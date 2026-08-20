# ============================================================
#  Has one package changed since its own last build?
#
#    exit 0  unchanged - skip the build
#    exit 1  changed   - build it
#
#  ONE definition, called by both start.bat (to decide what to compile) and
#  restart-scope.ps1 (to decide what to relaunch). They used to carry their own
#  inline copies of this test, and the copies had drifted apart in two ways that
#  each broke a deploy:
#
#   * start.bat compared sources against the single file apps\api\dist\src\main.js.
#     `nest build` only re-emits sources that actually changed, so main.js keeps
#     its original timestamp indefinitely while the rest of dist moves on. The API
#     therefore looked changed on EVERY run, so restart.bat printed
#     "Change scope: none" (its own test, newest-in-dist, said up to date) while
#     start.bat printed "API changed - building API" in the same breath, rebuilt,
#     and then nothing was relaunched. New build on disk, old process serving.
#
#   * start.bat's web source list left out apps\web\public and index.html. A
#     service-worker, manifest or icon change was seen as "web unchanged" and
#     never rebuilt, while restart-scope reported 'web' - so restart.bat happily
#     announced "the new bundle is already live" for a bundle that was never
#     built. Silent, and indefinite: the thing that would ship the fix is the
#     thing that decided not to.
#
#  Comparing against the NEWEST file in dist (not a fixed one) is what makes the
#  test honest for both compilers. *.tsbuildinfo is excluded because a plain
#  `tsc --noEmit` typecheck rewrites it without emitting any JS, which would make
#  "did I typecheck?" indistinguishable from "did I build?".
# ============================================================
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('shared', 'api', 'web')]
  [string]$Package
)
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Split-Path $PSScriptRoot -Parent)

$SOURCES = @{
  shared = @('packages\shared\src', 'packages\shared\package.json', 'package.json')
  api    = @('apps\api\src', 'apps\api\prisma\schema.prisma', 'apps\api\package.json')
  # public/ ships the service worker, the PWA manifest and the icons; index.html
  # is vite's entry. All are build inputs, all were missing here.
  web    = @('apps\web\src', 'apps\web\public', 'apps\web\vite.config.ts', 'apps\web\package.json', 'apps\web\index.html')
}
$OUTPUTS = @{
  shared = 'packages\shared\dist'
  api    = 'apps\api\dist'
  web    = 'apps\web\dist'
}
# A missing marker means the package has never been built at all.
$MARKERS = @{
  shared = 'packages\shared\dist\esm\index.js'
  api    = 'apps\api\dist\src\main.js'
  web    = 'apps\web\dist\index.html'
}

function Newest([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (Test-Path $p -PathType Container) {
      $items = Get-ChildItem $p -Recurse -File -Exclude '*.tsbuildinfo' -EA SilentlyContinue
    } elseif (Test-Path $p) {
      $items = Get-Item $p -EA SilentlyContinue
    } else { $items = @() }
    foreach ($i in $items) { if ($i.LastWriteTimeUtc -gt $newest) { $newest = $i.LastWriteTimeUtc } }
  }
  return $newest
}

if (-not (Test-Path $MARKERS[$Package])) { exit 1 }   # never built
$src = Newest $SOURCES[$Package]
$out = Newest @($OUTPUTS[$Package])
if ($src -gt $out) { exit 1 } else { exit 0 }
