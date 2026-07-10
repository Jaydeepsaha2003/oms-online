# OMS - Remove the Task Scheduler auto-start task (and the older
# Startup-folder shortcut, if left over from a previous version).
# Does NOT stop a server that's already running - use stop.bat for that.
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
