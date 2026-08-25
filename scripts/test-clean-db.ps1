$ErrorActionPreference = 'Stop'
$name = 'floz-clean-db-test'
$port = 15432
while ((Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet)) { $port++ }
docker rm -f $name 2>$null | Out-Null
docker run --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=floz -p "${port}:5432" -d postgres:16-alpine | Out-Null
try {
  $env:DATABASE_URL = "postgres://postgres:postgres@localhost:$port/floz"
  $env:BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long'
  $env:BETTER_AUTH_URL = 'http://localhost:3001'
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    docker exec $name pg_isready -U postgres -d floz | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Postgres did not become ready' }
  pnpm --filter @floz/database migrate
  pnpm --filter @floz/database seed
  pnpm --filter @floz/api test -- api.test.ts auth.test.ts
} finally {
  docker rm -f $name 2>$null | Out-Null
}
