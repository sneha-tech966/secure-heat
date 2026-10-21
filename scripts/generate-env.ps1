<#
  Creates .env from .env.example with freshly generated secrets (Windows PowerShell 5.1+ / PowerShell 7).
  Refuses to overwrite an existing .env unless -Force is given. Prints the generated admin login ONCE (also stored in .env).

  Usage (from the project root):
    powershell -ExecutionPolicy Bypass -File scripts\generate-env.ps1
    powershell -ExecutionPolicy Bypass -File scripts\generate-env.ps1 -Force
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path '.env.example')) { Write-Error 'error: .env.example not found (run this from the secure-heat folder)'; exit 1 }
if ((Test-Path '.env') -and -not $Force) { Write-Error 'error: .env already exists (use -Force to overwrite)'; exit 1 }

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Bytes([int]$n) { $b = New-Object byte[] $n; $rng.GetBytes($b); return ,$b }
function New-Hex([int]$n)   { return (($(New-Bytes $n) | ForEach-Object { $_.ToString('x2') }) -join '') }
function New-B64([int]$n)   { return [Convert]::ToBase64String($(New-Bytes $n)) }

$adminEmail = if ($env:SEED_ADMIN_EMAIL) { $env:SEED_ADMIN_EMAIL } else { 'admin@secure-heat.local' }
$adminPw = New-Hex 12          # hex only: URL-safe, no characters that need escaping
$pgPw    = New-Hex 16          # hex only: stays URL-safe inside DATABASE_URL
$simTok  = New-Hex 24

$lines = [System.Collections.Generic.List[string]](Get-Content -Path '.env.example')
function Set-Kv([string]$key, [string]$value) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith("$key=")) { $lines[$i] = "$key=$value"; return }
  }
  $lines.Add("$key=$value")
}
Set-Kv 'POSTGRES_PASSWORD'      $pgPw
Set-Kv 'DATABASE_URL'           "postgresql://secureheat:$pgPw@localhost:5432/secureheat"
Set-Kv 'JWT_SECRET'             (New-B64 48)
Set-Kv 'SENSOR_SECRET_ENC_KEY'  (New-B64 32)
Set-Kv 'ML_INTERNAL_TOKEN'      (New-Hex 24)
Set-Kv 'SIM_CONTROL_TOKEN'      $simTok
Set-Kv 'SIMULATOR_TOKEN'        $simTok
Set-Kv 'SEED_ADMIN_EMAIL'       $adminEmail
Set-Kv 'SEED_ADMIN_PASSWORD'    $adminPw
Set-Kv 'SEED_ON_START'          'true'

# UTF-8 WITHOUT a byte-order mark and with LF line endings (a BOM would corrupt the first variable name for Docker Compose)
$path = Join-Path (Get-Location) '.env'
[System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Created .env with generated secrets.'
Write-Host ''
Write-Host "  Dashboard login:  $adminEmail"
Write-Host "  Password:         $adminPw"
Write-Host ''
Write-Host 'Next: docker compose up --build   then open http://localhost:8080'
