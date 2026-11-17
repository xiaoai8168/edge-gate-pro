# Manual Deployment Guide

本指南用于在**状态正常且允许该工作负载**的 Cloudflare 账户中手动部署。不要使用新账户规避已有封禁、审核或服务限制。

## 1. 架构与资源名

```text
GitHub Actions
  -> egp-check-private  (外部 GPL 检测 Worker，私有)
  -> egp-check          (MIT 签名网关，公开)
       /check           -> 私有检测 Worker
       /healthz         -> 网关健康检查
       其他路径          -> egp-relay Service Binding
  -> egp-relay          (外部 GPL 代理 Worker)
  -> GitHub Pages
```

默认资源：

| 资源 | 名称 |
| --- | --- |
| 私有检测 Worker | `egp-check-private` |
| 签名网关 Worker | `egp-check` |
| 代理 Worker | `egp-relay` |
| KV Namespace | `egp-relay-kv` |
| 网关域名 | `egp-check.example.com` |
| 管理后台 | `https://egp-check.example.com/admin` |

## 2. 前置条件

- Cloudflare 账户状态正常，且当前工作负载符合 Cloudflare 服务条款；
- Cloudflare 中已有一个可管理的域名区域，例如 `example.com`；
- Node.js 22 或更高版本；
- Git、Python 3.11+；
- GitHub 仓库已 Fork 或已创建；
- 不要把 Token、ADMIN 密码、UUID 或 HMAC 密钥提交到 Git。

安装仓库依赖：

```bash
git clone https://github.com/<owner>/edge-gate-pro.git
cd edge-gate-pro
npm install --prefix scripts
python -m venv .venv
```

Windows PowerShell：

```powershell
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Linux/macOS：

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
```

## 3. 登录 Cloudflare

```bash
export CLOUDFLARE_ACCOUNT_ID="<32位账户ID>"
npx --yes wrangler@4 login
npx --yes wrangler@4 whoami
```

PowerShell：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "<32位账户ID>"
npx.cmd --yes wrangler@4 login
npx.cmd --yes wrangler@4 whoami
```

确认 `whoami` 显示的账户 ID 与目标账户一致。

## 4. 准备外部 GPL 组件

外部组件只在本地 `.build/manual/` 中准备，不复制进 MIT 核心源码。

```bash
mkdir -p .build/manual

git clone https://github.com/lsh8848/cm-Workers-CheckSocks5.git .build/manual/checker
git -C .build/manual/checker checkout 2f31cf9a242444eb22905d888d4d8871b0625b3a

git clone https://github.com/cmliu/edgetunnel.git .build/manual/relay
git -C .build/manual/relay checkout 24ee0b6

mkdir -p .build/manual/checker-gate/src
cp workers/checker-gate/src/index.js .build/manual/checker-gate/src/index.js
```

轻量稳定版代理会调用 Web Crypto MD5。当前 Cloudflare 运行时通常已支持原生 MD5，默认不要修改脚本。

只有在日志明确出现 `Unrecognized algorithm name: MD5` 时，才执行可选兼容补丁：

```bash
python scripts/patch_relay_md5.py .build/manual/relay/_worker.js
```

使用自动化部署脚本时，可通过环境变量启用该兜底：

```bash
export PATCH_RELAY_MD5=true
node scripts/deploy-cloudflare.mjs
```

## 5. 生成凭据

以下值只保存在本机：

```bash
node -e "console.log('HMAC='+require('crypto').randomBytes(36).toString('base64url'))"
node -e "console.log('ADMIN='+require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('UUID='+crypto.randomUUID())"
```

将输出保存到本机密码管理器，不要提交到 Git。

## 6. 创建 KV Namespace

先创建临时配置 `.build/manual/relay/wrangler.kv.toml`：

```toml
name = "egp-relay"
main = "_worker.js"
compatibility_date = "2026-09-07"
workers_dev = true
preview_urls = false
```

执行：

```bash
npx --yes wrangler@4 kv namespace create egp-relay-kv --config .build/manual/relay/wrangler.kv.toml
```

记录输出中的 32 位 namespace ID。

## 7. 配置并部署代理 Worker

创建 `.build/manual/relay/wrangler.toml`：

```toml
name = "egp-relay"
main = "_worker.js"
compatibility_date = "2026-09-07"
keep_vars = true
workers_dev = true
preview_urls = false

[observability]
enabled = true

[vars]
BEST_SUB = "1"
PRELOAD_RACE_DIAL = "1"
TCP_CONCURRENT_DIAL = "2"
PROXY_CONCURRENT_DIAL = "1"

[[kv_namespaces]]
binding = "KV"
id = "<KV_NAMESPACE_ID>"
```

设置代理后台凭据：

```bash
npx --yes wrangler@4 secret put ADMIN --config .build/manual/relay/wrangler.toml
npx --yes wrangler@4 secret put UUID --config .build/manual/relay/wrangler.toml
```

分别输入前面生成的 ADMIN 和 UUID。

部署：

```bash
npx --yes wrangler@4 deploy --config .build/manual/relay/wrangler.toml
```

## 8. 配置并部署私有检测 Worker

创建 `.build/manual/checker/wrangler.toml`：

```toml
name = "egp-check-private"
main = "_worker.js"
compatibility_date = "2026-11-17"
workers_dev = false
preview_urls = false

