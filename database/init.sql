-- Database initialization for system-monitor

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  cpu_percent REAL,
  mem_used INTEGER,
  mem_total INTEGER,
  disk_used INTEGER,
  disk_total INTEGER
);
