# ============================================================
#  Is this machine actually RUNNING the code it has pulled?
#
#  "I pulled and restarted but nothing changed" has three completely
#  different causes, and they are indistinguishable from the screen:
#
#    1. the pull never landed          -> git HEAD is behind
#    2. the build never ran            -> dist is older than src
#    3. the build ran but the BROWSER  -> dist is new, API is new,
#       is still on its cached shell      only the open tab is stale
#
#  Guessing between them is how an afternoon disappears. Run this on the
#  machine that looks stale; it names the cause.
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Line($k, $v) { '{0,-30} {1}' -f $k, $v }

Write-Output '=== 1. what this checkout is on ============================='
Write-Output (Line 'HEAD' (git log --oneline -1))
$dirty = git status --porcelain
Write-Output (Line 'uncommitted changes' $(if ($dirty) { "yes ($(($dirty -split "`n").Count) files)" } else { 'none' }))

Write-Output ''
Write-Output '=== 2. did the build run after the pull? ===================='
$newest = {
  param($p)
  if (-not (Test-Path $p)) { return $null }
  (Get-ChildItem $p -Recurse -File -Exclude '*.tsbuildinfo' -EA SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
}
foreach ($pair in @(
    @{ n = 'shared'; src = 'packages\shared\src'; out = 'packages\shared\dist' },
    @{ n = 'api';    src = 'apps\api\src';        out = 'apps\api\dist' },
    @{ n = 'web';    src = 'apps\web\src';        out = 'apps\web\dist' })) {
  $s = & $newest $pair.src; $o = & $newest $pair.out
  $verdict = if (-not $o) { 'NEVER BUILT — run start.bat' }
             elseif ($s -gt $o) { 'STALE — source is newer than the build' }
             else { 'built' }
  Write-Output (Line "$($pair.n) dist" $verdict)
}

Write-Output ''
Write-Output '=== 3. is the RUNNING api the built one? ===================='
# A new route answers 401 (auth required). 404 means the process predates it.
try {
  $r = Invoke-WebRequest 'http://127.0.0.1:4000/api/agent-commission/rates/impact' -UseBasicParsing -TimeoutSec 5
  $code = $r.StatusCode
} catch { $code = $_.Exception.Response.StatusCode.value__ }
Write-Output (Line 'GET /rates/impact' $(switch ($code) {
      401 { '401 - running the NEW build' }
      404 { '404 - STALE process, restart the API' }
      default { "$code - could not tell (is the API up?)" } }))

$pid4000 = (Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue | Select-Object -First 1).OwningProcess
if ($pid4000) {
  $started = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid4000").CreationDate
  $apiOut = & $newest 'apps\api\dist'
  Write-Output (Line 'api process started' $started)
  Write-Output (Line 'api dist built' $(if ($apiOut) { $apiOut.ToLocalTime() } else { 'n/a' }))
  if ($started -and $apiOut -and $started.ToUniversalTime() -lt $apiOut) {
    Write-Output (Line '' 'PROCESS IS OLDER THAN THE BUILD - restart it')
  }
}

Write-Output ''
Write-Output '=== 4. does the built bundle contain the new screens? ======='
foreach ($needle in 'Rate register', 'All rates', 'Settlement register', 'rates/impact') {
  $hit = Select-String -Path 'apps\web\dist\assets\*.js' -SimpleMatch $needle -List -EA SilentlyContinue
  Write-Output (Line "`"$needle`"" $(if ($hit) { 'present in dist' } else { 'NOT in dist - rebuild the web app' }))
}

Write-Output ''
Write-Output '=== verdict ================================================'
Write-Output 'If 2, 3 and 4 all look right, the server is fine and the BROWSER'
Write-Output 'is holding the old service-worker shell. On the client machine:'
Write-Output '  Ctrl+Shift+R, or DevTools > Application > Service Workers >'
Write-Output '  Unregister, then reload. The app also self-updates once idle.'
