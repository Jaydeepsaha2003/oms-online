# ============================================================
#  OMS - make the servers "on whenever the PC is on", independent of Wi-Fi.
#  Run via enable-always-on.bat (which self-elevates). Idempotent - safe to
#  re-run; every step reports what it changed.
#
#  WHY THIS EXISTS (measured on this machine, not guessed):
#  The servers do NOT die when the Wi-Fi drops. Proven: the node processes
#  started at 09:58 and were still serving at 14:35, across FOUR Wi-Fi
#  disconnect/reconnect cycles (WLAN-AutoConfig events 8003/8001 at 14:11,
#  14:14, 14:18, 14:31). Both listeners are bound to the wildcard address
#  (API 0.0.0.0:4000, web [::]:6173), which is not tied to any adapter and
#  therefore survives an interface going away.
#
#  What actually breaks is the ADDRESS, not the server:
#    - The Wi-Fi is a TP-Link *USB* adapter. Windows had USB selective
#      suspend ON, so Windows kept powering it down - that is the Wi-Fi
#      dropping on its own.
#    - When it drops, 192.168.0.236 disappears from the machine, so the
#      https://192.168.0.236:6173 URL saved on every phone points at
#      nothing. The server is up; the address is gone. That is what
#      "the server goes down with the Wi-Fi" looks like from outside.
#    - There was NO boot-time autostart registered ('OMS Auto Start' did
#      not exist), only Startup-folder shortcuts - so after a reboot the
#      servers waited for somebody to LOG IN before coming back.
#
#  This script fixes the three machine-level causes. To undo, see the
#  "UNDO" note printed at the end.
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$changed = @()

Write-Host ''
Write-Host '=== OMS: always-on setup ==============================='
Write-Host ''

# ------------------------------------------------------------------
# 1. Boot-time autostart (the real gap: server needed a LOGIN to come back).
#    Reuses enable-autostart.ps1 so there is exactly one definition of the
#    task - this script only makes sure it has actually been registered.
# ------------------------------------------------------------------
$task = Get-ScheduledTask -TaskName 'OMS Auto Start' -ErrorAction SilentlyContinue
if ($task) {
    Write-Host '[1/4] Boot autostart : already registered.'
} else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'enable-autostart.ps1')
    $changed += 'registered the SYSTEM boot task'
    Write-Host '[1/4] Boot autostart : REGISTERED - servers now start at power-on, before login.'
}

# Belt and braces: the task must never be gated on a network being present,
# or the very thing we are fixing (no Wi-Fi) would stop the server starting.
$task = Get-ScheduledTask -TaskName 'OMS Auto Start' -ErrorAction SilentlyContinue
if ($task -and $task.Settings.RunOnlyIfNetworkAvailable) {
    $s = $task.Settings
    $s.RunOnlyIfNetworkAvailable = $false
    Set-ScheduledTask -TaskName 'OMS Auto Start' -Settings $s | Out-Null
    $changed += 'cleared the task network condition'
    Write-Host '      -> cleared "start only if a network connection is available".'
}

# ------------------------------------------------------------------
# 2. Stop Windows powering down the USB Wi-Fi adapter.
#    USB selective suspend is what makes a USB Wi-Fi stick drop on its own.
# ------------------------------------------------------------------
$usbSub  = '2a737441-1930-4402-8d77-b2bebba308a3'
$usbSusp = '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'
powercfg /setacvalueindex SCHEME_CURRENT $usbSub $usbSusp 0 | Out-Null
powercfg /setdcvalueindex SCHEME_CURRENT $usbSub $usbSusp 0 | Out-Null
powercfg /setactive SCHEME_CURRENT | Out-Null
Write-Host '[2/4] USB suspend    : disabled (AC + DC) - Windows can no longer power down the Wi-Fi stick.'

