# Compile and pure acceptance-contract tests. No Windows token API is run here.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if (-not ('InkLeetCiToken' -as [type])) {Add-Type -Path (Join-Path $PSScriptRoot '../scripts/windows-ci-token.cs')}
function Fixture {
 $p=[InkLeetCiToken+Proof]::new();$p.user_sid='S-1-5-21-1-2-3-1001';$p.owner_sid=$p.user_sid;$p.integrity_rid=8192;$p.enabled_privileges=@('SeChangeNotifyPrivilege');$p.session_id=1;return $p
}
$valid=Fixture;[InkLeetCiToken]::ValidateStandard($valid,$valid.user_sid)
foreach($change in @(
 {param($p)$p.user_sid='S-1-5-18'}, {param($p)$p.owner_sid='S-1-5-32-544'}, {param($p)$p.integrity_rid=12288},
 {param($p)$p.integrity_rid=4096}, {param($p)$p.elevated=$true}, {param($p)$p.admin_enabled=$true},
 {param($p)$p.sandbox_inert=$true}, {param($p)$p.enabled_privileges=@('SeDebugPrivilege')}, {param($p)$p.enabled_privileges=$null}
)) {
 $p=Fixture;& $change $p;$failed=$false
 try {[InkLeetCiToken]::ValidateStandard($p,$valid.user_sid)}catch{$failed=$true}
 if(-not $failed){throw 'Unsafe token accepted by pure guard'}
}
$command=[InkLeetCiToken]::CommandLine('C:\Program Files\node.exe','D:\owned space\probe.mjs','D:\owned space\config.json')
if($command -cne '"C:\Program Files\node.exe" "D:\owned space\probe.mjs" "D:\owned space\config.json"'){throw 'Explicit quoted command mismatch'}
foreach($argument in @('','bad"quote',"bad`nline",'trailing\')){
 $failed=$false;try{[InkLeetCiToken]::CommandLine($argument,'script','config')|Out-Null}catch{$failed=$true};if(-not $failed){throw 'Unsafe launcher argument accepted'}
}
foreach($file in @('windows-ci-host.ps1','test-windows-installed.ps1','windows-ci-node.ps1')){
 $tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "../scripts/$file"),[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|Out-String)}
}
# Resolve the production helper against an ordered two-application fixture.
# Only Get-Command is mocked; path validation uses actual temporary files.
& {
 . (Join-Path $PSScriptRoot '../scripts/windows-ci-node.ps1')
 function Get-Command {param($Name,$CommandType,$ErrorAction) return $script:nodeCandidates}
 $temporary=Join-Path ([IO.Path]::GetTempPath()) ('inkleet-node-path-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $temporary | Out-Null
 try {
  $first=Join-Path $temporary 'first Node.exe';$second=Join-Path $temporary 'second Node.exe'
  New-Item -ItemType File -Path $first,$second | Out-Null
  $script:nodeCandidates=@([pscustomobject]@{Source=$first},[pscustomobject]@{Source=$second})
  $resolved=Resolve-InkLeetCiNode
  if($resolved -isnot [string] -or $resolved -cne $first -or $resolved.Contains($second)){throw 'Node application paths were concatenated or PATH precedence changed'}
  foreach($bad in @('', 'relative.exe', $temporary, (Join-Path $temporary 'missing.exe'), @($first,$second), $null)) {
   $script:nodeCandidates=@([pscustomobject]@{Source=$bad},[pscustomobject]@{Source=$second})
   $failed=$false;try{Resolve-InkLeetCiNode | Out-Null}catch{$failed=$true};if(-not $failed){throw 'Invalid first Node path accepted or silently skipped'}
  }
  $script:nodeCandidates=@();$failed=$false;try{Resolve-InkLeetCiNode | Out-Null}catch{$failed=$true};if(-not $failed){throw 'Missing Node accepted'}
 } finally {Remove-Item -LiteralPath $temporary -Recurse -Force;Remove-Variable nodeCandidates -Scope Script}
}
# Execute the actual catch body with a synthetic nested Win32 error. This proves
# wrapper messages cannot hide the native code; it does not call a native API.
$tokens=$null;$errors=$null
$hostAst=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-ci-host.ps1'),[ref]$tokens,[ref]$errors)
$captures=@($hostAst.FindAll({param($node)$node -is [System.Management.Automation.Language.CatchClauseAst] -and $node.Extent.Text.Contains('$state.error_chain')},$true))
if($captures.Count -ne 1){throw 'Expected one native diagnostic catch body'}
$capture=[scriptblock]::Create(($captures[0].Body.Statements | ForEach-Object {$_.Extent.Text}) -join "`n")
$state=[ordered]@{};$rethrown=$false
try {try {throw [Exception]::new('synthetic wrapper',[ComponentModel.Win32Exception]::new(1314,'synthetic native failure'))} catch {& $capture}} catch {$rethrown=$true}
if(-not $rethrown -or $state.error_chain.Count -gt 8 -or @($state.error_chain | Where-Object {$_.native_error_code -eq 1314}).Count -ne 1){throw 'Native failure diagnostics were lost or error swallowed'}
Write-Host 'PASS: C# compile, normal-host pure guards, scalar Node resolution, nested native error capture and PowerShell syntax (not native token execution)'
