<#
  目标库存测算小工具：按容器规范构建离线 zip
  用法：  .\build-minitool.ps1
  产物：  minitool\dist\                       仅含发布文件（index.html / styles.css / app.js）
          minitool\<名称>.zip                 index.html 位于 zip 根目录，解压不多一层文件夹
#>
param(
  [string]$OutName = "目标库存测算小工具"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$files = @("index.html", "styles.css", "app.js")
$buildRoot = Join-Path $PSScriptRoot "minitool"
$dist = Join-Path $buildRoot "dist"
$zip = Join-Path $buildRoot ($OutName + ".zip")

# 每次重建，避免残留旧文件被打进包
if (Test-Path -LiteralPath $buildRoot) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

foreach ($f in $files) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $dist
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
# CreateFromDirectory 压缩的是目录内容，index.html 因此直接位于 zip 根目录
[System.IO.Compression.ZipFile]::CreateFromDirectory($dist, $zip)

Write-Host ""
Write-Host "构建完成：$zip" -ForegroundColor Green
Get-ChildItem -LiteralPath $dist | Select-Object Name, Length | Format-Table -AutoSize
