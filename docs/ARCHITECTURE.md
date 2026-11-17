# Architecture

```text
VPN Gate APIs
  -> vpngate.py (MIT)
     -> validated CSV / mirror parsing
     -> SSTP candidate extraction
     -> signed request to checker gate
     -> private external CheckSocks5 service
     -> exit-IP / ASN / network classification
     -> diversity quotas + publish guard
     -> public/data.json, nodes.txt, index.html
  -> GitHub Pages
  -> independent external edgetunnel service
```

## Trust boundaries

- The public checker gate contains only our MIT validation/signing/proxy code.
- The GPL checker is a separate Worker with `workers_dev = false`.
- The GPL proxy service is deployed separately and is not imported by this repository.
- GitHub Actions receives only the checker hostname and HMAC secret.
- Generated admin credentials remain local in `.secrets/deployment.json`.

## Failure behavior

- All VPN Gate sources fail: the workflow fails without deploying a new snapshot.
- Worker errors dominate: the workflow fails without deploying.
- Success ratio is below 30%: the workflow fails without deploying.
- Success count is below 35% of the previous snapshot: the workflow fails unless `ALLOW_LARGE_DROP=true`.
- Individual node failure: omitted from the next publication.
