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
  docker run --rm --platform $Platform --network none --user floz --entrypoint sh "floz-$image`:phase12" -c 'test -r /etc/ssl/certs/ca-certificates.crt; test "$(id -u)" -ne 0; node --version'
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
$health = docker image inspect floz-worker:phase12 --format '{{json .Config.Healthcheck.Test}}'
if ($health -notmatch 'node.*dist/health.js') { throw 'worker healthcheck mismatch' }
docker run --rm --platform $Platform --network none --user floz --entrypoint node floz-web:phase12 node_modules/next/dist/bin/next --version
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (!$DatabaseUrl) { return }
$HostDatabaseUrl = if ($HostDatabaseUrl) { $HostDatabaseUrl } else { $DatabaseUrl }
$HostRedisUrl = if ($HostRedisUrl) { $HostRedisUrl } else { $RedisUrl }
$HostDatabaseUrl = $HostDatabaseUrl -replace '127\.0\.0\.1', 'host.docker.internal'
$HostRedisUrl = $HostRedisUrl -replace '127\.0\.0\.1', 'host.docker.internal'
docker run --rm --platform $Platform --add-host host.docker.internal:host-gateway -e NODE_ENV=test -e DATABASE_URL=$HostDatabaseUrl floz-migrator:phase12
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker run --rm -v "${PSScriptRoot}/../infra/Caddyfile:/etc/caddy/Caddyfile:ro" -e API_HOST=localhost -e ACME_EMAIL=smoke@example.test -e TRUSTED_PROXY_IPS=172.30.0.2 -e CADDY_TLS_MODE='tls internal' caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d caddy validate --config /etc/caddy/Caddyfile
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker network rm phase12-smoke 2>$null | Out-Null
docker network create --subnet 172.30.0.0/24 phase12-smoke | Out-Null
docker rm -f phase12-api phase12-worker phase12-web phase12-caddy 2>$null | Out-Null
try {
  docker run -d --name phase12-api --platform $Platform --network phase12-smoke --network-alias api --ip 172.30.0.3 -e NODE_ENV=test -e API_PORT=3001 -e DATABASE_URL=$HostDatabaseUrl -e BETTER_AUTH_SECRET=phase12-ci-secret-with-sufficient-entropy-123 -e BETTER_AUTH_URL=https://localhost -e ALLOWED_ORIGINS=https://localhost -e TRUSTED_PROXY_IPS=172.30.0.2 floz-api:phase12 | Out-Null
  docker run -d --name phase12-worker --platform $Platform --network phase12-smoke --tmpfs /run/floz-worker:rw,noexec,nosuid,size=1m,mode=0700,uid=100,gid=100 -e NODE_ENV=test -e DATABASE_URL=$HostDatabaseUrl -e REDIS_URL=$HostRedisUrl floz-worker:phase12 | Out-Null
  docker run -d --name phase12-web --platform $Platform --network phase12-smoke --network-alias web -e NODE_ENV=production -e NEXT_PUBLIC_API_URL=https://localhost floz-web:phase12 | Out-Null
  docker run -d --name phase12-caddy --platform $Platform --network phase12-smoke --ip 172.30.0.2 -p 8443:443 -v "${PSScriptRoot}/../infra/Caddyfile:/etc/caddy/Caddyfile:ro" -e API_HOST=localhost -e ACME_EMAIL=smoke@example.test -e TRUSTED_PROXY_IPS=172.30.0.2 -e CADDY_TLS_MODE='tls internal' caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d | Out-Null
  if ((docker inspect phase12-api --format '{{json .NetworkSettings.Ports}}') -ne '{}') { throw 'API is publicly exposed' }
  for ($i=0; $i -lt 45; $i++) { try { Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/health/ready -SkipCertificateCheck -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }
  $ready = Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/health/ready -SkipCertificateCheck -TimeoutSec 5
  if ($ready.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'API HSTS mismatch' }
  $fallback = Invoke-WebRequest -UseBasicParsing https://localhost:8443/not-found -SkipCertificateCheck -SkipHttpErrorCheck -TimeoutSec 5
  if ($fallback.Headers['Strict-Transport-Security'] -ne 'max-age=15552000') { throw 'fallback HSTS mismatch' }
  $spoofStatuses = 1..11 | ForEach-Object { (Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/v1/auth/sign-in/email -Method Post -ContentType application/json -Body '{}' -Headers @{ Origin = 'https://localhost'; 'X-Forwarded-For' = "203.0.113.$_"; Forwarded = "for=203.0.113.$_" } -SkipCertificateCheck -SkipHttpErrorCheck -TimeoutSec 5).StatusCode }
  if ($spoofStatuses[-1] -ne 429) { throw 'spoofed forwarding headers were trusted' }
  docker exec phase12-worker node dist/health.js
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally { docker rm -f phase12-api phase12-worker phase12-web phase12-caddy 2>$null | Out-Null; docker network rm phase12-smoke 2>$null | Out-Null }
