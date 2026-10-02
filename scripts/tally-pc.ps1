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
param([switch]$EnableWake, [switch]$Overlay, [int]$Parent = 0, [switch]$Once, [switch]$List, [int]$Max = 1, [string]$Tally = 'http://localhost:9000', [int]$EverySeconds = 10, [int]$IdleSeconds = 20)
$ErrorActionPreference = 'Stop'

# Settings + logins live in tally-autostart.ini next to this script (never in git): oms=, key=, user=, pass=, eiuser=, eipass=
$cfg = @{}
if (Test-Path "$PSScriptRoot\tally-autostart.ini") { Get-Content "$PSScriptRoot\tally-autostart.ini" | ForEach-Object { if ($_ -match '^\s*(\w+)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2] } } }
# SendKeys treats + ^ % ~ ( ) { } [ ] as commands: wrap them so a password with them is typed as text.
function Plain($s) { $s -replace '([+^%~(){}\[\]])', '{$1}' }

# ---- windows: "Automation ON" overlay and the start question ----
function Win32 {
  if ('Fg' -as [type]) { return }
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public static class Fg {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Windows refuses to bring a window to the front for a background process; a tap on Alt lifts that lock.
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static IntPtr Foreground() { return GetForegroundWindow(); }
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint f);
  // While bills are being made the PC must not go back to sleep or switch the screen off.
  public static void KeepAwake(bool on) { SetThreadExecutionState(on ? 0x80000003u : 0x80000000u); }
  public static void Show(IntPtr h) { ShowWindow(h, IsIconic(h) ? 9 : 5); Front(h); }
  public static void Front(IntPtr h) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); }
}
// Never takes the focus (keys must keep going to Tally), always on top, no taskbar button.
public class NoFocusForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x80 | 0x8; return p; } }
}
'@
}
$flag = Join-Path $PSScriptRoot 'overlay-on.txt'   # exists while the automation works; its first line is the step shown

