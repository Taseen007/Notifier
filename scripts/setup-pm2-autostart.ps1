<#
Setup script to start pm2 with the project's ecosystem and enable resurrect at user login.

This script will:
- attempt to start the app via `pm2 start ecosystem.config.js --env production`
- run `pm2 save` to persist the process list
- create a HKCU Run registry entry that runs `pm2 resurrect` at user login

Notes:
- Do NOT put secrets directly into the ecosystem file. Ensure your TELEGRAM env vars are set
  as user variables (setx or via System Properties) before running this script or start PM2
  from a shell that has them.
#>

param()

Write-Output "Running pm2 ecosystem setup..."

# Resolve pm2 command
$pm2Cmd = $null
try {
    $pm2Cmd = (Get-Command pm2 -ErrorAction Stop).Source
} catch {
    # try typical npm global location
    $possible = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path $possible) { $pm2Cmd = $possible }
}

if (-not $pm2Cmd) {
    Write-Output "pm2 not found in PATH. Please install pm2 globally (npm i -g pm2) or launch this script from a shell where pm2 is available."
    exit 2
}

Push-Location 'E:\Notifier\backend'

Write-Output "Starting processes with pm2 using ecosystem.config.js... (pm2 path: $pm2Cmd)"
& $pm2Cmd start ecosystem.config.js --env production

Write-Output "Saving pm2 process list..."
& $pm2Cmd save

# Create HKCU Run entry to resurrect pm2 on login
$runCmd = "`"$env:APPDATA\npm\pm2.cmd`" resurrect"
Write-Output "Creating HKCU Run key to call: $runCmd"
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v pm2-resurrect /d "$runCmd" /f | Out-Null

Write-Output "pm2 ecosystem setup complete. Verify with: pm2 ls"

Pop-Location
