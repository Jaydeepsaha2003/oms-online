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
  [pscustomobject]@{ Content = "<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><DATE TYPE=`"Date`">20260924</DATE><VOUCHERNUMBER>SSS-747/26-27</VOUCHERNUMBER><PARTYLEDGERNAME TYPE=`"String`">ANIL METAL</PARTYLEDGERNAME><MASTERID TYPE=`"Number`"> 23928</MASTERID><STATENAME>$(if ($env:DRY_STATE) { $env:DRY_STATE } else { 'Maharashtra' })</STATENAME>$irn</VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>" }
}
function Start-Sleep {}
function Start-Process { [pscustomobject]@{ Id = 4243 } }   # the Automation-ON overlay is a second process: not started in a dry run
function Get-Process { [pscustomobject]@{ ProcessName = 'tally'; MainWindowHandle = 1; Id = 4242 } }
function Is-TallyFront { $true }
# Fake Tally screen. $env:DRY_WRONG=1 -> another bill is open (the helper must stop before Ctrl+A).
function Snap($name) { Write-Host "PHOTO: $name"; $name }
# Otherwise every screen the helper checks for is "on show" (bill, e-invoice question, Print box, Printer Settings);
# $env:DRY_EWB=1 adds the e-Way line to Printer Settings.
function Read-Screen($png) {
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
function New-Object { [pscustomobject]@{} | Add-Member -PassThru ScriptMethod AppActivate { $true } | Add-Member -PassThru ScriptMethod SendKeys { param($k) Write-Host "KEY: $k" } }
& "$PSScriptRoot\tally-pc.ps1" -Once
