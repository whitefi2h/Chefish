param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
if ($root -ne 'E:\Chefish') { throw 'This audited cleanup is only for E:\Chefish.' }
Set-Location -LiteralPath $root
$active = @(Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.Name -match '^(node|cargo|rustc|makensis)\.exe$' -and $_.CommandLine -like '*E:\Chefish*')
})
if ($active.Count) { $active | Select-Object ProcessId, Name, ExecutablePath; throw 'Close project apps/builds before cleanup.' }
$beforeGit = @(git status --porcelain=v1 -uall)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git status.' }
$paths = @(
    'dist', 'node_modules-baseline-v1.1', 'node_modules/.vite', 'node_modules/.cache',
    'playwright-report', 'test-results', 'firestore-debug.log',
    'src-tauri/target/debug', 'src-tauri/target/import-preview',
    'src-tauri/target/release/deps', 'src-tauri/target/release/build',
    'src-tauri/target/release/incremental', 'src-tauri/target/release/.fingerprint',
    'src-tauri/target/release/nsis'
)
$paths += @(Get-ChildItem -LiteralPath 'src-tauri/target/release' -File | Where-Object {
    $_.Name -like 'chefish-before-*.exe' -or $_.Name -like 'chefish-running-*.exe' -or
    $_.Name -like 'chefish-font-viewer.*' -or $_.Name -eq 'chefish_font_viewer.pdb' -or $_.Extension -eq '.d'
} | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$paths += @(Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -File | Where-Object {
    $_.Name -match '^Chefish(?: QA)?_(?:1\.0\.0|2\.0\.0|2\.2\.[012]|2\.3\.[012456])_x64-setup\.exe(?:\.sig)?$'
} | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$paths += @(Get-ChildItem -LiteralPath 'review' -File | Where-Object {
    $_.Name -like 'chefish-*-qa.exe' -or $_.Extension -eq '.pid'
} | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$items = @(foreach ($relative in $paths) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (!$absolute.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $absolute" }
    if (!(Test-Path -LiteralPath $absolute)) { continue }
    $tracked = @(git ls-files -- $relative)
    if ($LASTEXITCODE -ne 0 -or $tracked.Count) { throw "Tracked or unverified target: $relative" }
    $item = Get-Item -LiteralPath $absolute -Force
    $children = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $absolute -Recurse -Force) } else { @() }
    $links = @(@($item) + $children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { throw "Links found in target: $absolute" }
    $files = @(@($item) + $children | Where-Object { !$_.PSIsContainer })
    [pscustomobject]@{path=$absolute;files=$files.Count;bytes=[long](($files | Measure-Object Length -Sum).Sum);status='pending'}
})
$items | Select-Object path, files, @{n='GiB';e={[math]::Round($_.bytes/1GB,3)}} | Format-Table -AutoSize
$total = [long](($items | Measure-Object bytes -Sum).Sum)
Write-Host ("Selected: {0:N2} GiB. Latest v2.3.7 and published v2.3.3 installers are retained." -f ($total/1GB))
if ($Preview) { return }
$receipt = [ordered]@{
    date=(Get-Date -Format o); root=$root
    preserved=@('Source and existing edits','Personal data and .env.local','Current node_modules','v2.3.7 EXE/installer/signature/manifest','Published v2.3.3 installer/signature','Docs/screenshots/references/source review archive')
    items=$items
}
$receiptPath = Join-Path $root 'docs/cleanup-20261107.json'
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
try {
    foreach ($item in $items) {
        Remove-Item -LiteralPath $item.path -Recurse -Force
        $item.status = 'deleted'
    }
} finally {
    $deleted = @($items | Where-Object { $_.status -eq 'deleted' })
    $receipt['deletedBytes'] = [long](($deleted | Measure-Object bytes -Sum).Sum)
    $receipt['deletedFiles'] = [long](($deleted | Measure-Object files -Sum).Sum)
    $receipt['allTargetsAbsent'] = @($items | Where-Object { Test-Path -LiteralPath $_.path }).Count -eq 0
    $afterGit = @(git status --porcelain=v1 -uall | Where-Object { $_ -notlike '*docs/cleanup-20261107.json' })
    $receipt['existingGitStatusUnchanged'] = @(Compare-Object $beforeGit $afterGit).Count -eq 0
    $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
}
Write-Host ("Removed {0:N2} GiB. Receipt: {1}" -f ($receipt.deletedBytes/1GB), $receiptPath)
