# System Monitor (notifier)

This repository contains a small system monitor (notifier) scaffold with a Node backend that collects local system metrics and a simple static frontend to view them.

Structure
```
system-monitor/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── utils/
│   │   └── App.js
│   ├── public/
│   ├── package.json
│   └── package-lock.json (optional)
├── scripts/
│   ├── startup-monitor.ps1
│   ├── shutdown-monitor.ps1
│   └── linux-monitor.sh
├── database/
│   └── init.sql
└── README.md
```

Quick start (Windows PowerShell)

1. Open PowerShell in the repository root.
2. Start the provided script which will open two windows (backend + frontend):

   ./scripts/startup-monitor.ps1

Alternatively, run manually:

- Backend
  cd backend
  npm install
  npm start

- Frontend (static server)
  cd frontend
  npm install
  npm start

By default the backend will run on http://localhost:4000 and the frontend static server on http://localhost:3000.

What it does
- Backend: collects CPU, memory and disk usage every 10 seconds (default) using the `systeminformation` package and stores them in a local sqlite database: `database/metrics.db`.
- Frontend: simple static page at `frontend/public/index.html` that fetches `/api/metrics/latest` and `/api/metrics/history` to display metrics.

Files to look at
- `backend/server.js` - start point
- `backend/src/services/monitorService.js` - metrics collection and DB writes
- `backend/src/controllers/metricsController.js` - API endpoints
- `frontend/public/index.html` - lightweight UI
- `database/init.sql` - initial DB schema

Notes and next steps
- This scaffold uses sqlite stored at `database/metrics.db` created by the backend on first run.
 - For notifications (alerts), we added a simple Telegram notifier and helper scripts. See next section.
- To convert the frontend to React with a build pipeline, replace the static HTML and add a bundler (Vite/Create React App).

Telegram (recommended for direct phone notifications)
----------------------------------------------------
Telegram delivers direct messages to your phone reliably and is ideal for personal notifications. To enable Telegram notifications:

1. Create a bot using BotFather in Telegram and get the bot token.
2. Send a message to your bot (so it appears in getUpdates) or use a helper to get your chat id.
3. Set the following environment variables (PowerShell temporary example):

```powershell
$env:TELEGRAM_BOT_TOKEN = '123456789:ABCdefGhIjK...'
$env:TELEGRAM_CHAT_ID = '123456789'
Set-Location -Path 'E:\Notifier\scripts'
.\startup-monitor.ps1
```

The backend and helper scripts will send a startup notification to Telegram when the env vars are set.

License: MIT (adapt as needed)