function Show-Overlay([int]$parent) {
  Win32
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $C = [System.Drawing.Color]; $white = $C::White
  # Plain notice, like a Windows system message: white card, 1 px grey border, Segoe UI, one amber stripe that slowly breathes.
  $mk = { param($txt, $x, $y, $w, $h, $font, $pt, $col)
    $l = New-Object System.Windows.Forms.Label; $l.Text = $txt; $l.SetBounds($x, $y, $w, $h); $l.ForeColor = $col; $l.BackColor = $white
    $l.Font = New-Object System.Drawing.Font($font, $pt); $l }
  $f = New-Object NoFocusForm
  $f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual'; $f.TopMost = $true; $f.BackColor = $C::FromArgb(196, 200, 207)
  $f.ClientSize = New-Object System.Drawing.Size(640, 300)
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $f.Location = New-Object System.Drawing.Point([int]($wa.Left + ($wa.Width - 640) / 2), [int]($wa.Top + ($wa.Height - 300) / 2))
  $card = New-Object System.Windows.Forms.Panel; $card.SetBounds(1, 1, 638, 298); $card.BackColor = $white
  $stripe = New-Object System.Windows.Forms.Panel; $stripe.SetBounds(0, 0, 8, 298)
  $ink = $C::FromArgb(32, 33, 36); $grey = $C::FromArgb(95, 99, 104)
  $title = & $mk 'Tally Automation Mode is ON' 36 26 580 42 'Segoe UI Semibold' 22 $ink
  $warn = & $mk 'Please do not press any key or touch the mouse.' 36 74 580 30 'Segoe UI Semibold' 13.5 $C::FromArgb(176, 40, 30)
  $hint = & $mk 'Kripya abhi keyboard aur mouse ko haath na lagaiye. Tally ke peeche automation apne aap kaam kar rahi hai, ho jaane par ye window khud hat jayegi.' 36 110 580 48 'Segoe UI' 10.5 $grey
  $rule = New-Object System.Windows.Forms.Panel; $rule.SetBounds(36, 172, 566, 1); $rule.BackColor = $C::FromArgb(226, 229, 234)
  $cap = & $mk 'Abhi' 36 186 200 20 'Segoe UI' 9 $grey
  $status = & $mk '' 36 206 566 28 'Segoe UI Semibold' 12 $ink
  $track = New-Object System.Windows.Forms.Panel; $track.SetBounds(36, 246, 566, 4); $track.BackColor = $C::FromArgb(233, 235, 239)
  $block = New-Object System.Windows.Forms.Panel; $block.SetBounds(0, 0, 110, 4); $block.BackColor = $C::FromArgb(74, 90, 110); $track.Controls.Add($block)
  $hide = New-Object System.Windows.Forms.Button; $hide.Text = 'Chhupao'; $hide.SetBounds(510, 262, 92, 26); $hide.FlatStyle = 'Flat'
  $hide.Font = New-Object System.Drawing.Font('Segoe UI', 9); $hide.ForeColor = $grey; $hide.BackColor = $white
  $hide.FlatAppearance.BorderColor = $C::FromArgb(196, 200, 207); $hide.Add_Click({ $f.Hide() })
  $card.Controls.AddRange(@($stripe, $title, $warn, $hint, $rule, $cap, $status, $track, $hide)); $f.Controls.Add($card)
  $st = @{ n = 0 }
  $t = New-Object System.Windows.Forms.Timer; $t.Interval = 50
  $t.Add_Tick({
    $st.n++; $n = $st.n
    $k = ([Math]::Sin($n / 18) + 1) / 2                                              # stripe breathes, slowly
    $stripe.BackColor = $C::FromArgb(232, [int](140 + 45 * $k), [int](10 + 20 * $k))
    $block.Left = [int]([Math]::Abs((($n * 8) % 912) - 456))                         # thin bar sweeps 0..456 and back
    if ($n % 6 -eq 0) {
      if (-not (Test-Path $flag)) { $f.Close(); return }
      $line = Get-Content $flag -TotalCount 1 -ErrorAction SilentlyContinue
      if ($line -and $status.Text -ne $line) { $status.Text = $line }
    }
    if ($n % 40 -eq 0 -and $parent -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { $f.Close() }   # the script died: never stay stuck on screen
  })
  $t.Start(); [System.Windows.Forms.Application]::Run($f); $t.Stop()
}
if ($Overlay) { Show-Overlay $Parent; return }

# The main script switches it on/off: a second hidden PowerShell shows the window.
function Overlay-On($text) {
  Win32; [Fg]::KeepAwake($true)
  Set-Content $flag $text -Encoding UTF8
  if ($script:ovPid -and (Get-Process -Id $script:ovPid -ErrorAction SilentlyContinue)) { return }
  $script:ovPid = (Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Overlay', '-Parent', $PID).Id
}
function Overlay-Text($text) { if (Test-Path $flag) { Set-Content $flag $text -Encoding UTF8 } }
function Overlay-Off { Remove-Item $flag -ErrorAction SilentlyContinue; if ('Fg' -as [type]) { [Fg]::KeepAwake($false) } }

# This PC's network card (the one with the default route): its address is what OMS needs to wake the PC (Wake-on-LAN),
# and whether the card is allowed to wake it.
function Pc-Net {
  try {
    $ad = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).NetAdapter
    $wol = try { (Get-NetAdapterPowerManagement -Name $ad.Name -ErrorAction Stop).WakeOnMagicPacket } catch { 'unknown' }
    [pscustomobject]@{ Name = $ad.Name; Desc = $ad.InterfaceDescription; Mac = $ad.MacAddress; Wifi = ($ad.PhysicalMediaType -match '802\.11'); Wol = "$wol" }
  } catch { $null }
}

# One-time set-up so OMS can wake this PC from sleep: tally-pc.bat -EnableWake (asks Windows for admin once).
if ($EnableWake) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-EnableWake'; return }
  $n = Pc-Net
  if (-not $n) { Write-Host 'Network card nahi mila.' -ForegroundColor Red }
  else {
    Write-Host "Network card: $($n.Name) ($($n.Desc))   Wi-Fi: $($n.Wifi)"
    try { Set-NetAdapterPowerManagement -Name $n.Name -WakeOnMagicPacket Enabled -ErrorAction Stop; Write-Host 'Wake on Magic Packet: ON' -ForegroundColor Green } catch { Write-Host "Ye card Wake-on-LAN nahi deta: $($_.Exception.Message)" -ForegroundColor Yellow }
    powercfg /deviceenablewake "$($n.Desc)" | Out-Null; Write-Host 'Allow this device to wake the computer: ON' -ForegroundColor Green
  }
  # No password prompt after waking (the helper types into Tally, which needs the unlocked desktop).
  powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 | Out-Null; powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 | Out-Null; powercfg /setactive SCHEME_CURRENT | Out-Null
  Write-Host 'Password after wake: OFF' -ForegroundColor Green
  Write-Host "BIOS mein bhi 'Wake on LAN' ON hona chahiye (ek baar dekh lena). Enter dabao..."; [void][Console]::ReadLine(); return
}

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
# Bill number as OCR can read it: the digits part (OCR sometimes reads S as 5). The "/" is often read as 1, l, I or |
# (SSS-792/26-27 came out "SSS-792126-27" and the helper refused to save), so the slash may be any of those, or missing.
function Shows-Bill($t) { $p = ($script:no -replace '^SSS-', '') -split '/'; $t -match ([regex]::Escape($p[0]) + '[/1lI|!]?' + [regex]::Escape($p[1])) }
# The number alone is not enough: on the real Day Book photo OCR read 774 as 776. Party names
# (bigger, letters) came out exactly, so every "is this the bill?" check wants both.
function Shows-Party($t) { ($t -replace '[^A-Za-z0-9]', '').ToUpper().Contains($script:partyKey) }
function Is-ThisBill($t) { (Shows-Bill $t) -and (Shows-Party $t) }

