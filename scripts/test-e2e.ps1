$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  corepack pnpm --filter @floz/web e2e @args
  if ($LASTEXITCODE -ne 0) { throw 'Playwright E2E failed' }
} finally {
  Pop-Location
}
