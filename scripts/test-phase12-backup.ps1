$ErrorActionPreference = 'Stop'
$MinioImage = 'quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e'
$PostgresImage = 'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
$Network = 'phase12-backup'
$Minio = 'phase12-backup-minio'
$Postgres = 'phase12-backup-postgres'
$RestorePostgres = 'phase12-restore-postgres'
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
$RestoreKey = 'fixture-restore'
$RestoreSecret = 'fixture-restore-secret'
$Recipient = $null
$TlsDir = Join-Path ([IO.Path]::GetTempPath()) "phase12-backup-tls-$([guid]::NewGuid())"
$OpenSslConf = 'C:\Program Files\Git\usr\ssl\openssl.cnf'

pnpm --filter @floz/infra exec vitest run test/backup.test.ts test/retention.test.ts test/restore-fixture.test.ts
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -f infra/docker/backup.Dockerfile -t floz-backup:phase12 .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -f infra/docker/migrate.Dockerfile -t floz-migrate:phase12 .
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
  docker exec $Postgres psql -U postgres -d fixture -c 'create database fixture_restore' | Out-Null
  docker run --rm --network $Network -e DATABASE_URL="postgres://postgres:$Password@db:5432/fixture" -e NODE_ENV=test floz-migrate:phase12
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  Get-Content -Raw .\infra\backup\task19-fixture.sql | docker exec -i $Postgres psql -U postgres -d fixture | Out-Null
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $SourceLedger = docker exec $Postgres psql -U postgres -d fixture -Atc "select md5(string_agg(table_name || ':' || row_count, ',' order by table_name)) from (select table_name, (xpath('/row/count/text()', query_to_xml(format('select count(*) as count from %I', table_name), false, true, '')))[1]::text as row_count from information_schema.tables where table_schema='public') ledger"
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Key = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c 'age-keygen'
  $Secret = ($Key | Select-String 'AGE-SECRET-KEY').ToString().Trim()
  Set-Content -LiteralPath "$TlsDir/age-identity.txt" -Value $Secret
  $Recipient = ($Key | Select-String 'public key').ToString().Split(':')[-1].Trim()
  $UploadPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:PutObject`",`"s3:GetObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]}]}"))
  $RetentionPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`",`"s3:DeleteObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  $NoListPolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`",`"s3:DeleteObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  $NoDeletePolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  $RestorePolicy = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("{`"Version`":`"2012-10-17`",`"Statement`":[{`"Effect`":`"Allow`",`"Action`":[`"s3:ListBucket`",`"s3:GetBucketLocation`"],`"Resource`":[`"arn:aws:s3:::$Bucket`"]},{`"Effect`":`"Allow`",`"Action`":[`"s3:GetObject`"],`"Resource`":[`"arn:aws:s3:::$Bucket/postgres/fixture/*`"]}]}"))
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on && mc mb fixture/$Bucket && echo $UploadPolicy | base64 -d >/tmp/upload.json && echo $RetentionPolicy | base64 -d >/tmp/retention.json && echo $NoListPolicy | base64 -d >/tmp/no-list.json && echo $NoDeletePolicy | base64 -d >/tmp/no-delete.json && mc admin policy create fixture backup-upload /tmp/upload.json && mc admin policy create fixture backup-retention /tmp/retention.json && mc admin policy create fixture backup-no-list /tmp/no-list.json && mc admin policy create fixture backup-no-delete /tmp/no-delete.json && echo $RestorePolicy | base64 -d >/tmp/restore.json && mc admin policy create fixture backup-restore-read /tmp/restore.json && mc admin user add fixture $UploadKey $UploadSecret && mc admin user add fixture $RetentionKey $RetentionSecret && mc admin user add fixture $ListFailureKey $ListFailureSecret && mc admin user add fixture $DeleteFailureKey $DeleteFailureSecret && mc admin user add fixture $RestoreKey $RestoreSecret && mc admin policy attach fixture backup-upload --user $UploadKey && mc admin policy attach fixture backup-retention --user $RetentionKey && mc admin policy attach fixture backup-no-list --user $ListFailureKey && mc admin policy attach fixture backup-no-delete --user $DeleteFailureKey && mc admin policy attach fixture backup-restore-read --user $RestoreKey"
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
  $RestoreSnapshot = (Get-Date $Metadata.snapshotStartedAt).ToUniversalTime().AddMinutes(-1).ToString('o')
  $Restore = docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e RESTORE_DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture_restore?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e RESTORE_ACCESS_KEY='fixture-restore' -e RESTORE_SECRET_KEY=$RestoreSecret -e RESTORE_AGE_IDENTITY='/tls/age-identity.txt' -e RESTORE_BACKUP_ID=$($Metadata.backupId) -e RESTORE_ENCRYPTED_SHA256=$($Metadata.encryptedSha256) -e RESTORE_SNAPSHOT_STARTED_AT=$RestoreSnapshot floz-backup:phase12 /app/infra/backup/restore-fixture.mjs
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-restore $RestoreSecret --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  $RestoreReadExit = $LASTEXITCODE
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-restore $RestoreSecret --api S3v4 --path on >/dev/null && printf denied | mc pipe fixture/$Bucket/postgres/fixture/restore-write-proof.txt >/dev/null"
  $RestoreWriteExit = $LASTEXITCODE
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc rm fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  $RestoreDeleteExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($RestoreReadExit) { throw 'Restore read probe failed' }
  if ($RestoreWriteExit -eq 0) { throw 'Restore write permission rejected' }
  if ($RestoreDeleteExit -eq 0) { throw 'Restore delete permission rejected' }
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-admin $Password --api S3v4 --path on >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  if ($LASTEXITCODE) { throw 'Admin artifact verification failed' }
  $TargetLedger = docker exec $Postgres psql -U postgres -d fixture_restore -Atc "select md5(string_agg(table_name || ':' || row_count, ',' order by table_name)) from (select table_name, (xpath('/row/count/text()', query_to_xml(format('select count(*) as count from %I', table_name), false, true, '')))[1]::text as row_count from information_schema.tables where table_schema='public') ledger"
  if ($TargetLedger -ne $SourceLedger) { throw "Target ledger mismatch: source=$SourceLedger target=$TargetLedger" }
  $ErrorActionPreference = 'Continue'
  docker exec $Postgres psql -U postgres -d fixture_restore -c "insert into notification_dedup_ledger (workspace_id,dedup_key) values ('00000000-0000-0000-0000-000000000020','task19-fixture')" 2>$null | Out-Null
  $ConstraintExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($ConstraintExit -eq 0) { throw 'Restored constraint behavior rejected' }
  $SourceLedgerAfter = docker exec $Postgres psql -U postgres -d fixture -Atc "select md5(string_agg(table_name || ':' || row_count, ',' order by table_name)) from (select table_name, (xpath('/row/count/text()', query_to_xml(format('select count(*) as count from %I', table_name), false, true, '')))[1]::text as row_count from information_schema.tables where table_schema='public') ledger"
  if ($SourceLedger -ne $SourceLedgerAfter) { throw 'Source changed during real restore checks' }
  docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc stat fixture/$Bucket/postgres/fixture/last-success.json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).json >/dev/null && mc stat fixture/$Bucket/postgres/fixture/$($Metadata.backupId).dump.age >/dev/null"
  if ($LASTEXITCODE) { throw 'Verified backup objects missing' }
  $RetentionRecords = 1..31 | ForEach-Object {
    $Id = "archive-$_"; $Started = (Get-Date '2026-08-31T00:00:00Z').AddDays(-$_).ToUniversalTime().ToString('o'); $Record = @{ id = $Id; successful = $true; verified = $true; snapshotStartedAt = $Started }; $RecordJson = $Record | ConvertTo-Json -Compress; $RecordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RecordJson))
    docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && echo $RecordBase64 | base64 -d | mc pipe fixture/$Bucket/postgres/fixture/$Id.json >/dev/null && printf archive | mc pipe fixture/$Bucket/postgres/fixture/$Id.dump.age >/dev/null"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    $Record
  }
  $ReplacementRecord = @{ id = $Metadata.backupId; successful = $true; verified = $true; snapshotStartedAt = '2026-08-31T00:00:00.000Z' }
  $Replacement = $ReplacementRecord | ConvertTo-Json -Compress
  $ReplacementBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Replacement))
  $DurableRetentionRecords = @($RetentionRecords) + @{ id = $Metadata.backupId; successful = $Metadata.successful; verified = $Metadata.verified; snapshotStartedAt = $Metadata.snapshotStartedAt }
  $RetentionRecordsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@($DurableRetentionRecords) + $ReplacementRecord | ConvertTo-Json -Compress)))
  $ExpectedRetention = docker run --rm -v "${Infra}:/app/infra:ro" -e RETENTION_RECORDS_BASE64=$RetentionRecordsBase64 --entrypoint node floz-backup:phase12 --input-type=module -e "import {selectRetention} from '/app/infra/backup/retention.mjs'; console.log(JSON.stringify(selectRetention(JSON.parse(Buffer.from(process.env.RETENTION_RECORDS_BASE64,'base64')))))"
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $ExpectedRetention = $ExpectedRetention | ConvertFrom-Json
  if (@($ExpectedRetention | Where-Object { $_.classes -contains 'daily' }).Count -ne 7) { throw 'Retention did not select seven daily classes' }
  if (@($ExpectedRetention | Where-Object { $_.classes -contains 'weekly' } | Select-Object -ExpandProperty week -Unique).Count -ne 4) { throw 'Retention did not select four weekly classes' }
  if (@($ExpectedRetention | Where-Object { $_.classes.Count -gt 1 }).Count -eq 0) { throw 'Retention daily weekly overlap missing' }
  $ProtectedRetentionIds = @($ExpectedRetention | Select-Object -ExpandProperty id)
  $ProtectedArchiveIds = @($RetentionRecords | Where-Object { $_.id -in $ProtectedRetentionIds } | ForEach-Object { $_.id })
  $StaleRetentionIds = @($RetentionRecords | Where-Object { $_.id -notin $ProtectedRetentionIds } | ForEach-Object { $_.id })
  $BeforeRetentionObjects = @(docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc ls --json --recursive fixture/$Bucket/postgres/fixture | grep 'archive-' ")
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
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
  $Deleted = @($Retention | ConvertFrom-Json | ForEach-Object { $_ })
  $AfterRetentionObjects = @(docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc ls --json --recursive fixture/$Bucket/postgres/fixture | grep 'archive-' ")
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $AfterRetentionIds = @($AfterRetentionObjects | ForEach-Object { [IO.Path]::GetFileName(($_ | ConvertFrom-Json).key) -replace '\.dump\.age$|\.json$','' } | Sort-Object -Unique)
  if (@($BeforeRetentionObjects).Count -ne (@($RetentionRecords).Count * 2)) { throw 'Retention before-state fixture incomplete' }
  $DeletedIds = (@($Deleted | ForEach-Object { [string]$_ } | Sort-Object) -join ',')
  $ExpectedDeletedIds = (@($StaleRetentionIds | ForEach-Object { [string]$_ } | Sort-Object) -join ',')
  if ($DeletedIds -ne $ExpectedDeletedIds) { throw "Retention deleted IDs differ from stale IDs: actual=$DeletedIds expected=$ExpectedDeletedIds" }
  if (@($ProtectedArchiveIds | Where-Object { $_ -notin $AfterRetentionIds }).Count) { throw 'Retention deleted protected archive' }
  if (@($StaleRetentionIds | Where-Object { $_ -in $AfterRetentionIds }).Count) { throw 'Retention retained stale archive' }
  if (@($AfterRetentionObjects).Count -ne (@($ProtectedArchiveIds).Count * 2)) { throw 'Retention after-state object count incorrect' }
  Write-Output "Retention evidence: daily=7 weekly=4 overlap=$(@($ExpectedRetention | Where-Object { $_.classes.Count -gt 1 }).Count) protected=$(@($ProtectedArchiveIds).Count) stale=$(@($StaleRetentionIds).Count) beforeObjects=$(@($BeforeRetentionObjects).Count) afterObjects=$(@($AfterRetentionObjects).Count) deleted=$(@($Deleted).Count)"
  $ErrorActionPreference = 'Continue'

  $ErrorActionPreference = 'Continue'
  docker run --rm --network $Network -v "${Infra}:/app/infra:ro" -v "${TlsDir}:/tls:ro" -e DATABASE_URL="postgres://postgres:$Password@$Postgres`:5432/fixture?sslmode=verify-full&sslrootcert=/tls/ca.crt" -e BACKUP_ENDPOINT='http://minio:9000' -e BACKUP_REMOTE="fixture/$Bucket" -e BACKUP_ACCESS_KEY='fixture-upload' -e BACKUP_SECRET_KEY=$UploadSecret -e BACKUP_RECIPIENT=$Recipient -e BACKUP_FAIL_AGE='1' floz-backup:phase12 /app/infra/backup/backup.mjs 2>$null | Out-Null
  $FailureExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($FailureExit -eq 0) { throw 'Injected age failure succeeded' }
  $AfterFailure = docker run --rm --network $Network --entrypoint sh floz-backup:phase12 -c "mc alias set fixture http://minio:9000 fixture-upload $UploadSecret --api S3v4 --path on >/dev/null && mc cat fixture/$Bucket/postgres/fixture/last-success.json"
  if ($LastSuccess -ne $AfterFailure) { throw 'Failure displaced last-success' }
} finally {
  docker rm -f $Postgres, $RestorePostgres, $Minio 2>$null | Out-Null
  docker network rm $Network 2>$null | Out-Null
  Remove-Item -LiteralPath $TlsDir -Recurse -Force -ErrorAction SilentlyContinue
}
