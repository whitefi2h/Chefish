$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$defaultSigningKey = Join-Path $env:USERPROFILE '.tauri\chefish-update.key'
if (!$env:TAURI_SIGNING_PRIVATE_KEY) {
    if (!(Test-Path -LiteralPath $defaultSigningKey)) {
        throw 'Missing update signing key. See docs/APP_UPDATES.md. Do not generate a replacement key for an existing release channel.'
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = $defaultSigningKey
}
& node_modules/.bin/tauri.cmd build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
& node scripts/prepare-update.mjs
if ($LASTEXITCODE -ne 0) { throw 'Update manifest generation failed' }
