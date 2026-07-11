# Scripts/update-certs.ps1
# Automates local SSL certificate generation based on current network IP interfaces.
# Runs before start.bat / restart.bat to prevent SSL mismatches when switching networks/hotspots.

$ErrorActionPreference = "Stop"

$mkcertDir = "C:\Users\USER\.vite-plugin-mkcert"
$mkcertExe = Join-Path $mkcertDir "mkcert.exe"
$projectCertsDir = Join-Path (Get-Location).Path "certs"

if (-not (Test-Path $mkcertExe)) {
    Write-Host "Warning: mkcert.exe not found at $mkcertExe. Skipping cert auto-update."
    exit 0
}

# 1. Gather all active local IPs (excluding loopback and link-local).
# ALWAYS include the PC's RESERVED LAN IP (DHCP reservation on the shop router).
# Why: if the server is (re)started while the PC is briefly on another network
# (e.g. an iPhone hotspot -> 172.20.10.4), the old code produced a cert that
# DROPPED 192.168.0.236. Phones on the home WiFi then hit a certificate mismatch
# (page/login/notifications all fail) until the next manual restart. Pinning the
# reserved IP means the home URL https://192.168.0.236:6173 is ALWAYS valid, even
# after a detour onto another network. Add more fixed IPs here if the PC ever
# gets a second reserved address.
$reservedLanIps = @("192.168.0.236")
$activeIps = @("localhost", "127.0.0.1", "::1") + $reservedLanIps
$adapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254.*" }
foreach ($a in $adapters) {
    if ($a.IPAddress) {
        $activeIps += $a.IPAddress
    }
}
$activeIps = $activeIps | Select-Object -Unique
Write-Host "Active hosts to secure: $($activeIps -join ', ')"

# 2. Check if the current cert exists and has all these hosts in its Subject Alternative Names (SANs)
$certPem = Join-Path $mkcertDir "cert.pem"
$keyPem = Join-Path $mkcertDir "dev.pem"
$configJson = Join-Path $mkcertDir "config.json"
$needsRegen = $false

if (-not (Test-Path $certPem) -or -not (Test-Path $keyPem)) {
    $needsRegen = $true
    Write-Host "Certificates not found in cache. Regenerating..."
} else {
    try {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPem)
        $sanExtension = $cert.Extensions | Where-Object { $_.Oid.FriendlyName -eq "Subject Alternative Name" }
        if (-not $sanExtension) {
            $needsRegen = $true
            Write-Host "Certificate has no SAN extension. Regenerating..."
        } else {
            $sanText = $sanExtension.Format($true)
            foreach ($ip in $activeIps) {
                # Search case-insensitively for IP Address=X or DNS Name=X
                if ($sanText -notmatch [regex]::Escape($ip)) {
                    $needsRegen = $true
                    Write-Host "Host '$ip' not found in current certificate SANs. Regenerating..."
                    break
                }
            }
        }
    } catch {
        $needsRegen = $true
        Write-Host "Error reading current certificate ($($_.Exception.Message)). Regenerating..."
    }
}

# 3. Regenerate if needed
if ($needsRegen) {
    Write-Host "Regenerating certificate using mkcert..."
    $env:CAROOT = $mkcertDir
    
    # Run mkcert
    & $mkcertExe -cert-file $certPem -key-file $keyPem $activeIps
    
    # Calculate SHA256 hashes for config.json
    $certHash = (Get-FileHash -Path $certPem -Algorithm SHA256).Hash.ToLower()
    $keyHash = (Get-FileHash -Path $keyPem -Algorithm SHA256).Hash.ToLower()
    
    # Build config.json structure to match what vite-plugin-mkcert expects
    $configObj = @{
        record = @{
            hosts = $activeIps
            hash = @{
                key = $keyHash
                cert = $certHash
            }
        }
        configFilePath = $configJson
    }
    
    # Write config.json without BOM (UTF-8) so Node's JSON.parse can parse it successfully.
    $configJsonContent = $configObj | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($configJson, $configJsonContent)
    Write-Host "config.json updated successfully (without BOM)."
} else {
    Write-Host "Existing certificate is up-to-date. No regeneration needed."
}

# 4. Copy certificate files to project certs/ directory
if (-not (Test-Path $projectCertsDir)) {
    New-Item -ItemType Directory -Path $projectCertsDir -Force | Out-Null
}

Copy-Item -Path $certPem -Destination (Join-Path $projectCertsDir "cert.pem") -Force
Copy-Item -Path $keyPem -Destination (Join-Path $projectCertsDir "dev.pem") -Force
$rootCaPem = Join-Path $mkcertDir "rootCA.pem"
if (Test-Path $rootCaPem) {
    Copy-Item -Path $rootCaPem -Destination (Join-Path $projectCertsDir "rootCA.pem") -Force
}

Write-Host "Certificate files copied to project certs/ folder successfully."