# One key into Tally. $gate: a pattern Tally's screen MUST show first, or nothing is sent.
# Speed: Tally already in front -> 0.1 s before the key (else focus it and wait 0.7 s: Alt was lost at 0.3 s once).
# A gate polls the screen every ~0.3 s until it shows what the key needs (up to ~3 s), so no fixed waits to guess the speed.
# After the key: 0.2 s (-Fast) or 0.5 s plus a photo - Ctrl+A was swallowed once when the bill was still opening (SSS-750),
# which is why the bill's own screen is waited for (and checked) before Ctrl+A.
function Key($k, $gate = $null, $what = '', [switch]$Fast) {
  Write-Host "  key $k"
  if (Is-TallyFront) { Start-Sleep -Milliseconds 100 }
  else {
    if (-not (Focus-Tally)) { Stop-Here 'Could not bring Tally to the front - stopped.' }
    Start-Sleep -Milliseconds 700
  }
  if ($gate) {
    foreach ($n in 1..10) { $t = Seen "before $k"; if ($t -match $gate) { break }; Start-Sleep -Milliseconds 300 }
    if ($t -notmatch $gate) { Stop-Here "Tally is not showing $what - stopped before pressing $k." }
  }
  if (-not (Is-TallyFront)) { Stop-Here "Another window took the focus - stopped before pressing $k." }
  $sh.SendKeys($k)
  if ($Fast) { Start-Sleep -Milliseconds 200; return }
  Start-Sleep -Milliseconds 500
  try { [void](Snap "after $k") } catch { }
}

# After the last print: Esc x4 back to the Gateway of Tally (as the owner does by hand), then check; two more Esc if needed.
function Back-To-Gateway {
  Overlay-Text 'Tally ko Gateway par wapas la raha hai'
  Key '{ESC}' -Fast; Key '{ESC}' -Fast
  foreach ($n in 1..8) {
    $t = Seen 'gateway'
    if ($t -match 'GatewayofTally' -and $t -match 'BalanceSheet') { return }   # never an Esc on the Gateway itself
    Key '{ESC}' -Fast; Start-Sleep -Milliseconds 300
  }
  Write-Host '>>> Tally did not come back to the Gateway - look at it.' -ForegroundColor Yellow
}

# One print from Tally's Print box: F5 sets the copies first, every time (Tally may remember the last ones).
function Print-Once($invCopies, $ewbCopies) {
  Key '{F5}' 'Copies' "the Print box" -Fast
  foreach ($n in 1..8) { $t = Seen 'printer-settings'; if ($t -match 'PrinterSettings') { break }; Start-Sleep -Milliseconds 300 }
  if ($t -notmatch 'PrinterSettings') { Stop-Here 'Printer Settings did not open - stopped, nothing printed.' }
  # The e-Way line is there only when the bill has an e-way bill (owner's screens, 750 vs 751).
  if ($t -match 'copiesfore-?Way') { Key "$invCopies~" -Fast; Key '~' -Fast; Key "$ewbCopies" -Fast; Key '^a' -Fast }
  else { Key "$invCopies" -Fast; Key '^a' -Fast }
  Key 'p' 'Copies' "the Print box" -Fast
  # Tally now shows "Printing ... 0%" over the bill. While it is up the bill behind it is dimmed and OCR cannot read it
  # (SSS-796: "Tally is not on SSS-796 any more"), and an Esc would cancel the print. So wait until that box is gone.
  Start-Sleep -Milliseconds 500
  foreach ($n in 1..60) { if ((Seen 'printing') -notmatch 'Printing') { break }; Start-Sleep -Milliseconds 300 }
}

