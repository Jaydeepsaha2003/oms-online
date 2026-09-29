<#
  Tally e-invoice helper. Runs ON THE TALLY PC, next to TallyPrime.

  For each SSS bill that has a party GSTIN but no IRN (oldest first, strictly one at a time):
    1. opens it in Tally and saves it (Ctrl+A), answers Yes to "generate e-Invoice"
       (the e-way bill goes along when F12 "Send e-Way Bill details with e-Invoice" is Yes),
    2. waits until Tally really has the IRN,
    3. only then prints it. No IRN = no print, and the helper stops.
  It never types the e-invoice password: save the login in Tally, or log in yourself when asked.

  Double-click tally-einvoice.bat   -> ONE bill, hands-off (don't touch the keyboard while it runs).
  powershell -File tally-einvoice-helper.ps1 -List     -> only shows the pending bills.
  powershell -File tally-einvoice-helper.ps1 -Max 20   -> up to 20 bills, one after another.
#>
param([switch]$Auto, [int]$Max = 1, [switch]$List, [string]$Tally = 'http://localhost:9000')
$ErrorActionPreference = 'Stop'

# Tally keys (SendKeys: % = Alt, ^ = Ctrl, ~ = Enter). {DATE} and {NO} are filled in per bill.
# ponytail: blind keystrokes, calibrated on this PC in step mode; if a Tally screen changes, fix the list here.
# Checked on the Tally PC with SSS-747: Go To > Day Book > date > Ctrl+F "Look for" the number > open > save > "generate e-Invoice?" Yes.
# 1.5 s after each key: at 0.8 s Tally was still opening the bill and swallowed Ctrl+A (SSS-750).
# 1 s after bringing Tally to the front: sooner, and Alt of Alt+G was lost (opened Group Creation).
# Printing, the owner's rule (duplex printer, so never "copies 2" of the invoice alone — copy 2
# would land on the back of copy 1):
#  party in Maharashtra   : e-invoice only, printed TWICE as two separate prints
#  party outside it       : ONE print with F5 > invoice copies 2 > Type of Copy as is > e-Way copies 2
# After the e-invoice Tally opens its own Print box; F5 there is "Printer Settings" (seen on the owner's screen).

function Ask-Tally($filter) {
  $xml = "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P</ID></HEADER><BODY><DESC>" +
    "<STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>S.S.STEEL</SVCURRENTCOMPANY>" +
    "<SVFROMDATE>$((Get-Date).AddDays(-7).ToString('yyyyMMdd'))</SVFROMDATE><SVTODATE>$((Get-Date).ToString('yyyyMMdd'))</SVTODATE></STATICVARIABLES>" +
    "<TDL><TDLMESSAGE><COLLECTION NAME=`"P`"><TYPE>Voucher</TYPE><FILTER>F</FILTER><FETCH>Date,VoucherNumber,PartyLedgerName,MasterID,IRN,StateName,EWayBillDetails.BillNumber</FETCH></COLLECTION>" +
    "<SYSTEM TYPE=`"Formulae`" NAME=`"F`">`$VoucherTypeName = `"Sales`" AND $filter</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
  $r = Invoke-WebRequest -Uri $Tally -Method Post -Body $xml -UseBasicParsing -TimeoutSec 30
  ([xml]($r.Content -replace '&#4;', '')).ENVELOPE.BODY.DATA.COLLECTION.VOUCHER
}

# A field's text whether Tally sent it as <X TYPE="String">v</X> (an element) or <X>v</X> (a plain string).
function Txt($x) { if ($null -eq $x) { '' } elseif ($x -is [string]) { $x.Trim() } else { "$($x.'#text')".Trim() } }

# Last 7 days only, so an old bill is never touched by accident.
# A bad formula freezes Tally behind an error box until someone presses OK — keep these exact shapes.
$pending = @(Ask-Tally '$$IsEmpty:$IRN AND NOT $IsCancelled AND NOT $$IsEmpty:$PartyGSTIN' | Where-Object { (Txt $_.VOUCHERNUMBER) -like 'SSS-*' } |
  Sort-Object { [int](Txt $_.MASTERID) })
if (-not $pending.Count) { Write-Host 'Koi bill e-invoice ke liye baaki nahi.'; return }
$pending | ForEach-Object { Write-Host ("{0}  {1}  {2}  ({3})" -f (Txt $_.DATE), (Txt $_.VOUCHERNUMBER), (Txt $_.PARTYLEDGERNAME), (Txt $_.STATENAME)) }
if ($List) { return }

$sh = New-Object -ComObject WScript.Shell
# No step mode any more: pausing for the owner's Enter meant handing the keyboard back and forth,
# and Windows won't let a background window take focus back — the owner's Enter went to Tally
# (it opened "Bills Payable - GST" once, RAMSON's bill another time). The run is hands-off; the
# screen checks below are what keep it on the right bill.
# Bring Tally to the front by its program (tally.exe), not the window title — the title
# changes with the screen, and "TallyPrime" alone was once not found.
function Focus-Tally {
  foreach ($try in 1..3) {
    $p = Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) { [void]$sh.AppActivate($p.Id); Start-Sleep -Milliseconds 300; if (Is-TallyFront) { return $true } }
    Start-Sleep -Milliseconds 700
  }
  $false
}
# Eyes on Tally: a photo of the Tally window after every key (helper-log, next to this script),
# and Windows' own OCR reads it before anything is saved. (A slipped step once opened SSS-738
# instead of SSS-752 — blind Ctrl+A there would have saved the wrong bill.)
$log = Join-Path $PSScriptRoot 'helper-log'
[void](New-Item -ItemType Directory -Force $log); Remove-Item "$log\*.png" -ErrorAction SilentlyContinue
$script:shot = 0
if (-not $function:Snap) {
  Add-Type -AssemblyName System.Drawing
  Add-Type 'using System; using System.Runtime.InteropServices; public static class Win { public struct R { public int L, T, Rt, B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
  # Keys go only to Tally: checked right before every key, since anything can take the focus meanwhile.
  function Is-TallyFront {
    $p = Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    $p -and [Win]::GetForegroundWindow() -eq $p.MainWindowHandle
  }
  # PrintWindow draws Tally's own window even when this console is on top of it, so a photo
  # never needs to move the focus (in step mode the next Enter must reach this window, and
  # while the owner types the portal login, focus must stay in Tally).
  function Snap($name) {
    $p = Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    $r = New-Object Win+R; [void][Win]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    $bmp = New-Object System.Drawing.Bitmap ($r.Rt - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
    [void][Win]::PrintWindow($p.MainWindowHandle, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
    $script:shot++; $png = Join-Path $log ('{0:d2}-{1}.png' -f $script:shot, ($name -replace '[^\w-]', '_'))
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $png
  }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }
  function Read-Screen($png) {
    # OCR reads Tally's small text only when enlarged: at 1x it skipped "SSS-778/26-27" on a
    # highlighted row and read 774 as 776; at 2x both came out right (real Day Book photos).
    $img = [System.Drawing.Image]::FromFile($png)
    $big = New-Object System.Drawing.Bitmap ($img.Width * 2), ($img.Height * 2)
    $g = [System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $big.Width, $big.Height); $g.Dispose(); $img.Dispose()
    $png = $png -replace '\.png$', '-x2.png'; $big.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $bitmap = Await ((Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])).GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $text = (Await ([Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages().RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])).Text
    $stream.Dispose(); $text
  }
}

function Stop-Here($msg) { [console]::Beep(800, 600); throw "$msg  Photos: $log" }
# What Tally shows right now, spaces removed (OCR reads the same words with random spacing).
function Seen($name) { (Read-Screen (Snap $name)) -replace '\s', '' }
# Bill number as OCR can read it: the digits part (OCR sometimes reads S as 5).
function Shows-Bill($t) { $t -like ('*' + ($script:no -replace '^SSS-', '') + '*') }
# The number alone is not enough: on the real Day Book photo OCR read 774 as 776. Party names
# (bigger, letters) came out exactly, so every "is this the bill?" check wants both.
function Shows-Party($t) { ($t -replace '[^A-Za-z0-9]', '').ToUpper().Contains($script:partyKey) }
function Is-ThisBill($t) { (Shows-Bill $t) -and (Shows-Party $t) }

# One key into Tally. $gate: a pattern Tally's screen MUST show first, or nothing is sent.
function Key($k, $gate = $null, $what = '') {
  Write-Host "  key $k"
  if (-not (Focus-Tally)) { Stop-Here 'Could not bring Tally to the front - stopped.' }
  Start-Sleep -Milliseconds 1000
  if ($gate -and (Seen "before $k") -notmatch $gate) { Stop-Here "Tally is not showing $what - stopped before pressing $k." }
  if (-not (Is-TallyFront)) { Stop-Here "Another window took the focus - stopped before pressing $k." }
  $sh.SendKeys($k)
  Start-Sleep -Milliseconds 1500
  try { [void](Snap "after $k") } catch { }
}

# One print from Tally's Print box: F5 sets the copies first, every time (Tally may remember the last ones).
function Print-Once($invCopies, $ewbCopies) {
  Key '{F5}' 'Copies' "the Print box"
  $t = Seen 'printer-settings'
  if ($t -notmatch 'PrinterSettings') { Stop-Here 'Printer Settings did not open - stopped, nothing printed.' }
  # The e-Way line is there only when the bill has an e-way bill (owner's screens, 750 vs 751).
  if ($t -match 'copiesfore-?Way') { Key "$invCopies~"; Key '~'; Key "$ewbCopies"; Key '^a' }
  else { Key "$invCopies"; Key '^a' }
  Key 'p' 'Copies' "the Print box"
  Start-Sleep -Seconds 4   # let the job reach the printer before the next screen
}

foreach ($v in $pending | Select-Object -First $Max) {
  $no = Txt $v.VOUCHERNUMBER; $script:no = $no
  $script:partyKey = ((Txt $v.PARTYLEDGERNAME) -replace '[^A-Za-z0-9]', '').ToUpper()
  if ($script:partyKey.Length -lt 3) { Stop-Here "$no : no party name from Tally - stopped." }
  if ($no -notmatch '^SSS-\d+/\d\d-\d\d$') { throw "Odd bill number '$no' - stopped before asking Tally anything." }
  # Built plainly: quotes nested inside "$(...)" got dropped and sent Tally a broken formula.
  $byNo = '$VoucherNumber = "' + $no + '"'
  $date = [datetime]::ParseExact((Txt $v.DATE), 'yyyyMMdd', $null).ToString('d-M-yyyy')
  $state = Txt $v.STATENAME
  # The print rule hangs on the state; never guess it.
  if (-not $state) { Stop-Here "$no : Tally gave no party state - stopped before touching the bill." }
  $local = $state -eq 'Maharashtra'
  Write-Host "`n== $no  $(Txt $v.PARTYLEDGERNAME)  ($state) =="
  # Open the bill: Go To > Day Book > its date > Ctrl+F "Look for" its number > Enter. Each step checks the screen first.
  # From the Gateway, K ("Day BooK") opens the Day Book directly. Elsewhere Go To (Alt+G), tried twice:
  # once the Alt+G reached Tally as nothing at all and it stayed on the Gateway.
  $t = Seen 'start'
  if ($t -match 'GatewayofTally' -and $t -match 'BalanceSheet' -and $t -notmatch 'SavedViews') { Key 'k' }
  else {
    Key '%g'
    if ((Seen 'go-to') -notmatch 'SavedViews|CreateVoucher') { Key '%g' }
    Key 'Day Book~' 'SavedViews|CreateVoucher' 'the Go To box'
  }
  Key '{F2}' 'VchNo' 'the Day Book'
  Key "$date~"
  Key '^f' 'VchNo' 'the Day Book'
  Key "$no~" 'Lookfor' 'the "Look for" filter box'
  $t = Seen 'filtered'
  # Exactly one row left: one bill number on screen, and it is this one.
  if (-not (Is-ThisBill $t) -or $t -notmatch 'VchNo' -or [regex]::Matches($t, '\d+/\d\d-\d\d').Count -ne 1) { Stop-Here "The Day Book is not showing $no alone - stopped before opening anything." }
  Key '~'
  # Made by hand meanwhile? (SSS-752 was, while an old list still offered it.) Never re-save a bill that has an IRN.
  if (Txt (Ask-Tally $byNo).IRN) { Stop-Here "$no already has its e-invoice (made by hand?) - stopped, nothing saved. Press Esc in Tally." }
  # Save only if Tally really shows THIS bill open (a slipped step once opened SSS-738 instead of 752, another RAMSON's).
  $t = Seen 'before-save'
  if (-not (Is-ThisBill $t) -or $t -notmatch 'Party|ledger') { Stop-Here "$no is not open in Tally - stopped BEFORE saving anything. Press Esc in Tally (don't save)." }
  Key '^a'
  # Two wordings: "Do you want to generate e-Invoice?" and, with an e-way bill due, "Do you want to send
  # voucher details for e-Invoice and e-Way Bill generation?" (SSS-778). OCR reads "e-Invoice" as "e-lnvoice".
  Key 'y' '(?=.*YesorNo)(?=.*(generate|voucherdetailsfor).{0,4}[Il1]nvoice)' 'the "e-Invoice?" question'

  # IRN. If the portal login pops up, the owner types it — this script never handles passwords.
  Write-Host 'Waiting for the IRN (up to 5 min)...'
  $irn = $null; $asked = $false
  foreach ($i in 1..100) {
    Start-Sleep -Seconds 3
    # Tally doesn't answer while a screen of its own is open — just keep waiting.
    try { $irn = Txt (Ask-Tally $byNo).IRN } catch { }
    if ($irn) { break }
    if (-not $asked -and $i % 3 -eq 0) {
      try { if ((Seen 'waiting') -match 'Password') { $asked = $true; [console]::Beep(1000, 900); Write-Host '>>> Tally is asking for the e-invoice login: type the ID/password in Tally yourself. Waiting...' -ForegroundColor Yellow } } catch { }
    }
  }
  if (-not $irn) { Stop-Here "$no : no IRN after 5 minutes (login not done, or an error in Tally). Not printed - stopped." }
  $ewb = ''
  foreach ($i in 1..5) {
    try { $ewb = Txt (Ask-Tally $byNo).'EWAYBILLDETAILS.LIST'.BILLNUMBER } catch { }
    if ($ewb) { break }
    Start-Sleep -Seconds 3
  }
  Write-Host "IRN ok: $irn   e-way: $(if ($ewb) { $ewb } else { 'none' })   $(if ($local) { 'Maharashtra: invoice x2, separately' } else { 'outside MH: invoice 2 + e-way 2' })"
  # Tally first shows "e-Invoice and e-Way Bill generated successfully ... Press any key to continue"
  # (SSS-778); the Print box comes after it. Enter only while such a box is up and the Print box is not.
  foreach ($i in 1..3) {
    Start-Sleep -Seconds 2
    $t = Seen 'after-irn'
    if ($t -match 'Pressanykey' -and $t -notmatch 'Copies') { Key '~' } else { break }
  }

  if (-not $local -and $ewb) { Print-Once 2 2 }
  else {
    if (-not $local) { [console]::Beep(800, 400); Write-Host ">>> $no : Maharashtra ke bahar, par e-way bill nahi bana (bill Rs 50,000 se kam ho to theek hai) - sirf invoice 2 baar print." -ForegroundColor Yellow }
    Print-Once 1 0
    # Second copy on its own sheet: open the bill again (Day Book still filtered to it) and print once more.
    $t = Seen 'after-first-print'
    if (-not (Is-ThisBill $t)) { Stop-Here "First copy printed; Tally is not on $no any more - print the second copy by hand." }
    if ($t -notmatch 'Party|ledger') { Key '~' }
    Key '%p' 'Party|ledger' "bill $no open"
    Print-Once 1 0
    Key '{ESC}'
  }
}
Write-Host "`nDone."
