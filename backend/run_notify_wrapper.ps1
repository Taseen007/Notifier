# Wrapper to import persistent User env vars and run the temporary notifier script
$env:TELEGRAM_BOT_TOKEN = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN','User')
$env:TELEGRAM_CHAT_ID  = [Environment]::GetEnvironmentVariable('TELEGRAM_CHAT_ID','User')
Write-Output 'Imported persistent User env into this shell (tokens not shown).'
Write-Output "TELEGRAM_BOT_TOKEN present: $([bool]($env:TELEGRAM_BOT_TOKEN))"
Write-Output "TELEGRAM_CHAT_ID present: $([bool]($env:TELEGRAM_CHAT_ID))"
Set-Location -Path 'E:\Notifier\backend'
node tmp_run_notify.js
