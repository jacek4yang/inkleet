# Installer-only qualification on a disposable Windows runner. Never launches
# InkLeet, changes security settings/ACLs, or treats seeded files as app-authored.
param([string] $BuildInfoPath = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-ci-node.ps1')
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'MSI lifecycle qualification requires a disposable GitHub-hosted Windows runner'
}
$root = (Get-Location).Path
$commit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -cne $env:GITHUB_SHA) { throw 'Checkout/source identity mismatch' }
$tree = (git rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source identity' }
$version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version
$evidence = Join-Path $root 'evidence/windows-x64/msi-lifecycle'
New-Item -ItemType Directory -Force $evidence | Out-Null
$temporary = Join-Path $env:RUNNER_TEMP ('InkLeet MSI lifecycle ' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $temporary 'Installed app'
$appData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'top.jacek.inkleet'
$appCache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'top.jacek.inkleet'
$seedRoots = [ordered]@{appData=$appData; appCache=$appCache}
$report = [ordered]@{
    schema=1; scope='installer-only-seeded-data'; result='FAIL'
    source_commit=$commit; source_tree=$tree; version=$version; runner='windows-2025'
    application_launched=$false
    stages=[System.Collections.Generic.List[string]]::new()
    registrations=[System.Collections.Generic.List[object]]::new()
    msi_operations=[System.Collections.Generic.List[object]]::new()
    payloads=[ordered]@{}
    synthetic=[ordered]@{origin='test-seeded-not-app-authored'; marker=($commit + ':' + [guid]::NewGuid().ToString('N')); roots=@(); baseline=$null; boundaries=[System.Collections.Generic.List[object]]::new()}
    cleanup_errors=[System.Collections.Generic.List[string]]::new()
    not_verified=@('Windows real GUI and WebView2 startup', 'post-upgrade application runtime', 'old-application-authored storage compatibility or migration', 'application save/reload/archive/restart/restore', 'interactive MSI/NSIS installer', 'physical desktop/IME', 'signing or SmartScreen reputation', 'real account or online judge', 'managed LSP/tool installation')
}
$script:msiUncertain = $false
$ownedProducts = [ordered]@{}
$installer = $null
function Assert-NoApplication {
    $processes = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -ieq 'inkleet' })
    if ($processes.Count -ne 0) { $report.application_launched=$true; throw 'Refusing a running InkLeet process; no app launch is permitted by this test' }
}
function Assert-PlainPath([string] $Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing reparse/symbolic-link path: $Path" }
    return $item
}
function Owner-Sid([string] $Path) {
    return (Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
}
function Create-AbsentDirectory([string] $Path) {
    if (Test-Path -LiteralPath $Path) { throw "Refusing existing synthetic directory: $Path" }
    # No -Force: a race creating this directory is a failure, never adoption.
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    $item = Assert-PlainPath $Path
    if (-not $item.PSIsContainer) { throw "Synthetic root is not a directory: $Path" }
}
function Write-SeedFile([string] $RootPath, [string] $Relative, [string] $Text) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[/\\])\.\.([/\\]|$)' -or $Relative.Contains(':')) { throw 'Invalid seed-relative path' }
    [void](Assert-PlainPath $RootPath)
    $path = Join-Path $RootPath $Relative
    $parent = Split-Path -Parent $path
    $part = $RootPath
    foreach ($segment in ([IO.Path]::GetRelativePath($RootPath,$parent) -split '[/\\]')) {
        if ($segment -eq '.') { continue }
        $part=Join-Path $part $segment
        if (-not (Test-Path -LiteralPath $part)) { New-Item -ItemType Directory -Path $part -ErrorAction Stop | Out-Null }
        if (-not (Assert-PlainPath $part).PSIsContainer) { throw 'Seed parent is not an ordinary directory' }
    }
    if (Test-Path -LiteralPath $path) { throw 'Seed file unexpectedly exists' }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Seed-Notebook {
    foreach ($path in $seedRoots.Values) { Create-AbsentDirectory $path; Write-SeedFile $path '.inkleet-msi-fixture' $report.synthetic.marker }
    $named = 'notebook/lc-1/.solutions/rust/11111111111111111111111111111111'
    Write-SeedFile $appData 'notebook/lc-1/solution.rs' ('// test-seeded default 解答' + "`n" + 'fn main() { println!("保留 42"); }' + "`n")
    Write-SeedFile $appData 'notebook/lc-1/notes.md' "# 测试笔记 🦀`n完整的笔记内容；并非旧版应用写入。`n"
    Write-SeedFile $appData 'notebook/lc-1/.solutions/rust/default.json' '{"id":"default","name":"默认解答"}'
    Write-SeedFile $appData "$named/name.json" '{"id":"11111111111111111111111111111111","name":"优化版"}'
    Write-SeedFile $appData "$named/solution.rs" ('// test-seeded named solution' + "`n" + 'fn main() { println!("{}", 42); }' + "`n")
    Write-SeedFile $appData 'notebook/lc-1/.inkleet-drafts/solution.rs.json' '{"version":1,"file":"solution.rs","text":"unsaved default 草稿","baseline":"saved fixture"}'
    Write-SeedFile $appData "$named/.inkleet-drafts/solution.rs.json" '{"version":1,"file":"solution.rs","text":"unsaved named 草稿","baseline":"named fixture"}'
    Write-SeedFile $appData "$named/.inkleet-recovery/conflict-fixture.json" '{"format":"inkleet-conflict-v1","file":"solution.rs","local":"local fixture","external":"external fixture","choice":"external"}'
    Write-SeedFile $appData 'settings.json' '{"fixture":"installer-only","note":"字节保留；不声称运行兼容"}'
    Write-SeedFile $appCache 'fixture-cache.json' '{"fixture":"no credentials or real user data"}'
}
function Seed-Snapshot {
    $files = [System.Collections.Generic.List[object]]::new()
    $directories = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $seedRoots.GetEnumerator()) {
        $pending = [System.Collections.Generic.Queue[string]]::new(); $pending.Enqueue($entry.Value)
        while ($pending.Count -gt 0) {
            $path = $pending.Dequeue(); $item = Assert-PlainPath $path
            if (-not $item.PSIsContainer) { throw 'Seed root/directory changed kind' }
            $relative = [IO.Path]::GetRelativePath($entry.Value, $path).Replace('\', '/')
            $directories.Add([ordered]@{root=$entry.Key; relative_path=$relative; owner_sid=(Owner-Sid $path)})
            if ($directories.Count -gt 100) { throw 'Unexpected synthetic directory growth' }
            foreach ($child in @(Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop | Sort-Object Name)) {
                $child = Assert-PlainPath $child.FullName
                if ($child.PSIsContainer) { $pending.Enqueue($child.FullName); continue }
                if ($child.Length -gt 4 * 1024 * 1024) { throw 'Unexpectedly large synthetic file' }
                $bytes = [IO.File]::ReadAllBytes($child.FullName)
                $files.Add([ordered]@{root=$entry.Key; relative_path=([IO.Path]::GetRelativePath($entry.Value, $child.FullName).Replace('\', '/')); bytes=$bytes.Length; sha256=([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()); owner_sid=(Owner-Sid $child.FullName)})
                if ($files.Count -gt 100 -or $directories.Count -gt 100) { throw 'Unexpected synthetic tree growth' }
            }
        }
    }
    return [ordered]@{files=@($files | Sort-Object root,relative_path); directories=@($directories | Sort-Object root,relative_path)}
}
function Assert-Preserved([string] $Stage) {
    $snapshot = Seed-Snapshot
    $boundary = [ordered]@{stage=$Stage; result='FAIL'; snapshot=$snapshot}
    $report.synthetic.boundaries.Add($boundary)
    if (($snapshot | ConvertTo-Json -Depth 10 -Compress) -cne ($report.synthetic.baseline | ConvertTo-Json -Depth 10 -Compress)) { throw "$Stage changed synthetic files, directories, bytes or ownership" }
    $boundary.result='PASS'
}
function Msi-Property($Database, [string] $Name) {
    $view = $Database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
    try { [void]$view.Execute(); $record=$view.Fetch(); if ($null -eq $record) { throw "Missing MSI property $Name" }; return [string]$record.StringData(1) }
    finally { [void]$view.Close() }
}
function Msi-Info([string] $Path) {
    $database=$installer.OpenDatabase($Path, 0)
    $view=$database.OpenView('SELECT `Directory` FROM `Directory` WHERE `Directory` = ''INSTALLDIR''')
    try { [void]$view.Execute(); if ($null -eq $view.Fetch()) { throw 'MSI has no explicit INSTALLDIR' } } finally { [void]$view.Close() }
    $info=[ordered]@{path=$Path; productCode=(Msi-Property $database 'ProductCode'); upgradeCode=(Msi-Property $database 'UpgradeCode'); version=(Msi-Property $database 'ProductVersion'); name=(Msi-Property $database 'ProductName'); bytes=(Get-Item -LiteralPath $Path).Length; sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
    $guid='^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$'
    if ($info.name -cne 'InkLeet' -or $info.productCode -notmatch $guid -or $info.upgradeCode -notmatch $guid) { throw 'Unexpected MSI identity' }
    return $info
}
function Read-MsiStringList($List) {
    if ($null -eq $List) { throw 'Missing MSI StringList' }
    $count=$List.GetType().InvokeMember('Count', 'GetProperty', $null, $List, @())
    if ($count -isnot [int] -or $count -lt 0 -or $count -gt 128) { throw 'Invalid MSI StringList count' }
    $items=[System.Collections.Generic.List[string]]::new()
    for ($index=0; $index -lt $count; $index++) {
        $value=$List.GetType().InvokeMember('Item', 'GetProperty', $null, $List, @($index))
        if ($value -isnot [string] -or $value -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$' -or $items.Contains($value)) { throw 'Invalid/duplicate related MSI product' }
        $items.Add($value)
    }
    return ,$items.ToArray()
}
function Product-State([string] $Code) { return [int]$installer.GetType().InvokeMember('ProductState', 'GetProperty', $null, $installer, @($Code)) }
function Related-Products {
    return ,(Read-MsiStringList ($installer.GetType().InvokeMember('RelatedProducts', 'GetProperty', $null, $installer, @($current.upgradeCode))))
}
function Assert-Registration([string] $Stage, [int] $CurrentState, [int] $LegacyState, [string[]] $Related) {
    $observed=Related-Products
    $record=[ordered]@{stage=$Stage; result='FAIL'; states=[ordered]@{current=(Product-State $current.productCode); legacy=(Product-State $legacy.productCode)}; expected_related=@($Related); related_product_codes=@($observed)}
    $report.registrations.Add($record)
    if ($record.states.current -ne $CurrentState -or $record.states.legacy -ne $LegacyState -or (($observed | Sort-Object) -join ',') -ine (($Related | Sort-Object) -join ',')) { throw "$Stage registration/related-products mismatch" }
    $record.result='PASS'
}
function Run-Msi([string] $Action, [string] $Package, [string] $Label) {
    if ($script:msiUncertain) { throw 'No MSI replay/action after uncertain outcome' }
    if ($Action -notin @('/i','/x') -or [string]::IsNullOrWhiteSpace($Package) -or $Package -match '["\x00\r\n]' -or $Label -notmatch '^[a-z0-9.-]+$') { throw 'Invalid bounded MSI operation arguments' }
    Assert-NoApplication
    $log=Join-Path $evidence "$Label-msi.log"
    $record=[ordered]@{action=$Action; label=$Label; package=$Package; log=$log; pid=$null; exit_code=$null; result='FAIL'; uncertain=$false}
    $report.msi_operations.Add($record)
    $arguments=@($Action, ('"' + $Package + '"'), '/qn', '/norestart', '/L*V', ('"' + $log + '"'))
    if ($Action -eq '/i') { $arguments+=('INSTALLDIR="' + $installDir + '"') }
    $knownExit=$false
    try {
        $process=Start-Process -FilePath (Join-Path $env:WINDIR 'System32/msiexec.exe') -ArgumentList $arguments -PassThru -ErrorAction Stop
        $record.pid=$process.Id
        if (-not $process.WaitForExit(180000)) { throw "$Label MSI timed out; no automatic replay" }
        $process.Refresh(); $record.exit_code=$process.ExitCode
        if ($null -eq $record.exit_code) { throw 'MSI exit code unavailable' }
        $knownExit=$true
        if ($record.exit_code -in @(1641,3010)) { $knownExit=$false; throw 'MSI requested/initiated restart; outcome not qualified' }
        if ($record.exit_code -ne 0) { throw "$Label MSI exit $($record.exit_code)" }
        Assert-NoApplication
        $record.result='PASS'
    } catch {
        $record.error=$_.Exception.Message
        if (-not $knownExit) { $script:msiUncertain=$true; $record.uncertain=$true }
        throw
    }
}
function Install-Owned($Info, [string] $Label) {
    if ($script:msiUncertain -or (Product-State $Info.productCode) -ne -1) { throw "Refusing non-absent product or uncertain state before $Label" }
    $ownedProducts[$Info.productCode]=$Info
    Run-Msi '/i' $Info.path $Label
}
function Cleanup-OwnedProducts([string] $Result) {
    if ($Result -eq 'PASS' -or $script:msiUncertain) { return }
    foreach ($info in $ownedProducts.Values) {
        if ($script:msiUncertain) { break }
        try { if ((Product-State $info.productCode) -eq 5) { Run-Msi '/x' $info.productCode ('failure-cleanup-' + $info.version) } }
        catch { $report.cleanup_errors.Add($_.Exception.Message); Write-Warning $_.Exception.Message }
    }
}
function Installed-Binary {
    $found=@(Get-ChildItem -LiteralPath $installDir -Recurse -Force -File -Filter 'inkleet.exe' -ErrorAction Stop)
    if ($found.Count -ne 1) { throw 'Expected exactly one installed InkLeet executable' }
    [void](Assert-PlainPath $found[0].FullName)
    return $found[0].FullName
}
function Assert-NoBinary {
    if (Test-Path -LiteralPath $installDir) {
        if (@(Get-ChildItem -LiteralPath $installDir -Recurse -Force -File -Filter 'inkleet.exe' -ErrorAction Stop).Count -ne 0) { throw 'Uninstall left an InkLeet executable' }
    }
}
function Assert-InstalledPayload([string] $Stage) {
    $installed=Installed-Binary; $payloadReport=Join-Path $evidence "$Stage-payload.json"
    & $node tests/windows-msi-payload.mjs $built $installed $payloadReport
    $exitCode=$LASTEXITCODE
    if (Test-Path -LiteralPath $payloadReport) { $report.payloads[$Stage]=Get-Content -Raw $payloadReport | ConvertFrom-Json }
    if ($exitCode -ne 0 -or -not $report.payloads.Contains($Stage) -or $report.payloads[$Stage].result -ne 'PASS') { throw "$Stage exact installed MSI payload failed" }
}
$current=$null; $legacy=$null
try {
    Assert-NoApplication
    foreach ($path in @($temporary,$appData,$appCache)) { if (Test-Path -LiteralPath $path) { throw "Refusing existing fixture location: $path" } }
    if ($appData -ieq $appCache) { throw 'Expected distinct app-data/cache roots' }
    $node=Resolve-InkLeetCiNode
    $built=(Resolve-Path 'src-tauri/target/x86_64-pc-windows-msvc/release/inkleet.exe').Path
    $packages=@(Get-ChildItem 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi' -Filter '*.msi' -File)
    if ($packages.Count -ne 1) { throw 'Expected exactly one current MSI' }
    $installer=New-Object -ComObject WindowsInstaller.Installer
    $current=Msi-Info $packages[0].FullName
    if ($current.version -cne $version -or (Product-State $current.productCode) -ne -1) { throw 'Current MSI version/absent-state mismatch' }
    $related=Related-Products
    $report.preflight=[ordered]@{states=[ordered]@{current=-1; legacy=$null}; related_product_codes=@($related); no_processes=$true; absent_paths=@($temporary,$appData,$appCache); current_user_sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}
    if ($related.Length -ne 0) { throw 'Refusing pre-existing related installed/advertised products' }
    $manifest=Get-Content -Raw 'releases/v0.1.1.json' | ConvertFrom-Json
    $priorName='InkLeet-0.1.1-preview-fbacb2041b83-windows-x64.msi'
    $priorHash='1246c47b6a814bb3c3d42ab4972c8ca6a52ecb3fd05d82dfd75000b6921f46e0'
    $priorSource='fbacb2041b83232a30a791965c58d93a7556a4ff'
    $assets=@($manifest.artifacts.windows.assets | Where-Object { $_.name -like '*.msi' })
    if ($manifest.repository -cne 'jacek4yang/inkleet' -or $manifest.tag -cne 'v0.1.1' -or $manifest.source_commit -cne $priorSource -or $assets.Count -ne 1 -or $assets[0].name -cne $priorName -or $assets[0].sha256 -cne $priorHash -or $assets[0].bytes -ne 6885376) { throw 'Unexpected public v0.1.1 MSI provenance' }
    Create-AbsentDirectory $temporary
    $priorPath=Join-Path $temporary $priorName
    $priorUrl="https://github.com/jacek4yang/inkleet/releases/download/v0.1.1/$priorName"
    Invoke-WebRequest -Uri $priorUrl -OutFile $priorPath
    if ((Get-Item -LiteralPath $priorPath).Length -ne 6885376 -or (Get-FileHash -LiteralPath $priorPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $priorHash) { throw 'Downloaded public MSI hash/size mismatch' }
    $legacy=Msi-Info $priorPath
    if ($legacy.version -cne '0.1.1' -or [version]$version -le [version]$legacy.version -or $legacy.upgradeCode -ine $current.upgradeCode -or $legacy.productCode -ieq $current.productCode -or (Product-State $legacy.productCode) -ne -1) { throw 'Incompatible MSI upgrade identity/state' }
    $report.preflight.states.legacy=-1
    $report.prior=[ordered]@{url=$priorUrl; sha256=$priorHash; bytes=6885376; source_commit=$priorSource; version='0.1.1'}
    $report.packages=[ordered]@{current=$current; legacy=$legacy}
    Seed-Notebook
    $report.synthetic.roots=@(foreach ($entry in $seedRoots.GetEnumerator()) { [ordered]@{name=$entry.Key; path=$entry.Value; owner_sid=(Owner-Sid $entry.Value)} })
    $report.synthetic.baseline=Seed-Snapshot
    if ($report.synthetic.baseline.files.Count -ne 12) { throw 'Incomplete synthetic seed set' }
    Install-Owned $current 'fresh-install'
    Assert-Registration 'fresh-install' 5 -1 @($current.productCode)
    Assert-InstalledPayload 'fresh'; Assert-Preserved 'fresh-install'; $report.stages.Add('fresh-install')
    Run-Msi '/x' $current.productCode 'fresh-uninstall'
    Assert-Registration 'fresh-uninstall' -1 -1 @(); Assert-NoBinary
    Assert-Preserved 'fresh-uninstall'; $report.stages.Add('fresh-uninstall')
    Install-Owned $legacy 'legacy-install'
    Assert-Registration 'legacy-install' -1 5 @($legacy.productCode); [void](Installed-Binary)
    Assert-Preserved 'legacy-install'; $report.stages.Add('legacy-install')
    Install-Owned $current 'major-upgrade'
    Assert-Registration 'major-upgrade' 5 -1 @($current.productCode)
    Assert-InstalledPayload 'upgraded'; Assert-Preserved 'major-upgrade'; $report.stages.Add('major-upgrade')
    Run-Msi '/x' $current.productCode 'upgraded-uninstall'
    Assert-Registration 'upgraded-uninstall' -1 -1 @(); Assert-NoBinary
    Assert-Preserved 'upgraded-uninstall'; $report.stages.Add('upgraded-uninstall')
    Assert-NoApplication
    $report.result='PASS'
} catch { $report.error=$_.Exception.Message; throw }
finally {
    # No fixture deletion or ACL changes. Only exact absent-state install attempts
    # are owned; an uncertain MSI outcome forbids further installer actions.
    Cleanup-OwnedProducts $report.result
    $report.msi_uncertain=$script:msiUncertain
    $report | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8NoBOM (Join-Path $evidence 'MSI_LIFECYCLE_RESULT.json')
}
if ($BuildInfoPath) {
    $buildInfo=Get-Content -Raw -LiteralPath $BuildInfoPath | ConvertFrom-Json
    if ($buildInfo.commit -cne $commit -or $buildInfo.version -cne $version -or $buildInfo.target -cne 'x86_64-pc-windows-msvc') { throw 'Cannot attach lifecycle result to mismatched build metadata' }
    $buildInfo | Add-Member -NotePropertyName msi_lifecycle_acceptance -NotePropertyValue $report -Force
    $buildInfo | ConvertTo-Json -Depth 24 | Set-Content -Encoding utf8NoBOM -LiteralPath $BuildInfoPath
    Copy-Item -LiteralPath (Join-Path $evidence 'MSI_LIFECYCLE_RESULT.json') -Destination (Join-Path (Split-Path -Parent $BuildInfoPath) 'MSI_LIFECYCLE_RESULT.json')
}
Write-Host 'PASS: installer-only MSI lifecycle and test-seeded byte preservation. Windows GUI/runtime/migration acceptance remains unverified.'
