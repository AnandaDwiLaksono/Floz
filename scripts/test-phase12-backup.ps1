$ErrorActionPreference = 'Stop'
$MinioImage = 'quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e'
$PostgresImage = 'postgres:15-alpine'
$Network = 'phase12-backup'
$Minio = 'phase12-backup-minio'
$Postgres = 'phase12-backup-postgres'
$Bucket = 'fixture-backups'
$Password = 'fixture-password'
$Recipient = $null

pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -f infra/docker/backup.Dockerfile -t floz-backup:phase12 .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker network create --internal $Network 2>$null | Out-Null
try {
  docker run -d --rm --name $Postgres --network $Network -e POSTGRES_PASSWORD=$Password -e POSTGRES_DB=fixture $PostgresImage
  docker run -d --rm --name $Minio --network $Network --network-alias minio -e MINIO_ROOT_USER=fixture-admin -e MINIO_ROOT_PASSWORD=$Password $MinioImage server /data
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Ready = $false
  $ErrorActionPreference = 'Continue'
  for ($i = 0; $i -lt 60; $i++) {
    docker exec $Postgres psql -U postgres -d fixture -c 'select 1' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $Ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  $ErrorActionPreference = 'Stop'
  if (!$Ready) { throw 'PostgreSQL fixture did not become ready' }
  docker exec $Postgres psql -U postgres -d fixture -c 'create table fixture_check (id integer primary key, value text not null); insert into fixture_check values (1, ''ok'');' | Out-Null
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Key = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c 'age-keygen'
  $Secret = ($Key | Select-String 'AGE-SECRET-KEY').ToString().Trim()
  $Recipient = ($Key | Select-String 'public key').ToString().Split(':')[-1].Trim()
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on && mc mb fixture/$Bucket"
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Infra = (Resolve-Path '.\infra').Path
  $Result = docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=disable" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-admin' -e BACKUP_SECRET_KEY=$Password -e BACKUP_RECIPIENT=$Recipient floz-backup:phase12 /app/infra/backup/backup.mjs
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Metadata = $Result | ConvertFrom-Json
  if (!$Metadata.encryptedSha256 -or $Metadata.encryptedBytes -le 0) { throw 'Real encrypted backup evidence missing' }
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on >/dev/null && mc stat fixture/$Bucket/postgres/fixture/last-success.json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  if ($LASTEXITCODE) { throw 'Verified backup objects missing' }
  $LastSuccess = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=disable" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-admin' -e BACKUP_SECRET_KEY=$Password -e BACKUP_RECIPIENT=$Recipient -e BACKUP_FAIL_AGE='1' floz-backup:phase12 /app/infra/backup/backup.mjs 2>$null | Out-Null
  $FailureExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($FailureExit -eq 0) { throw 'Injected age failure succeeded' }
  $AfterFailure = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  if ($LastSuccess -ne $AfterFailure) { throw 'Failure displaced last-success' }
} finally {
  docker rm -f $Postgres, $Minio 2>$null | Out-Null
  docker network rm $Network 2>$null | Out-Null
}