# Per-adapter power saving. The "Allow the computer to turn off this device to
# save power" checkbox lives in the driver's PnPCapabilities value; 24 (0x18)
# turns off both that and wake-from-device. Takes effect after a reboot.
$netClass = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
$touched = 0
foreach ($sub in Get-ChildItem $netClass -ErrorAction SilentlyContinue) {
    $p = Get-ItemProperty $sub.PSPath -ErrorAction SilentlyContinue
    if (-not $p.DriverDesc) { continue }
    # Only the PHYSICAL NICs on this box. Virtual adapters (Wi-Fi Direct, VPN,
    # Hyper-V) have no real hardware to power down, so changing them is a no-op
    # that only makes this script's output confusing.
    if ($p.DriverDesc -match 'TP-Link|Wireless|Wi-?Fi|Realtek PCIe' -and $p.DriverDesc -notmatch 'Virtual|VPN|Hyper-V|Direct') {
        if ($p.PnPCapabilities -ne 24) {
            Set-ItemProperty $sub.PSPath -Name 'PnPCapabilities' -Value 24 -Type DWord
            Write-Host "      -> power saving disabled on: $($p.DriverDesc)"
            $touched++
        }
    }
}
if ($touched -gt 0) { $changed += "disabled NIC power saving on $touched adapter(s) (applies after reboot)" }
else { Write-Host '      -> per-adapter power saving already disabled.' }

# ------------------------------------------------------------------
# 3. Fast Startup off.
#    With it on, "Shut down" is really a hibernate: USB devices are restored
#    from a saved image rather than re-enumerated, which is a classic way for
#    a USB Wi-Fi adapter to come back dead - and -AtStartup task triggers are
#    unreliable on that path. Turning it off makes every power-on a true cold
#    boot, so "PC on => server on" is deterministic. Costs a few seconds boot.
# ------------------------------------------------------------------
$powerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
$hb = (Get-ItemProperty $powerKey -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
if ($hb -ne 0) {
    Set-ItemProperty $powerKey -Name 'HiberbootEnabled' -Value 0 -Type DWord
    $changed += 'disabled Fast Startup'
    Write-Host '[3/4] Fast Startup   : DISABLED - every power-on is now a real boot.'
} else {
    Write-Host '[3/4] Fast Startup   : already disabled.'
}

# ------------------------------------------------------------------
# 4. Never sleep. A sleeping PC is an off server - and the System log showed
#    this machine entering sleep on 05-08. Keep the screen free to blank.
# ------------------------------------------------------------------
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
Write-Host '[4/4] Sleep/hibernate: disabled (display may still blank - that is fine, it does not stop the server).'

Write-Host ''
Write-Host '=== Result ============================================='
if ($changed.Count) { foreach ($c in $changed) { Write-Host "  CHANGED: $c" } }
else { Write-Host '  Nothing needed changing - this machine was already set up.' }
Write-Host ''
Write-Host '  Reboot once so the adapter + Fast Startup changes take effect.'
Write-Host '  After that the servers come up at power-on WITHOUT anyone logging in.'
Write-Host ''
Write-Host '  Reach the app:'
Write-Host "     On this PC        :  https://localhost:6173"
Write-Host "     Phone, anywhere   :  https://192.168.0.236:6173      <- use this one"
Write-Host "     Phone, shop Wi-Fi :  https://$($env:COMPUTERNAME):6173   (LAN only)"
Write-Host ''
Write-Host '  Use the IP, not the PC name, as the everyday phone URL. The name is'
Write-Host '  resolved by NetBIOS/mDNS, which are LAN-only and do NOT travel through'
Write-Host '  the router VPN - so the name works in the shop and fails silently from'
Write-Host '  outside, while the IP works in both places (the VPN routes 192.168.0.x,'
Write-Host '  and 192.168.0.236 is a router DHCP reservation, so it does not move).'
Write-Host ''
Write-Host '  UNDO: disable-autostart.bat removes the boot task; set'
Write-Host '        HiberbootEnabled back to 1 to restore Fast Startup.'
Write-Host '========================================================'
Write-Host ''
