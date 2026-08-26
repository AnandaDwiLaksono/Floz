$ErrorActionPreference = 'Stop'
$name = 'floz-e2e-db'
$port = 15433

# Start fresh DB container
docker rm -f $name 2>$null | Out-Null
docker run --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=floz -p "${port}:5432" -d postgres:16-alpine | Out-Null
Write-Host "Started container $name on port $port"

try {
  # Free ports
  $apiPort = 13001
  while ((Test-NetConnection localhost -Port $apiPort -WarningAction SilentlyContinue).TcpTestSucceeded) { $apiPort++ }
  $webPort = 13000
  while ((Test-NetConnection localhost -Port $webPort -WarningAction SilentlyContinue).TcpTestSucceeded) { $webPort++ }

  $env:DATABASE_URL = "postgres://postgres:postgres@localhost:$port/floz"
  $env:BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
  $env:BETTER_AUTH_URL = "http://localhost:$apiPort"
  $env:NEXT_PUBLIC_API_URL = "http://localhost:$apiPort"
  $env:ALLOWED_ORIGIN = "http://localhost:$webPort"

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec $name pg_isready -U postgres -d floz 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Postgres did not become ready' }

  # Migrate and seed
  pnpm --filter @floz/database migrate
  
  # Start API background
  Write-Host "Starting API on port $apiPort..."
  $apiJob = Start-Job -ScriptBlock {
    $env:DATABASE_URL = $args[0]
    $env:BETTER_AUTH_SECRET = $args[1]
    $env:BETTER_AUTH_URL = $args[2]
    $env:API_PORT = $args[3]
    $env:ALLOWED_ORIGIN = $args[4]
    Set-Location $args[5]
    pnpm --filter @floz/api start
  } -ArgumentList $env:DATABASE_URL, $env:BETTER_AUTH_SECRET, $env:BETTER_AUTH_URL, $apiPort, $env:ALLOWED_ORIGIN, (Get-Location).Path

  # Wait for API to be responsive
  $apiReady = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $res = Invoke-WebRequest -Uri "http://localhost:$apiPort/api/v1/health" -UseBasicParsing
      if ($res.StatusCode -eq 200) { $apiReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $apiReady) { throw 'API did not become ready' }

  # Start Web background
  Write-Host "Rebuilding Web for E2E..."
  $env:NEXT_PUBLIC_API_URL = "http://localhost:$apiPort"
  pnpm --filter @floz/web build

  Write-Host "Starting Web on port $webPort..."
  $webJob = Start-Job -ScriptBlock {
    $env:NEXT_PUBLIC_API_URL = $args[0]
    $env:PORT = $args[1]
    Set-Location $args[2]
    pnpm --filter @floz/web start
  } -ArgumentList $env:NEXT_PUBLIC_API_URL, $webPort, (Get-Location).Path

  # Wait for Web to be responsive
  $webReady = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $res = Invoke-WebRequest -Uri "http://localhost:$webPort" -UseBasicParsing
      if ($res.StatusCode -eq 200 -and $res.Content -notmatch "NINOX System") { $webReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $webReady) { throw 'Web did not become ready' }

  # Run Playwright
  Write-Host "Running Playwright E2E..."
  $env:PLAYWRIGHT_TEST_BASE_URL = "http://localhost:$webPort"
  pnpm --filter @floz/web exec playwright test

} finally {
  # Cleanup
  if ($apiJob) { Stop-Job $apiJob; Remove-Job $apiJob }
  if ($webJob) { Stop-Job $webJob; Remove-Job $webJob }
  docker rm -f $name 2>$null | Out-Null
}
