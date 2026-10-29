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
foreach($file in @('windows-ci-host.ps1','test-windows-installed.ps1')){
 $tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "../scripts/$file"),[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|Out-String)}
}
Write-Host 'PASS: C# compile, normal-host pure token/argument guards and PowerShell syntax (not native token execution)'
