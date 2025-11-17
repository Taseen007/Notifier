const fetch = globalThis.fetch || require('node-fetch');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// suppression windows (ms) per state
const SUPPRESSION_MS_STARTUP = Number(process.env.NOTIFY_SUPPRESSION_MS_STARTUP) || 10 * 60 * 1000; // 10 minutes
const SUPPRESSION_MS_SHUTDOWN = Number(process.env.NOTIFY_SUPPRESSION_MS_SHUTDOWN) || 10 * 60 * 1000; // 10 minutes
const SUPPRESSION_MS_TEST = Number(process.env.NOTIFY_SUPPRESSION_MS_TEST) || 5 * 1000; // 5 seconds
const _lastSent = {}; // in-memory cache state -> timestamp (epoch ms)
const fs = require('fs');
const path = require('path');
const dns = require('dns');

// fallback DNS servers to use if system DNS fails (Cloudflare, Google)
const DNS_FALLBACK = ['1.1.1.1', '8.8.8.8'];
const QUEUE_PATH = path.resolve(__dirname, '../../.notify_queue.json');
const MAX_SEND_RETRIES = 3;
const QUEUE_PROCESS_INTERVAL_MS = 30 * 1000; // 30s
let queueProcessing = false;
const STATE_FILE = path.resolve(__dirname, '../../../../.notify_state.json');
// Unique boot identifier for this process start — used to deduplicate startup messages
const BOOT_ID = Date.now();

function readStateFile() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8') || '{}';
      return JSON.parse(raw);
    }
  } catch (e) {
    // ignore
  }
  return { lastNotify: {} };
}

function writeStateFile(obj) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
  } catch (e) {
    // ignore
  }
}

// small fetch-with-timeout helper using AbortController when available
function fetchWithTimeout(url, opts = {}, timeoutMs = 3000) {
  // prefer global AbortController if available
  const AbortController = globalThis.AbortController || require('abort-controller');
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const options = Object.assign({}, opts, { signal: controller.signal });
  return fetch(url, options).finally(() => clearTimeout(id));
}

async function getPublicIpInfo() {
  const providers = [
    { url: 'https://api.ipify.org?format=json', extract: body => ({ query: body.ip, isp: body.org || body.hostname || 'unknown' }) },
    { url: 'https://ipinfo.io/json', extract: body => ({ query: body.ip || body.ipv4 || body.ipv6 || body.hostname || body.query, isp: body.org || body.isp || 'unknown' }) },
    { url: 'http://ip-api.com/json', extract: body => ({ query: body.query || body.ip, isp: body.isp || body.org || 'unknown' }) }
  ];

  // try providers once with a short per-request timeout
  for (const p of providers) {
    try {
      const res = await fetchWithTimeout(p.url, { method: 'GET' }, 3000);
      if (!res || !res.ok) continue;
      let body;
      try { body = await res.json(); } catch (e) { continue; }
      const info = p.extract(body);
      if (info && info.query) return info;
    } catch (err) {
      // fetch timeout or resolve errors should not block send
      console.debug(`Public IP provider ${p.url} failed:`, err && err.message ? err.message : err);
    }
  }

  // If all providers failed, attempt a DNS fallback once and retry providers
  try {
    const current = dns.getServers ? dns.getServers() : [];
    console.debug('All public IP providers failed; attempting DNS fallback', { current });
    dns.setServers(DNS_FALLBACK);
    for (const p of providers) {
      try {
        const res = await fetchWithTimeout(p.url, { method: 'GET' }, 3000);
        if (!res || !res.ok) continue;
        let body;
        try { body = await res.json(); } catch (e) { continue; }
        const info = p.extract(body);
        if (info && info.query) return info;
      } catch (err) {
        console.debug(`Retry provider ${p.url} failed after DNS fallback:`, err && err.message ? err.message : err);
      }
    }
  } catch (e) {
    console.debug('DNS fallback attempt failed', e && e.message ? e.message : e);
  }

  console.debug('All public IP providers failed even after DNS fallback; falling back to unknown');
  return null;
}

// Simple sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Queue utilities
function ensureQueueFile() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) {
      fs.writeFileSync(QUEUE_PATH, JSON.stringify([]), { encoding: 'utf8' });
    }
  } catch (e) {
    console.error('Failed to ensure queue file', e && e.message ? e.message : e);
  }
}

