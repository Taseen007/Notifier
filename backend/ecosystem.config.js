module.exports = {
  apps: [
    {
      name: 'notifier-backend',
      script: 'server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production'
        // TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID should be set in the user environment
        // or provided via a secure .env file loaded by your process.
      },
      // avoid aggressive restart loops
      min_uptime: 5000,
      max_restarts: 5,
      restart_delay: 5000
    }
  ]
};