Overlay-On 'Bill ka kaam shuru ho raha hai...'
try {
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
  Overlay-Text "$no  $(Txt $v.PARTYLEDGERNAME)  -  bill khola ja raha hai"
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
  Key '{F2}' 'VchNo' 'the Day Book' -Fast
  Key "$date~" -Fast
  Key '^f' 'VchNo' 'the Day Book' -Fast
  Key "$no~" 'Lookfor' 'the "Look for" filter box' -Fast
  # Exactly one row left: one bill number on screen, and it is this one. (The filter takes a moment: look again.)
  foreach ($n in 1..8) {
    $t = Seen 'filtered'
    if ((Is-ThisBill $t) -and $t -match 'VchNo' -and [regex]::Matches($t, '\d+/\d\d-\d\d').Count -eq 1) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not (Is-ThisBill $t) -or $t -notmatch 'VchNo' -or [regex]::Matches($t, '\d+/\d\d-\d\d').Count -ne 1) { Stop-Here "The Day Book is not showing $no alone - stopped before opening anything." }
  Key '~' -Fast
  # Made by hand meanwhile? (SSS-752 was, while an old list still offered it.) Never re-save a bill that has an IRN.
  if (Txt (Ask-Tally $byNo).IRN) { Stop-Here "$no already has its e-invoice (made by hand?) - stopped, nothing saved. Press Esc in Tally." }
  # Save only if Tally really shows THIS bill open (a slipped step once opened SSS-738 instead of 752, another RAMSON's).
  foreach ($n in 1..10) {
    $t = Seen 'before-save'
    if ((Is-ThisBill $t) -and $t -match 'Party|ledger') { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not (Is-ThisBill $t) -or $t -notmatch 'Party|ledger') { Stop-Here "$no is not open in Tally - stopped BEFORE saving anything. Press Esc in Tally (don't save)." }
  Key '^a'
  # Two wordings: "Do you want to generate e-Invoice?" and, with an e-way bill due, "Do you want to send
  # voucher details for e-Invoice and e-Way Bill generation?" (SSS-778). OCR reads "e-Invoice" as "e-lnvoice".
  Key 'y' '(?=.*YesorNo)(?=.*(generate|voucherdetailsfor).{0,4}[Il1]nvoice)' 'the "e-Invoice?" question'

  # IRN. If Tally asks for the e-invoice portal login, type it ONCE (ID, Enter, password, Ctrl+A) - only when that
  # screen really shows. A wrong password tried again and again can lock the portal account, so never a second try.
  Write-Host 'Waiting for the IRN (up to 5 min)...'
  Overlay-Text "$no  -  e-Invoice (IRN) ban raha hai"
  $irn = $null; $typed = $null
  foreach ($i in 1..200) {
    Start-Sleep -Milliseconds 1500
    # Tally doesn't answer while a screen of its own is open - just keep waiting.
    try { $irn = Txt (Ask-Tally $byNo).IRN } catch { }
    if ($irn) { break }
    if ($i -le 4 -or $i % 6 -eq 0) {
      try { $login = (Seen 'waiting') -match 'Password' } catch { $login = $false }
      if ($login -and $typed -and ((Get-Date) - $typed).TotalSeconds -gt 12) { Stop-Here "$no : the e-invoice portal login did not go through (wrong ID/password?) - stopped, not tried again. Fix it in Tally." }
      if ($login -and $typed) { }   # typed a moment ago: Tally is still sending it
      elseif ($login -and -not ($cfg.eiuser -and $cfg.eipass)) { [console]::Beep(1000, 900); Write-Host '>>> Tally is asking for the e-invoice login: type the ID/password in Tally yourself. Waiting...' -ForegroundColor Yellow }
      elseif ($login) {
        Write-Host 'Tally asks for the e-invoice login - typing it once.'
        Key ((Plain $cfg.eiuser) + '~') 'Password' 'the e-invoice login' -Fast
        Key (Plain $cfg.eipass) 'Password' 'the e-invoice login' -Fast
        Key '^a' 'Password' 'the e-invoice login'
        $typed = Get-Date
      }
    }
  }
  if (-not $irn) { Stop-Here "$no : no IRN after 5 minutes (login not done, or an error in Tally). Not printed - stopped." }
  $ewb = ''
  if (-not $local) {   # a Maharashtra bill never prints an e-way copy, so no waiting for one
    foreach ($i in 1..4) {
      try { $ewb = Txt (Ask-Tally $byNo).'EWAYBILLDETAILS.LIST'.BILLNUMBER } catch { }
      if ($ewb) { break }
      Start-Sleep -Milliseconds 1500
    }
  }
  Write-Host "IRN ok: $irn   e-way: $(if ($ewb) { $ewb } else { 'none' })   $(if ($local) { 'Maharashtra: invoice x2, separately' } else { 'outside MH: invoice 2 + e-way 2' })"
  # Tally first shows "e-Invoice and e-Way Bill generated successfully ... Press any key to continue"
  # (SSS-778); the Print box comes after it. ONE Enter for that box, never more: the photo taken right after the Enter
  # still showed the box (Tally had not redrawn), so the helper pressed Enter again - and that Enter landed on the Print
  # box, whose default button is Print. One copy printed by accident and the real print stopped (SSS-795).
  $pressed = $false
  foreach ($i in 1..16) {
    $t = Seen 'after-irn'
    if ($t -match 'Copies') { break }
    if ($t -match 'Pressanykey' -and -not $pressed) { Key '~' -Fast; $pressed = $true; Start-Sleep -Milliseconds 800 }
    else { Start-Sleep -Milliseconds 300 }
  }

  Overlay-Text "$no  -  print ho raha hai"
  if (-not $local -and $ewb) { Print-Once 2 2 }
  else {
    if (-not $local) { [console]::Beep(800, 400); Write-Host ">>> $no : Maharashtra ke bahar, par e-way bill nahi bana (bill Rs 50,000 se kam ho to theek hai) - sirf invoice 2 baar print." -ForegroundColor Yellow }
    Print-Once 1 0
    # Second copy on its own sheet: open the bill again (Day Book still filtered to it) and print once more.
    foreach ($n in 1..10) { $t = Seen 'after-first-print'; if (Is-ThisBill $t) { break }; Start-Sleep -Milliseconds 300 }
    if (-not (Is-ThisBill $t)) { Stop-Here "First copy printed; Tally is not on $no any more - print the second copy by hand." }
    if ($t -notmatch 'Party|ledger') {
      Key '~' -Fast
      foreach ($n in 1..8) { $t = Seen 'reopened'; if ($t -match 'Party|ledger') { break }; Start-Sleep -Milliseconds 300 }
      if ($t -notmatch 'Party|ledger') { Stop-Here "First copy printed; $no did not open again - print the second copy by hand." }
    }
    Key '%p' -Fast
    # Alt+P only opens the top-bar Print menu (Current highlighted, seen on SSS-784); Enter picks Current = the Print box.
    Key '~' 'Current' 'the Print menu' -Fast
    Print-Once 1 0
  }
  Back-To-Gateway
}
} finally { Overlay-Off }
Write-Host "`nDone."

}

