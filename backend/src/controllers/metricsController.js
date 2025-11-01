const { getDb } = require('../utils/db');

async function getLatest(req, res) {
  try {
    const db = await getDb();
    const row = await db.get('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 1');
    if (!row) return res.json({});
    res.json({
      id: row.id,
      timestamp: row.timestamp,
      cpu_percent: row.cpu_percent,
      mem_used: row.mem_used,
      mem_total: row.mem_total,
      disk_used: row.disk_used,
      disk_total: row.disk_total
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch latest metrics' });
  }
}

async function getHistory(req, res) {
  try {
    const limit = Math.min(1000, Number(req.query.limit) || 200);
    const db = await getDb();
    const rows = await db.all('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT ?', limit);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch metrics history' });
  }
}

module.exports = { getLatest, getHistory };
