const si = require('systeminformation');
const { getDb } = require('../utils/db');

// Monitor interval in milliseconds
const INTERVAL = Number(process.env.MONITOR_INTERVAL_MS) || 10_000; // 10s
let timer = null;

async function init() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    cpu_percent REAL,
    mem_used INTEGER,
    mem_total INTEGER,
    disk_used INTEGER,
    disk_total INTEGER
  )`);
  // Start loop
  schedule();
}

async function collectAndSave() {
  try {
    const ts = Date.now();
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const fsSize = await si.fsSize();
    // choose first filesystem as a simple approximation
    const disk = fsSize && fsSize[0] ? fsSize[0] : { used: 0, size: 0 };

    const db = await getDb();
    await db.run(
      `INSERT INTO metrics (timestamp, cpu_percent, mem_used, mem_total, disk_used, disk_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ts,
      cpu.currentload || 0,
      mem.used || 0,
      mem.total || 0,
      disk.used || 0,
      disk.size || 0
    );

    // keep DB small: delete entries older than 7 days
    const sevenDaysAgo = ts - 7 * 24 * 60 * 60 * 1000;
    await db.run('DELETE FROM metrics WHERE timestamp < ?', sevenDaysAgo);
  } catch (err) {
    console.error('Error collecting metrics', err);
  }
}

function schedule() {
  if (timer) return;
  // collect immediately then at interval
  collectAndSave();
  timer = setInterval(collectAndSave, INTERVAL);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { init, stop, collectAndSave };
