# Edge Gate Pro

免费优先、可自用的 VPN Gate SSTP 节点采集、实测、筛选与发布系统。

核心流水线采用 MIT 许可；上游 GPL 组件只作为独立服务部署，不复制进核心仓库。

## 架构

```text
VPN Gate API（HTTPS 优先、多源回退）
  -> GitHub Actions
  -> 私有 CheckSocks5 Worker
  -> 带 HMAC 签名和 SSRF 防护的检测前置 Worker
  -> 出口 IP / ASN / 住宅属性校验
  -> 去重、出口 IP/ASN/国家配额、断崖保护
  -> GitHub Pages: data.json / nodes.txt / index.html
  -> 独立 edgetunnel Worker
```

## 已配置域名

| 用途 | 地址 |
| --- | --- |
| 仪表盘 | GitHub Pages（可后续绑定 `egp-edge.aiy.kdns.fr`） |
| 检测前置 | `egp-check.aiy.kdns.fr` |
| 代理与后台 | `egp-gate.aiy.kdns.fr` |

## 核心能力

- 每 30 分钟自动检测，手动触发可覆盖检测数量、并发和超时；
- HTTPS 优先并可自动回退多个 VPN Gate 镜像；
- 检测请求使用 HMAC-SHA256、时间窗和固定目标域名白名单；
- 私有检测 Worker 不开放 `workers.dev`，只允许前置 Worker 通过 Service Binding 调用；
- 必须返回真实出口 IP 才计为可用，避免把“TCP 可连接”误判成可用节点；
- 限制同一出口 IP、同一 ASN、同一国家的发布数量，减少“始终几个旧 IP”的问题；
- 成功率低于 30% 或较上一版断崖下降时停止发布，保留上一版；
- 原子写入、真实数据源内测、Python 与 Worker 单元测试、GitHub Actions CI。

## 一键上线

前置条件：

1. Cloudflare 账户中已有 `aiy.kdns.fr` 区域；
2. 创建最小权限 Cloudflare API Token，或使用 Wrangler OAuth 登录；
3. 创建 Fine-grained GitHub Token。

Windows PowerShell：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "<账户ID>"
$env:CLOUDFLARE_API_TOKEN = "<Cloudflare最小权限Token>"
$env:GH_TOKEN = "<GitHub Fine-grained Token>"
powershell -ExecutionPolicy Bypass -File scripts\go-live.ps1
```

没有 Cloudflare Token 时可省略该变量，脚本会启动 Wrangler OAuth。GitHub Token 不可省略。

默认创建：

- GitHub：`xiaoai8168/edge-gate-pro`（公开）；
- Cloudflare Worker：`egp-check-private`、`egp-check`、`egp-proxy`。

运行凭据只写入本机 `.secrets/deployment.json`，该目录已被 Git 忽略。

## 本地验收

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

单独检查已部署服务：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-deployment.ps1
```

## Cloudflare Token 权限

```text
Workers Scripts: Edit
Workers KV Storage: Edit
Workers Routes: Edit
Zone: Read
DNS: Edit
```

DNS/Zone 权限仅在启用自定义域名时需要。

## GitHub Token 权限

```text
Administration: Read and write
Contents: Read and write
Actions: Read and write
Workflows: Read and write
Metadata: Read
```

## 产物

- `public/data.json`
- `public/nodes.txt`
- `public/index.html`

## 资源隔离

所有云端资源均使用独立 `egp-*` 前缀，详见 `docs/RESOURCE_ISOLATION.md`。

## 安全与合规

- 不提交 Token、管理员密码、UUID 或 HMAC 密钥；
- 不公开带管理凭据的订阅地址；
- 仅用于合法用途；
- CheckSocks5（GPL-3.0）与 edgetunnel（GPL-2.0）独立部署，详见 `NOTICE.md` 与 `docs/LICENSE_BOUNDARIES.md`。
