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
$OpenAndSend = @('%g', 'Day Book~', '{F2}', '{DATE}~', '%{F12}', 'Voucher Number~', 'Equal To~', '{NO}~', '^a', '~', '^a', '~')
$PrintKeys = @('%p', '~', '^p')

function Ask-Tally($filter) {
  $xml = "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P</ID></HEADER><BODY><DESC>" +
    "<STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>S.S.STEEL</SVCURRENTCOMPANY>" +
    "<SVFROMDATE>$((Get-Date).AddDays(-7).ToString('yyyyMMdd'))</SVFROMDATE><SVTODATE>$((Get-Date).ToString('yyyyMMdd'))</SVTODATE></STATICVARIABLES>" +
    "<TDL><TDLMESSAGE><COLLECTION NAME=`"P`"><TYPE>Voucher</TYPE><FILTER>F</FILTER><FETCH>Date,VoucherNumber,PartyLedgerName,MasterID,IRN</FETCH></COLLECTION>" +
    "<SYSTEM TYPE=`"Formulae`" NAME=`"F`">`$VoucherTypeName = `"Sales`" AND $filter</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
  $r = Invoke-WebRequest -Uri $Tally -Method Post -Body $xml -UseBasicParsing -TimeoutSec 30
  ([xml]($r.Content -replace '&#4;', '')).ENVELOPE.BODY.DATA.COLLECTION.VOUCHER
}

# Last 7 days only, so an old bill is never touched by accident.
# Tally reads formulas strictly left to right, and a bad one freezes Tally behind an error box:
# only these two exact shapes are proven on this Tally.
$pending = @(Ask-Tally '$$IsEmpty:$IRN AND NOT $IsCancelled AND NOT $$IsEmpty:$PartyGSTIN' | Where-Object { "$($_.VOUCHERNUMBER)" -like 'SSS-*' } |
  Sort-Object { [int]"$($_.MASTERID.'#text')".Trim() })
if (-not $pending.Count) { Write-Host 'Koi bill e-invoice ke liye baaki nahi.'; return }
$pending | ForEach-Object { Write-Host ("{0}  {1}  {2}" -f $_.DATE.'#text', $_.VOUCHERNUMBER, $_.PARTYLEDGERNAME.'#text') }
if ($List) { return }

$sh = New-Object -ComObject WScript.Shell
foreach ($v in $pending | Select-Object -First $Max) {
  $no = "$($v.VOUCHERNUMBER)"
  $date = [datetime]::ParseExact($v.DATE.'#text', 'yyyyMMdd', $null).ToString('d-M-yyyy')
  Write-Host "`n== $no =="
  foreach ($k in $OpenAndSend) {
    $k = $k.Replace('{DATE}', $date).Replace('{NO}', $no)
    if (-not $Auto) { Read-Host "Next key: $k   (Enter = send, Ctrl+C = stop)" | Out-Null }
    if (-not $sh.AppActivate('TallyPrime')) { throw 'TallyPrime window not found - stopped.' }
    Start-Sleep -Milliseconds 400
    $sh.SendKeys($k)
    Start-Sleep -Milliseconds 800
  }
  Write-Host 'Waiting for the IRN (up to 2 min)...'
  $irn = $null
  foreach ($i in 1..40) {
    Start-Sleep -Seconds 3
    # Tally doesn't answer while a screen of its own is open — just keep waiting.
    try { $irn = "$((Ask-Tally "`$VoucherNumber = `"$no`"").IRN.'#text')".Trim() } catch { }
    if ($irn) { break }
  }
  if (-not $irn) { [console]::Beep(800, 600); throw "$no : no IRN after 2 minutes (login screen or an error in Tally?). Not printed - stopped." }
  Write-Host "IRN ok: $irn - printing"
  foreach ($k in $PrintKeys) {
    if (-not $Auto) { Read-Host "Next key: $k   (Enter = send, Ctrl+C = stop)" | Out-Null }
    [void]$sh.AppActivate('TallyPrime'); Start-Sleep -Milliseconds 400; $sh.SendKeys($k); Start-Sleep -Milliseconds 800
  }
}
Write-Host "`nDone."
