<#
  Runs ON THE TALLY PC, next to tally-einvoice-helper.ps1. Start it with tally-einvoice-watch.bat
  and leave the window open.

  Every bill posted to Tally - from any phone or PC - shows up in Tally as an SSS bill with no IRN.
  This watches for that and runs the helper (e-invoice + e-way + print), one bill at a time.
    - Keys go to Tally only when nobody has touched this PC for $IdleSeconds, so it never types
      over someone working here.
    - Tally closed or not answering: it just waits.
    - The helper stopped on a bill (no IRN, wrong screen, ...): the watch ends with a beep, so the
      same bill is not tried again and again. Fix it in Tally, then start the watch again.
#>
param([int]$EverySeconds = 20, [int]$IdleSeconds = 60)
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'tally-einvoice-helper.ps1'

Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Idle {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint cb; public uint time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info i);
  public static uint Seconds() { Info i = new Info(); i.cb = 8; GetLastInputInfo(ref i); return ((uint)Environment.TickCount - i.time) / 1000; }
}
'@

Write-Host "Watching Tally for bills without an e-invoice (every $EverySeconds s). Close this window to stop." -ForegroundColor Cyan
while ($true) {
  Start-Sleep -Seconds $EverySeconds
  if ([Idle]::Seconds() -lt $IdleSeconds) { continue } # someone is using this PC
  try {
    $list = & $helper -List 6>&1 | Out-String # read-only: asks Tally which bills are pending
  } catch {
    continue # Tally closed or busy - try again next round
  }
  if ($list -match 'Koi bill') { continue }
  Write-Host "`n$(Get-Date -Format 'HH:mm:ss')  Pending:`n$list" -ForegroundColor Yellow
  try {
    & $helper
  } catch {
    [console]::Beep(600, 900)
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix it in Tally, then start tally-einvoice-watch.bat again.' -ForegroundColor Red
    break
  }
}
