# Cross-platform production-function tests. Mocked MSI/process/owner interfaces
# and real temporary seed files are NOT Windows installer or runtime acceptance.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$tokens=$null; $errors=$null
$source=Join-Path $PSScriptRoot '../scripts/test-windows-msi-lifecycle.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$names=@('Assert-NoApplication','Assert-PlainPath','Create-AbsentDirectory','Write-SeedFile','Seed-Notebook','Seed-Snapshot','Assert-Preserved','Read-MsiStringList','Assert-Registration','Run-Msi','Install-Owned','Cleanup-OwnedProducts')
foreach ($name in $names) {
    $found=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
    if ($found.Count -ne 1) { throw "Missing exact production function $name" }
    . ([scriptblock]::Create($found[0].Extent.Text))
}
function Assert($Condition,[string] $Message) { if (-not $Condition) { throw $Message } }
function Rejects([scriptblock] $Action,[string] $Message) {
    $rejected=$false; try { & $Action | Out-Null } catch { $rejected=$true }
    Assert $rejected $Message
}
$raw=Get-Content -Raw $source
Assert (-not ($raw -match 'Standard-Node|Ui-Probe|windows-ci-host|windows-installed-ui|Set-Acl|Set-ExecutionPolicy|Set-LocalUser|New-LocalUser|Set-ItemProperty')) 'Lifecycle script cannot invoke app/token/security mutation helpers'
Assert ($raw.Contains("scope='installer-only-seeded-data'") -and $raw.Contains("origin='test-seeded-not-app-authored'")) 'Installer-only scope must be explicit'
Assert (-not $raw.Contains('installed_msi_acceptance')) 'Never emit the historical GUI acceptance field'
Add-Type -TypeDefinition @'
public sealed class LifecycleStringList {
    private readonly string[] values;
    public LifecycleStringList(string[] values) { this.values=values; }
    public int Count { get { return values.Length; } }
    public string this[int index] { get { return values[index]; } }
}
public sealed class LifecycleProcess {
    public int Id { get { return 12345; } }
    public int ExitCode { get; set; }
    public string Mode { get; set; }
    public bool WaitForExit(int milliseconds) {
        if(milliseconds!=180000) throw new System.Exception("Unexpected timeout");
        if(Mode=="wait-throw") throw new System.Exception("Fixture wait error");
        return Mode!="timeout";
    }
    public void Refresh() { if(Mode=="refresh-throw") throw new System.Exception("Fixture refresh error"); }
}
'@
$codeA='{11111111-1111-1111-1111-111111111111}'; $codeB='{22222222-2222-2222-2222-222222222222}'
$empty=Read-MsiStringList ([LifecycleStringList]::new([string[]]@()))
Assert ($empty -is [string[]] -and $empty.Length -eq 0) 'Empty MSI StringList stays typed and empty'
$one=Read-MsiStringList ([LifecycleStringList]::new([string[]]@($codeA)))
Assert ($one -is [string[]] -and $one.Length -eq 1 -and $one[0] -ceq $codeA) 'Advertised singleton is not lost'
$two=Read-MsiStringList ([LifecycleStringList]::new([string[]]@($codeA,$codeB)))
Assert ($two.Length -eq 2) 'Every related product is retained'
Rejects { Read-MsiStringList ([LifecycleStringList]::new([string[]]@('invalid'))) } 'Malformed product must fail'
Rejects { Read-MsiStringList ([LifecycleStringList]::new([string[]]@($codeA,$codeA))) } 'Duplicate product must fail'
Rejects { Read-MsiStringList $null } 'Missing StringList must fail'

