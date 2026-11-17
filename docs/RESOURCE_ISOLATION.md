# Resource Isolation

`hezhanleiok/gate` and `xiaoai8168/gate` are reference/source baselines only. Edge Gate Pro does not reuse their deployed resources.

| Resource | Edge Gate Pro |
| --- | --- |
| GitHub repository | `xiaoai8168/edge-gate-pro` |
| Private checker Worker | `egp-check-private` |
| Signed checker gate | `egp-check` |
| Relay Worker | `egp-relay` |
| KV namespace | `egp-relay-kv` |
| Checker host | `egp-check.aiy.kdns.fr` |
| Proxy/admin path | `egp-check.aiy.kdns.fr/admin` |
| Dashboard host | `egp-edge.aiy.kdns.fr` |

Deployment scripts never delete, rename, redirect, or overwrite resources outside these names. Existing Cloudflare KV namespaces are reused only when their ID is stored in the local `.secrets/deployment.json`.
