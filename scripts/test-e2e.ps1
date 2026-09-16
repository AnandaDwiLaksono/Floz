$ErrorActionPreference = 'Stop'
$name = "floz-e2e-db-$PID-$(Get-Random)"
$nextDistDir = ".next-e2e-$PID-$(Get-Random)"
$previousNextDistDir = $env:FLOZ_NEXT_DIST_DIR
$redisName = "$name-redis"
$previousRedisUrl = $env:REDIS_URL
$previousRedisTls = $env:REDIS_TLS
$apiJob = $null
$webJob = $null
$workerJob = $null

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

function Invoke-NativeProcess {
  param(
    [string]$FilePath,
    [string]$Arguments
  )
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  try {
    $proc = [System.Diagnostics.Process]::Start($psi)
  } catch {
    throw "Failed to execute '$FilePath $Arguments': $_"
  }
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return [PSCustomObject]@{
    ExitCode = $proc.ExitCode
    StdOut   = $stdout.Trim()
    StdErr   = $stderr.Trim()
  }
}

function Wait-ForRedis {
  param(
    [string]$ContainerName,
    [int]$MaxAttempts = 30,
    [int]$SleepMs = 500
  )
  $lastResult = $null
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    $inspect = Invoke-NativeProcess 'docker' "inspect -f {{.State.Running}} $ContainerName"
    if ($inspect.ExitCode -ne 0 -or $inspect.StdOut -ne 'true') {
      throw "Redis container '$ContainerName' is not running (inspect exit=$($inspect.ExitCode), err=$($inspect.StdErr))"
    }

    $lastResult = Invoke-NativeProcess 'docker' "exec $ContainerName redis-cli ping"
    if ($lastResult.ExitCode -eq 0 -and $lastResult.StdOut -eq 'PONG') {
      return
    }
    Start-Sleep -Milliseconds $SleepMs
  }
  $inspectState = (Invoke-NativeProcess 'docker' "inspect -f {{.State.Status}} $ContainerName").StdOut
  $diag = "containerState=$inspectState, exitCode=$($lastResult.ExitCode), stdOut='$($lastResult.StdOut)', stdErr='$($lastResult.StdErr)'"
  throw "Redis did not become ready within deadline ($diag)"
}

