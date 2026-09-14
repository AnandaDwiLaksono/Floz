$ErrorActionPreference = 'Stop'
$MinioImage = 'quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e'
$PostgresImage = 'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
$Network = 'phase12-backup'
$Minio = 'phase12-backup-minio'
$Postgres = 'phase12-backup-postgres'
$Bucket = 'fixture-backups'
$Password = 'fixture-password'
$UploadKey = 'fixture-upload'
$UploadSecret = 'fixture-upload-secret'
$RetentionKey = 'fixture-retention'
$RetentionSecret = 'fixture-retention-secret'
$ListFailureKey = 'fixture-no-list'
$ListFailureSecret = 'fixture-no-list-secret'
$DeleteFailureKey = 'fixture-no-delete'
$DeleteFailureSecret = 'fixture-no-delete-secret'
$Recipient = $null
$TlsDir = Join-Path ([IO.Path]::GetTempPath()) "phase12-backup-tls-$([guid]::NewGuid())"
$OpenSslConf = 'C:\Program Files\Git\usr\ssl\openssl.cnf'

pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -f infra/docker/backup.Dockerfile -t floz-backup:phase12 .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker network create --internal $Network 2>$null | Out-Null
New-Item -ItemType Directory -Path $TlsDir | Out-Null
try {
  $env:OPENSSL_CONF = $OpenSslConf
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$TlsDir/ca.key" -out "$TlsDir/ca.crt" -subj '/CN=phase12-fixture-ca' | Out-Null
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  openssl req -newkey rsa:2048 -nodes -keyout "$TlsDir/server.key" -out "$TlsDir/server.csr" -subj '/CN=phase12-backup-postgres' | Out-Null
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  Set-Content -LiteralPath "$TlsDir/san.cnf" -Value 'subjectAltName=DNS:phase12-backup-postgres'
  openssl x509 -req -days 1 -in "$TlsDir/server.csr" -CA "$TlsDir/ca.crt" -CAkey "$TlsDir/ca.key" -CAcreateserial -out "$TlsDir/server.crt" -extfile "$TlsDir/san.cnf" | Out-Null
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  docker run -d --rm --name $Postgres --network $Network --network-alias db -v "${TlsDir}:/tls:ro" -e POSTGRES_PASSWORD=$Password -e POSTGRES_DB=fixture --entrypoint sh $PostgresImage -c 'cp -R /tls /var/lib/postgresql/tls && chown -R postgres:postgres /var/lib/postgresql/tls && chmod 600 /var/lib/postgresql/tls/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/tls/server.crt -c ssl_key_file=/var/lib/postgresql/tls/server.key -c ssl_ca_file=/var/lib/postgresql/tls/ca.crt'
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
  $UploadPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:PutObject`",`"s3:GetObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]}]}"))
  $RetentionPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`",`"s3:DeleteObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  $NoListPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`",`"s3:DeleteObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  $NoDeletePolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on && mc mb fixture/$Bucket && echo $UploadPolicy | base64 -d >/tmp/upload.json && echo $RetentionPolicy | base64 -d >/tmp/retention.json && echo $NoListPolicy | base64 -d >/tmp/no-list.json && echo $NoDeletePolicy | base64 -d >/tmp/no-delete.json && mc admin policy create fixture backup-upload /tmp/upload.json && mc admin policy create fixture backup-retention /tmp/retention.json && mc admin policy create fixture backup-no-list /tmp/no-list.json && mc admin policy create fixture backup-no-delete /tmp/no-delete.json && mc admin user add fixture $UploadKey $UploadSecret && mc admin user add fixture $RetentionKey $RetentionSecret && mc admin user add fixture $ListFailureKey $ListFailureSecret && mc admin user add fixture $DeleteFailureKey $DeleteFailureSecret && mc admin policy attach fixture backup-upload --user $UploadKey && mc admin policy attach fixture backup-retention --user $RetentionKey && mc admin policy attach fixture backup-no-list --user $ListFailureKey && mc admin policy attach fixture backup-no-delete --user $DeleteFailureKey"
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Infra = (Resolve-Path '.\infra').Path
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout "$TlsDir/bad-ca.key" -out "$TlsDir/bad-ca.crt" -subj '/CN=bad-ca' | Out-Null
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/bad-ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-upload' -e BACKUP_SECRET_KEY=$UploadSecret -e BACKUP_RECIPIENT=$Recipient floz-backup:phase12 /app/infra/backup/backup.mjs 2>$null | Out-Null
  $BadCaExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($BadCaExit -eq 0) { throw 'TLS bad CA rejected' }
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@db`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-upload' -e BACKUP_SECRET_KEY=$UploadSecret -e BACKUP_RECIPIENT=$Recipient floz-backup:phase12 /app/infra/backup/backup.mjs
  if ($LASTEXITCODE -eq 0) { throw 'TLS hostname mismatch rejected' }
  $Result = docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-upload' -e BACKUP_SECRET_KEY=$UploadSecret -e BACKUP_RECIPIENT=$Recipient floz-backup:phase12 /app/infra/backup/backup.mjs
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Metadata = $Result | ConvertFrom-Json
  if (!$Metadata.encryptedSha256 -or $Metadata.encryptedBytes -le 0) { throw 'Real encrypted backup evidence missing' }
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc stat fixture/$Bucket/postgres/fixture/last-success.json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  if ($LASTEXITCODE) { throw 'Verified backup objects missing' }
  1..31 | ForEach-Object {
    $Id = "archive-$_"; $Started = (Get-Date '2026-08-31T00:00:00Z').AddDays(-$_).ToString('o'); $Record = "{`"id`":`"$Id`",`"successful`":true,`"verified`":true,`"snapshotStartedAt`":`"$Started`"}"; $RecordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Record))
    docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && echo $RecordBase64 | base64 -d | mc pipe fixture/$Bucket/postgres/fixture/$Id.json >/dev/null && printf archive | mc pipe fixture/$Bucket/postgres/fixture/$Id.dump.age >/dev/null"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }
  $Replacement = "{`"id`":`"$($Metadata.backupId)`",`"successful`":true,`"verified`":true,`"snapshotStartedAt`":`"2026-08-31T00:00:00.000Z`"}"
  $ReplacementBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Replacement))
  $LastSuccess = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY=$ListFailureKey -e BACKUP_SECRET_KEY=$ListFailureSecret -e RETENTION_REPLACEMENT_BASE64=$ReplacementBase64 floz-backup:phase12 /app/infra/backup/retention.mjs 2>$null | Out-Null
  $RetentionListFailure = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($RetentionListFailure -eq 0) { throw 'Retention list failure rejected' }
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY=$DeleteFailureKey -e BACKUP_SECRET_KEY=$DeleteFailureSecret -e RETENTION_REPLACEMENT_BASE64=$ReplacementBase64 floz-backup:phase12 /app/infra/backup/retention.mjs 2>$null | Out-Null
  $RetentionDeleteFailure = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($RetentionDeleteFailure -eq 0) { throw 'Retention delete failure rejected' }
  $AfterRetentionFailure = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  if ($LastSuccess -ne $AfterRetentionFailure) { throw 'Retention failure displaced last-success' }
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc stat fixture/$Bucket/postgres/fixture/archive-31.json >/dev/null"
  if ($LASTEXITCODE) { throw 'Retention failure removed protected archive' }
  $Retention = docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY=$RetentionKey -e BACKUP_SECRET_KEY=$RetentionSecret -e RETENTION_REPLACEMENT_BASE64=$ReplacementBase64 floz-backup:phase12 /app/infra/backup/retention.mjs
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Deleted = $Retention | ConvertFrom-Json
  if ($Deleted.Count -ne 24) { throw 'Retention selected daily weekly overlap incorrectly' }
  $ErrorActionPreference = 'Continue'

  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-upload' -e BACKUP_SECRET_KEY=$UploadSecret -e BACKUP_RECIPIENT=$Recipient -e BACKUP_FAIL_AGE='1' floz-backup:phase12 /app/infra/backup/backup.mjs 2>$null | Out-Null
  $FailureExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($FailureExit -eq 0) { throw 'Injected age failure succeeded' }
  $AfterFailure = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  if ($LastSuccess -ne $AfterFailure) { throw 'Failure displaced last-success' }
} finally {
  docker rm -f $Postgres, $Minio 2>$null | Out-Null
  docker network rm $Network 2>$null | Out-Null
  Remove-Item -LiteralPath $TlsDir -Recurse -Force -ErrorAction SilentlyContinue
}
