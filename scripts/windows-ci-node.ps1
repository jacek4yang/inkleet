# Resolve exactly the first native application in PATH order. Get-Command can
# return multiple ApplicationInfo objects; never coerce their paths to a string.
function Resolve-InkLeetCiNode {
    $applications=@(Get-Command node -CommandType Application -ErrorAction Stop)
    if ($applications.Count -eq 0) {throw 'No native Node application found'}
    $path=$applications[0].Source
    if ($path -isnot [string] -or [string]::IsNullOrWhiteSpace($path) -or -not [IO.Path]::IsPathFullyQualified($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'First Node application is not one fully qualified existing file'
    }
    return [IO.Path]::GetFullPath($path)
}
