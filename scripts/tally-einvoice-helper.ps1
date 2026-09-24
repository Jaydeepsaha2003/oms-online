<#
  Tally e-invoice helper. Runs ON THE TALLY PC, next to TallyPrime.

  For each SSS bill that has a party GSTIN but no IRN (oldest first, strictly one at a time):
    1. opens it in Tally and saves it (Ctrl+A), answers Yes to "generate e-Invoice"
       (the e-way bill goes along when F12 "Send e-Way Bill details with e-Invoice" is Yes),
    2. waits until Tally really has the IRN,
    3. only then prints it. No IRN = no print, and the helper stops.
  It never types the e-invoice password: save the login in Tally, or log in yourself when asked.

  Right-click > Run with PowerShell  -> ONE bill, pausing before every key (watch Tally).
  powershell -File tally-einvoice-helper.ps1 -List        -> only shows the pending bills.
  powershell -File tally-einvoice-helper.ps1 -Auto -Max 20 -> no pauses, up to 20 bills.
#>
param([switch]$Auto, [int]$Max = 1, [switch]$List, [string]$Tally = 'http://localhost:9000')
$ErrorActionPreference = 'Stop'

# Tally keys (SendKeys: % = Alt, ^ = Ctrl, ~ = Enter). {DATE} and {NO} are filled in per bill.
# ponytail: blind keystrokes, calibrated on this PC in step mode; if a Tally screen changes, fix the list here.
# Checked on the Tally PC with SSS-747: Go To > Day Book > date > Ctrl+F "Look for" the number > open > save > "generate e-Invoice?" Yes.
# 1.5 s after each key: at 0.8 s Tally was still opening the bill and swallowed Ctrl+A (SSS-750).
# 1 s after bringing Tally to the front: sooner, and Alt of Alt+G was lost (opened Group Creation).
$OpenAndSend = @('%g', 'Day Book~', '{F2}', '{DATE}~', '^f', '{NO}~', '~', '^a', 'y')
# After a successful e-invoice Tally opens its own Print box (P: Print selected); copies are set in that box (C: Configure).
# Duplex printer, so never "copies 2" on a bill alone (copy 2 would land on the back of copy 1):
#  with e-way bill : F5 > copies 2 > Type of Copy as is > e-Way copies 2 > accept > P   (seen on the owner's screen)
#  e-invoice only  : P, then open the bill again and print a second time   (to check in step mode)
$PrintWithEway = @('{F5}', '2~', '~', '2', '^a', 'p')
$PrintInvoiceOnly = @('p', '~', '%p', 'p', '{ESC}')

function Ask-Tally($filter) {
  $xml = "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P</ID></HEADER><BODY><DESC>" +
    "<STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>S.S.STEEL</SVCURRENTCOMPANY>" +
    "<SVFROMDATE>$((Get-Date).AddDays(-7).ToString('yyyyMMdd'))</SVFROMDATE><SVTODATE>$((Get-Date).ToString('yyyyMMdd'))</SVTODATE></STATICVARIABLES>" +
    "<TDL><TDLMESSAGE><COLLECTION NAME=`"P`"><TYPE>Voucher</TYPE><FILTER>F</FILTER><FETCH>Date,VoucherNumber,PartyLedgerName,MasterID,IRN,EWayBillDetails.BillNumber</FETCH></COLLECTION>" +
    "<SYSTEM TYPE=`"Formulae`" NAME=`"F`">`$VoucherTypeName = `"Sales`" AND $filter</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
  $r = Invoke-WebRequest -Uri $Tally -Method Post -Body $xml -UseBasicParsing -TimeoutSec 30
  ([xml]($r.Content -replace '&#4;', '')).ENVELOPE.BODY.DATA.COLLECTION.VOUCHER
}

# Last 7 days only, so an old bill is never touched by accident.
# A bad formula freezes Tally behind an error box until someone presses OK — keep these exact shapes.
$pending = @(Ask-Tally '$$IsEmpty:$IRN AND NOT $IsCancelled AND NOT $$IsEmpty:$PartyGSTIN' | Where-Object { "$($_.VOUCHERNUMBER)" -like 'SSS-*' } |
  Sort-Object { [int]"$($_.MASTERID.'#text')".Trim() })
if (-not $pending.Count) { Write-Host 'Koi bill e-invoice ke liye baaki nahi.'; return }
$pending | ForEach-Object { Write-Host ("{0}  {1}  {2}" -f $_.DATE.'#text', $_.VOUCHERNUMBER, $_.PARTYLEDGERNAME.'#text') }
if ($List) { return }

$sh = New-Object -ComObject WScript.Shell
# Bring Tally to the front by its program (tally.exe), not the window title — the title
# changes with the screen, and "TallyPrime" alone was once not found. Keys only ever go to Tally.
function Focus-Tally {
  foreach ($try in 1..3) {
    $p = Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p -and $sh.AppActivate($p.Id)) { return $true }
    Start-Sleep -Milliseconds 700
  }
  $false
}
foreach ($v in $pending | Select-Object -First $Max) {
  $no = "$($v.VOUCHERNUMBER)"
  if ($no -notmatch '^SSS-\d+/\d\d-\d\d$') { throw "Odd bill number '$no' - stopped before asking Tally anything." }
  # Built plainly: quotes nested inside "$(...)" got dropped and sent Tally a broken formula.
  $byNo = '$VoucherNumber = "' + $no + '"'
  $date = [datetime]::ParseExact($v.DATE.'#text', 'yyyyMMdd', $null).ToString('d-M-yyyy')
  Write-Host "`n== $no =="
  foreach ($k in $OpenAndSend) {
    $k = $k.Replace('{DATE}', $date).Replace('{NO}', $no)
    if (-not $Auto) { Read-Host "Next key: $k   (Enter = send, Ctrl+C = stop)" | Out-Null }
    if (-not (Focus-Tally)) { throw 'TallyPrime window not found - stopped.' }
    Start-Sleep -Milliseconds 1000
    $sh.SendKeys($k)
    Start-Sleep -Milliseconds 1500
  }
  Write-Host 'Waiting for the IRN (up to 2 min)...'
  $irn = $null
  foreach ($i in 1..40) {
    Start-Sleep -Seconds 3
    # Tally doesn't answer while a screen of its own is open — just keep waiting.
    try { $irn = "$((Ask-Tally $byNo).IRN.'#text')".Trim() } catch { }
    if ($irn) { break }
  }
  if (-not $irn) { [console]::Beep(800, 600); throw "$no : no IRN after 2 minutes (login screen or an error in Tally?). Not printed - stopped." }
  # Tally makes the e-way bill (if any) right after the IRN; give it a few seconds to show up.
  $ewb = ''
  foreach ($i in 1..5) {
    try { $ewb = "$((Ask-Tally $byNo).'EWAYBILLDETAILS.LIST'.BILLNUMBER)".Trim() } catch { }
    if ($ewb) { break }
    Start-Sleep -Seconds 3
  }
  $PrintKeys = if ($ewb) { $PrintWithEway } else { $PrintInvoiceOnly }
  Write-Host "IRN ok: $irn  e-way: $(if ($ewb) { $ewb } else { 'none' }) - printing"
  foreach ($k in $PrintKeys) {
    if (-not $Auto) { Read-Host "Next key: $k   (Enter = send, Ctrl+C = stop)" | Out-Null }
    if (-not (Focus-Tally)) { throw 'TallyPrime window not found - stopped before printing.' }
    Start-Sleep -Milliseconds 1000; $sh.SendKeys($k); Start-Sleep -Milliseconds 1500
  }
}
Write-Host "`nDone."
