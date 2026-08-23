# OMS - Pull new code from GitHub and restart, if and only if it is safe to.
#
# Run on a timer by the task that enable-autopull.bat registers. Does nothing at
# all unless the remote is genuinely ahead, so a tick costs one `git fetch`.
#
# WHY POLL: GitHub Desktop has no auto-pull, and a webhook would need this
# machine reachable from the internet. A fetch every few minutes is the right
# shape for a machine on the shop floor.
#
# WHAT IT REFUSES TO DO, and why that matters more than what it does:
#   * never pulls over local edits - a pull that hits a conflict leaves the repo
#     half-merged and the app unbuildable, which is far worse than being a few
#     commits behind. It logs and waits for a human instead.
#   * never runs two at once - a build takes longer than the timer interval.
#   * never restarts unless the pull actually succeeded.
# restart.bat itself is safe on a broken build: it builds first and leaves the
# running servers untouched if compilation fails.

# Deliberately NOT 'Stop'. git writes ordinary hints to stderr — a refused
# fast-forward is the common case — and under 'Stop' each one became a
# terminating NativeCommandError that killed the script before it could log why
# it had stopped. Every external call below checks its own exit code instead.
$ErrorActionPreference = 'Continue'
$Project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Project

$LogFile = Join-Path $Project 'logs\auto-pull.log'
$LockFile = Join-Path $Project '.oms-autopull-running'
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

<#
  Run git and hand back both its output and its exit code.

  Routed through cmd.exe so stderr is merged INSIDE the child process. Piping a
  native command's stderr in Windows PowerShell wraps each line in an
  ErrorRecord and flips $? to false even on success, which is what made a
  routine "can't fast-forward" hint look like a crash.
#>
function Invoke-Git([string]$Arguments) {
    $out = & cmd.exe /c "git $Arguments 2>&1"
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = @($out) }
}

# Keep the log from growing without bound - 2000 lines is months of ticks.
if ((Test-Path $LogFile) -and ((Get-Content $LogFile).Count -gt 2000)) {
    Set-Content $LogFile (Get-Content $LogFile | Select-Object -Last 500)
}

# ── One at a time ───────────────────────────────────────────────────────────
# A stale lock (machine cut power mid-build) would otherwise block every future
# run for ever, so anything older than 30 minutes is treated as abandoned.
if (Test-Path $LockFile) {
    $age = (Get-Date) - (Get-Item $LockFile).LastWriteTimeUtc.ToLocalTime()
    if ($age.TotalMinutes -lt 30) {
        Write-Log "Skipped - a previous run started $([int]$age.TotalMinutes) min ago and is still going."
        exit 0
    }
    Write-Log 'Clearing a stale lock from an earlier run that never finished.'
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

try {
    # ── Is there anything to fetch? ─────────────────────────────────────────
    $fetch = Invoke-Git 'fetch --quiet origin'
    if ($fetch.Code -ne 0) {
        $fetch.Lines | Where-Object { $_ -match '\S' } | ForEach-Object { Write-Log "git fetch: $_" }
        # Almost always the network, or a credential that needs renewing in
        # GitHub Desktop. Not fatal - the next tick tries again.
        Write-Log 'Could not reach GitHub (network or sign-in). Will try again next tick.'
        exit 0
    }

    $branch = (Invoke-Git 'rev-parse --abbrev-ref HEAD').Lines[0].Trim()
    $rev = Invoke-Git 'rev-list --count HEAD..@{u}'
    if ($rev.Code -ne 0) {
        Write-Log "Branch '$branch' has no upstream set - nothing to pull from."
        exit 0
    }
    $behind = [int]($rev.Lines[0].Trim())
    if ($behind -eq 0) { exit 0 }   # the quiet, normal case: say nothing

    Write-Log "$behind new commit(s) on origin/$branch."

    # ── Would pulling destroy someone's work? ───────────────────────────────
    # Checked AFTER we know there is something to pull, so a dirty tree on a
    # machine nobody is pushing to never fills the log.
    $dirty = (Invoke-Git 'status --porcelain').Lines | Where-Object { $_ -match '\S' }
    if ($dirty) {
        Write-Log "REFUSED to pull: this machine has uncommitted changes, so a pull could conflict."
        $dirty | Select-Object -First 20 | ForEach-Object { Write-Log "    $_" }
        Write-Log '    Commit, stash or discard them, and the next tick will pull.'
        exit 0
    }
    # An unfinished merge or rebase is the same problem wearing a different hat.
    if ((Test-Path '.git\MERGE_HEAD') -or (Test-Path '.git\rebase-merge') -or (Test-Path '.git\rebase-apply')) {
        Write-Log 'REFUSED to pull: a merge or rebase is still in progress here.'
        exit 0
    }

    'running' | Set-Content $LockFile

    # ── Pull ────────────────────────────────────────────────────────────────
    $before = (Invoke-Git 'rev-parse HEAD').Lines[0].Trim()
    # --ff-only so this can only ever fast-forward. If the histories have
    # diverged it stops rather than creating a merge commit nobody asked for.
    $pull = Invoke-Git 'pull --ff-only'
    if ($pull.Code -ne 0) {
        Write-Log 'REFUSED to pull: this branch and origin have diverged, so it cannot fast-forward.'
        $pull.Lines | Where-Object { $_ -match '\S' } | Select-Object -First 8 | ForEach-Object { Write-Log "    $_" }
        Write-Log '    Someone committed here as well as on the other machine. Sort it out by hand.'
        Write-Log '    Nothing was pulled and nothing was restarted.'
        exit 0
    }
    $after = (Invoke-Git 'rev-parse HEAD').Lines[0].Trim()
    if ($before -eq $after) {
        Write-Log 'Pull left HEAD unchanged - nothing to restart.'
        exit 0
    }

    $subject = (Invoke-Git "log -1 --format=%h_%s").Lines[0].Trim().Replace('_', ' ')
    Write-Log "Pulled to $subject"

    # A migration in the pull needs applying before the API starts on the new
    # schema, and it must happen while nothing is mid-request. db:deploy is
    # additive-only and a no-op when there is nothing pending.
    $touched = (Invoke-Git "diff --name-only $before $after").Lines
    if ($touched -match 'prisma/migrations/') {
        Write-Log 'New database migration(s) in this pull - applying them.'
        # Routed through cmd.exe on purpose: `npm` on Windows is npm.cmd, and
        # invoking a .cmd with PowerShell's call operator while piping its
        # output mangles the arguments — it arrived as `pm` and npm rejected it.
        & cmd.exe /c 'npm run db:deploy' 2>&1 | ForEach-Object { Write-Log "db:deploy: $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Log 'MIGRATION FAILED - stopping here. The old build is still serving; fix this by hand.'
            exit 1
        }
    }

    # ── Restart ─────────────────────────────────────────────────────────────
    # restart.bat decides for itself what actually needs bouncing: a
    # frontend-only change restarts nothing at all.
    Write-Log 'Building and restarting...'
    & cmd.exe /c "`"$Project\restart.bat`"" 2>&1 | ForEach-Object { if ($_ -match '\S') { Write-Log "restart: $_" } }
    if ($LASTEXITCODE -ne 0) {
        Write-Log "restart.bat exited $LASTEXITCODE - check the output above. The previous build keeps serving on a build failure."
        exit 1
    }
    Write-Log 'Up to date and running.'
}
finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
