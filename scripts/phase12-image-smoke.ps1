param(
  [ValidateSet('linux/amd64','linux/arm64')][string]$Platform = 'linux/amd64',
  [string]$DatabaseUrl,
  [string]$RedisUrl,
  [string]$HostDatabaseUrl,
  [string]$HostRedisUrl
)
$ErrorActionPreference = 'Stop'
foreach ($image in 'api','worker','web','migrator') {
  $inspect = docker image inspect "floz-$image`:phase12" | ConvertFrom-Json
  if ($inspect[0].Config.User -ne 'floz' -or $inspect[0].Id -notmatch '^sha256:[a-f0-9]{64}$') { throw "$image identity or digest missing" }
  docker run --rm --platform $Platform --network none --user floz --entrypoint sh "floz-$image`:phase12" -c "test -r /etc/ssl/certs/ca-certificates.crt && id -u | grep -v '^0$' && node --version"
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
$health = docker image inspect floz-worker:phase12 --format '{{json .Config.Healthcheck.Test}}'
if ($health -notmatch 'node.*dist/health.js') { throw 'worker healthcheck mismatch' }
docker run --rm --platform $Platform --network none --user floz --entrypoint node floz-web:phase12 node_modules/next/dist/bin/next --version
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$caddyfileAbs = (Resolve-Path "${PSScriptRoot}/../infra/Caddyfile").Path
$caddyfileMount = ($caddyfileAbs -replace '\\', '/') -replace '^([A-Za-z]):', '/$1'
docker run --rm -v "${caddyfileAbs}:/etc/caddy/Caddyfile:ro" -e API_HOST=localhost -e ACME_EMAIL=smoke@example.test -e TRUSTED_PROXY_IPS=172.30.0.2 -e CADDY_TLS_MODE='tls internal' caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d caddy validate --config /etc/caddy/Caddyfile
if ($LASTEXITCODE) { exit $LASTEXITCODE }

if (docker network ls -q --filter name=phase12-smoke) { docker network rm phase12-smoke 2>&1 | Out-Null }
docker network create --subnet 172.30.0.0/24 phase12-smoke | Out-Null
docker rm -f phase12-api phase12-worker phase12-web phase12-caddy phase12-smoke-pg phase12-smoke-redis 2>&1 | Out-Null

$createdLocalServices = $false
try {
  if (!$DatabaseUrl) {
    $createdLocalServices = $true
    docker run -d --name phase12-smoke-pg --platform $Platform --network phase12-smoke --ip 172.30.0.10 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=floz postgres:16-alpine | Out-Null
    docker run -d --name phase12-smoke-redis --platform $Platform --network phase12-smoke --ip 172.30.0.11 redis:7-alpine | Out-Null
    for ($i=0; $i -lt 60; $i++) {
      docker exec phase12-smoke-pg pg_isready -U postgres -d floz 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep -Milliseconds 500
    }
    $DatabaseUrl = "postgres://postgres:postgres@172.30.0.10:5432/floz"
    $RedisUrl = "redis://172.30.0.11:6379"
    $HostDatabaseUrl = $DatabaseUrl
    $HostRedisUrl = $RedisUrl
  } else {
    $HostDatabaseUrl = if ($HostDatabaseUrl) { $HostDatabaseUrl } else { $DatabaseUrl }
    $HostRedisUrl = if ($HostRedisUrl) { $HostRedisUrl } else { $RedisUrl }
    $HostDatabaseUrl = $HostDatabaseUrl -replace '127\.0\.0\.1', 'host.docker.internal'
    $HostRedisUrl = $HostRedisUrl -replace '127\.0\.0\.1', 'host.docker.internal'
  }

  docker run --rm --platform $Platform --network phase12-smoke --add-host host.docker.internal:host-gateway -e NODE_ENV=test -e DB_SSL=false -e DATABASE_URL=$HostDatabaseUrl floz-migrator:phase12
  if ($LASTEXITCODE) { exit $LASTEXITCODE }

  $skipCert = if ($PSVersionTable.PSEdition -eq 'Core') { @{ SkipCertificateCheck = $true } } else { @{} }
  if ($PSVersionTable.PSEdition -ne 'Core') {
    if (-not ([System.Management.Automation.PSTypeName]'TrustAllCertsPolicy').Type) {
      Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint srvPoint, X509Certificate certificate, WebRequest request, int certificateProblem) {
        return true;
    }
}
"@
    }
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
  }
  docker run -d --name phase12-api --platform $Platform --add-host host.docker.internal:host-gateway --network phase12-smoke --network-alias api --ip 172.30.0.3 -e NODE_ENV=test -e DB_SSL=false -e API_PORT=3001 -e DATABASE_URL=$HostDatabaseUrl -e BETTER_AUTH_SECRET=phase12-ci-secret-with-sufficient-entropy-123 -e BETTER_AUTH_URL=https://localhost -e ALLOWED_ORIGINS=https://localhost -e TRUSTED_PROXY_IPS=172.30.0.2 floz-api:phase12 | Out-Null
  docker run -d --name phase12-worker --platform $Platform --add-host host.docker.internal:host-gateway --network phase12-smoke --ip 172.30.0.4 --tmpfs /run/floz-worker:rw,noexec,nosuid,size=1m,mode=1777 -e NODE_ENV=test -e DB_SSL=false -e REDIS_TLS=false -e DATABASE_URL=$HostDatabaseUrl -e REDIS_URL=$HostRedisUrl floz-worker:phase12 | Out-Null
  docker run -d --name phase12-web --platform $Platform --network phase12-smoke --network-alias web --ip 172.30.0.5 -e NODE_ENV=production -e NEXT_PUBLIC_API_URL=https://localhost floz-web:phase12 | Out-Null
  docker run -d --name phase12-caddy --platform $Platform --network phase12-smoke --ip 172.30.0.2 -p 8443:443 -v "${caddyfileAbs}:/etc/caddy/Caddyfile:ro" -e API_HOST=localhost -e ACME_EMAIL=smoke@example.test -e TRUSTED_PROXY_IPS=172.30.0.2 -e CADDY_TLS_MODE='tls internal' caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d | Out-Null
  $apiInspect = docker inspect phase12-api | ConvertFrom-Json
  $published = $apiInspect[0].NetworkSettings.Ports.PSObject.Properties | Where-Object { $_.Value -ne $null }
  if ($published) { throw 'API is publicly exposed' }
  for ($i=0; $i -lt 45; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/health/ready @skipCert -TimeoutSec 2 | Out-Null
      break
    } catch {
      if ($i -eq 44) {
        Write-Host "--- CADDY LOGS ---"
        docker logs phase12-caddy
        Write-Host "--- API LOGS ---"
        docker logs phase12-api
        throw
      }
      Start-Sleep 1
    }
  }
  $ready = Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/health/ready @skipCert -TimeoutSec 5
  if ($ready.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'API HSTS mismatch' }
  try {
    $fallback = Invoke-WebRequest -UseBasicParsing https://localhost:8443/not-found @skipCert -TimeoutSec 5
    if ($fallback.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'fallback HSTS mismatch' }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($resp.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'fallback HSTS mismatch' }
  } catch {
    # In PowerShell Core (pwsh on Linux), WebException might be wrapped or HttpRequestException
    $resp = $_.Exception.Response
    if ($resp -and $resp.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'fallback HSTS mismatch' }
  }
  $spoofStatuses = 1..11 | ForEach-Object {
    try {
      (Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/auth/login @skipCert -Method Post -ContentType application/json -Body '{"email":"test@test.test","password":"Password123!"}' -Headers @{ Origin = 'https://localhost'; 'X-Forwarded-For' = "203.0.113.$_"; Forwarded = "for=203.0.113.$_" } -TimeoutSec 5).StatusCode
    } catch [System.Net.WebException] {
      [int]$_.Exception.Response.StatusCode
    } catch {
      if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    }
  }
  if ($spoofStatuses[-1] -ne 429) { throw "spoofed forwarding headers were trusted: $($spoofStatuses -join ',')" }
  if ((docker inspect phase12-worker --format '{{.State.Running}}') -ne 'true') {
    Write-Host "--- WORKER LOGS ---"
    docker logs phase12-worker
    throw "worker container is not running"
  }
  docker exec phase12-worker node dist/health.js
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  docker rm -f phase12-api phase12-worker phase12-web phase12-caddy 2>&1 | Out-Null
  if ($createdLocalServices) {
    docker rm -f phase12-smoke-pg phase12-smoke-redis 2>&1 | Out-Null
  }
  if (docker network ls -q --filter name=phase12-smoke) { docker network rm phase12-smoke 2>&1 | Out-Null }
}
