param([ValidateSet('linux/amd64','linux/arm64')][string]$Platform = 'linux/amd64')
$ErrorActionPreference = 'Stop'
$images = @{ api='api'; worker='worker'; web='web'; migrator='migrate' }
foreach ($imageName in $images.Keys) {
  docker buildx build --platform $Platform --load -f "infra/docker/$($images[$imageName]).Dockerfile" -t "floz-${imageName}:phase12" .
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