if ($Once -or $List) { Run-Helper -List:$List -Max $Max; return }

# ---- start-up: tell OMS, open Tally, log in (was tally-autostart.ps1) ----
Start-Transcript -Path "$PSScriptRoot\tally-pc-log.txt" -Force | Out-Null
# One small window for every question to the person at this PC: white card, amber stripe, Segoe UI, buttons.
# Returns the number of the button pressed (0 = first). $Seconds > 0: after that long the $Default button is taken for them.
function Notice([string]$Heading, [string]$Body, [string[]]$Buttons, [int]$Seconds = 0, [int]$Default = 0) {
  Win32
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $C = [System.Drawing.Color]; $white = $C::White; $ink = $C::FromArgb(32, 33, 36); $grey = $C::FromArgb(95, 99, 104)
  $bodyFont = New-Object System.Drawing.Font('Segoe UI', 10.5)
  $textH = [System.Windows.Forms.TextRenderer]::MeasureText($Body, $bodyFont, (New-Object System.Drawing.Size(470, 2000)), 'WordBreak').Height + 8
  $h = 24 + 34 + 12 + $textH + 16 + $(if ($Seconds) { 40 } else { 0 }) + 52 + 16
  $f = New-Object System.Windows.Forms.Form
  $f.Text = 'Tally PC automation'; $f.FormBorderStyle = 'FixedDialog'; $f.ControlBox = $false; $f.TopMost = $true; $f.BackColor = $white
  $f.ClientSize = New-Object System.Drawing.Size(560, $h); $f.StartPosition = 'Manual'
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $f.Location = New-Object System.Drawing.Point([int]($wa.Left + ($wa.Width - 560) / 2), [int]($wa.Top + ($wa.Height - $h) / 2))
  $f.Add_Shown({ [Fg]::Front($f.Handle); $f.Activate() })
  $stripe = New-Object System.Windows.Forms.Panel; $stripe.SetBounds(0, 0, 8, $h); $stripe.BackColor = $C::FromArgb(232, 160, 20)
  $title = New-Object System.Windows.Forms.Label; $title.Text = $Heading; $title.SetBounds(30, 22, 510, 34); $title.ForeColor = $ink
  $title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 15)
  $txt = New-Object System.Windows.Forms.Label; $txt.Text = $Body; $txt.SetBounds(30, 68, 500, $textH + 4); $txt.Font = $bodyFont; $txt.ForeColor = $ink
  $f.Controls.AddRange(@($stripe, $title, $txt))
  $y = 68 + $textH + 20
  if ($Seconds) {
    $left = New-Object System.Windows.Forms.Label; $left.SetBounds(30, $y, 500, 20); $left.Font = New-Object System.Drawing.Font('Segoe UI', 9); $left.ForeColor = $grey
    $track = New-Object System.Windows.Forms.Panel; $track.SetBounds(30, ($y + 24), 500, 3); $track.BackColor = $C::FromArgb(233, 235, 239)
    $bar = New-Object System.Windows.Forms.Panel; $bar.SetBounds(0, 0, 500, 3); $bar.BackColor = $C::FromArgb(74, 90, 110); $track.Controls.Add($bar)
    $f.Controls.AddRange(@($left, $track)); $y += 40
  }
  $st = @{ pick = $Default; n = 0 }
  $gap = 8; $bw = [Math]::Min(150, [int]((500 - $gap * ($Buttons.Count - 1)) / $Buttons.Count)); $x = 530 - ($bw * $Buttons.Count + $gap * ($Buttons.Count - 1))
  for ($i = 0; $i -lt $Buttons.Count; $i++) {
    $b = New-Object System.Windows.Forms.Button; $b.Text = $Buttons[$i]; $b.SetBounds($x, $y, $bw, 36); $b.Tag = $i; $b.FlatStyle = 'Flat'
    $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9.5)
    if ($i -eq $Default) { $b.BackColor = $C::FromArgb(45, 62, 80); $b.ForeColor = $white; $b.FlatAppearance.BorderColor = $C::FromArgb(45, 62, 80); $f.AcceptButton = $b }
    else { $b.BackColor = $white; $b.ForeColor = $ink; $b.FlatAppearance.BorderColor = $C::FromArgb(196, 200, 207) }
    $b.Add_Click({ param($s, $e) $st.pick = $s.Tag; $f.Close() })
    $f.Controls.Add($b); $x += $bw + $gap
  }
  $t = New-Object System.Windows.Forms.Timer; $t.Interval = 100
  $t.Add_Tick({
    $st.n++
    if (-not $Seconds) { return }
    $rest = $Seconds - $st.n / 10
    $left.Text = "$([int][Math]::Ceiling($rest)) second mein jawab nahi aaya to '$($Buttons[$Default])' maana jayega."
    $bar.Width = [int](500 * [Math]::Max([double]0, $rest) / $Seconds)
    if ($rest -le 0) { $f.Close() }
  })
  $t.Start(); [System.Media.SystemSounds]::Asterisk.Play()
  [void]$f.ShowDialog(); $t.Stop(); $f.Dispose()
  $st.pick
}

