$ErrorActionPreference = "Stop"

param(
  [Parameter(Mandatory=$true)][string]$Note,
  [ValidateSet("patch","major")][string]$Bump = "patch"
)

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$ver = (Get-Content VERSION -Raw).Trim()
$m = [regex]::Match($ver, '^(\d+)\.(\d{2})$')
if ($m.Success) {
  [int]$maj = $m.Groups[1].Value
  [int]$cnt = $m.Groups[2].Value
} elseif ($ver -match '^\d+\.\d+\.\d+$') {
  # Legacy semver migration fallback.
  [int]$maj = 1
  [int]$cnt = 1
} else {
  throw "VERSION must be X.YY (example: 1.01)"
}

switch ($Bump) {
  "major" { $maj++; $cnt = 1 }
  "patch" {
    $cnt++
    if ($cnt -gt 99) {
      $maj++
      $cnt = 1
    }
  }
}

$newVer = "{0}.{1:D2}" -f $maj, $cnt
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
