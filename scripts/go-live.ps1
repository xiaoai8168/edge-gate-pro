param(
  [switch]$SkipCloudflare,
  [switch]$SkipGitHub
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$NpmExe = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpmExe) { $NpmExe = "C:\Program Files\nodejs\npm.cmd" }
$NpxExe = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $NpxExe) { $NpxExe = "C:\Program Files\nodejs\npx.cmd" }
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $NpmExe) -or -not (Test-Path $NodeExe)) { throw "Node.js 22+ is required" }
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  throw "请先设置环境变量 CLOUDFLARE_ACCOUNT_ID"
}

Push-Location $Root
try {
  Write-Host "[1/4] 安装部署工具"
  & $NpmExe install --prefix scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  if (-not $SkipCloudflare) {
    if (-not $env:CLOUDFLARE_API_TOKEN) {
      Write-Host "[2/4] 未检测到 API Token，启动 Wrangler OAuth 登录"
      & $NpxExe --yes wrangler@4 login
      if ($LASTEXITCODE -ne 0) { throw "Wrangler login failed" }
    } else {
      Write-Host "[2/4] 使用最小权限 API Token 部署 Cloudflare"
    }
    & $NodeExe scripts/deploy-cloudflare.mjs
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare deployment failed" }
  } else {
    Write-Host "[2/4] 已跳过 Cloudflare"
  }

  if (-not $SkipGitHub) {
    if (-not ($env:GH_TOKEN -or $env:GITHUB_TOKEN)) {
      throw "请设置 GH_TOKEN（Fine-grained PAT）后再执行 GitHub 发布步骤"
    }
    Write-Host "[3/4] 创建/更新 GitHub 仓库并设置 Secrets"
    & node scripts/publish-github.mjs
    if ($LASTEXITCODE -ne 0) { throw "GitHub publish failed" }
  } else {
    Write-Host "[3/4] 已跳过 GitHub"
  }

  Write-Host "[4/4] 完成"
  Get-ChildItem .secrets -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime
} finally {
  Pop-Location
}
