# Disposable GitHub-hosted Windows runner only. Real MSI + installed WebView2 app.
# Never changes SmartScreen/AV/policies, credentials, or globally scoped env vars.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-ci-node.ps1')
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Installed-app acceptance is restricted to a disposable GitHub-hosted Windows runner'
}
$root = (Get-Location).Path
$commit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -ne $env:GITHUB_SHA) { throw 'Checkout/source identity mismatch' }
$evidence = Join-Path $root 'evidence/windows-x64/installed'
New-Item -ItemType Directory -Force $evidence | Out-Null
$temporary = Join-Path $env:RUNNER_TEMP ('InkLeet MSI acceptance ' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $temporary 'Installed app'
$appData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'top.jacek.inkleet'
$appCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'top.jacek.inkleet'
$version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version
$report = [ordered]@{
    result = 'FAIL'; source_commit = $commit; version = $version; runner = 'windows-2025'
    stages = [System.Collections.Generic.List[string]]::new()
    ui = [ordered]@{}
    payloads = [ordered]@{}
    hosts = [ordered]@{}
    cleanup_errors = [System.Collections.Generic.List[string]]::new()
    scope = 'Unattended MSI fresh install, verified v0.1.1 upgrade, uninstall and real installed WebView2 synthetic-data UI. No mocked IPC.'
    not_verified = @('interactive MSI/NSIS installer', 'physical desktop/IME', 'SmartScreen reputation', 'signing', 'real account or online judge', 'managed LSP/tool installation')
}
$installer = New-Object -ComObject WindowsInstaller.Installer
$script:msiUncertain = $false
# Inspected metadata is NOT ownership. Only absent products whose install this
# test actually initiates may be considered for failure cleanup.
$ownedProducts = [ordered]@{}
function Msi-Property($Database, [string] $Name) {
    $view = $Database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
    try { [void]$view.Execute(); $record = $view.Fetch(); if ($null -eq $record) { throw "Missing MSI property $Name" }; return [string]$record.StringData(1) }
    finally { [void]$view.Close() }
}
function Msi-Info([string] $Path) {
    $database = $installer.OpenDatabase($Path, 0)
    $view = $database.OpenView('SELECT `Directory` FROM `Directory` WHERE `Directory` = ''INSTALLDIR''')
    try { [void]$view.Execute(); if ($null -eq $view.Fetch()) { throw 'The MSI has no explicit INSTALLDIR test location' } }
    finally { [void]$view.Close() }
    $info = [ordered]@{path=$Path; productCode=(Msi-Property $database 'ProductCode'); upgradeCode=(Msi-Property $database 'UpgradeCode'); version=(Msi-Property $database 'ProductVersion'); name=(Msi-Property $database 'ProductName')}
    if ($info.name -cne 'InkLeet' -or $info.productCode -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$' -or $info.upgradeCode -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') { throw 'Unexpected MSI identity' }
    return $info
}
function Read-MsiStringList($List) {
    if ($null -eq $List) { throw 'Missing MSI StringList response' }
    # PowerShell's synthetic scalar .Count can be 1 on an opaque COM wrapper.
    # Ask IDispatch for the actual StringList.Count, not the wrapper count.
    $count = $List.GetType().InvokeMember('Count', 'GetProperty', $null, $List, @())
    if ($count -isnot [int] -or $count -lt 0 -or $count -gt 128) { throw 'Invalid MSI StringList count' }
    $items = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $count; $index++) {
        $value = $List.GetType().InvokeMember('Item', 'GetProperty', $null, $List, @($index))
        if ($value -isnot [string] -or $value -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') { throw 'Invalid related MSI product identifier' }
        $items.Add($value)
    }
    return ,$items.ToArray()
}
function Product-Installed([string] $Code) {
    # Windows Installer state 5 = INSTALLSTATE_DEFAULT, not just package metadata.
    return [int]$installer.GetType().InvokeMember('ProductState', 'GetProperty', $null, $installer, @($Code)) -eq 5
}
function Run-Msi([string] $Action, [string] $Package, [string] $Label) {
    $log = Join-Path $evidence "$Label-msi.log"
    $arguments = @($Action, ('"' + $Package + '"'), '/qn', '/norestart', '/L*V', ('"' + $log + '"'))
    if ($Action -eq '/i') { $arguments += ('INSTALLDIR="' + $installDir + '"') }
    $process = Start-Process -FilePath "$env:WINDIR/System32/msiexec.exe" -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit(180000)) { $script:msiUncertain = $true; throw "$Label MSI did not complete within 180 seconds; see log, no automatic replay" }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "$Label MSI exit $($process.ExitCode); restart-required/uncertain states are not PASS" }
}
function Install-Owned($Info, [string] $Label) {
    if (Product-Installed $Info.productCode) { throw "Refusing already-installed product before $Label" }
    $ownedProducts[$Info.productCode] = $Info
    Run-Msi '/i' $Info.path $Label
}
function Cleanup-OwnedProducts([string] $Result) {
    if ($Result -eq 'PASS' -or $script:msiUncertain) { return }
    foreach ($info in $ownedProducts.Values) {
        if ($script:msiUncertain) { break }
        try {
            if (Product-Installed $info.productCode) { Run-Msi '/x' $info.productCode ('failure-cleanup-' + $info.version) }
        } catch { $report.cleanup_errors.Add($_.Exception.Message); Write-Warning $_.Exception.Message }
    }
}
function Installed-Binary {
    $found = @(Get-ChildItem -LiteralPath $installDir -Recurse -File -Filter 'inkleet.exe')
    if ($found.Count -ne 1) { throw 'Expected exactly one installed InkLeet executable under owned INSTALLDIR' }
    return $found[0].FullName
}
function Notebook-Hashes {
    $notebook = Join-Path $appData 'notebook'
    $hashes = [ordered]@{}
    foreach ($file in @(Get-ChildItem -LiteralPath $notebook -Recurse -File | Sort-Object FullName)) {
        $relative = [IO.Path]::GetRelativePath($notebook, $file.FullName)
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($hashes.Count -lt 2) { throw 'No actual saved synthetic notebook to preserve' }
    return ($hashes | ConvertTo-Json -Compress -Depth 6)
}
function Assert-Preserved([string] $Before, [string] $Stage) {
    if ((Notebook-Hashes) -cne $Before) { throw "$Stage changed or removed saved notebook data" }
    $Before | Set-Content -Encoding utf8NoBOM (Join-Path $evidence "$Stage-preserved-notebook.json")
}
function Assert-InstalledPayload([string] $Stage, [string] $Built) {
    $installed = Installed-Binary
    $payloadReport = Join-Path $evidence "$Stage-payload.json"
    & node tests/windows-msi-payload.mjs $Built $installed $payloadReport
    if (Test-Path -LiteralPath $payloadReport) { $report.payloads[$Stage] = Get-Content -Raw $payloadReport | ConvertFrom-Json }
    if ($LASTEXITCODE -ne 0) { throw "$Stage exact MSI payload verification failed; see hashes, byte sizes and paths" }
    if ($report.payloads[$Stage].result -ne 'PASS') { throw 'Missing successful payload proof' }
}
function Standard-Node([string] $Phase, $Configuration) {
    $Configuration.userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $Configuration.powershell=(Get-Process -Id $PID).Path
    $Configuration.nodeExecutable=Resolve-InkLeetCiNode
    $Configuration.tokenInspector=Join-Path $root 'scripts/windows-ci-host.ps1'
    $configPath=Join-Path $evidence "$Phase-config.json"
    $Configuration | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM $configPath
    $hostResult=& ./scripts/windows-ci-host.ps1 -Config $configPath
    $report.hosts[$Phase]=$hostResult
    if ($hostResult.result -ne 'PASS') {throw "$Phase standard-host launch did not pass"}
}
function Ui-Probe([string] $Phase, [string] $ExpectedVersion, [string] $ApplicationSource) {
    $binary = Installed-Binary
    $config = [ordered]@{phase=$Phase; binary=$binary; installDir=$installDir; appData=$appData; appCache=$appCache; evidence=$evidence; temporary=$temporary; version=$ExpectedVersion; harnessCommit=$commit; applicationSourceCommit=$ApplicationSource}
    Standard-Node $Phase $config
    $result = Get-Content -Raw (Join-Path $evidence "$Phase-ui.json") | ConvertFrom-Json
    if ($result.result -ne 'PASS' -or $result.nativeVersion -ne $ExpectedVersion -or $result.harnessCommit -ne $commit -or $result.applicationSourceCommit -ne $ApplicationSource -or -not $result.normalClose) { throw "$Phase UI evidence is incomplete" }
    $report.ui[$Phase] = $result
}
$current = $null; $legacy = $null
try {
    foreach ($path in @($appData, $appCache) | Select-Object -Unique) {
        if (Test-Path -LiteralPath $path) { throw "Refusing existing application directory: $path" }
    }
    if (@(Get-Process -Name inkleet -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Refusing an already-running InkLeet process' }
    $packages = @(Get-ChildItem 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi' -Filter '*.msi' -File)
    if ($packages.Count -ne 1) { throw 'Expected exactly one current MSI package' }
    $current = Msi-Info $packages[0].FullName
    if ($current.version -ne $version -or (Product-Installed $current.productCode)) { throw 'Current MSI version/state mismatch' }
    $relatedList = $installer.GetType().InvokeMember('RelatedProducts', 'GetProperty', $null, $installer, @($current.upgradeCode))
    $related = Read-MsiStringList $relatedList
    $report.preflight = [ordered]@{related_product_codes=$related}
    if ($related.Length -ne 0) { throw ('Refusing pre-existing installed or advertised related InkLeet product(s): ' + ($related -join ', ')) }
    $manifest = Get-Content -Raw 'releases/v0.1.1.json' | ConvertFrom-Json
    if ($manifest.repository -ne 'jacek4yang/inkleet' -or $manifest.tag -ne 'v0.1.1' -or $manifest.source_commit -ne 'fbacb2041b83232a30a791965c58d93a7556a4ff') { throw 'Unexpected prior-release provenance' }
    $assets = @($manifest.artifacts.windows.assets | Where-Object { $_.name -match '^[A-Za-z0-9._-]+\.msi$' })
    if ($assets.Count -ne 1 -or $assets[0].sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Ambiguous prior MSI asset' }
    $preparation=[ordered]@{phase='prepare';appData=$appData;appCache=$appCache;evidence=$evidence;temporary=$temporary;harnessCommit=$commit}
    Standard-Node 'prepare' $preparation
    $report.preflight.owned_paths=@()
    foreach ($path in @($temporary,$appData,$appCache,(Join-Path $temporary 'WebView2 synthetic profile'))) {
        $owner=(Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -cne $preparation.userSid) {throw "Synthetic path not owned by current standard user: $path ($owner)"}
        $report.preflight.owned_paths+=@([ordered]@{path=$path;owner_sid=$owner})
    }
    $priorPath = Join-Path $temporary $assets[0].name
    $priorUrl = "https://github.com/jacek4yang/inkleet/releases/download/v0.1.1/$($assets[0].name)"
    Invoke-WebRequest -Uri $priorUrl -OutFile $priorPath
    if ((Get-Item -LiteralPath $priorPath).Length -ne $assets[0].bytes -or (Get-FileHash -LiteralPath $priorPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $assets[0].sha256) { throw 'Prior public MSI size/hash mismatch' }
    $legacy = Msi-Info $priorPath
    if ($legacy.version -ne '0.1.1' -or [version]$version -le [version]$legacy.version -or $legacy.upgradeCode -ne $current.upgradeCode -or $legacy.productCode -eq $current.productCode -or (Product-Installed $legacy.productCode)) { throw 'MSI upgrade identity/version is incompatible' }
    $report.prior = [ordered]@{url=$priorUrl; sha256=$assets[0].sha256; bytes=$assets[0].bytes; source_commit=$manifest.source_commit; version=$legacy.version}
    $report.packages = [ordered]@{current=$current; legacy=$legacy}
    Install-Owned $current 'fresh-install'
    if (-not (Product-Installed $current.productCode)) { throw 'Fresh MSI did not register the product' }
    $built = 'src-tauri/target/x86_64-pc-windows-msvc/release/inkleet.exe'
    Assert-InstalledPayload 'fresh' $built
    Ui-Probe 'fresh' $version $commit; $report.stages.Add('current MSI fresh install and real WebView2 save')
    $before = Notebook-Hashes
    Run-Msi '/x' $current.productCode 'fresh-uninstall'
    if ((Product-Installed $current.productCode) -or @(Get-ChildItem $installDir -Recurse -File -Filter 'inkleet.exe' -ErrorAction SilentlyContinue).Count) { throw 'Fresh uninstall left product or executable installed' }
    Assert-Preserved $before 'fresh-uninstall'; $report.stages.Add('fresh uninstall preserves saved notebook')
    Install-Owned $legacy 'legacy-install'
    if (-not (Product-Installed $legacy.productCode)) { throw 'Prior MSI did not register the product' }
    Ui-Probe 'legacy' $legacy.version $manifest.source_commit; $report.stages.Add('public v0.1.1 installed, actual source/notes/named solution saved')
    $before = Notebook-Hashes
    Install-Owned $current 'upgrade'
    if (-not (Product-Installed $current.productCode) -or (Product-Installed $legacy.productCode)) { throw 'Upgrade did not replace the prior registered product' }
    Assert-Preserved $before 'upgrade'
    Assert-InstalledPayload 'upgraded' $built
    Ui-Probe 'upgraded' $version $commit; $report.stages.Add('upgrade retains v0.1.1 data; real WebView2 reload, archive/restart/restore')
    $before = Notebook-Hashes
    Run-Msi '/x' $current.productCode 'upgraded-uninstall'
    if ((Product-Installed $current.productCode) -or @(Get-ChildItem $installDir -Recurse -File -Filter 'inkleet.exe' -ErrorAction SilentlyContinue).Count) { throw 'Final uninstall left product or executable installed' }
    Assert-Preserved $before 'upgraded-uninstall'; $report.stages.Add('upgraded uninstall preserves full synthetic notebook')
    $report.result = 'PASS'
} catch { $report.error = $_.Exception.Message; throw }
finally {
    # On failure only, remove products whose absent-state install this test started.
    # Inspected/pre-existing products are never owned. An uncertain MSI timeout
    # stops all further installer actions; logs and synthetic files are retained.
    Cleanup-OwnedProducts $report.result
    $report.msi_uncertain = $script:msiUncertain
    $report | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8NoBOM (Join-Path $evidence 'MSI_INSTALLED_RESULT.json')
}
$infoPath = 'delivery/windows-x64/BUILD_INFO.json'
$buildInfo = Get-Content -Raw $infoPath | ConvertFrom-Json
$buildInfo | Add-Member -NotePropertyName installed_msi_acceptance -NotePropertyValue $report -Force
$buildInfo | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8NoBOM $infoPath
Copy-Item (Join-Path $evidence 'MSI_INSTALLED_RESULT.json') 'delivery/windows-x64/MSI_INSTALLED_RESULT.json'
Write-Host 'PASS: actual unattended MSI lifecycle and installed WebView2 synthetic-data acceptance; see precise exclusions.'
