# Same-user least-privilege CI child, or read-only owned-process diagnostics.
param([Parameter(Mandatory=$true)][string]$Config, [int]$InspectPid=0, [int]$NodePid=0, [int]$TeardownPid=0, [string]$OwnedPids="", [int]$Port=0)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-ci-node.ps1')
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Disposable hosted Windows CI only' }
if (-not ('InkLeetCiToken' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'windows-ci-token.cs') }
$configValue=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($configValue.userSid -cne $current -or $configValue.harnessCommit -cne $env:GITHUB_SHA) { throw 'Unknown CI user/source identity' }
# The launching parent verifies the checkout. Read-only standard-child diagnostics
# use that exact configuration; they need no git configuration or ownership bypass.
if ($InspectPid -eq 0 -and $TeardownPid -eq 0 -and $configValue.harnessCommit -cne (git rev-parse HEAD).Trim()) {throw 'Launcher checkout/source identity mismatch'}
$root=(Get-Location).Path
function Owner-Proof([string]$Path) {
    $owner=(Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -cne $current) { throw "Synthetic path owner differs from current user: $Path ($owner)" }
    [ordered]@{path=$Path;owner_sid=$owner}
}
if ($TeardownPid -gt 0) {
    if ($InspectPid -ne 0 -or $NodePid -ne 0 -or $Port -lt 1 -or $Port -gt 65535) {throw 'Invalid owned teardown query'}
    if ($OwnedPids -notmatch '^\d+(,\d+){0,255}$') {throw 'Missing recorded owned process set'}
    $recorded=@($OwnedPids.Split(',') | ForEach-Object {[int]$_})
    if ($recorded -notcontains $TeardownPid -or @($recorded | Where-Object {$_ -le 0}).Count) {throw 'Invalid owned process set'}
    $remaining=@($recorded | ForEach-Object {Get-CimInstance Win32_Process -Filter "ProcessId=$_" -Property ProcessId})
    $listeners=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object {$_.LocalPort -eq $Port -and $_.State -eq 'Listen'})
    [ordered]@{result=$(if ($remaining.Count -eq 0 -and $listeners.Count -eq 0) {'PASS'} else {'FAIL'});app_pid=$TeardownPid;port=$Port;app_absent=(@($remaining | Where-Object {[int]$_.ProcessId -eq $TeardownPid}).Count -eq 0);owned_processes_absent=($remaining.Count -eq 0);owned_pids=$recorded;listener_absent=($listeners.Count -eq 0)} | ConvertTo-Json
    return
}
if ($InspectPid -gt 0) {
    if ($OwnedPids -ne '') {throw 'Unexpected owned PID input'}
    if ($NodePid -le 0 -or $Port -lt 1 -or $Port -gt 65535) { throw 'Invalid owned debug port' }
    $own=[InkLeetCiToken]::Inspect($PID); [InkLeetCiToken]::ValidateStandard($own,$current)
    $nodeToken=[InkLeetCiToken]::Inspect($NodePid);[InkLeetCiToken]::ValidateStandard($nodeToken,$current)
    $app=[InkLeetCiToken]::Inspect($InspectPid); [InkLeetCiToken]::ValidateStandard($app,$current)
    if ($nodeToken.session_id -ne $app.session_id -or $own.session_id -ne $app.session_id) {throw 'Owned process session changed'}
    $paths=@($configValue.appData,$configValue.appCache,$configValue.temporary,(Join-Path $configValue.temporary 'WebView2 synthetic profile'))
    $owners=@($paths | Select-Object -Unique | ForEach-Object { Owner-Proof $_ })
    # Read the process inventory, but emit only this recorded child and descendants.
    $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,SessionId,CreationDate); $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add($InspectPid)
    do { $added=$false; foreach($process in $all) {if($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) {$added=$true}} } while($added)
    $processes=@($all | Where-Object {$ids.Contains([int]$_.ProcessId)} | ForEach-Object {
        $details=Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ProcessId)" -ErrorAction Stop
        $version=$null; $imagePath=$null; $commandLine=$null
        if ($null -eq $details) {
            if ([int]$_.ProcessId -eq $InspectPid) {throw 'Owned application exited during diagnostics'}
            # A successful empty PID query confirms this short-lived descendant
            # exited. Preserve its snapshot ID/ancestry for the teardown union.
        } else {
            if ($details.ParentProcessId -ne $_.ParentProcessId -or $details.CreationDate -ne $_.CreationDate) {throw 'Owned process changed identity during diagnostics'}
            $imagePath=$details.ExecutablePath;$commandLine=$details.CommandLine
            if ($_.Name -eq 'msedgewebview2.exe' -and $imagePath) { $version=(Get-Item -LiteralPath $imagePath).VersionInfo.FileVersion }
        }
        [ordered]@{pid=[int]$_.ProcessId;parent_pid=[int]$_.ParentProcessId;session_id=[int]$_.SessionId;name=$_.Name;path=$imagePath;command_line=$commandLine;webview_file_version=$version;confirmed_exited=($null -eq $details)}
    })
    $rootRecord=@($processes | Where-Object {$_.pid -eq $InspectPid})
    if ($rootRecord.Count -ne 1 -or $rootRecord[0].parent_pid -ne $NodePid -or [IO.Path]::GetFullPath($rootRecord[0].path) -ine [IO.Path]::GetFullPath($configValue.binary)) {throw 'Owned application ancestry/path mismatch'}
    $nodeRecord=Get-CimInstance Win32_Process -Filter "ProcessId=$NodePid"
    if ([IO.Path]::GetFullPath($nodeRecord.ExecutablePath) -ine [IO.Path]::GetFullPath($configValue.nodeExecutable)) {throw 'Observed Node executable changed'}
    $liveIds=[Collections.Generic.HashSet[int]]::new(); foreach($process in $processes) {if(-not $process.confirmed_exited) {[void]$liveIds.Add([int]$process.pid)}}
    $listeners=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object {$_.LocalPort -eq $Port -and $_.State -eq 'Listen'} | ForEach-Object { [ordered]@{address=$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess;owned=$liveIds.Contains([int]$_.OwningProcess)} })
    [ordered]@{result='PASS';inspector_token=$own;node_token=$nodeToken;app_token=$app;owners=$owners;processes=$processes;listeners=$listeners} | ConvertTo-Json -Depth 12
    return
}
if ($InspectPid -ne 0 -or $NodePid -ne 0 -or $TeardownPid -ne 0 -or $OwnedPids -ne "" -or $Port -ne 0 -or $configValue.phase -notin @('prepare','fresh','legacy','upgraded')) {throw 'Invalid standard-host request'}
$node=Resolve-InkLeetCiNode
if ($configValue.nodeExecutable -isnot [string] -or $configValue.nodeExecutable -cne $node) {throw 'Configured Node must equal the single resolved executable path'}
$script=Join-Path $root $(if ($configValue.phase -eq 'prepare') {'tests/windows-installed-prepare.mjs'} else {'tests/windows-installed-ui.mjs'})
foreach($path in @($node,$script,$Config)) {if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {throw "Missing exact launcher input $path"}}
$recordPath=Join-Path $configValue.evidence ($configValue.phase + '-host.json')
$state=[ordered]@{result='FAIL';harnessCommit=$configValue.harnessCommit;phase=$configValue.phase;run=$null;scope='Same-user child token only. No credentials, account, UAC, registry, ACL, policy or application changes.'}
$checkpoint=[Action[InkLeetCiToken+RunResult]]{param($value) $state.run=$value; $state | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8NoBOM $recordPath}
try {
    $value=[InkLeetCiToken]::Run($node,$script,(Resolve-Path -LiteralPath $Config).Path,$root,360000,$checkpoint)
    if (-not $value.exited -or $value.exit_code -ne 0 -or $value.timed_out -or -not $value.job_handle_closed -or -not $value.job_tree_empty) {throw "Standard child did not complete normally: exit $($value.exit_code)"}
    $state.result='PASS'
} catch {
    $state.error=$_.Exception.Message
    $state.error_chain=@();$cause=$_.Exception
    for($depth=0;$null -ne $cause -and $depth -lt 8;$depth++) {
        $state.error_chain+=@([ordered]@{type=$cause.GetType().FullName;message=$cause.Message;hresult=$cause.HResult;native_error_code=$(if($cause -is [ComponentModel.Win32Exception]) {$cause.NativeErrorCode} else {$null})})
        $cause=$cause.InnerException
    }
    throw
}
finally {$state | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8NoBOM $recordPath}
[pscustomobject]$state
