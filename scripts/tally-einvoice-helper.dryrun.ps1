# Dry run of tally-einvoice-helper.ps1: fake Tally + fake keyboard. Prints every formula and key it would send.
# Run after any change: powershell -ExecutionPolicy Bypass -File scripts\tally-einvoice-helper.dryrun.ps1
$script:calls = 0
function Invoke-WebRequest { param($Uri, $Method, $Body, [switch]$UseBasicParsing, $TimeoutSec)
  $script:calls++
  Write-Host ("TALLY FORMULA: " + [regex]::Match($Body, '<SYSTEM[^>]*>(.*)</SYSTEM>').Groups[1].Value)
  $irn = if ($script:calls -ge 3) { '<IRN TYPE="String">abc123</IRN>' } else { '' }
  # $env:DRY_EWB=1 -> the bill also gets an e-way bill (tests the 2-2 print path)
  if ($irn -and $env:DRY_EWB) { $irn += '<EWAYBILLDETAILS.LIST><BILLNUMBER>202294394122</BILLNUMBER></EWAYBILLDETAILS.LIST>' }
  [pscustomobject]@{ Content = "<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><DATE TYPE=`"Date`">20260924</DATE><VOUCHERNUMBER>SSS-747/26-27</VOUCHERNUMBER><PARTYLEDGERNAME TYPE=`"String`">ANIL METAL</PARTYLEDGERNAME><MASTERID TYPE=`"Number`"> 23928</MASTERID>$irn</VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>" }
}
function Start-Sleep {}
function Get-Process { [pscustomobject]@{ ProcessName = 'tally'; MainWindowHandle = 1; Id = 4242 } }
# Fake Tally screen. $env:DRY_WRONG=1 -> another bill is open (the helper must stop before Ctrl+A).
function Snap($name) { Write-Host "PHOTO: $name"; "fake.png" }
function Read-Screen($png) { if ($env:DRY_WRONG) { 'Sales No. SSS-738/26-27 Party Alc name: MUKTI KITCHENWARE' } else { 'Sales No. SSS-747/26-27 Party Alc name: ANIL METAL' } }
function New-Object { [pscustomobject]@{} | Add-Member -PassThru ScriptMethod AppActivate { $true } | Add-Member -PassThru ScriptMethod SendKeys { param($k) Write-Host "KEY: $k" } }
& "$PSScriptRoot\tally-einvoice-helper.ps1" -Auto
