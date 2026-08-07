# ============================================================
#  OMS - install the logon keep-alive (no administrator rights needed).
#
#  Puts a shortcut to oms-watchdog.vbs in the current user's Startup folder so
#  the watchdog comes back at every logon. The watchdog then relaunches the
#  production servers within a minute whenever they aren't listening - which is
#  what makes "started stays started" survive a reboot, a logoff, or a crash.
#
#  Why this exists: oms-watchdog.vbs has always documented that "a Startup-folder
#  shortcut launches this hidden at every logon", but nothing ever created that
#  shortcut. start.bat launched the watchdog for the CURRENT session only, so a
#  reboot left the machine with no watchdog and no servers until somebody
#  double-clicked start.bat again.
#
#  This is deliberately the no-admin mechanism (fires at logon). For coverage
#  BEFORE anyone logs in, run setup\enable-autostart.bat once as administrator -
#  that registers a SYSTEM scheduled task. The two are safe together: the watchdog
#  has a duplicate-instance guard and both respect the .oms-stopped marker, so an
#  intentional stop.bat stays stopped.
#
#  Idempotent: re-running only rewrites the shortcut if it's missing or stale.
#  Removed by setup\disable-autostart.bat - though start.bat re-installs it on
#  every launch, so to keep OMS down on purpose use stop.bat instead.
# ============================================================
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$watchdog = Join-Path $root 'oms-watchdog.vbs'
if (-not (Test-Path $watchdog)) {
    Write-Host "[keep-alive] oms-watchdog.vbs not found next to the project - skipped."
    exit 0
}

$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup -or -not (Test-Path $startup)) {
    Write-Host "[keep-alive] No Startup folder for this account - skipped."
    exit 0
}

$linkPath = Join-Path $startup 'OMS Keep Alive.lnk'
$wantArgs = '"' + $watchdog + '"'

# Only touch the file when something actually differs, so a normal start.bat run
# stays silent and doesn't churn the Startup folder.
$needsWrite = $true
if (Test-Path $linkPath) {
    try {
        $shellCheck = New-Object -ComObject WScript.Shell
        $existing = $shellCheck.CreateShortcut($linkPath)
        if ($existing.TargetPath -match 'wscript' -and $existing.Arguments -eq $wantArgs) {
            $needsWrite = $false
        }
    } catch {
        $needsWrite = $true
    }
}

if (-not $needsWrite) {
    exit 0
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($linkPath)
# wscript.exe (not cscript) so the watchdog runs with no console window at all.
$lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$lnk.Arguments = $wantArgs
$lnk.WorkingDirectory = $root
$lnk.Description = 'Keeps the OMS production servers running (relaunches them if they stop).'
$lnk.WindowStyle = 7  # minimised; wscript is hidden regardless
$lnk.Save()

Write-Host "[keep-alive] Installed - OMS will now come back on its own after a reboot or logon."
