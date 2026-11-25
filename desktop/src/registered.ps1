$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$packages = @{}
if ($env:POLAR_QUERY -eq 'games') {
    Get-AppxPackage | ForEach-Object { $packages[$_.PackageFamilyName] = $_.InstallLocation }
}
$apps = @(Get-StartApps | ForEach-Object {
    $id = [string]$_.AppID
    $root = ''
    if ($env:POLAR_QUERY -eq 'games') {
        $family = $id.Split('!')[0]
        if (!$packages.ContainsKey($family) -or !$packages[$family]) { return }
        $root = $packages[$family]
    }
    [pscustomobject]@{ id=$id; name=[string]$_.Name; root=[string]$root }
})
ConvertTo-Json -InputObject $apps -Compress
