$ErrorActionPreference = 'Stop'
$MinioImage = 'quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e'
pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -f infra/docker/backup.Dockerfile -t floz-backup:phase12 .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker image inspect $MinioImage 2>$null | Out-Null
if ($LASTEXITCODE) { docker pull $MinioImage }
if ($LASTEXITCODE) { exit $LASTEXITCODE }
