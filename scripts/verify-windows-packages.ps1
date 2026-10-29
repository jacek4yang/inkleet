# GitHub Actions-only package inspection. Does not launch or install the app.
param([switch] $TestOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-PeHeader([string] $Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
        throw "Missing DOS/PE header: $Path"
    }
    $offset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ($offset -lt 0 -or $offset + 26 -gt $bytes.Length) { throw "Invalid PE offset: $Path" }
    if ([BitConverter]::ToUInt32($bytes, $offset) -ne 0x00004550) { throw "Invalid PE signature: $Path" }
    return [ordered]@{
        machine = [int][BitConverter]::ToUInt16($bytes, $offset + 4)
        optional_header_magic = [int][BitConverter]::ToUInt16($bytes, $offset + 24)
        bytes = $bytes.Length
    }
}

function Read-MsiProperty($Database, [string] $Name) {
    $view = $Database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
    try {
        [void]$view.Execute()
        $record = $view.Fetch()
        if ($null -eq $record) { throw "Missing MSI property: $Name" }
        return [string]$record.StringData(1)
    } finally { [void]$view.Close() }
}

if ($TestOnly) {
    $record = [pscustomobject]@{Value = 'InkLeet'}
    $record | Add-Member ScriptMethod StringData { param($Index) if ($Index -ne 1) { throw 'Invalid index' }; return $this.Value }
    $view = [pscustomobject]@{Record = $record; Closed = $false}
    $view | Add-Member ScriptMethod Execute { return 0 }
    $view | Add-Member ScriptMethod Fetch { return $this.Record }
    $view | Add-Member ScriptMethod Close { $this.Closed = $true; return 0 }
    $database = [pscustomobject]@{View = $view}
    $database | Add-Member ScriptMethod OpenView { param($Query) return $this.View }
    $value = Read-MsiProperty $database 'ProductName'
    if ($value -isnot [string] -or $value -cne 'InkLeet' -or -not $view.Closed) { throw 'MSI reader leaked COM method output into the returned value' }
    $view.Record = $null; $view.Closed = $false
    $rejected = $false
    try { Read-MsiProperty $database 'Missing' | Out-Null } catch { $rejected = $true }
    if (-not $rejected -or -not $view.Closed) { throw 'MSI reader must reject absent records and close the view' }
    Write-Host 'MSI scalar property and failure cleanup regressions passed.'
    return
}
$target = 'x86_64-pc-windows-msvc'
$release = Join-Path $PWD "src-tauri/target/$target/release"
$binary = Join-Path $release 'inkleet.exe'
$nsis = @(Get-ChildItem (Join-Path $release 'bundle/nsis') -File -Filter '*-setup.exe')
$msi = @(Get-ChildItem (Join-Path $release 'bundle/msi') -File -Filter '*.msi')
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) { throw 'Expected exactly one NSIS installer and one MSI package' }
$appPe = Read-PeHeader $binary
if ($appPe.machine -ne 0x8664 -or $appPe.optional_header_magic -ne 0x20b) {
    throw 'The application is not an x64 PE32+ executable'
}
$setupPe = Read-PeHeader $nsis[0].FullName
# The NSIS installer stub may be 32-bit even when its application payload is x64.
if ($setupPe.machine -notin @(0x14c, 0x8664)) { throw 'Unexpected NSIS installer architecture' }

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msi[0].FullName, 0)
$summary = $database.GetType().InvokeMember('SummaryInformation', 'GetProperty', $null, $database, @(0))
$template = [string]$summary.GetType().InvokeMember('Property', 'GetProperty', $null, $summary, @(7))
if (($template -split ';')[0] -ne 'x64') { throw "MSI Template Summary is not x64: $template" }
$productName = Read-MsiProperty $database 'ProductName'
$productVersion = Read-MsiProperty $database 'ProductVersion'
$productCode = Read-MsiProperty $database 'ProductCode'
if ($productName -isnot [string] -or $productName -cne 'InkLeet') { throw "Unexpected MSI product: $productName" }

