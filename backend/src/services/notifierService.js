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
const STATE_FILE = path.resolve(__dirname, '../../../../.notify_state.json');

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

async function getPublicIpInfo() {
  try {
    // ip-api is a lightweight public API returning isp and query (ip)
    const res = await fetch('http://ip-api.com/json');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch IP info', err);
    return null;
  }
}

function formatMessage(state, ipInfo, extra) {
  const now = new Date().toLocaleString();
  const ip = ipInfo && ipInfo.query ? ipInfo.query : 'unknown';
  const isp = ipInfo && ipInfo.isp ? ipInfo.isp : 'unknown';
  let msg = `System ${state} at ${now}\nIP: ${ip}\nISP: ${isp}`;
  if (extra) msg += `\n${extra}`;
  return msg;
}

// Discord webhook support removed. We only support Telegram now.

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured; would send:', text);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = new URLSearchParams();
    body.append('chat_id', TELEGRAM_CHAT_ID);
    body.append('text', text);
    // ensure simple plain text message
    await fetch(url, { method: 'POST', body });
    // persistence handled by caller (notify) which knows the state
  } catch (err) {
    console.error('Failed to send Telegram message', err);
  }
}

async function notify(state = 'startup', extra) {
  try {
    const ipInfo = await getPublicIpInfo();
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

    // send to Telegram (if configured)
    await sendTelegram(msg);

    // update both in-memory and persistent
    _lastSent[state] = now;
    stateObj.lastNotify = stateObj.lastNotify || {};
    stateObj.lastNotify[state] = now;
    try { writeStateFile(stateObj); } catch (e) { /* ignore */ }
  } catch (err) {
    console.error('Notifier error', err);
  }
}

module.exports = { notify };
