# ============================================================
#  Decide how much of OMS needs relaunching after a build.
#
#  Prints exactly one word for restart.bat to read:
#    full  - shared package changed (API and web are both built from it),
#            or a build output is missing entirely
#    api   - only backend sources / the Prisma schema changed
#    web   - only frontend sources changed; NOTHING needs relaunching, because
#            both servers serve apps\web\dist straight off disk
#    none  - nothing changed since the last build
#
#  MUST run BEFORE the build: it compares source timestamps against build
#  outputs, and building is what makes those outputs newer.
# ============================================================
$ErrorActionPreference = 'SilentlyContinue'

function Newest([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (Test-Path $p -PathType Container) {
      # *.tsbuildinfo is TypeScript's own incremental-build bookkeeping, not
      # served output — and critically, `tsc --noEmit` (a plain typecheck,
      # touching none of the compiled .js) still rewrites it. Counting it here
      # made "did I just typecheck?" indistinguishable from "did I just build?":
      # the bookkeeping file's timestamp alone made a dist folder whose real
      # .js hadn't moved in a day look freshly built, and the verdict flipped
      # to 'none' — silently discarding a real, uncompiled API change.
      $items = Get-ChildItem $p -Recurse -File -Exclude '*.tsbuildinfo' -EA SilentlyContinue
    }
    elseif (Test-Path $p) { $items = Get-Item $p -EA SilentlyContinue }
    else { $items = @() }
    foreach ($i in $items) { if ($i.LastWriteTimeUtc -gt $newest) { $newest = $i.LastWriteTimeUtc } }
  }
  return $newest
}

# A missing output means that package has never been built - rebuild everything
# rather than guess which half is stale.
$markers = @('packages\shared\dist\esm\index.js', 'apps\api\dist\src\main.js', 'apps\web\dist\index.html')
foreach ($m in $markers) { if (-not (Test-Path $m)) { Write-Output 'full'; exit 0 } }

$sharedSrc = Newest @('packages\shared\src', 'packages\shared\package.json', 'package.json')
$apiSrc    = Newest @('apps\api\src', 'apps\api\prisma\schema.prisma', 'apps\api\package.json')
# `apps\web\public` belongs here as much as `src`: the service worker, the PWA
# manifest and the icons are shipped from it, and they are copied into dist by
# the build like any other source. Leaving it out meant a service-worker fix
# looked like "nothing changed", was never rebuilt, and every client stayed on
# the old worker — the failure mode is silent and indefinite, because the thing
# that would have shipped the fix is the thing that decided not to.
$webSrc    = Newest @('apps\web\src', 'apps\web\public', 'apps\web\vite.config.ts', 'apps\web\package.json', 'apps\web\index.html')

# Compare against the NEWEST file in each dist, not one fixed file. `nest build`
# and `tsc` only re-emit sources that actually changed, so dist\src\main.js keeps
# its original timestamp forever - pinning to it makes the API look permanently
# stale and forces a rebuild every run. Vite rewrites index.html each time, but
# newest-in-folder is correct for all three, so treat them the same way.
$sharedOut = Newest @('packages\shared\dist')
$apiOut    = Newest @('apps\api\dist')
$webOut    = Newest @('apps\web\dist')

# Shared feeds both, so treat any change to it as a full relaunch.
if ($sharedSrc -gt $sharedOut) { Write-Output 'full'; exit 0 }

# A build output being current does NOT mean it is the code that is running.
# The API is a long-lived node process that reads dist once, at launch; the web
# server re-reads apps\web\dist per request, which is why only the API can drift
# this way. Build the API without bouncing it - or bounce it and have the launch
# quietly fail - and the previous build serves indefinitely while every
# timestamp here says 'none'. That is invisible from the outside: the page is
# current, dist is current, only the responses are stale, and no rebuild will
# ever dislodge it. So compare the RUNNING process against the build it is
# meant to be serving, not just source against output.
$apiPid = (Get-NetTCPConnection -State Listen -LocalPort 4000 -EA SilentlyContinue | Select-Object -First 1).OwningProcess
if ($apiPid) {
  # Get-Process's own .StartTime is unreliable here: on this machine it silently
  # returns nothing for a live, listening node.exe (observed directly, not a
  # guess) — a non-terminating property-access failure that $ErrorActionPreference
  # swallows, so the check below would just never fire, no error, no output.
  # Get-CimInstance's CreationDate reads the same information via WMI instead of
  # the .NET Process class and has been reliable where StartTime was not.
  $started = (Get-CimInstance Win32_Process -Filter "ProcessId=$apiPid" -EA SilentlyContinue).CreationDate
  if ($started -and $started.ToUniversalTime() -lt $apiOut) { Write-Output 'api'; exit 0 }
}

$apiChanged = $apiSrc -gt $apiOut
$webChanged = $webSrc -gt $webOut

if ($apiChanged) { Write-Output 'api'; exit 0 }   # API restart covers a web rebuild too
if ($webChanged) { Write-Output 'web'; exit 0 }
Write-Output 'none'
