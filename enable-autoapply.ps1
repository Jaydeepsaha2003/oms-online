# OMS - Register the task that applies this machine's code changes by itself
# (scripts\auto-apply.ps1, every minute). Runs as the signed-in user, like the
# servers themselves, so restart.bat can stop and start them.
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'OMS Auto Apply'

# Through wscript + a .vbs: powershell.exe started directly flashes a console
# window every minute, -WindowStyle Hidden or not.
$Action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$ProjectDir\auto-apply-hidden.vbs`"" -WorkingDirectory $ProjectDir
$Triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$RunAs = if ($env:OMS_TASK_USER) { $env:OMS_TASK_USER.Trim() } else { "$env:USERDOMAIN\$env:USERNAME" }
$Principal = New-ScheduledTaskPrincipal -UserId $RunAs -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Principal $Principal -Settings $Settings -Force -ErrorAction Stop | Out-Null
} catch {
    Write-Host "  Could not register the scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Write-Host "  '$TaskName' was not created." -ForegroundColor Red
    exit 1
}
Write-Host "Scheduled task '$TaskName' created - runs every minute as $RunAs."
