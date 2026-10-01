<#
  Runs ON THE TALLY PC at every Windows logon (set up once: tally-autostart.bat install).
    1. tells OMS "I am here" - OMS takes this PC's current address from the call (no internet needed, LAN only),
    2. if TallyPrime is not running: opens it from the desktop shortcut, picks the 3rd company in the list
       and types the Tally user ID + password,
    3. tells OMS again once Tally answers on port 9000.
  Needs tally-autostart.ini next to this script (never in git): oms=, key=, user=, pass=
#>
param([switch]$Install)
$ErrorActionPreference = 'Stop'
if ($Install) { schtasks /create /f /tn TallyAutoStart /sc onlogon /tr "`"$PSScriptRoot\tally-autostart.bat`""; return }
Start-Transcript -Path "$PSScriptRoot\tally-autostart-log.txt" -Force | Out-Null

$cfg = @{}
Get-Content "$PSScriptRoot\tally-autostart.ini" | ForEach-Object { if ($_ -match '^\s*(\w+)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2] } }

function Hello {
  foreach ($i in 1..20) {   # the network may still be coming up right after power-on
    try { $r = Invoke-RestMethod -Method Post -Uri "$($cfg.oms)/api/tally/pc-hello" -Headers @{ 'x-tally-key' = $cfg.key } -TimeoutSec 10; Write-Host "OMS knows us as $($r.url)"; return }
    catch { Write-Host "OMS not reachable yet ($($_.Exception.Message))"; Start-Sleep -Seconds 15 }
  }
}
function Tally-Answers { try { [void](Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5); $true } catch { $false } }
function Tally-Proc { Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
# SendKeys treats + ^ % ~ ( ) { } [ ] as commands: wrap them so a password with them is typed as text.
function Plain($s) { $s -replace '([+^%~(){}\[\]])', '{$1}' }

Hello
if (-not (Tally-Proc)) {
  # ponytail: blind keystrokes (a startup screen has nothing dangerous to hit); if Tally's start screens change, fix here.
  $lnk = Get-ChildItem (Split-Path $PSScriptRoot) -Filter 'Tally*.lnk' | Select-Object -First 1
  if (-not $lnk) { throw 'No Tally shortcut found on the desktop.' }
  Write-Host "Starting $($lnk.Name)"
  Start-Process $lnk.FullName
  foreach ($i in 1..30) { Start-Sleep -Seconds 2; if (Tally-Proc) { break } }
  Start-Sleep -Seconds 12   # let the company list draw
  $p = Tally-Proc
  if (-not $p) { throw 'Tally did not open.' }
  $sh = New-Object -ComObject WScript.Shell
  [void]$sh.AppActivate($p.Id); Start-Sleep -Seconds 1
  $sh.SendKeys('{HOME}{DOWN}{DOWN}~'); Start-Sleep -Seconds 8     # 3rd company in the list
  [void]$sh.AppActivate($p.Id); Start-Sleep -Seconds 1
  $sh.SendKeys((Plain $cfg.user) + '~'); Start-Sleep -Seconds 1
  $sh.SendKeys((Plain $cfg.pass) + '~')
}
foreach ($i in 1..40) { if (Tally-Answers) { Write-Host 'Tally answers on 9000.'; Hello; return }; Start-Sleep -Seconds 3 }
Write-Host 'Tally is open but does not answer on port 9000 yet (company not open? message box waiting?).'