$version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version
if ($productVersion -ne $version) { throw 'MSI version differs from the application configuration' }
$commit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$' -or $commit -ne $env:GITHUB_SHA) {
    throw 'Checkout commit does not match the workflow commit'
}
$delivery = New-Item -ItemType Directory -Force 'delivery/windows-x64'
$evidence = New-Item -ItemType Directory -Force 'evidence/windows-x64'
$stem = "InkLeet-$version-preview-$($commit.Substring(0,12))-windows-x64"
$setupName = "$stem-setup.exe"
$msiName = "$stem.msi"
Copy-Item $nsis[0].FullName (Join-Path $delivery $setupName)
Copy-Item $msi[0].FullName (Join-Path $delivery $msiName)

$hashLines = foreach ($name in @($setupName, $msiName)) {
    $hash = (Get-FileHash -Algorithm SHA256 (Join-Path $delivery $name)).Hash.ToLowerInvariant()
    "$hash  $name"
}
$hashLines | Set-Content -Encoding utf8NoBOM (Join-Path $delivery 'SHA256SUMS')
$commit | Set-Content -Encoding utf8NoBOM (Join-Path $delivery 'SOURCE_COMMIT.txt')

$signatures = foreach ($file in @($binary, $nsis[0].FullName, $msi[0].FullName)) {
    $signature = Get-AuthenticodeSignature $file
    [ordered]@{file = [System.IO.Path]::GetFileName($file); status = [string]$signature.Status}
}
$information = [ordered]@{
    commit = $commit
    target = $target
    runner = 'windows-2025'
    version = $version
    build_profile = 'release; default features; diagnostic snippet features disabled'
    workflow_run = "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
    app_pe = $appPe
    nsis_stub_pe = $setupPe
    msi = [ordered]@{template = $template; product_name = $productName; product_version = $productVersion; product_code = $productCode}
    authenticode = @($signatures)
    verified = @('locked frontend and native tests', 'x64 application PE32+', 'NSIS PE container', 'readable x64 MSI metadata', 'SHA-256')
    not_verified = @('interactive MSI/NSIS installer', 'physical Windows GUI/IME', 'SmartScreen reputation', 'real account login and online submission')
}
$information | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM (Join-Path $delivery 'BUILD_INFO.json')
Copy-Item (Join-Path $delivery 'BUILD_INFO.json') (Join-Path $evidence 'package-inspection.json')

@'
InkLeet Windows x64 developer preview

Choose either the NSIS *-setup.exe or the .msi installer, not both for the same
installation. The application payload targets x86_64-pc-windows-msvc.
SOURCE_COMMIT.txt identifies the exact source; SHA256SUMS identifies these files.

These preview installers have no publisher certificate supplied by this build.
Windows may display an unknown-publisher or reputation warning. Do not disable
SmartScreen, antivirus, or system security policies. If your device blocks the
installer, use an approved signed build or ask your administrator.

WebView2 is required. The unchanged Tauri default installer mode downloads its
bootstrapper when the runtime is absent, so that installation needs Internet
access. This is not an offline installer or a Windows 7 compatibility promise.

CI inspects compilation, tests, application architecture, MSI metadata and hashes.
A separate mandatory step exercises fresh MSI install, v0.1.1 upgrade, uninstall
and the installed WebView2 app with synthetic data. Its actual outcome and scope
are in BUILD_INFO.json under installed_msi_acceptance; missing/PENDING is not PASS.
This does not certify interactive installer UI, physical IME, NSIS installation,
SmartScreen reputation, account login or online submission. See the linked workflow.

Before acceptance on a Windows test machine: back up application data; install
one format; launch; check Settings opening/search/save/reopen; save and reopen a
sample note; close the app; verify uninstall behavior. Test the other format on a
clean test machine. Do not run different app versions against the same data.
The application uses managed language tools; downloaded tool isolation is not a
security sandbox. Only execute code you trust.
'@ | Set-Content -Encoding utf8NoBOM (Join-Path $delivery 'README.txt')

Write-Host "Prepared $setupName and $msiName; installer/GUI acceptance remains explicit."
