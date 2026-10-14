# setup/bootstrap.ps1 - a private, checksum-verified Node.js runtime in .runtime (no administrator access), then the
# setup wizard (setup/server.mjs). Arguments pass through (--launch, --install-only, --no-open).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $root = Split-Path -Parent $PSScriptRoot
  Set-Location -LiteralPath $root
  $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Being needs Windows on x64.' }
  $spec = $manifest.'win-x64'
  $runtime = Join-Path $root '.runtime'
  $nodeHome = Join-Path $runtime ('node-v' + $manifest.version + '-win-x64')
  $node = Join-Path $nodeHome 'node.exe'
  $npm = Join-Path $nodeHome 'node_modules\npm\bin\npm-cli.js'
  $healthy = $false
  if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $npm)) { try { $null = & $node $npm --version 2>&1; $healthy = $LASTEXITCODE -eq 0 } catch {} }
  if (!$healthy) {
    Write-Host 'Preparing setup...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    $archive = Join-Path $runtime ($spec.file + '.part')
    try { Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v' + $manifest.version + '/' + $spec.file) -OutFile $archive }
    catch { throw 'Could not download. Check the internet and run Setup again.' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.sha256) { Remove-Item -LiteralPath $archive; throw 'Download check failed. Run Setup again.' }
    $zip = Join-Path $runtime $spec.file
    Move-Item -LiteralPath $archive -Destination $zip -Force
    if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force }
    # Windows 10+ ships tar (much faster than Expand-Archive); fall back when it is missing or fails
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    $done = $false
    if (Test-Path -LiteralPath $tar) { & $tar -xf $zip -C $runtime; $done = $LASTEXITCODE -eq 0 }
    if (!$done) { if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force }; Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force }
    Remove-Item -LiteralPath $zip
  }
  if ((& $node --version) -ne ('v' + $manifest.version)) { throw 'Runtime version mismatch. Delete the .runtime folder and run Setup again.' }
  $env:Path = $nodeHome + ';' + $env:Path
  & $node (Join-Path $PSScriptRoot 'server.mjs') @args
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message
  exit 1
}
