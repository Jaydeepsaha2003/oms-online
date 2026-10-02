<#
  ONE script for the Tally PC (tally-pc.bat). Leave its window open; it runs by itself at every Windows logon.
    1. tells OMS "I am here": OMS takes this PC's current address from the call (LAN only, no internet),
    2. if TallyPrime is not running: starts it with the 'tally data' folder (like dragging the folder onto the icon),
       picks the 3rd company and types the Tally user ID + password,
    3. then watches Tally: every SSS bill posted without an IRN gets e-invoice + e-way + print, one at a time
       (keys only when nobody has touched this PC for a minute; stops with a beep if a bill goes wrong).
  Needs tally-autostart.ini next to it (never in git): oms=, key=, user=, pass=
  tally-pc.bat -Once   -> only ONE pending bill, then exit.     tally-pc.bat -List -> only list the pending bills.
#>
param([switch]$Once, [switch]$List, [int]$Max = 1, [string]$Tally = 'http://localhost:9000', [int]$EverySeconds = 20, [int]$IdleSeconds = 60)
$ErrorActionPreference = 'Stop'

# Settings + logins live in tally-autostart.ini next to this script (never in git): oms=, key=, user=, pass=, eiuser=, eipass=
$cfg = @{}
if (Test-Path "$PSScriptRoot\tally-autostart.ini") { Get-Content "$PSScriptRoot\tally-autostart.ini" | ForEach-Object { if ($_ -match '^\s*(\w+)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2] } } }
# SendKeys treats + ^ % ~ ( ) { } [ ] as commands: wrap them so a password with them is typed as text.
function Plain($s) { $s -replace '([+^%~(){}\[\]])', '{$1}' }

# ---- e-invoice + e-way + print for the pending SSS bills (was tally-einvoice-helper.ps1) ----
function Run-Helper([switch]$List, [int]$Max = 1) {

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

  # IRN. If Tally asks for the e-invoice portal login, type it ONCE (ID, Enter, password, Ctrl+A) - only when that
  # screen really shows. A wrong password tried again and again can lock the portal account, so never a second try.
  Write-Host 'Waiting for the IRN (up to 5 min)...'
  $irn = $null; $typed = $false
  foreach ($i in 1..100) {
    Start-Sleep -Seconds 3
    # Tally doesn't answer while a screen of its own is open - just keep waiting.
    try { $irn = Txt (Ask-Tally $byNo).IRN } catch { }
    if ($irn) { break }
    if ($i -le 5 -or $i % 3 -eq 0) {
      try { $login = (Seen 'waiting') -match 'Password' } catch { $login = $false }
      if ($login -and $typed) { Stop-Here "$no : the e-invoice portal login did not go through (wrong ID/password?) - stopped, not tried again. Fix it in Tally." }
      if ($login -and -not ($cfg.eiuser -and $cfg.eipass)) { [console]::Beep(1000, 900); Write-Host '>>> Tally is asking for the e-invoice login: type the ID/password in Tally yourself. Waiting...' -ForegroundColor Yellow }
      elseif ($login) {
        Write-Host 'Tally asks for the e-invoice login - typing it once.'
        Key ((Plain $cfg.eiuser) + '~') 'Password' 'the e-invoice login'
        Key (Plain $cfg.eipass) 'Password' 'the e-invoice login'
        Key '^a' 'Password' 'the e-invoice login'
        $typed = $true
      }
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
    # Alt+P only opens the top-bar Print menu (Current highlighted, seen on SSS-784); Enter picks Current = the Print box.
    Key '~' 'Current' 'the Print menu'
    Print-Once 1 0
    Key '{ESC}'
  }
}
Write-Host "`nDone."

}

if ($Once -or $List) { Run-Helper -List:$List -Max $Max; return }

# ---- start-up: tell OMS, open Tally, log in (was tally-autostart.ps1) ----
Start-Transcript -Path "$PSScriptRoot\tally-pc-log.txt" -Force | Out-Null
# Ask first, with a small animated window: fades in, a pulsing banner and a bar that runs down for $Seconds.
# No answer in time = Yes. No = nothing is touched (no hello, no Tally, no keys).
function Ask-Start([int]$Seconds = 20) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $ui = [System.Windows.Forms.Application]; $ui::EnableVisualStyles()
  $f = New-Object System.Windows.Forms.Form
  $f.Text = 'Tally PC automation'; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true; $f.Opacity = 0
  $f.FormBorderStyle = 'FixedDialog'; $f.ControlBox = $false; $f.ClientSize = New-Object System.Drawing.Size(480, 250)
  $f.Font = New-Object System.Drawing.Font('Segoe UI', 10); $f.BackColor = [System.Drawing.Color]::White
  $band = New-Object System.Windows.Forms.Label
  $band.Text = '  Tally Automation ON hone wali hai'; $band.Dock = 'Top'; $band.Height = 62; $band.TextAlign = 'MiddleLeft'
  $band.ForeColor = [System.Drawing.Color]::White; $band.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $msg = New-Object System.Windows.Forms.Label
  $msg.Text = "Tally khulega, company ka login hoga aur bills ke e-invoice apne aap banenge.`nAap kuch type mat karna jab tak chal raha ho."
  $msg.SetBounds(20, 76, 440, 60)
  $left = New-Object System.Windows.Forms.Label; $left.SetBounds(20, 140, 440, 24); $left.ForeColor = [System.Drawing.Color]::DimGray
  $bar = New-Object System.Windows.Forms.ProgressBar; $bar.SetBounds(20, 168, 440, 10); $bar.Maximum = $Seconds * 10; $bar.Value = $bar.Maximum
  $yes = New-Object System.Windows.Forms.Button; $yes.Text = 'Haan, shuru karo'; $yes.SetBounds(160, 196, 170, 38); $yes.DialogResult = 'Yes'
  $yes.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 212); $yes.ForeColor = [System.Drawing.Color]::White; $yes.FlatStyle = 'Flat'
  $no = New-Object System.Windows.Forms.Button; $no.Text = 'Nahi'; $no.SetBounds(340, 196, 120, 38); $no.DialogResult = 'No'
  $f.Controls.AddRange(@($msg, $left, $bar, $yes, $no, $band)); $f.AcceptButton = $yes; $f.CancelButton = $no
  $t = New-Object System.Windows.Forms.Timer; $t.Interval = 100; $st = @{ n = 0 }
  $t.Add_Tick({
    $st.n++; $n = $st.n
    if ($f.Opacity -lt 1) { $f.Opacity = [Math]::Min(1, $f.Opacity + 0.1) }      # fade in
    $k = [Math]::Abs([Math]::Sin($n / 6))                                         # pulsing banner
    $band.BackColor = [System.Drawing.Color]::FromArgb(0, [int](100 + 40 * $k), [int](190 + 40 * $k))
    $bar.Value = [Math]::Max(0, $bar.Maximum - $n)
    $left.Text = "$([Math]::Ceiling(($bar.Maximum - $n) / 10)) second mein jawab nahi aaya to apne aap shuru ho jayega."
    if ($n -ge $bar.Maximum) { $f.DialogResult = 'Yes' }
  })
  $t.Start(); [System.Media.SystemSounds]::Asterisk.Play()
  $r = $f.ShowDialog(); $t.Stop(); $f.Dispose()
  $r -eq 'Yes'
}
if (-not (Ask-Start)) { Write-Host 'Cancelled by the user - nothing done.'; return }

# Make it start by itself at every logon: a shortcut in the Startup folder (no admin needed).
try { schtasks /delete /tn TallyAutoStart /f *> $null } catch { }   # the old two-file set-up, if it was installed
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Tally PC.lnk'
if (-not (Test-Path $lnk)) { $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath = "$PSScriptRoot\tally-pc.bat"; $s.WorkingDirectory = $PSScriptRoot; $s.Save(); Write-Host 'Added to Startup: it will run by itself at every logon.' }

function Hello {
  foreach ($i in 1..20) {   # the network may still be coming up right after power-on
    try { $r = Invoke-RestMethod -Method Post -Uri "$($cfg.oms)/api/tally/pc-hello" -Headers @{ 'x-tally-key' = $cfg.key } -TimeoutSec 10; Write-Host "OMS knows us as $($r.data.url)"; return }
    catch { Write-Host "OMS not reachable yet ($($_.Exception.Message))"; Start-Sleep -Seconds 15 }
  }
}
function Tally-Answers { try { [void](Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5); $true } catch { $false } }
function Tally-Proc { Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }

function Start-Tally {
  # ponytail: blind keystrokes (a startup screen has nothing dangerous to hit); if Tally's start screens change, fix here.
  # The owner's hand routine: drag the 'tally data' folder onto the Tally icon = start Tally with that folder as its argument.
  $desks = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object { $_ -and (Test-Path $_) }
  $icon = $desks | ForEach-Object { Get-ChildItem $_ -File -Filter 'tally*' } | Where-Object { $_.Extension -in '.lnk', '.exe' } | Select-Object -First 1
  $data = $desks | ForEach-Object { Get-ChildItem $_ -Directory -Filter '*tally*data*' } | Select-Object -First 1
  if (-not $icon -or -not $data) { throw "Tally icon ya 'tally data' folder desktop par nahi mila (dekha: $($desks -join ', '))." }
  $exe = if ($icon.Extension -eq '.lnk') { (New-Object -ComObject WScript.Shell).CreateShortcut($icon.FullName).TargetPath } else { $icon.FullName }
  Write-Host "Starting $exe with $($data.FullName)"
  Start-Process $exe -ArgumentList "`"$($data.FullName)`""
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
# "Start Tally" pressed in OMS? Asked every round of the watch below.
function Start-Asked { try { (Invoke-RestMethod -Method Post -Uri "$($cfg.oms)/api/tally/pc-poll" -Headers @{ 'x-tally-key' = $cfg.key } -TimeoutSec 10).data.start } catch { $false } }

if (-not (Tally-Proc)) { Start-Tally }
foreach ($i in 1..40) { if (Tally-Answers) { Write-Host 'Tally answers on 9000.'; Hello; break }; Start-Sleep -Seconds 3 }

# ---- watch (was tally-einvoice-watch.ps1) ----
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
  if (Start-Asked) {
    if (Tally-Proc) { Write-Host 'Start Tally asked from OMS - Tally is already open.' }
    else { try { Start-Tally; Hello } catch { Write-Host "Start Tally failed: $($_.Exception.Message)" -ForegroundColor Red } }
  }
  if ([Idle]::Seconds() -lt $IdleSeconds) { continue } # someone is using this PC
  try {
    $list = Run-Helper -List 6>&1 | Out-String # read-only: asks Tally which bills are pending
  } catch {
    continue # Tally closed or busy - try again next round
  }
  if ($list -match 'Koi bill') { continue }
  Write-Host "`n$(Get-Date -Format 'HH:mm:ss')  Pending:`n$list" -ForegroundColor Yellow
  try {
    Run-Helper
  } catch {
    [console]::Beep(600, 900)
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix it in Tally, then start tally-pc.bat again.' -ForegroundColor Red
    break
  }
}
