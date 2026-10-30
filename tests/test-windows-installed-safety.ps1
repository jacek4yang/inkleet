# Cross-platform control-flow tests only. These mocks are NOT Windows MSI/UI proof.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/test-windows-installed.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Read-MsiStringList','Install-Owned','Cleanup-OwnedProducts')) {
    $found=@($ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
    if ($found.Count -ne 1) { throw "Missing exact implementation function $name" }
    . ([scriptblock]::Create($found[0].Extent.Text))
}
function Assert($Condition,[string] $Message) { if (-not $Condition) { throw $Message } }
# Exercise the exact IDispatch property names through .NET reflection; this is
# a reader contract test, not a claim that COM/MSI ran on Linux.
Add-Type -TypeDefinition @'
public sealed class MsiStringListFixture {
    private readonly string[] values;
    public MsiStringListFixture(string[] values) { this.values = values; }
    public int Count { get { return this.values.Length; } }
    public string this[int index] { get { return this.values[index]; } }
}
'@
$empty=Read-MsiStringList ([MsiStringListFixture]::new([string[]]@()))
Assert ($empty -is [string[]] -and $empty.Length -eq 0) 'Empty StringList must stay an empty typed array, not scalar wrapper Count'
$codeA='{11111111-1111-1111-1111-111111111111}'; $codeB='{22222222-2222-2222-2222-222222222222}'
$single=Read-MsiStringList ([MsiStringListFixture]::new([string[]]@($codeA)))
Assert ($single -is [string[]] -and $single.Length -eq 1 -and $single[0] -eq $codeA) 'Singleton related product must remain detectable'
$multiple=Read-MsiStringList ([MsiStringListFixture]::new([string[]]@($codeA,$codeB)))
Assert ($multiple.Length -eq 2 -and $multiple[1] -eq $codeB) 'Every related product must be retained'
$rejected=$false
try { Read-MsiStringList ([MsiStringListFixture]::new([string[]]@('not-a-product'))) | Out-Null } catch { $rejected=$true }
Assert $rejected 'Malformed related product must fail closed'
$rejected=$false
try { Read-MsiStringList ([MsiStringListFixture]::new([string[]]@('{' + ('-' * 36) + '}'))) | Out-Null } catch { $rejected=$true }
Assert $rejected 'Right-length but malformed GUID shape must fail closed'
$ownedProducts=[ordered]@{}; $script:msiUncertain=$false
$report=@{cleanup_errors=[System.Collections.Generic.List[string]]::new()}
$calls=[System.Collections.Generic.List[string]]::new(); $installed=@{}
$script:failInstall=$false; $script:uncertainCleanup=$false
function Product-Installed([string] $Code) { return $installed.ContainsKey($Code) }
function Run-Msi([string] $Action,[string] $Package,[string] $Label) {
    $calls.Add("$Action $Package $Label")
    if ($Action -eq '/i' -and $script:failInstall) { throw 'Fixture install error' }
    if ($Action -eq '/x' -and $script:uncertainCleanup) { $script:msiUncertain=$true; throw 'Fixture uncertain MSI timeout' }
}
# Merely inspecting existing products before refusing preflight grants no cleanup.
$current=@{productCode='preexisting';path='prior.msi';version='0.1.1'}; $legacy=$current
$installed.preexisting=$true
Cleanup-OwnedProducts 'FAIL'
Assert ($calls.Count -eq 0) 'Pre-existing product must never be uninstalled'
$rejected=$false
try { Install-Owned $current 'refused' } catch { $rejected=$true }
Assert ($rejected -and $ownedProducts.Count -eq 0 -and $calls.Count -eq 0) 'Existing install must fail before ownership or mutation'
# A newly initiated, failed install can require cleanup, but only its exact code.
$new=@{productCode='owned';path='new.msi';version='0.1.2'}; $script:failInstall=$true
try { Install-Owned $new 'fixture' } catch {}
Assert ($ownedProducts.Count -eq 1 -and $ownedProducts.Contains('owned')) 'Absent install attempt must be tracked'
$installed.owned=$true; Cleanup-OwnedProducts 'FAIL'
Assert ($calls.Count -eq 2 -and $calls[1] -eq '/x owned failure-cleanup-0.1.2') 'Cleanup must target only initiated product'
# PASS and uncertain states cannot trigger cleanup, even with owned products.
$calls.Clear(); Cleanup-OwnedProducts 'PASS'; $script:msiUncertain=$true; Cleanup-OwnedProducts 'FAIL'
Assert ($calls.Count -eq 0) 'PASS or uncertain MSI must not be uninstalled by failure handler'
# A cleanup timeout itself also prevents any further installer operation.
$script:msiUncertain=$false; $script:uncertainCleanup=$true
$ownedProducts.second=@{productCode='second';path='second.msi';version='0.1.3'}; $installed.second=$true
Cleanup-OwnedProducts 'FAIL'
Assert ($calls.Count -eq 1 -and $script:msiUncertain -and $report.cleanup_errors.Count -eq 1) 'Uncertain cleanup must stop the remaining loop'
Write-Host 'PASS: MSI test ownership, refused preflight, failure and uncertain-cleanup control flow (mocked, not installer acceptance)'