function Wait-ForPostgres {
  param(
    [string]$ContainerName,
    [int]$MaxAttempts = 30,
    [int]$SleepSec = 1
  )
  $lastResult = $null
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    $inspect = Invoke-NativeProcess 'docker' "inspect -f {{.State.Running}} $ContainerName"
    if ($inspect.ExitCode -ne 0 -or $inspect.StdOut -ne 'true') {
      throw "Postgres container '$ContainerName' is not running (inspect exit=$($inspect.ExitCode), err=$($inspect.StdErr))"
    }

    $lastResult = Invoke-NativeProcess 'docker' "exec $ContainerName pg_isready -U postgres -d floz"
    if ($lastResult.ExitCode -eq 0) {
      return
    }
    Start-Sleep -Seconds $SleepSec
  }
  $inspectState = (Invoke-NativeProcess 'docker' "inspect -f {{.State.Status}} $ContainerName").StdOut
  $diag = "containerState=$inspectState, exitCode=$($lastResult.ExitCode), stdOut='$($lastResult.StdOut)', stdErr='$($lastResult.StdErr)'"
  throw "Postgres did not become ready within deadline ($diag)"
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
  $runPg = $null
  for ($i = 0; $i -lt 10; $i++) {
    $dbPort = Get-FreePort
    $runPg = Invoke-NativeProcess 'docker' "run --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=floz -p 127.0.0.1:${dbPort}:5432 -d postgres:16-alpine"
    if ($runPg.ExitCode -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }
  if ($runPg.ExitCode -ne 0) { throw "Unable to bind a PostgreSQL test port: $($runPg.StdErr)" }

  $redisPort = Get-FreePort
  $runRedis = Invoke-NativeProcess 'docker' "run --name $redisName -p 127.0.0.1:${redisPort}:6379 -d redis:7-alpine"
  if ($runRedis.ExitCode -ne 0) { throw "Unable to start disposable Redis: $($runRedis.StdErr)" }
  $env:REDIS_URL = "redis://127.0.0.1:$redisPort"
  $env:REDIS_TLS = 'false'
  Wait-ForRedis $redisName
  $env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:$dbPort/floz"
  $env:BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
  Wait-ForPostgres $name

  pnpm --filter @floz/database migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
  pnpm --filter @floz/api build
  if ($LASTEXITCODE -ne 0) { throw 'API build failed' }
  pnpm --filter @floz/worker build
  if ($LASTEXITCODE -ne 0) { throw 'Worker build failed' }

  $root = (Get-Location).Path
  $logDir = Join-Path $env:TEMP $name
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    if ($workerJob) { Stop-Job $workerJob -ErrorAction SilentlyContinue; Remove-Job $workerJob -Force -ErrorAction SilentlyContinue; $workerJob = $null }
    if ($webJob) { Stop-Job $webJob -ErrorAction SilentlyContinue; Remove-Job $webJob -Force -ErrorAction SilentlyContinue; $webJob = $null }
    if ($apiJob) { Stop-Job $apiJob -ErrorAction SilentlyContinue; Remove-Job $apiJob -Force -ErrorAction SilentlyContinue; $apiJob = $null }
    $apiPort = Get-FreePort
    do { $webPort = Get-FreePort } while ($webPort -eq $apiPort)
    $env:BETTER_AUTH_URL = "http://127.0.0.1:$apiPort"
    $env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$apiPort"
    $env:ALLOWED_ORIGIN = "http://127.0.0.1:$webPort"
    $env:FLOZ_NEXT_DIST_DIR = $nextDistDir
    $nextDistPath = Join-Path $root "apps/web/$nextDistDir"
    New-Item -ItemType Directory -Path $nextDistPath -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'apps/web/tsconfig.json') -Destination (Join-Path $nextDistPath 'tsconfig.json') -Force
    pnpm --filter @floz/web build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
    $apiStdout = Join-Path $logDir "api-$attempt.out.log"
    $apiStderr = Join-Path $logDir "api-$attempt.err.log"
    $webStdout = Join-Path $logDir "web-$attempt.out.log"
    $webStderr = Join-Path $logDir "web-$attempt.err.log"
    $apiJob = Start-Job -ScriptBlock {
      param($root, $databaseUrl, $redisUrl, $redisTls, $secret, $authUrl, $port, $origin, $stdout, $stderr)
      Set-Location $root
      $env:DATABASE_URL = $databaseUrl
      $env:REDIS_URL = $redisUrl
      $env:REDIS_TLS = $redisTls
      $env:BETTER_AUTH_SECRET = $secret
      $env:BETTER_AUTH_URL = $authUrl
      $env:API_PORT = $port
      $env:ALLOWED_ORIGIN = $origin
      $env:NODE_ENV = 'test'
      $env:AUTH_RATE_LIMIT_MAX = '1000'
      $env:FLOZ_TEST_REPORTING_NOW = '2026-09-03T00:00:00.000Z'
      cmd /c "node apps/api/dist/src/main.js > `"$stdout`" 2> `"$stderr`""
    } -ArgumentList $root, $env:DATABASE_URL, $env:REDIS_URL, $env:REDIS_TLS, $env:BETTER_AUTH_SECRET, $env:BETTER_AUTH_URL, $apiPort, $env:ALLOWED_ORIGIN, $apiStdout, $apiStderr
    try {
      Wait-ForHttp "http://127.0.0.1:$apiPort/api/v1/health" $apiJob $apiStdout $apiStderr 'API'
      $webJob = Start-Job -ScriptBlock {
        param($root, $apiUrl, $port, $distDir, $stdout, $stderr)
        Set-Location (Join-Path $root 'apps/web')
        $env:NEXT_PUBLIC_API_URL = $apiUrl
        $env:PORT = $port
        $env:FLOZ_NEXT_DIST_DIR = $distDir
        cmd /c "npx next start -H 127.0.0.1 -p %PORT% > `"$stdout`" 2> `"$stderr`""
      } -ArgumentList $root, $env:NEXT_PUBLIC_API_URL, $webPort, $nextDistDir, $webStdout, $webStderr
      Wait-ForHttp "http://127.0.0.1:$webPort/login" $webJob $webStdout $webStderr 'Web'
      $workerStdout = Join-Path $logDir "worker-$attempt.out.log"
      $workerStderr = Join-Path $logDir "worker-$attempt.err.log"
      $workerJob = Start-Job -ScriptBlock {
        param($root, $databaseUrl, $redisUrl, $redisTls, $stdout, $stderr)
        Set-Location $root
        $env:DATABASE_URL = $databaseUrl
        $env:REDIS_URL = $redisUrl
        $env:REDIS_TLS = $redisTls
        $env:NODE_ENV = 'test'
        cmd /c "node apps/worker/dist/main.js > `"$stdout`" 2> `"$stderr`""
      } -ArgumentList $root, $env:DATABASE_URL, $env:REDIS_URL, $env:REDIS_TLS, $workerStdout, $workerStderr
      Start-Sleep -Seconds 1
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
  if ($workerJob) { Stop-Job $workerJob -ErrorAction SilentlyContinue; Remove-Job $workerJob -Force -ErrorAction SilentlyContinue }
  if ($webJob) { Stop-Job $webJob -ErrorAction SilentlyContinue; Remove-Job $webJob -Force -ErrorAction SilentlyContinue }
  if ($apiJob) { Stop-Job $apiJob -ErrorAction SilentlyContinue; Remove-Job $apiJob -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath (Join-Path $PSScriptRoot "../apps/web/$nextDistDir") -Recurse -Force -ErrorAction SilentlyContinue
  $env:FLOZ_NEXT_DIST_DIR = $previousNextDistDir
  docker rm -f $name $redisName 2>$null | Out-Null
  $env:REDIS_URL = $previousRedisUrl
  $env:REDIS_TLS = $previousRedisTls
}
