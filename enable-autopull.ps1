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

# Interactive so the task can reach this user's saved GitHub credential, and
# RunLevel Limited so it runs with no more rights than the user has - pulling
# and building need none, and restart.bat only touches processes this same user
# started. Registering the task is the only step that needs elevation, and the
# .bat handles that before we get here.
# After elevation $env:USERNAME is "Administrator", which is NOT who needs to
# run this - the GitHub credential belongs to the person signed in at the
# console. enable-autopull.bat discovers that name and passes it here.
$RunAs = if ($env:OMS_TASK_USER) { $env:OMS_TASK_USER.Trim() } else { "$env:USERDOMAIN\$env:USERNAME" }
$Principal = New-ScheduledTaskPrincipal -UserId $RunAs -LogonType Interactive -RunLevel Limited

# IgnoreNew matters: a build can outlast the interval, and a second copy on top
# of the first would fight over the same files. The script also takes its own
# lock, so this is belt and braces.
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Registering in the root task folder needs admin, even for a task that will
# RUN unprivileged - so enable-autopull.bat elevates before calling this. The
# check below is not belt-and-braces: Register-ScheduledTask fails
# non-terminating, so without it an "Access is denied" scrolled past and the
# script still announced success. It did exactly that once.
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $LogonTrigger,$Repeat `
        -Principal $Principal -Settings $Settings -Force -ErrorAction Stop | Out-Null
} catch {
    Write-Host ''
    Write-Host '  Could not register the scheduled task:' -ForegroundColor Red
    Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Message -match 'denied|0x80070005') {
        Write-Host ''
        Write-Host '  This one needs administrator rights. Right-click' -ForegroundColor Yellow
        Write-Host '  enable-autopull.bat and choose "Run as administrator".' -ForegroundColor Yellow
    }
    exit 1
}

# Prove it, rather than trust the call. Belt and braces here IS warranted: the
# whole point of this script is that nobody has to check on it afterwards.
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host "  Register-ScheduledTask reported no error, but '$TaskName' is not there." -ForegroundColor Red
    exit 1
}

Write-Host "Scheduled task '$TaskName' created."
Write-Host "  Checks GitHub every $Minutes minutes as $RunAs, and after every logon."
Write-Host '  Pulls only when the remote is ahead AND this machine has no uncommitted changes.'
Write-Host '  Applies any new migration, then runs restart.bat - which restarts nothing at all'
Write-Host '  for a frontend-only change, and leaves the old build serving if a build fails.'
Write-Host '  Log: logs\auto-pull.log'