function readQueue() {
  try {
    ensureQueueFile();
    const raw = fs.readFileSync(QUEUE_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed to read queue file', e && e.message ? e.message : e);
    return [];
  }
}

function writeQueue(items) {
  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2), { encoding: 'utf8' });
  } catch (e) {
    console.error('Failed to write queue file', e && e.message ? e.message : e);
  }
}

// enqueue a message for later retry. item may be { payload: { text }, state?: 'startup'|'shutdown'|... }
function enqueueMessage(item) {
  try {
    const state = item && item.state;
    const fingerprint = item && item.fingerprint;
    const q = readQueue();
    // If this is a startup item, avoid duplicating the same fingerprint
    if (state === 'startup' && fingerprint) {
      const exists = q.some(e => e && e.fingerprint && e.fingerprint === fingerprint);
      if (exists) {
        console.log('Startup notification already queued for this boot; skipping enqueue; fingerprint=', fingerprint);
        return;
      }
    }
    q.push(Object.assign({ id: Date.now() }, item));
    writeQueue(q);
    console.log('Enqueued failed notification for retry later; queueLength=', q.length);
  } catch (e) {
    console.error('Failed to enqueue message', e && e.message ? e.message : e);
  }
}

async function processQueueOnce() {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    const q = readQueue();
    if (!q.length) return;
    console.log('Processing notification queue, items=', q.length);
    const remaining = [];
    // load persistent state once for dedupe checks
    const stateObj = readStateFile();
    for (const item of q) {
      try {
        // If this is a startup queued item, skip it if we've already recorded a successful startup send for this boot
        if (item && item.state === 'startup') {
          const lastStartup = (stateObj && stateObj.lastNotify && stateObj.lastNotify.startup) || 0;
          // if lastStartup >= item.fingerprint then this boot's startup has already been delivered
          if (item.fingerprint && lastStartup && Number(lastStartup) >= Number(item.fingerprint)) {
            console.log('Dropping queued startup notification because startup already delivered for this boot; id=', item.id, 'fingerprint=', item.fingerprint);
            continue;
          }
        }
        const ok = await sendTelegramRaw(item.payload, { enqueueOnFail: false, tryEmailFallback: true, state: item.state, fingerprint: item.fingerprint });
        if (!ok) {
          remaining.push(item);
        }
      } catch (e) {
        console.debug('Queue item send threw', e && e.message ? e.message : e);
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    if (remaining.length) console.log('Queue processing finished; remaining=', remaining.length);
    else console.log('Queue emptied successfully');
  } finally {
    queueProcessing = false;
  }
}

function startQueueProcessor() {
  ensureQueueFile();
  // run immediately then on interval
  processQueueOnce().catch(e => console.error('Queue initial process failed', e));
  setInterval(() => {
    processQueueOnce().catch(e => console.error('Queue process failed', e));
  }, QUEUE_PROCESS_INTERVAL_MS);
}

function formatMessage(state, ipInfo, extra) {
  const now = new Date().toLocaleString();
  const ip = ipInfo && ipInfo.query ? ipInfo.query : 'unknown';
  const isp = ipInfo && ipInfo.isp ? ipInfo.isp : 'unknown';
  let msg = `System ${state} at ${now}\nIP: ${ip}\nISP: ${isp}`;
  if (extra) msg += `\n${extra}`;
  return msg;
}

// low-level sender: accepts payload { text } and options { enqueueOnFail }
async function sendTelegramRaw(payload, options = { enqueueOnFail: true, tryEmailFallback: true, state: null, fingerprint: null }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured; would send:', payload && payload.text);
    return true;
  }

  const { text } = payload || {};
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = new URLSearchParams();
  body.append('chat_id', TELEGRAM_CHAT_ID);
  body.append('text', text);

  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', body });
      if (!res || !res.ok) {
        let respText = '';
        try { respText = await res.text(); } catch (e) { /* ignore */ }
        console.error(`Telegram API non-ok response (attempt ${attempt})`, res && res.status, respText);
        // retry after delay
        await sleep(1000 * attempt);
        continue;
      }
      const json = await res.json();
      if (json && json.ok) {
        console.log('Telegram message sent, message_id=', json.result && json.result.message_id);
        return true;
      }
      console.error('Telegram API responded but reported failure', json);
      await sleep(1000 * attempt);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error(`Telegram send attempt ${attempt} failed:`, msg);
      if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
        try {
          console.log('Applying DNS fallback servers and retrying later attempts');
          dns.setServers(DNS_FALLBACK);
        } catch (e) {
          console.debug('Failed to set DNS fallback', e && e.message ? e.message : e);
        }
      }
      // exponential backoff between attempts
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
  }

  console.error('All Telegram send attempts failed');
  // Try email fallback if configured and requested
  if (options.tryEmailFallback) {
    try {
      const emailOk = await sendEmailFallback({ text });
      if (emailOk) return true;
    } catch (e) {
      console.error('Email fallback attempt threw', e && e.message ? e.message : e);
    }
  }
  if (options.enqueueOnFail) {
    try {
      enqueueMessage({ payload: { text }, state: options.state, fingerprint: options.fingerprint });
    } catch (e) {
      console.error('Failed to enqueue failed Telegram message', e && e.message ? e.message : e);
    }
  }
  return false;
}

