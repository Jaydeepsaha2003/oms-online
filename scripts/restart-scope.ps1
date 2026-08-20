# ============================================================
#  Decide how much of OMS needs relaunching after a build.
#
#  Prints exactly one word for restart.bat to read:
#    full  - shared package changed (API and web are both built from it), a
#            build output is missing entirely, or a DATABASE sync is pending
#            (only the full path runs start.bat, where migrations are applied)
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
& (Join-Path $PSScriptRoot 'pkg-changed.ps1') -Package shared | Out-Null
if ($LASTEXITCODE -eq 1) { Write-Output 'full'; exit 0 }

# A pending DATABASE sync is invisible to every source-vs-dist test in this file.
# Migrations are not build inputs — nothing in any dist folder ever reflects them,
# and after any build dist is newer than the migration file anyway — so a
# migration-only change (a data backfill, a new index) compares as 'none'.
# restart.bat then exits early and start.bat's DB-sync step, the ONLY thing that
# runs `prisma migrate deploy`, is never reached: the migration sits unapplied
# indefinitely, with no error printed anywhere and every timestamp here insisting
# nothing changed. Observed directly — a receipts backfill migration reported
# 'none' and silently never applied.
#
# start.bat already tracks this correctly via .db-sync-stamp (the newest of
# schema / migrations / seed / .env, compared against the last SUCCESSFUL sync),
# so mirror that test rather than inventing a second rule.
#
# This must report 'full', NOT 'api', even though a migration is a backend
# concern: 'api' takes restart.bat's fast path, which bounces the API process
# directly and never calls start.bat — and start.bat is the only place
# `prisma migrate deploy` runs. Only 'full' stops everything and goes through
# start.bat, which is also what lets the sync happen with the database free of
# the running API, exactly what start.bat defers it for.
$syncNewest = Newest @('apps\api\prisma\schema.prisma', 'apps\api\prisma\migrations', 'apps\api\prisma\seed.ts', 'apps\api\.env')
$syncStamp = if (Test-Path '.db-sync-stamp') { Get-Content '.db-sync-stamp' -EA SilentlyContinue } else { $null }
# Fail safe: no stamp (fresh clone / never synced) counts as pending. Being wrong
# this way costs one unnecessary relaunch; being wrong the other way ships an
# unapplied migration, which is the failure this whole block exists to prevent.
if (-not $syncStamp -or $syncStamp -ne $syncNewest.Ticks.ToString()) { Write-Output 'full'; exit 0 }

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

# Delegated to the same script start.bat uses, so the two can never disagree
# about whether a package changed. They did: this file compared against the
# newest file in dist while start.bat pinned the API to dist\src\main.js, which
# nest build often does not re-emit - so this printed 'none' while start.bat
# printed "API changed - building API", rebuilt, and nothing was relaunched.
$pkg = Join-Path $PSScriptRoot 'pkg-changed.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $pkg -Package api  | Out-Null
$apiChanged = $LASTEXITCODE -eq 1
& powershell -NoProfile -ExecutionPolicy Bypass -File $pkg -Package web  | Out-Null
$webChanged = $LASTEXITCODE -eq 1

if ($apiChanged) { Write-Output 'api'; exit 0 }   # API restart covers a web rebuild too
if ($webChanged) { Write-Output 'web'; exit 0 }
Write-Output 'none'