# Bills waiting in Tally (read from the helper's -List text) as a short list, and a rough time for them.
$script:secPerBill = 70   # learned from real runs below
function Parse-Bills($text) {
  @($text -split "\r?\n" | ForEach-Object { if ($_ -match '^\s*\d{8}\s+(SSS-\S+)\s+(.*?)\s+\(([^)]*)\)\s*$') { [pscustomobject]@{ No = $Matches[1]; Party = $Matches[2]; State = $Matches[3] } } } | Sort-Object No -Unique)
}
function Bills-Text($bills) {
  $lines = @($bills | Select-Object -First 8 | ForEach-Object { "  -  $($_.No)    $($_.Party)  ($($_.State))" })
  if ($bills.Count -gt 8) { $lines += "  ...  aur $($bills.Count - 8) bill" }
  $lines -join "`n"
}
function Eta($n) { "kareeb $([int][Math]::Ceiling(($n * $script:secPerBill + 25) / 60)) minute" }

# Tally open but not on screen (behind other windows, or minimised)? Bring it to the front; Alt+Tab if that did not work.
function Show-Tally {
  $p = Tally-Proc; if (-not $p) { return }
  Win32
  [Fg]::Show($p.MainWindowHandle)
  Start-Sleep -Milliseconds 400
  if ([Fg]::Foreground() -ne $p.MainWindowHandle) { (New-Object -ComObject WScript.Shell).SendKeys('%{TAB}'); Start-Sleep -Milliseconds 500 }
}
if ((Notice 'Tally Automation ON hone wali hai' "Tally khulega, company ka login hoga aur bills ke e-invoice apne aap banenge.`nAap kuch type mat karna jab tak chal raha ho." @('Haan, shuru karo', 'Nahi') 20 0) -ne 0) { Write-Host 'Cancelled by the user - nothing done.'; return }

