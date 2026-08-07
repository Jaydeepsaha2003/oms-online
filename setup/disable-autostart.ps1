# OMS - Turn OFF every way OMS brings itself back on its own:
#   1. the SYSTEM boot task registered by enable-autostart.ps1,
#   2. the 'OMS Auto Start' Startup shortcut left over from an older version,
#   3. the 'OMS Keep Alive' logon shortcut that starts the watchdog.
# Does NOT stop a server that's already running - use stop.bat for that.
#
# Note on (3): start.bat re-installs the keep-alive shortcut on EVERY launch
# (see scripts\install-keepalive.ps1), so this only stays undone until the next
# start.bat. To keep OMS down on purpose, use stop.bat - it drops the
# .oms-stopped marker, which both the watchdog and the boot task honour.
$TaskName = 'OMS Auto Start'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
} else {
    Write-Host 'Nothing to remove - the scheduled task was not present.'
}

$Startup = [Environment]::GetFolderPath('Startup')

$OldShortcut = Join-Path $Startup 'OMS Auto Start.lnk'
if (Test-Path $OldShortcut) {
    Remove-Item $OldShortcut -Force
    Write-Host 'Also removed the older Startup-folder shortcut.'
}

$KeepAlive = Join-Path $Startup 'OMS Keep Alive.lnk'
if (Test-Path $KeepAlive) {
    Remove-Item $KeepAlive -Force
    Write-Host "Removed the logon keep-alive shortcut - the watchdog no longer starts at logon."
    Write-Host "  (start.bat re-installs it; use stop.bat to keep OMS down on purpose.)"
} else {
    Write-Host 'The logon keep-alive was not installed - nothing to do there.'
}
