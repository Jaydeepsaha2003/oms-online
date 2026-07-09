# OMS - Remove the Startup-folder shortcut created by enable-autostart.ps1.
# Does NOT stop a server that's already running - use stop.bat for that.
$Startup = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $Startup 'OMS Auto Start.lnk'

if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "Removed: $ShortcutPath"
} else {
    Write-Host 'Nothing to remove - auto-start was not enabled.'
}