# Make it start by itself at every logon: a shortcut in the Startup folder (no admin needed).
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Tally PC.lnk'
if (-not (Test-Path $lnk)) { $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath = "$PSScriptRoot\tally-pc.bat"; $s.WorkingDirectory = $PSScriptRoot; $s.Save(); Write-Host 'Added to Startup: it will run by itself at every logon.' }

function Hello-Once {
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$($cfg.oms)/api/tally/pc-hello" -Headers @{ 'x-tally-key' = $cfg.key } -ContentType 'application/json' -Body (@{ mac = (Pc-Net).Mac } | ConvertTo-Json) -TimeoutSec 10
    $r.data.url
  } catch { $null }
}
function Hello {
  foreach ($i in 1..20) {   # the network may still be coming up right after power-on
    $u = Hello-Once
    if ($u) { Write-Host "OMS knows us as $u"; return }
    Write-Host 'OMS not reachable yet'; Start-Sleep -Seconds 15
  }
}
# Can OMS wake this PC from sleep? Say so in the window.
function Wake-Check {
  $n = Pc-Net
  if (-not $n) { return }
  if ($n.Wol -eq 'Enabled') { Write-Host "Wake-on-LAN taiyaar ($($n.Name)): sleep mein ho to OMS is PC ko jagaa sakta hai." -ForegroundColor Green }
  elseif ($n.Wol -eq 'Disabled') { Write-Host ">>> Wake-on-LAN band hai: PC sleep mein ho to OMS use jagaa nahi payega. Ek baar chalao: tally-pc.bat -EnableWake" -ForegroundColor Yellow }
  else { Write-Host 'Wake-on-LAN ki halat dikh nahi rahi (admin ke bina Windows batata nahi). Sleep se PC na jaage to ek baar chalao: tally-pc.bat -EnableWake' -ForegroundColor Yellow }
  if ($n.Wifi) { Write-Host '>>> Ye PC Wi-Fi par hai: Wake-on-LAN Wi-Fi par aksar kaam nahi karta. LAN cable lagana behtar hai.' -ForegroundColor Yellow }
}
function Tally-Answers { try { [void](Invoke-WebRequest 'http://localhost:9000' -UseBasicParsing -TimeoutSec 5); $true } catch { $false } }
function Tally-Proc { Get-Process | Where-Object { $_.ProcessName -like 'tally*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }

function Start-Tally { Overlay-On 'Tally khul raha hai aur login ho raha hai...'; try { Start-TallyKeys } finally { Overlay-Off } }
function Start-TallyKeys {
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
  # Tally opens on the last date it was used: once the company is open, F2 on the Gateway sets today's date (like the owner does by hand).
  foreach ($w in 1..40) { if (Tally-Answers) { break }; Start-Sleep -Seconds 3 }
  Start-Sleep -Seconds 3; [void]$sh.AppActivate($p.Id); Start-Sleep -Seconds 1
  $sh.SendKeys('{F2}'); Start-Sleep -Seconds 2
  $sh.SendKeys((Get-Date).ToString('d-M-yyyy') + '~')
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

Wake-Check
Write-Host "Watching Tally for bills without an e-invoice (every $EverySeconds s). Close this window to stop." -ForegroundColor Cyan
$later = $null; $approved = $false   # $later: when the person said "start later"; $approved: they agreed, so the rest of the bills just go through
$lastLoop = Get-Date; $loops = 0
while ($true) {
  Start-Sleep -Seconds $EverySeconds
  # Back from sleep (the loop was frozen) or every minute: tell OMS this PC's address again - DHCP may have given it a new one.
  $loops++
  if (((Get-Date) - $lastLoop).TotalSeconds -gt 45 -or $loops % 6 -eq 0) { [void](Hello-Once) }
  $lastLoop = Get-Date
  if (Start-Asked) {
    if (Tally-Proc) { Write-Host 'Start Tally asked from OMS - Tally is already open.' }
    else { try { Start-Tally; Hello } catch { Write-Host "Start Tally failed: $($_.Exception.Message)" -ForegroundColor Red } }
  }
  # Tally was closed (by someone, or it crashed)? Ask once; Yes (or no answer) reopens it, No = leave it
  # closed until Tally is open again (a backup or update needs it closed).
  if (Tally-Proc) { $declined = $false }
  elseif (-not $declined) {
    if ((Notice 'Tally band ho gaya hai' "Tally dobara kholna hai? Company ka login bhi apne aap hoga.`nNahi dabane par Tally band hi rahega." @('Haan, kholo', 'Nahi') 20 0) -eq 0) {
      try { Start-Tally; Hello } catch { Write-Host "Reopening Tally failed: $($_.Exception.Message)" -ForegroundColor Red; $declined = $true }
    } else { $declined = $true }
  }
  if ($later -and (Get-Date) -lt $later) { continue }   # they chose "later": wait, whatever is posted meanwhile
  try {
    $pendingText = Run-Helper -List 6>&1 | Out-String # read-only: asks Tally which bills are pending
  } catch {
    continue # Tally closed or busy - try again next round
  }
  if ($pendingText -match 'Koi bill') { $approved = $false; $later = $null; continue }
  $bills = @(Parse-Bills $pendingText)   # @(): a single bill comes back as one object, which has no .Count
  if (-not $bills.Count) { continue }
  Write-Host "`n$(Get-Date -Format 'HH:mm:ss')  Pending:`n$pendingText" -ForegroundColor Yellow

  if (-not $approved) {
    if ($later) {
      # The chosen time is up: warn, then start by itself.
      $later = $null
      [void](Notice 'Apna kaam save kar lijiye' "Tally automation ab shuru hone wali hai, kyunki Tally mein ye sales bill banane hain:`n`n$(Bills-Text $bills)`n`nLagne wala time: $(Eta $bills.Count).`nPlease save your work now." @('Abhi shuru karo') 20 0)
    }
    elseif ([Idle]::Seconds() -lt $IdleSeconds) {
      # Someone is working at this PC: tell them what is waiting and let them choose.
      $pick = Notice 'Tally mein sales bill banana hai' "OMS se ye bill post hue hain:`n`n$(Bills-Text $bills)`n`nLagne wala time: $(Eta $bills.Count).`nProceed dabane par automation shuru hogi, tab koi key ya mouse mat dabaiye." @('Proceed', 'Later') 60 0
      if ($pick -eq 1) {
        $mins = 0, 1, 5, 10, 15
        $when = Notice 'Automation kab shuru karni hai?' "Jo bhi waqt chunoge, utne waqt baad pehle ek yaad dilane wala popup aayega, phir automation shuru hogi." @('Abhi (Now)', '1 min baad', '5 min baad', '10 min baad', '15 min baad') 60 2
        if ($mins[$when] -gt 0) { $later = (Get-Date).AddMinutes($mins[$when]); Write-Host "Later: $($mins[$when]) min (till $($later.ToString('HH:mm')))"; continue }
      }
    }
    $approved = $true
  }
  Show-Tally
  $sw = [Diagnostics.Stopwatch]::StartNew(); $count = $bills.Count
  try {
    Run-Helper -Max 50   # all that are waiting, one after the other
    $script:secPerBill = [int][Math]::Min([double]300, [Math]::Max([double]30, ($script:secPerBill + $sw.Elapsed.TotalSeconds / $count) / 2))
  } catch {
    [console]::Beep(600, 900)
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix it in Tally, then start tally-pc.bat again.' -ForegroundColor Red
    break
  }
}
