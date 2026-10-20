$ErrorActionPreference = "Stop"
$path = Join-Path $PSScriptRoot "../.local"
New-Item -ItemType Directory -Path $path -Force | Out-Null
$name = "metering-test-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$password = [Convert]::ToHexString($bytes).ToLowerInvariant()
$id = docker run --detach --name $name -e POSTGRES_USER=metering -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=metering_test -p 127.0.0.1::5432 postgres:18
if ($LASTEXITCODE -ne 0) { throw "Could not start test PostgreSQL" }
Set-Content -LiteralPath (Join-Path $path "test-container") -Value $name
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  docker exec $name pg_isready -U metering -d metering_test 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL did not become ready. Container: $name" }
$port = docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' $name
$url = "postgres://metering:" + $password + "@127.0.0.1:" + $port + "/metering_test"
Set-Content -LiteralPath (Join-Path $path "test.env") -Value ("TEST_DATABASE_URL=" + $url)
Write-Output ("Ready: " + $name + " on localhost:" + $port + ". Connection saved to .local/test.env")
