param([ValidateSet('linux/amd64','linux/arm64')][string]$Platform = 'linux/amd64')
$ErrorActionPreference = 'Stop'
$expected = if ($Platform -eq 'linux/arm64') { 'aarch64|arm64' } else { 'x86_64|amd64' }
foreach ($image in 'floz-api:phase12','floz-worker:phase12','floz-web:phase12','floz-migrator:phase12') {
  $arch = docker run --rm --platform $Platform --network none --user 65534:65534 --entrypoint uname $image -m
  if ($LASTEXITCODE -or $arch -notmatch $expected) { throw "$image architecture check failed: $arch" }
  docker run --rm --platform $Platform --network none --user 65534:65534 --entrypoint sh $image -c 'test -r /etc/ssl/certs/ca-certificates.crt'
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
docker image inspect floz-worker:phase12 --format '{{json .Config.Healthcheck.Test}}' | Select-String -Quiet 'node.*dist/health.js'
if (!$?) { throw 'worker healthcheck mismatch' }
