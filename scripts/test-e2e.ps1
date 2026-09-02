$ErrorActionPreference = 'Stop'
$name = "floz-e2e-db-$PID-$(Get-Random)"
$apiJob = $null
$webJob = $null

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

function Wait-ForHttp($url, $job, $stdout, $stderr, $label) {
  for ($i = 0; $i -lt 60; $i++) {
    if ($job.State -ne 'Running') {
      throw "$label exited before readiness.`n$(Get-Content $stdout -Raw -ErrorAction SilentlyContinue)$(Get-Content $stderr -Raw -ErrorAction SilentlyContinue)"
    }
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "$label did not become ready at $url.`n$(Get-Content $stdout -Raw -ErrorAction SilentlyContinue)$(Get-Content $stderr -Raw -ErrorAction SilentlyContinue)"
}

try {
  for ($i = 0; $i -lt 10; $i++) {
    $dbPort = Get-FreePort
    docker run --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=floz -p "127.0.0.1:${dbPort}:5432" -d postgres:16-alpine 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($LASTEXITCODE -ne 0) { throw 'Unable to bind a PostgreSQL test port' }

  $env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:$dbPort/floz"
  $env:BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'

  for ($i = 0; $i -lt 30; $i++) {
    docker exec $name pg_isready -U postgres -d floz 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if ($LASTEXITCODE -ne 0) { throw 'Postgres did not become ready' }

  pnpm --filter @floz/database migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
  pnpm --filter @floz/api build
  if ($LASTEXITCODE -ne 0) { throw 'API build failed' }

  $root = (Get-Location).Path
  $logDir = Join-Path $env:TEMP $name
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    if ($webJob) { Stop-Job $webJob -ErrorAction SilentlyContinue; Remove-Job $webJob -Force -ErrorAction SilentlyContinue; $webJob = $null }
    if ($apiJob) { Stop-Job $apiJob -ErrorAction SilentlyContinue; Remove-Job $apiJob -Force -ErrorAction SilentlyContinue; $apiJob = $null }
    $apiPort = Get-FreePort
    do { $webPort = Get-FreePort } while ($webPort -eq $apiPort)
    $env:BETTER_AUTH_URL = "http://127.0.0.1:$apiPort"
    $env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$apiPort"
    $env:ALLOWED_ORIGIN = "http://127.0.0.1:$webPort"
    pnpm --filter @floz/web build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
    $apiStdout = Join-Path $logDir "api-$attempt.out.log"
    $apiStderr = Join-Path $logDir "api-$attempt.err.log"
    $webStdout = Join-Path $logDir "web-$attempt.out.log"
    $webStderr = Join-Path $logDir "web-$attempt.err.log"
    $apiJob = Start-Job -ScriptBlock {
      param($root, $databaseUrl, $secret, $authUrl, $port, $origin, $stdout, $stderr)
      Set-Location $root
      $env:DATABASE_URL = $databaseUrl
      $env:BETTER_AUTH_SECRET = $secret
      $env:BETTER_AUTH_URL = $authUrl
      $env:API_PORT = $port
      $env:ALLOWED_ORIGIN = $origin
      $env:NODE_ENV = 'test'
      $env:FLOZ_TEST_REPORTING_NOW = '2026-09-03T00:00:00.000Z'
      node apps/api/dist/src/main.js > $stdout 2> $stderr
    } -ArgumentList $root, $env:DATABASE_URL, $env:BETTER_AUTH_SECRET, $env:BETTER_AUTH_URL, $apiPort, $env:ALLOWED_ORIGIN, $apiStdout, $apiStderr
    try {
      Wait-ForHttp "http://127.0.0.1:$apiPort/api/v1/health" $apiJob $apiStdout $apiStderr 'API'
      $webJob = Start-Job -ScriptBlock {
        param($root, $apiUrl, $port, $stdout, $stderr)
        Set-Location (Join-Path $root 'apps/web')
        $env:NEXT_PUBLIC_API_URL = $apiUrl
        $env:PORT = $port
        pnpm start -- --hostname 127.0.0.1 > $stdout 2> $stderr
      } -ArgumentList $root, $env:NEXT_PUBLIC_API_URL, $webPort, $webStdout, $webStderr
      Wait-ForHttp "http://127.0.0.1:$webPort/login" $webJob $webStdout $webStderr 'Web'
      break
    } catch {
      $logs = "$(Get-Content $apiStderr -Raw -ErrorAction SilentlyContinue)$(Get-Content $webStderr -Raw -ErrorAction SilentlyContinue)"
      if ($logs -notmatch 'EACCES|EADDRINUSE' -or $attempt -eq 4) { throw }
    }
  }

  $env:PLAYWRIGHT_TEST_BASE_URL = "http://127.0.0.1:$webPort"
  pnpm --filter @floz/web exec playwright test
  if ($LASTEXITCODE -ne 0) { throw 'Playwright E2E failed' }
} finally {
  if ($webJob) { Stop-Job $webJob -ErrorAction SilentlyContinue; Remove-Job $webJob -Force -ErrorAction SilentlyContinue }
  if ($apiJob) { Stop-Job $apiJob -ErrorAction SilentlyContinue; Remove-Job $apiJob -Force -ErrorAction SilentlyContinue }
  docker rm -f $name 2>$null | Out-Null
}
