const express = require('express');
const cors = require('cors');
const path = require('path');
const monitorService = require('./src/services/monitorService');
const notifier = require('./src/services/notifierService');
const metricsController = require('./src/controllers/metricsController');

const app = express();
app.use(express.json());
app.use(cors());

// Routes
app.get('/api/metrics/latest', metricsController.getLatest);
app.get('/api/metrics/history', metricsController.getHistory);

const PORT = process.env.PORT || 4000;

async function start() {
  // initialize DB and start monitoring loop
  await monitorService.init();
  app.listen(PORT, () => {
    console.log(`System Monitor backend listening on port ${PORT}`);
    // send a startup notification (if configured)
    notifier.notify('startup').catch(err => console.error('Startup notifier failed', err));
  });
}

start().catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});

// Keep startup notifications only. On signals we exit without sending a shutdown notification
process.on('SIGINT', () => {
  console.log('Received SIGINT, exiting (no shutdown notification)');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, exiting (no shutdown notification)');
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
  // Exit without sending shutdown notifications to avoid false messages during crashes.
  process.exit(1);
});
