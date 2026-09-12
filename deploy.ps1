<#
  一键发布脚本
  用法：  .\deploy.ps1 "这次改了什么"
  作用：  把本目录的改动提交并推送到 GitHub；
          推送成功后 GitHub Pages 与 Cloudflare Pages 会自动重新部署。
#>
param(
  [string]$Message = "更新目标库存测算工具"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (git remote)) {
  throw "还没有配置远程仓库，请先执行：git remote add origin <仓库地址>"
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
  Write-Host "当前分支为 $branch，切换到 main。" -ForegroundColor Yellow
  git checkout main
}

$changed = git status --porcelain
if (-not $changed) {
  Write-Host "没有检测到改动，跳过提交。" -ForegroundColor Yellow
} else {
  git add -A
  git -c i18n.commitEncoding=UTF-8 commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw "git commit 失败" }
}

git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push 失败：请检查网络或 GitHub 登录状态" }

Write-Host ""
Write-Host "推送完成。GitHub Pages 约 1-2 分钟、Cloudflare Pages 约 30 秒后自动更新。" -ForegroundColor Green