[observability]
enabled = true
```

部署：

```bash
npx --yes wrangler@4 deploy --config .build/manual/checker/wrangler.toml
```

这个 Worker 不应直接公开访问，只通过网关的 Service Binding 调用。

## 9. 配置并部署签名网关

创建 `.build/manual/checker-gate/wrangler.toml`。  
将 `egp-check.example.com` 替换为你自己的域名：

```toml
name = "egp-check"
main = "src/index.js"
compatibility_date = "2026-11-17"
workers_dev = true
preview_urls = false

routes = [
  { pattern = "egp-check.example.com", custom_domain = true }
]

[observability]
enabled = true

[vars]
ALLOWED_TARGET_SUFFIXES = ".opengw.net,.vpngate.net"
CHECK_TIMEOUT_MS = "30000"

[[services]]
binding = "CHECKER"
service = "egp-check-private"

[[services]]
binding = "PROXY"
service = "egp-relay"
```

如果没有自定义域名，删除 `routes`，使用生成的 `*.workers.dev` 地址。

设置 HMAC 密钥：

```bash
npx --yes wrangler@4 secret put EDGE_HMAC_SECRET --config .build/manual/checker-gate/wrangler.toml
```

部署：

```bash
npx --yes wrangler@4 deploy --config .build/manual/checker-gate/wrangler.toml
```

部署后验证：

```bash
curl -fsS https://egp-check.example.com/healthz
curl -I https://egp-check.example.com/login
curl -I https://egp-check.example.com/admin
```

预期：

- `/healthz` 返回 `200`；
- `/login` 返回代理登录页；
- `/admin` 重定向登录或返回管理页；
- 不应出现 Cloudflare `1101` 或 `522`。

## 10. 配置 GitHub Actions

在 GitHub 仓库：

1. `Settings -> Secrets and variables -> Actions`；
2. 新增 Secret：

```text
DOMAIN=egp-check.example.com
CHECK_HMAC_SECRET=<网关中的同一个 HMAC 密钥>
```

3. 打开 `Settings -> Pages`；
4. Source 选择 `GitHub Actions`；
5. 打开 `.github/workflows/check.yml`，确认执行环境允许 Pages 写入；
6. 手动运行 `Edge Gate Pro Node Check`。

如果工作流之前被停用，需要先重新启用：

```bash
gh workflow enable check.yml --repo <owner>/edge-gate-pro
gh workflow run check.yml --repo <owner>/edge-gate-pro
gh run watch --repo <owner>/edge-gate-pro
```

## 11. 验收发布产物

工作流成功后检查：

```text
https://<owner>.github.io/edge-gate-pro/
https://<owner>.github.io/edge-gate-pro/data.json
https://<owner>.github.io/edge-gate-pro/nodes.txt
```

本地也应有：

```text
public/data.json
public/index.html
public/nodes.txt
```

`data.json` 中的 `worker_host` 应等于 `egp-check.example.com`。

## 12. 代理后台

打开：

```text
https://egp-check.example.com/login
```

使用第 5 步生成的 ADMIN 密码登录，然后在后台配置或导入 `nodes.txt`。

不要公开：

- ADMIN 密码；
- UUID；
- HMAC 密钥；
- 带 token 的订阅 URL；
- 直连代理后台的 `workers.dev` 地址。

## 13. 本地质量检查

```bash
python -m pytest -q
ruff check .
node --test workers/checker-gate/test/gate.test.js scripts/test/github-secrets.test.mjs
node --check scripts/deploy-cloudflare.mjs
python scripts/diagnose.py
```

## 14. 资源清理

按依赖顺序删除本次创建的资源：

```bash
npx --yes wrangler@4 delete --name egp-check --force
npx --yes wrangler@4 delete --name egp-check-private --force
npx --yes wrangler@4 delete --name egp-relay --force
npx --yes wrangler@4 kv namespace delete --binding KV --config .build/manual/relay/wrangler.toml
```

如果创建了自定义域或路由，还需在 Cloudflare Dashboard 的 Workers Routes/DNS 中删除对应记录。

## 15. 故障排查

### `1101 Worker threw exception`

先部署一个只返回固定文本的最小 Worker：

```js
export default {
  async fetch() {
    return new Response("ok", { status: 200 });
  }
};
```

- 最小 Worker 也返回 `1101`：怀疑账户限制、运行时、路由或部署状态；
- 只有完整项目返回 `1101`：检查模块兼容性、Secrets、KV、日志和上游版本。

### `522`

通常是自定义域名、DNS、证书或路由未生效；优先检查：

- DNS 记录是否指向 Worker；
- 自定义域是否启用；
- Route pattern 是否正确；
- Worker 是否有有效生产版本。

### 没有节点

检查：

- GitHub Actions Secrets 是否与 Worker 一致；
- HMAC 时间窗是否正常；
- 私有检测 Worker 的 Service Binding 是否有效；
- `MIN_SUCCESS_RATIO` 是否过高；
- VPN Gate 数据源是否可用；
- GitHub Actions 日志中的 Worker 异常比例。

## 16. 合规声明

部署前必须确认当前账户和用途符合 Cloudflare 服务条款。遇到账户限制时，不要通过新建账户、隐藏身份、伪造信息或替换账号来规避平台审核。
