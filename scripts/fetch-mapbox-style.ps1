#!/usr/bin/env pwsh
# Requires a Mapbox access token with styles:read scope for the style owner.
# Usage: .\scripts\fetch-mapbox-style.ps1 -Token <token>
# Reads VITE_MAPBOX_STYLE_URL from ..\.env.local if present, otherwise falls back to default.

param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$EnvFile = "$PSScriptRoot\..\.env.local"
)

$ErrorActionPreference = 'Stop'

$styleUrl = 'mapbox://styles/oies0/cmqw4e7m7001101qo7kmvdwry'

if (Test-Path -LiteralPath $EnvFile) {
  $envLine = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^VITE_MAPBOX_STYLE_URL=' } | Select-Object -First 1
  if ($envLine) {
    $styleUrl = ($envLine -split '=', 2)[1].Trim().Trim("'`"")
  }
}

if (-not $styleUrl.StartsWith('mapbox://styles/')) {
  throw "Invalid Mapbox style URL: $styleUrl"
}

$parts = $styleUrl -replace '^mapbox://styles/', '' -split '/'
$owner = $parts[0]
$styleId = $parts[1]

$apiUrl = "https://api.mapbox.com/styles/v1/$owner/$styleId`?access_token=$Token"

$outputDir = "$PSScriptRoot\..\output"
if (-not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$outputFile = "$outputDir\mapbox-style-$styleId.json"

Invoke-WebRequest -Uri $apiUrl -OutFile $outputFile

Write-Host "Saved style JSON to: $outputFile"
