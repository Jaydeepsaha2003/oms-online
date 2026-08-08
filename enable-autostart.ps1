# OMS - Register a Task Scheduler task that runs at every Windows power-on
# (before any login), as SYSTEM, silently launching autostart-oms.vbs.
# Also removes the older Startup-folder shortcut (login-only) if present,
# since this task supersedes it.
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'OMS Auto Start'

$Startup = [Environment]::GetFolderPath('Startup')
$OldShortcut = Join-Path $Startup 'OMS Auto Start.lnk'
if (Test-Path $OldShortcut) {
    Remove-Item $OldShortcut -Force
    Write-Host 'Removed the older login-only Startup shortcut.'
}

$Action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$ProjectDir\autostart-oms.vbs`""
# Two triggers: at every boot, plus a watchdog re-check every 5 minutes so the
# servers come back even if they ever crash mid-day. The vbs is a no-op when
# the server is already running or when stop.bat left its .oms-stopped marker,
# so the repeat costs nothing and never fights an intentional stop.
$BootTrigger = New-ScheduledTaskTrigger -AtStartup
$WatchTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $BootTrigger,$WatchTrigger -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host "Scheduled task '$TaskName' created - OMS starts at Windows power-on and is re-checked every 5 minutes (self-healing), with no browser opened."
