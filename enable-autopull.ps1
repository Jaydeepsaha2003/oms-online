# OMS - Register a Task Scheduler task that pulls new code from GitHub on a
# timer and restarts only when something actually arrived.
#
# Runs as the LOGGED-IN USER, not SYSTEM. That is deliberate and it is the whole
# reason this works: GitHub Desktop keeps the credential for a private repo in
# THIS user's Windows Credential Manager, and SYSTEM cannot see it - the fetch
# would fail silently for ever. The trade-off is that the task only runs while
# someone is logged in, which on an always-on shop-floor PC is the normal state.
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'OMS Auto Pull'
$Minutes = 5
if ($env:OMS_AUTOPULL_MINUTES) { $Minutes = [int]$env:OMS_AUTOPULL_MINUTES }

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ProjectDir\scripts\auto-pull.ps1`"" `
    -WorkingDirectory $ProjectDir

# At logon, and then every few minutes. The script exits in milliseconds when
# the remote has nothing new, so a short interval costs almost nothing.
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn
$Repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutes) -RepetitionDuration (New-TimeSpan -Days 3650)

# Interactive so it can reach this user's saved GitHub credential. Not Highest:
# pulling and building need no admin rights, and restart.bat only touches
# processes this same user started.
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# IgnoreNew matters: a build can outlast the interval, and a second copy on top
# of the first would fight over the same files. The script also takes its own
# lock, so this is belt and braces.
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $LogonTrigger,$Repeat `
    -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host "Scheduled task '$TaskName' created."
Write-Host "  Checks GitHub every $Minutes minutes as $env:USERNAME, and after every logon."
Write-Host '  Pulls only when the remote is ahead AND this machine has no uncommitted changes.'
Write-Host '  Applies any new migration, then runs restart.bat - which restarts nothing at all'
Write-Host '  for a frontend-only change, and leaves the old build serving if a build fails.'
Write-Host '  Log: logs\auto-pull.log'
