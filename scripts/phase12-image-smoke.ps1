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
docker run --rm --platform $Platform --network host -e NODE_ENV=test -e DATABASE_URL=$HostDatabaseUrl floz-migrator:phase12
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker run -d --name phase12-api --platform $Platform --network host -e NODE_ENV=test -e API_PORT=3001 -e DATABASE_URL=$HostDatabaseUrl -e BETTER_AUTH_SECRET=phase12-ci-secret-with-sufficient-entropy-123 -e BETTER_AUTH_URL=https://localhost -e ALLOWED_ORIGINS=https://localhost floz-api:phase12 | Out-Null
docker run -d --name phase12-worker --platform $Platform --network host --tmpfs /run/floz-worker:rw,noexec,nosuid,size=1m,mode=0700,uid=100,gid=100 -e NODE_ENV=test -e DATABASE_URL=$HostDatabaseUrl -e REDIS_URL=$HostRedisUrl floz-worker:phase12 | Out-Null
docker run -d --name phase12-web --platform $Platform --network host -e NODE_ENV=production -e NEXT_PUBLIC_API_URL=https://localhost floz-web:phase12 | Out-Null
try {
  for ($i=0; $i -lt 45; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/v1/health/ready -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }
  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/v1/health/ready -TimeoutSec 5 | Out-Null
  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/ -TimeoutSec 5 | Out-Null
  docker exec phase12-worker node dist/health.js
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally { docker rm -f phase12-api phase12-worker phase12-web | Out-Null }
