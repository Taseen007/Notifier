# Start backend and frontend in new PowerShell windows
# Ensure you ran npm install in both backend and frontend before using this script

$projRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Prepare startup notification (Telegram)
try {
	$ipInfo = Invoke-RestMethod 'http://ip-api.com/json' -UseBasicParsing -ErrorAction Stop
	$now = (Get-Date).ToString()
	$content = "System START at $now`nIP: $($ipInfo.query)`nISP: $($ipInfo.isp)"
} catch {
	Write-Host "Failed to prepare startup notification: $_"
	$content = "System START at $(Get-Date)"
}

# Dedupe: check persistent state file to avoid duplicate sends
$stateFile = 'E:\Notifier\.notify_state.json'
$suppress = $false
$suppressWindowMinutes = 10
if (Test-Path $stateFile) {
	try {
		$json = Get-Content $stateFile -Raw | ConvertFrom-Json
		if ($json.lastNotify -and $json.lastNotify.startup) {
			$last = [int64]$json.lastNotify.startup
			$now = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
			$diffMs = $now - $last
			if (($diffMs / 1000 / 60) -lt $suppressWindowMinutes) {
				Write-Host "Startup notification suppressed; last sent $([math]::Round($diffMs/60000,2)) minutes ago"
				$suppress = $true
			}
		}
	} catch { }
}

if (-not $suppress -and $env:TELEGRAM_BOT_TOKEN -and $env:TELEGRAM_CHAT_ID) {
	try {
		$tgUrl = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage"
		$tgBody = @{ chat_id = $env:TELEGRAM_CHAT_ID; text = $content }
		Invoke-RestMethod -Uri $tgUrl -Method Post -Body $tgBody -UseBasicParsing
		try {
			$epochMs = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
			if (Test-Path $stateFile) { $obj = Get-Content $stateFile -Raw | ConvertFrom-Json } else { $obj = @{ lastNotify = @{} } }
			if (-not $obj.lastNotify) { $obj.lastNotify = @{} }
			$obj.lastNotify.startup = $epochMs
			$obj | ConvertTo-Json | Set-Content $stateFile -Force
		} catch { }
	} catch {
		Write-Host "Startup Telegram notification failed: $_"
	}
}

# Start Backend
Start-Process -FilePath powershell -ArgumentList "-NoExit","-Command","cd '$projRoot\..\backend'; if (!(Test-Path node_modules)) { npm install } ; npm run start" -WindowStyle Normal

# Start Frontend
Start-Process -FilePath powershell -ArgumentList "-NoExit","-Command","cd '$projRoot\..\frontend'; if (!(Test-Path node_modules)) { npm install } ; npm run start" -WindowStyle Normal

Write-Host "Started backend and frontend in new windows (if npm install ran, it may take a moment)."