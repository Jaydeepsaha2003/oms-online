# OMS - Apply code changes made ON THIS MACHINE without anyone running restart.bat.
#
# Run every minute by the task enable-autoapply.bat registers. Does nothing unless
# the sources are newer than the running build (restart-scope.ps1 decides, the
# same check restart.bat makes), and then waits until nobody has touched a source
# file for QUIET_MINUTES - so a change being made across several files is never
# built half-way through. Then it runs restart.bat, which builds FIRST, restarts
# only what changed (a frontend change restarts nothing), and leaves the old
# build serving if the build fails. A failed build is not retried until the
# sources change again.
$ErrorActionPreference = 'Continue'
$Project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Project

$QuietMinutes = 1
$LogFile = Join-Path $Project 'logs\auto-apply.log'
$LockFile = Join-Path $Project '.oms-autoapply-running'
$FailedFile = Join-Path $Project '.oms-autoapply-failed'
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

function Write-Log([string]$Message) {
    Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}
if ((Test-Path $LogFile) -and ((Get-Content $LogFile).Count -gt 2000)) {
    Set-Content $LogFile (Get-Content $LogFile | Select-Object -Last 500)
}

# Someone (or auto-pull) is already restarting, or an earlier run is still building.
foreach ($busy in '.oms-restarting', '.oms-autopull-running') { if (Test-Path (Join-Path $Project $busy)) { exit 0 } }
if (Test-Path $LockFile) {
    if (((Get-Date) - (Get-Item $LockFile).LastWriteTime).TotalMinutes -lt 30) { exit 0 }
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

# Is there anything to apply?
$scope = (& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Project 'scripts\restart-scope.ps1') | Select-Object -Last 1)
$scope = "$scope".Trim()
if (-not $scope -or $scope -eq 'none') { exit 0 }

# Wait for the edits to settle.
# Not the whole prisma folder: the live database (dev.db) sits in it and changes
# every minute, which made the code look forever mid-edit and nothing applied.
$sources = 'apps\api\src', 'apps\api\prisma\schema.prisma', 'apps\api\prisma\migrations', 'apps\web\src', 'apps\web\index.html', 'packages\shared\src'
$newest = [datetime]::MinValue
foreach ($s in $sources) {
    $files = if (Test-Path $s -PathType Container) { Get-ChildItem $s -Recurse -File -ErrorAction SilentlyContinue } else { Get-Item $s -ErrorAction SilentlyContinue }
    foreach ($f in $files) { if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc } }
}
if (((Get-Date).ToUniversalTime() - $newest).TotalMinutes -lt $QuietMinutes) { exit 0 }

# This exact set of sources already failed to build: wait for a fix.
$signature = "$($newest.Ticks)"
if ((Test-Path $FailedFile) -and ((Get-Content $FailedFile -Raw).Trim() -eq $signature)) { exit 0 }

'running' | Set-Content $LockFile
try {
    Write-Log "Changes found (scope: $scope) - building and restarting..."
    # stdin from NUL: restart.bat's pause/timeout must not wait for a keypress nobody will press.
    & cmd.exe /c "`"$Project\restart.bat`" < NUL" 2>&1 | ForEach-Object { if ($_ -match '\S') { Write-Log "restart: $_" } }
    if ($LASTEXITCODE -ne 0) {
        $signature | Set-Content $FailedFile
        Write-Log "restart.bat exited $LASTEXITCODE - the previous build keeps serving. Waiting for the sources to change."
    } else {
        Remove-Item $FailedFile -Force -ErrorAction SilentlyContinue
        Write-Log 'Applied - the new code is live.'
    }
}
finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