$fixture=Join-Path ([IO.Path]::GetTempPath()) ('inkleet-msi-unit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$oldWindir=$env:WINDIR
try {
    $env:WINDIR=$fixture
    $evidence=$fixture; $installDir=Join-Path $fixture 'install'
    $report=[ordered]@{application_launched=$false; msi_operations=[System.Collections.Generic.List[object]]::new(); cleanup_errors=[System.Collections.Generic.List[string]]::new(); registrations=[System.Collections.Generic.List[object]]::new()}
    # The exact process query fails closed; a query error is not an empty result.
    $script:processQueryMode='empty'
    function Get-Process {
        param($ErrorAction)
        if ($script:processQueryMode -eq 'error') { throw 'Fixture process query error' }
        if ($script:processQueryMode -eq 'app') { [pscustomobject]@{ProcessName='InkLeet'} }
    }
    Assert-NoApplication
    $script:processQueryMode='error'; Rejects { Assert-NoApplication } 'Process-query failure cannot pass'
    $script:processQueryMode='app'; Rejects { Assert-NoApplication } 'Running InkLeet must be refused'
    Assert $report.application_launched 'Detected app must be explicit in report'
    $script:processQueryMode='empty'; $report.application_launched=$false
    $script:startCalls=[System.Collections.Generic.List[object]]::new()
    $script:processMode='normal'; $script:exitCode=0; $script:msiUncertain=$false
    function Start-Process {
        param($FilePath,$ArgumentList,[switch]$PassThru,$ErrorAction)
        $script:startCalls.Add([ordered]@{file=$FilePath; arguments=$ArgumentList})
        if ($script:processMode -eq 'start-throw') { throw 'Fixture start error' }
        $p=[LifecycleProcess]::new(); $p.Mode=$script:processMode; $p.ExitCode=$script:exitCode; return $p
    }
    Run-Msi '/i' 'current.msi' 'fresh-install'
    Assert ($report.msi_operations.Count -eq 1 -and $report.msi_operations[0].result -eq 'PASS' -and $report.msi_operations[0].pid -eq 12345 -and $report.msi_operations[0].exit_code -eq 0 -and -not $report.msi_operations[0].uncertain) 'Completed operation retains exact PID/exit evidence'
    Assert ($script:startCalls[0].file -eq (Join-Path $fixture 'System32/msiexec.exe') -and $script:startCalls[0].arguments -contains '/qn' -and $script:startCalls[0].arguments -contains '/norestart' -and $script:startCalls[0].arguments -contains ('INSTALLDIR="' + $installDir + '"')) 'Only ordinary quiet no-restart MSI is invoked'
    foreach ($mode in @('start-throw','wait-throw','timeout','refresh-throw')) {
        $script:processMode=$mode; $script:msiUncertain=$false
        Rejects { Run-Msi '/i' 'current.msi' $mode } "$mode must fail"
        Assert ($script:msiUncertain -and $report.msi_operations[-1].uncertain -and $report.msi_operations[-1].result -eq 'FAIL') "$mode must latch uncertainty"
        $before=$script:startCalls.Count; Rejects { Run-Msi '/x' $codeA 'forbidden-replay' } 'Uncertain outcome must forbid next MSI action'
        Assert ($script:startCalls.Count -eq $before) 'No new process starts after uncertainty'
    }
    $script:processMode='normal'
    foreach ($exit in @(1641,3010)) {
        $script:exitCode=$exit; $script:msiUncertain=$false
        Rejects { Run-Msi '/i' 'current.msi' 'restart-required' } 'Restart-required is not PASS'
        Assert ($script:msiUncertain -and $report.msi_operations[-1].exit_code -eq $exit) 'Restart-required latches uncertainty with actual code'
    }
    $script:exitCode=1603; $script:msiUncertain=$false
    Rejects { Run-Msi '/i' 'current.msi' 'known-failure' } 'Known failed install must fail'
    Assert (-not $script:msiUncertain) 'Known completed 1603 stays distinguishable from unknown outcome'
    $script:exitCode=0
    $states=@{}; $relatedCodes=[string[]]@(); $ownedProducts=[ordered]@{}
    function Product-State([string]$Code) { if ($states.ContainsKey($Code)) { return $states[$Code] }; return -1 }
    function Related-Products { return ,$relatedCodes }
    $current=@{productCode=$codeA;path='current.msi';version='0.1.2'}
    $legacy=@{productCode=$codeB;path='legacy.msi';version='0.1.1'}
    foreach ($state in @(0,1,2,5)) {
        $states[$codeA]=$state; $before=$script:startCalls.Count
        Rejects { Install-Owned $current 'preexisting' } 'All non-unknown states, including advertised, must be refused'
        Assert ($ownedProducts.Count -eq 0 -and $script:startCalls.Count -eq $before) 'Inspected non-absent product is never owned/mutated'
    }
    $states[$codeA]=-1; Install-Owned $current 'owned-install'
    Assert ($ownedProducts.Count -eq 1 -and $ownedProducts.Contains($codeA)) 'Exact absent initiated install becomes owned'
    $states[$codeA]=5; $relatedCodes=[string[]]@($codeA)
    Assert-Registration 'fresh-install' 5 -1 @($codeA)
    Assert ($report.registrations[-1].result -eq 'PASS') 'Exact observed registration is retained'
    $states[$codeB]=1; Rejects { Assert-Registration 'bad-removed' 5 -1 @($codeA) } 'Advertised removed product cannot masquerade as absent'
    $states[$codeB]=-1; $relatedCodes=[string[]]@($codeA,$codeB)
    Rejects { Assert-Registration 'extra-related' 5 -1 @($codeA) } 'Extra related registration cannot pass'
    $before=$script:startCalls.Count; Cleanup-OwnedProducts 'PASS'
    Assert ($script:startCalls.Count -eq $before) 'No failure cleanup after PASS'
    Cleanup-OwnedProducts 'FAIL'
    Assert ($script:startCalls.Count -eq $before+1 -and $report.msi_operations[-1].package -eq $codeA -and $report.msi_operations[-1].action -eq '/x') 'Known failure cleanup touches only owned installed product'
    $ownedProducts[$codeB]=$legacy; $states[$codeB]=5; $script:processMode='timeout'
    $before=$script:startCalls.Count; Cleanup-OwnedProducts 'FAIL'
    Assert ($script:startCalls.Count -eq $before+1 -and $script:msiUncertain -and $report.cleanup_errors.Count -eq 1) 'Cleanup timeout blocks all remaining owned products'
    $before=$script:startCalls.Count; Cleanup-OwnedProducts 'FAIL'
    Assert ($script:startCalls.Count -eq $before) 'Already uncertain cleanup performs no operation'

    # Real seed files and exact recursive snapshot equality, with only Windows
    # owner-SID lookup mocked. No MSI/application is used for these assertions.
    function Owner-Sid([string] $Path) { return 'S-1-5-21-1-2-3-1001' }
    $appData=Join-Path $fixture 'appData'; $appCache=Join-Path $fixture 'appCache'
    $seedRoots=[ordered]@{appData=$appData;appCache=$appCache}
    $report.synthetic=[ordered]@{marker='unit-test-marker';baseline=$null;boundaries=[System.Collections.Generic.List[object]]::new()}
    Seed-Notebook; $report.synthetic.baseline=Seed-Snapshot
    Assert ($report.synthetic.baseline.files.Count -eq 12) 'Complete seed file set includes hidden metadata/drafts/recovery and markers'
    $sourcePath=Join-Path $appData 'notebook/lc-1/solution.rs'
    $expected=('// test-seeded default 解答' + "`n" + 'fn main() { println!("保留 42"); }' + "`n")
    Assert ([IO.File]::ReadAllText($sourcePath) -ceq $expected) 'Seed source has exact intended quotes, Unicode and complete content'
    Assert-Preserved 'fresh-install'
    Rejects { Seed-Notebook } 'Existing fixture directories cannot be adopted or overwritten'
    [IO.File]::WriteAllText($sourcePath,$expected.Replace('42','43'))
    Rejects { Assert-Preserved 'changed-byte' } 'Same-length byte change must fail'
    [IO.File]::WriteAllText($sourcePath,$expected,[Text.UTF8Encoding]::new($false))
    $extra=Join-Path $appData '.unexpected'; [IO.File]::WriteAllText($extra,'extra')
    Rejects { Assert-Preserved 'extra-hidden-file' } 'New hidden file must fail'
    Remove-Item -LiteralPath $extra
    $emptyDir=Join-Path $appData '.empty-added'; New-Item -ItemType Directory $emptyDir | Out-Null
    Rejects { Assert-Preserved 'extra-empty-directory' } 'New empty directory must fail'
    Remove-Item -LiteralPath $emptyDir
    $marker=Join-Path $appCache '.inkleet-msi-fixture'; Remove-Item -LiteralPath $marker
    Rejects { Assert-Preserved 'missing-marker' } 'Removing marker must fail'
    Write-SeedFile $appCache '.inkleet-msi-fixture' 'unit-test-marker'
    Assert-Preserved 'restored-identical-fixture'
    for ($i=0;$i -lt 101;$i++) { New-Item -ItemType Directory (Join-Path $appCache ('empty-' + $i)) | Out-Null }
    Rejects { Seed-Snapshot } 'Empty-directory-only tree growth must be bounded'
    # The actual reparse predicate is exercised without requiring symlink privilege.
    function Get-Item { param($LiteralPath,[switch]$Force,$ErrorAction); return [pscustomobject]@{Attributes=[IO.FileAttributes]::ReparsePoint;PSIsContainer=$true} }
    Rejects { Assert-PlainPath 'fixture-reparse-path' } 'Reparse paths cannot be traversed'
    Remove-Item Function:Get-Item
    Write-Host 'PASS: production MSI safety/control-flow and real seed byte/snapshot tests (mocked MSI, not installer/runtime acceptance)'
} finally {
    $env:WINDIR=$oldWindir
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
