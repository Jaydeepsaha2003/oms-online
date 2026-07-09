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
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host "Scheduled task '$TaskName' created - OMS will now start at Windows power-on, before login, with no browser opened."
