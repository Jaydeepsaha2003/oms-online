# Dry run of tally-pc.ps1 -Once: fake Tally + fake keyboard. Prints every formula and key it would send.
# Run after any change: powershell -ExecutionPolicy Bypass -File scripts\tally-pc.dryrun.ps1
$script:calls = 0; $script:loginShown = 0; $script:infoShown = 0; $script:pr = 0; $script:af = 0; $script:gw = 0
function Invoke-WebRequest { param($Uri, $Method, $Body, [switch]$UseBasicParsing, $TimeoutSec)
  $script:calls++
  Write-Host ("TALLY FORMULA: " + [regex]::Match($Body, '<SYSTEM[^>]*>(.*)</SYSTEM>').Groups[1].Value)
  # $env:DRY_DONE=1 -> the IRN was already made by hand before the helper saves (it must stop).
  $irn = if ($script:calls -ge $(if ($env:DRY_LOGIN) { 5 } else { 3 }) -or ($env:DRY_DONE -and $script:calls -ge 2)) { '<IRN TYPE="String">abc123</IRN>' } else { '' }
  # $env:DRY_EWB=1 -> the bill also gets an e-way bill (tests the 2-2 print path)
  if ($irn -and $env:DRY_EWB) { $irn += '<EWAYBILLDETAILS.LIST><BILLNUMBER>202294394122</BILLNUMBER></EWAYBILLDETAILS.LIST>' }
  [pscustomobject]@{ Content = "<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><DATE TYPE=`"Date`">20260924</DATE><VOUCHERNUMBER>SSS-747/26-27</VOUCHERNUMBER><PARTYLEDGERNAME TYPE=`"String`">ANIL METAL</PARTYLEDGERNAME><MASTERID TYPE=`"Number`"> 23928</MASTERID><AMOUNT TYPE=`"Amount`">-$(if ($env:DRY_AMOUNT) { $env:DRY_AMOUNT } else { '14700.00' })</AMOUNT><STATENAME>$(if ($env:DRY_STATE) { $env:DRY_STATE } else { 'Maharashtra' })</STATENAME>$irn</VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>" }
}
function Start-Sleep {}
# OMS is not called in a dry run: the bill-ready report is printed instead, anything else fails as if OMS were unreachable.
function Invoke-RestMethod { param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec) if ($Uri -like '*pc-printed') { Write-Host "OMS BILL READY: $Body"; return }; throw 'no OMS in a dry run' }
function Start-Process { [pscustomobject]@{ Id = 4243 } }   # the Automation-ON overlay is a second process: not started in a dry run
function Get-Process { [pscustomobject]@{ ProcessName = 'tally'; MainWindowHandle = 1; Id = 4242 } }
function Is-TallyFront { $true }
# Fake Tally screen. $env:DRY_WRONG=1 -> another bill is open (the helper must stop before Ctrl+A).
function Snap($name) { Write-Host "PHOTO: $name"; $name }
# Otherwise every screen the helper checks for is "on show" (bill, e-invoice question, Print box, Printer Settings);
# $env:DRY_EWB=1 adds the e-Way line to Printer Settings.
function Read-Screen($png) {
  if ($global:scr -in 'features', 'features2') { return 'Company:S.S.STEEL Show more features Maintain Accounts Enable Goods and Services Tax (GST) Set/Alter Company GST Rate and Other Details' }
  if ($global:scr -eq 'gst') { return 'GST Rate and Other Details e-Way Bill Details Interstate Threshold Limit Intrastate Threshold Limit Threshold Limit includes Value of Invoice' }
  if ($global:scr -eq 'gateway' -or $png -eq 'restore-start') { return 'Gateway of Tally Balance Sheet' }
  # $env:DRY_PRINTING=1 -> Tally's "Printing 0%" box is up for two looks after the p and for one look after the first print (the bill behind it cannot be read: SSS-796).
  if ($env:DRY_PRINTING -and $png -eq 'printing' -and $script:pr -lt 2) { $script:pr++; return 'Accounting Voucher Display Printing' }
  if ($env:DRY_PRINTING -and $png -eq 'after-first-print' -and $script:af -lt 1) { $script:af++; return 'Accounting Voucher Display Printing' }
  # $env:DRY_GW=1 -> two Esc are not enough (Day Book first): the Gateway shows only on the third look.
  if ($env:DRY_GW -and $png -eq 'gateway' -and $script:gw -lt 2) { $script:gw++; return 'Day Book Vch No For' }
  if ($png -eq 'gateway') { return 'Gateway of Tally Balance Sheet' }   # after the last Esc
  # $env:DRY_INFO=1 -> after the IRN Tally first shows its "generated successfully - Press any key" box, once.
  # $env:DRY_INFO=1 -> after the IRN Tally shows its "generated successfully - Press any key" box; DRY_INFO=2 -> the box is STILL on the photo taken right after the Enter (Tally had not redrawn: SSS-795).
  if ($env:DRY_INFO -and $png -eq 'after-irn' -and $script:infoShown -lt [int]$env:DRY_INFO) { $script:infoShown++; return 'Information e-Invoice and e-Way Bill generated successfully. Press any key to continue' }
  # $env:DRY_LOGIN=1 -> while waiting for the IRN Tally shows the e-invoice portal login, once.
  if ($env:DRY_LOGIN -and ($png -eq 'waiting' -or ($script:loginShown -ge 1 -and $png -like 'before *')) -and $script:loginShown -lt 4) { $script:loginShown++; return 'e-Invoice Login User Name Password' }
  # $env:DRY_GATEWAY=1 -> Tally starts on the Gateway (helper should press K, not Alt+G).
  if ($env:DRY_GATEWAY) { return 'Gateway of Tally Balance Sheet Day Book Vch No For 24-Sep-26 24-Sep-26 ANIL METAL Sales No. SSS-747/26-27 Party Alc name: ANIL METAL Look for Do you want to generate e-Invoice? Yes or No Print Number of Copies Printer Settings' }
  if ($env:DRY_WRONG) { return 'Saved Views Day Book Vch No For 24-Sep-26 24-Sep-26 MUKTI KITCHENWARE Sales No. SSS-738/26-27 Party Alc name: MUKTI KITCHENWARE Look for' }
  'Saved Views Day Book Vch No For 24-Sep-26 24-Sep-26 ANIL METAL Sales No. SSS-747/26-27 Party Alc name: ANIL METAL Look for Do you want to generate e-Invoice? Yes or No Print Number of Copies Printer Settings Print menu Current' + $(if ($env:DRY_EWB) { ' Number of copies for e-Way Bill' } else { '' })
}
function New-Object { [pscustomobject]@{} | Add-Member -PassThru ScriptMethod AppActivate { $true } | Add-Member -PassThru ScriptMethod SendKeys { param($k) Write-Host "KEY: $k"; Eway-Mock-Key $k } }

# ---- E-way limit (F11) simulator. $env:DRY_EWAY=1: OMS says the bill needs an e-way bill whatever the amount. $env:DRY_NODOWN=1: Down does not
# move Tally's cursor (Enter has to). $env:DRY_TYPED_WRONG=1: the limit field keeps showing the old value. $env:DRY_AMOUNT: the bill amount.
function Eway-Required { param($v) if ($env:DRY_EWAY) { , @($v) } else { , @() } }
$global:scr = 'normal'; $global:ret = 'normal'; $global:cur = 0; $global:flagY = $false; $global:typed = ''; $global:atGateway = $false; $global:ewayLog = @()
$global:F11 = @(
  @('Maintain Accounts', 133, 44, 151, 360, 412), @('Enable Bill-wise entry', 151, 52, 177, 360, 412), @('Enable Cost Centres', 169, 52, 171, 360, 412),
  @('Enable Interest Calculation', 187, 52, 206, 360, 412), @('Maintain Inventory', 237, 44, 148, 360, 412), @('Integrate Accounts with Inventory', 256, 52, 243, 360, 412),
  @('Enable multiple Price Levels', 273, 52, 214, 360, 412), @('Enable Batches', 291, 52, 143, 360, 412), @('Enable Job Order Processing', 325, 52, 220, 360, 412),
  @('Enable Cost Tracking', 343, 52, 176, 360, 412), @('Enable Job Costing', 361, 52, 164, 360, 412), @('Use Discount column in invoices', 379, 52, 239, 360, 412),
  @('Use separate Actual and Billed Quantity columns in invoices', 397, 52, 348, 360, 412),
  @('Enable Goods and Services Tax (GST)', 133, 442, 665, 745, 790), @('Set/Alter Company GST Rate and Other Details', 151, 448, 723, 745, 790),
  @('Enable Tax Deducted at Source (TDS)', 169, 442, 663, 745, 790), @('Enable Tax Collected at Source (TCS)', 187, 442, 662, 745, 790))
$global:GST = @(@('HSN/SAC Details', 120, 23, 124, 206, 391), @('GST Rate Details', 252, 23, 123, 220, 292), @('Interstate Threshold Limit', 111, 592, 738, 900, 951),
  @('Intrastate Threshold Limit', 129, 592, 738, 880, 950), @('Threshold Limit includes', 147, 592, 731, 882, 984))
function Eway-Mock-Key($k) {
  if ($k -eq '{ESC}') { $global:atGateway = $true; return }
  if ($global:scr -eq 'normal' -and $k -ne '{F11}') { $global:atGateway = $false }
  if ($k -eq '{F11}') { $global:ret = if ($global:atGateway) { 'gateway' } else { 'normal' }; $global:scr = 'features'; $global:cur = 0; $global:flagY = $false; return }
  if ($global:scr -eq 'features') {
    if ($k -eq '{DOWN}') { if (-not $env:DRY_NODOWN) { $global:cur = [Math]::Min($global:cur + 1, $global:F11.Count - 1) } }
    elseif ($k -eq 'y') { $global:flagY = ($global:cur -eq 14) }
    elseif ($k -eq '~') { if ($global:cur -eq 14 -and $global:flagY) { $global:scr = 'gst'; $global:cur = 0 } else { $global:cur = [Math]::Min($global:cur + 1, $global:F11.Count - 1) } }
  } elseif ($global:scr -eq 'gst') {
    if ($k -eq '~') { $global:cur = [Math]::Min($global:cur + 1, 4) }
    elseif ($k -eq '{BS 12}') { $global:typed = '' }
    elseif ($k -match '^\d+$') { $global:typed = $k; $global:ewayLog += ('limit field "' + $global:GST[$global:cur][0] + '" <- ' + $k) }
    elseif ($k -eq '^a') { $global:scr = 'features2' }
  } elseif ($global:scr -eq 'features2') {
    if ($k -eq '^a') { $global:scr = $global:ret; $global:atGateway = ($global:ret -eq 'gateway') }
  }
}
function Read-Lines($png) {
  $rows = if ($global:scr -in 'features', 'features2') { $global:F11 } elseif ($global:scr -eq 'gst') { $global:GST } else { @() }
  foreach ($r in $rows) { [pscustomobject]@{ T = ($r[0] -replace '\s', ''); Y = $r[1]; X1 = $r[2]; X2 = $r[3] } }
  if ($global:scr -eq 'gst' -and $global:cur -ge 2 -and $global:cur -le 3) {
    $r = $global:GST[$global:cur]; $shown = if ($env:DRY_TYPED_WRONG -or -not $global:typed) { '50,000' } else { '{0:N0}' -f [int]$global:typed }
    [pscustomobject]@{ T = $shown; Y = $r[1]; X1 = $r[4] + 2; X2 = $r[5] }
  }
}
function Highlight-Box($png) {
  $row = if ($global:scr -in 'features', 'features2') { $global:F11[$global:cur] } elseif ($global:scr -eq 'gst') { $global:GST[$global:cur] } else { $null }
  if ($row) { [pscustomobject]@{ L = $row[4]; R = $row[5]; T = $row[1] - 7; B = $row[1] + 7; Y = $row[1] } }
}
# The print record is a real file next to the script: start clean (DRY_KEEPREC=1 keeps the last run's, to prove a bill is never printed again).
if (-not $env:DRY_KEEPREC) { Remove-Item "$PSScriptRoot\print-record.json" -ErrorAction SilentlyContinue }
& "$PSScriptRoot\tally-pc.ps1" -Once
if (Test-Path "$PSScriptRoot\print-record.json") { Write-Host ("PRINT RECORD: " + ((Get-Content "$PSScriptRoot\print-record.json" -Raw) -replace '\s+', ' ')) }
if ($global:ewayLog.Count) { Write-Host ("EWAY LIMIT CHANGES: " + ($global:ewayLog -join " | ")) }
Write-Host ("EWAY MARKER LEFT BEHIND: " + (Test-Path "$PSScriptRoot\eway-limit-low.json"))