// convenience wrapper
async function sendTelegram(text) {
  return sendTelegramRaw({ text }, { enqueueOnFail: true, tryEmailFallback: true });
}

// Email fallback using nodemailer (optional). Requires environment variables:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO
async function sendEmailFallback(payload) {
  const { text } = payload || {};
  // Attempt to require nodemailer if installed
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    console.debug('nodemailer not installed; email fallback unavailable');
    return false;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const to = process.env.SMTP_TO;

  if (!host || !to) {
    console.debug('Email fallback not configured (SMTP_HOST or SMTP_TO missing)');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const mail = {
    from,
    to,
    subject: 'Notifier fallback message',
    text,
  };

  try {
    const info = await transporter.sendMail(mail);
    console.log('Email fallback sent:', info && info.messageId);
    return true;
  } catch (e) {
    console.error('Email fallback failed', e && e.message ? e.message : e);
    return false;
  }
}

async function notify(state = 'startup', extra) {
  try {
    // Try to get IP info but don't block sending—use a short overall timeout.
    let ipInfo = null;
    try {
      // overall timeout for IP lookup (ms)
      const ipLookup = getPublicIpInfo();
      ipInfo = await Promise.race([
        ipLookup,
        (async () => { await sleep(3000); return null; })()
      ]);
      if (!ipInfo) console.debug('Public IP lookup timed out or failed; proceeding with unknown IP');
    } catch (e) {
      console.debug('Public IP lookup threw; proceeding with unknown IP', e && e.message ? e.message : e);
      ipInfo = null;
    }
    const msg = formatMessage(state, ipInfo, extra);
    const now = Date.now();

    // choose suppression window
    let windowMs = SUPPRESSION_MS_TEST;
    if (state === 'startup') windowMs = SUPPRESSION_MS_STARTUP;
    else if (state === 'shutdown') windowMs = SUPPRESSION_MS_SHUTDOWN;

    // check in-memory first
    const lastInMem = _lastSent[state] || 0;
    if (now - lastInMem < windowMs) {
      console.log(`Notifier suppressed (in-memory) (${state}) — last sent ${now - lastInMem}ms ago`);
      return;
    }

    // check persistent state file
    const stateObj = readStateFile();
    const lastPersistent = (stateObj && stateObj.lastNotify && stateObj.lastNotify[state]) || 0;
    if (now - lastPersistent < windowMs) {
      console.log(`Notifier suppressed (persistent) (${state}) — last sent ${now - lastPersistent}ms ago`);
      // update in-memory too
      _lastSent[state] = lastPersistent;
      return;
    }

    // Attempt to send to Telegram (if configured). Always attempt regardless of network/interface.
    console.log(`Notifier attempting to send (${state}) — ip=${ipInfo && ipInfo.query ? ipInfo.query : 'unknown'}`);
    // Use low-level send with state metadata. For startup we enqueue on failure but include a boot fingerprint
    if (state === 'startup') {
      await sendTelegramRaw({ text: msg }, { enqueueOnFail: true, tryEmailFallback: true, state: 'startup', fingerprint: BOOT_ID });
    } else {
      await sendTelegram(msg);
    }

    // update both in-memory and persistent
    _lastSent[state] = now;
    stateObj.lastNotify = stateObj.lastNotify || {};
    stateObj.lastNotify[state] = now;
    try { writeStateFile(stateObj); } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Notifier error', err && err.message ? err.message : err);
  }
}

// Start queue processor on module load
startQueueProcessor();

module.exports = { notify };
