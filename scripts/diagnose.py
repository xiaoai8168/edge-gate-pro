"""Live data-source diagnostics without touching the published snapshot."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import vpngate


def main() -> int:
    session = vpngate.make_session(pool_size=4, retries=1)
    for url in vpngate._source_urls(vpngate.DEFAULT_VPNGATE_API):
        try:
            raw = vpngate.fetch_limited(session, url, timeout=25)
            rows = vpngate.parse_csv(raw.decode("utf-8", "replace"))
            nodes = vpngate.to_sstp_nodes(rows)
            print(f"OK {url} raw={len(rows)} sstp={len(nodes)}")
            if rows:
                return 0
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {url}: {type(exc).__name__}: {exc}")
    print("FAIL: all VPN Gate sources are unavailable")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
