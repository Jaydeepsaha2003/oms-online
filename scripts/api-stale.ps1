# ============================================================
#  Is the RUNNING api older than the build it is supposed to serve?
#
#    exit 1  stale - the process predates apps\api\dist, bounce it
#    exit 0  fine  - or nothing is listening on 4000
#
#  This is the one test that must run AFTER the build, and the reason
#  restart.bat could not be trusted. Scope is decided before building - it has
#  to be, since building is what moves the timestamps it compares - so a build
#  that happens during THIS run leaves the API process older than its own fresh
#  dist, with a pre-build verdict of 'none' and nothing to correct it. That is
#  exactly what was observed: "Change scope: none", then
#  "API changed - building API", then "running servers were left untouched".
#
#  It depends on no source timestamps at all, only on the process against dist,
#  so it is safe to re-run at any point and decisive when it fires.
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Split-Path $PSScriptRoot -Parent)

$apiPid = (Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue | Select-Object -First 1).OwningProcess
if (-not $apiPid) { exit 0 }   # nothing running; the launch step will start it

# Get-Process's .StartTime silently returns nothing for a live listening
# node.exe on this machine (observed, not assumed), and $ErrorActionPreference
# swallows the failure - so read the same fact through WMI instead.
$started = (Get-CimInstance Win32_Process -Filter "ProcessId=$apiPid" -EA SilentlyContinue).CreationDate
if (-not $started) { exit 0 }

$newest = [datetime]::MinValue
foreach ($f in Get-ChildItem 'apps\api\dist' -Recurse -File -Exclude '*.tsbuildinfo' -EA SilentlyContinue) {
  if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
}
if ($newest -eq [datetime]::MinValue) { exit 0 }

if ($started.ToUniversalTime() -lt $newest) { exit 1 } else { exit 0 }
