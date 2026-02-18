$ErrorActionPreference = "Stop"

param(
  [Parameter(Mandatory=$true)][string]$Note,
  [ValidateSet("patch","minor","major")][string]$Bump = "patch"
)

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$ver = (Get-Content VERSION -Raw).Trim()
$parts = $ver.Split(".")
if ($parts.Length -ne 3) { throw "VERSION must be x.y.z" }
[int]$maj = $parts[0]
[int]$min = $parts[1]
[int]$pat = $parts[2]

switch ($Bump) {
  "major" { $maj++; $min = 0; $pat = 0 }
  "minor" { $min++; $pat = 0 }
  "patch" { $pat++ }
}

$newVer = "$maj.$min.$pat"
Set-Content -Path VERSION -Value "$newVer`n" -NoNewline

$today = Get-Date -Format "yyyy-MM-dd"
$old = Get-Content CHANGELOG.md -Raw
$header = @"
# Changelog

All notable changes to `KaraokePhotoBooth` are tracked here.

## [$newVer] - $today
- $Note

"@
$tail = ($old -split "`r?`n",6)[5]
Set-Content -Path CHANGELOG.md -Value ($header + $tail)

$top = (git rev-parse --show-toplevel).Trim()
$rel = [System.IO.Path]::GetRelativePath($top, $RootDir)

git -C $top add -- $rel
git -C $top commit -m "KaraokePhotoBooth v$newVer: $Note"

Write-Host "Committed v$newVer"
if ($env:NO_PUSH -eq "1") {
  Write-Host "Auto-push skipped (NO_PUSH=1)."
  Write-Host "Push with: git -C `"$top`" push"
} else {
  git -C $top push
  Write-Host "Pushed v$newVer"
}
