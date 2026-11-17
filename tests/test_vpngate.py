import base64

import pytest

import vpngate
from vpngate import ConfigError, Node


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def make_config(**overrides):
    values = {
        "vpngate_api": "http://example.invalid/api",
        "vpngate_mirror": "https://example.invalid/mirror.json",
        "worker_base": "https://worker.example.com/check?sstp=vpn:vpn@",
        "concurrency": 4,
        "check_timeout": 5.0,
        "deadline_s": 60.0,
        "http_timeout": 5.0,
        "max_check_nodes": 0,
        "public_dir": "/tmp/public",
        "template_html": "/tmp/index.html",
        "edge_hosts": ("a.example.com:443", "b.example.com:443"),
        "optimal_api": "",
        "nodes_url": "https://owner.github.io/repo/nodes.txt",
        "min_success_ratio": 0.0,
        "max_residential_per_country": 20,
        "max_datacenter_per_country": 10,
        "max_per_exit_ip": 1,
        "max_per_asn_per_country": 6,
        "max_unknown_asn_per_country": 2,
        "max_total_nodes": 0,
        "require_exit_ip": True,
        "checker_hmac_secret": "",
        "previous_data_url": "",
        "min_previous_ratio": 0.35,
        "allow_large_drop": False,
    }
    values.update(overrides)
    return vpngate.Config(**values)


# ---------------------------------------------------------------------------
# 配置归一化
# ---------------------------------------------------------------------------
def test_normalize_worker_full_url_kept():
    url = "https://abc.workers.dev/check?sstp=vpn:vpn@"
    assert vpngate.normalize_worker_base(url) == url


def test_normalize_worker_bare_host():
    assert (
        vpngate.normalize_worker_base("abc.workers.dev")
        == "https://abc.workers.dev/check?sstp=vpn:vpn@"
    )


def test_normalize_worker_missing_query():
    assert (
        vpngate.normalize_worker_base("https://abc.workers.dev/check")
        == "https://abc.workers.dev/check?sstp=vpn:vpn@"
    )


def test_normalize_worker_incomplete_sstp_value():
    result = vpngate.normalize_worker_base("https://abc.workers.dev/check?sstp=")
    assert result.endswith("sstp=vpn:vpn@")


def test_normalize_worker_placeholder_raises():
    with pytest.raises(ConfigError):
        vpngate.normalize_worker_base("https://你的域名/check?sstp=vpn:vpn@")
    with pytest.raises(ConfigError):
        vpngate.normalize_worker_base("https://YOUR_GITHUB_USERNAME.github.io")


def test_normalize_worker_query_without_path():
    assert (
        vpngate.normalize_worker_base("https://abc.workers.dev?sstp=vpn:vpn@")
        == "https://abc.workers.dev/check?sstp=vpn:vpn@"
    )


def test_normalize_worker_empty_raises():
    with pytest.raises(ConfigError):
        vpngate.normalize_worker_base("")


# ---------------------------------------------------------------------------
# 端点归一化（含 IPv6）
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1.2.3.4:443", "1.2.3.4:443"),
        ("example.com", "example.com:443"),
        ("example.com:8443", "example.com:8443"),
        ("2001:db8::1", "[2001:db8::1]:443"),
        ("[2001:db8::1]:8443", "[2001:db8::1]:8443"),
        ("1.2.3.4:443#备注", "1.2.3.4:443"),
        ("1.2.3.4:99999", None),
        ("", None),
        ("bad host", None),
    ],
)
def test_normalize_endpoint(raw, expected):
    assert vpngate.normalize_endpoint(raw) == expected


def test_parse_edge_hosts_dedupes_and_skips_invalid():
    result = vpngate.parse_edge_hosts("a.com:443, a.com:443, b.com:8443, bad host")
    assert result == ["a.com:443", "b.com:8443"]


# ---------------------------------------------------------------------------
# CSV / 镜像解析
# ---------------------------------------------------------------------------
HEADER = (
    "#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,Uptime,"
    "TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64"
)


def test_parse_csv_reads_header_and_skips_star_rows():
    tcp_config = b64("proto tcp\nremote 219.100.37.153 443\n")
    udp_config = b64("proto udp\nremote 219.100.37.154 1194\n")
    text = "\n".join(
        [
            "*",
            HEADER,
            f"public-vpn-153,219.100.37.153,123456,45,1000000,Japan,JP,10,100,100,100,2weeks,op,,{tcp_config}",
            "*",
            f"public-vpn-154,219.100.37.154,999,80,1000000,Japan,JP,1,1,1,1,2weeks,op,,{udp_config}",
            "#",
        ]
    )
    rows = vpngate.parse_csv(text)
    assert len(rows) == 2
    assert rows[0]["host"] == "public-vpn-153"
    assert rows[0]["country_short"] == "JP"
    assert rows[0]["ping"] == 45

    nodes = vpngate.to_sstp_nodes(rows)
    assert len(nodes) == 1
    assert nodes[0].host == "public-vpn-153.opengw.net"
    assert nodes[0].port == 443


def test_to_sstp_nodes_keeps_full_domain_and_skips_missing_proto():
    rows = [
        {
            "host": "public-vpn-9.vpngate.net",
            "ip": "1.1.1.1",
            "country_long": "Japan",
            "country_short": "JP",
            "config_b64": b64("remote 1.1.1.1 443\n"),
        },
        {
            "host": "public-vpn-10",
            "ip": "1.1.1.2",
            "country_long": "Japan",
            "country_short": "JP",
            "config_b64": b64("proto tcp\nremote 1.1.1.2 443\n"),
        },
    ]
    nodes = vpngate.to_sstp_nodes(rows)
    assert len(nodes) == 1
    assert nodes[0].host == "public-vpn-10.opengw.net"


def test_parse_mirror_json_reads_servers():
    data = [
        {
            "servers": [
                {
                    "hostname": "public-vpn-1",
                    "ip": "1.1.1.1",
                    "countrylong": "Japan",
                    "countryshort": "JP",
                    "ping": "12",
                    "score": "999",
                    "openvpn_configdata_base64": b64("proto tcp\nremote 1.1.1.1 443\n"),
                }
            ]
        },
        1700000000000,
    ]
    rows = vpngate.parse_mirror_json(data)
    assert len(rows) == 1
    assert rows[0]["ping"] == 12
    assert vpngate.to_sstp_nodes(rows)[0].port == 443


# ---------------------------------------------------------------------------
# 去重 / 排序 / 分类
# ---------------------------------------------------------------------------
def test_dedupe_and_prioritize():
    nodes = [
        Node("b.opengw.net", 443, "1.1.1.2", "Japan", "JP", ping=100, score=1),
        Node("a.opengw.net", 443, "1.1.1.1", "Japan", "JP", ping=None, score=5),
        Node("b.opengw.net", 443, "1.1.1.2", "Japan", "JP", ping=100, score=1),
        Node("c.opengw.net", 443, "1.1.1.3", "Japan", "JP", ping=20, score=3),
    ]
    unique = vpngate.dedupe_nodes(nodes)
    assert len(unique) == 3
    ordered = vpngate.prioritize(unique)
    assert [n.host for n in ordered] == ["c.opengw.net", "b.opengw.net", "a.opengw.net"]


def test_classify_prefers_worker_flag():
    assert vpngate.classify_network("GOOGLE LLC", False) == "residential"
    assert vpngate.classify_network("NTT EAST", True) == "datacenter"
    assert vpngate.classify_network("", None) == "unknown"


def test_classify_falls_back_to_org_keywords():
    assert vpngate.classify_network("Google LLC", None) == "datacenter"
    assert vpngate.classify_network("NTT EAST", None) == "residential"
    assert vpngate.classify_network(None, None) == "unknown"


# ---------------------------------------------------------------------------
# 产物
# ---------------------------------------------------------------------------
def sample_data():
    return {
        "countries": {
            "JP": {
                "code": "JP",
                "name": "日本",
                "count": 3,
                "residential": 2,
                "datacenter": 1,
                "unknown": 0,
                "nodes": [
                    {"host": "a.opengw.net", "port": 443, "residential": "residential", "latency_ms": 30},
                    {"host": "b.opengw.net", "port": 443, "residential": "residential", "latency_ms": 50},
                    {"host": "c.opengw.net", "port": 443, "residential": "datacenter", "latency_ms": 10},
                ],
            }
        }
    }


def test_build_nodes_text_caps_and_formats():
    cfg = make_config(max_residential_per_country=1, max_datacenter_per_country=1)
    text = vpngate.build_nodes_text(sample_data(), ["a.example.com:443"], cfg)
    lines = text.strip().splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("a.example.com:443#日本-住宅-01$sstp://vpn:vpn@a.opengw.net:443")
    assert lines[1].startswith("a.example.com:443#日本-机房-01$sstp://vpn:vpn@c.opengw.net:443")


def test_build_nodes_text_sanitizes_remark_and_dedupes_links():
    data = {"countries": {"XX": {"code": "XX", "name": "Bad#Name$X", "nodes": [
        {"host": "a.opengw.net", "port": 443, "residential": "unknown", "latency_ms": 5},
        {"host": "a.opengw.net", "port": 443, "residential": "unknown", "latency_ms": 5},
    ]}}}
    cfg = make_config()
    text = vpngate.build_nodes_text(data, ["edge.example.com:443"], cfg)
    lines = text.strip().splitlines()
    assert len(lines) == 1
    assert "#" in lines[0]
    remark = lines[0].split("#", 1)[1].split("$", 1)[0]
    assert "#" not in remark and "$" not in remark


def test_build_nodes_text_requires_edge_pool():
    with pytest.raises(ConfigError):
        vpngate.build_nodes_text(sample_data(), [], make_config())


def test_build_outputs_stats_and_country_grouping():
    results = [
        {"host": "a.opengw.net", "port": 443, "success": True, "country": "Japan", "country_code": "JP",
         "residential": "residential", "latency_ms": 40, "worker_error": False},
        {"host": "b.opengw.net", "port": 443, "success": True, "country": "Japan", "country_code": "JP",
         "residential": "datacenter", "latency_ms": 10, "worker_error": False},
        {"host": "c.opengw.net", "port": 443, "success": False, "country": "Japan", "country_code": "JP",
         "residential": "unknown", "latency_ms": None, "worker_error": True},
    ]
    data = vpngate.build_outputs(
        results=results,
        raw_count=10,
        sstp_count=8,
        source="vpngate.net/api/iphone",
        worker_host="worker.example.com",
        duration_s=12.34,
        timed_out=0,
    )
    assert data["schema_version"] == vpngate.SCHEMA_VERSION
    assert data["stats"]["success"] == 2
    assert data["stats"]["failed"] == 1
    assert data["stats"]["worker_errors"] == 1
    assert data["stats"]["countries"] == 1
    group = data["countries"]["JP"]
    assert group["count"] == 2
    assert group["residential"] == 1
    assert group["datacenter"] == 1
    assert group["nodes"][0]["host"] == "a.opengw.net"
    assert "available" not in data


def test_atomic_write_text(tmp_path):
    target = tmp_path / "out" / "nodes.txt"
    vpngate.atomic_write_text(str(target), "line1\nline2\n")
    assert target.read_text(encoding="utf-8") == "line1\nline2\n"
    assert list(target.parent.glob("*.tmp-*")) == []


def test_signed_checker_url_covers_target(monkeypatch):
    url = vpngate._signed_checker_url(
        "https://checker.example.net/check?sstp=vpn:vpn@",
        "vpn:vpn@public-vpn-1.opengw.net:443",
        "x" * 32,
    )
    assert url.startswith("https://checker.example.net/check?")
    assert "target=vpn%3Avpn%40public-vpn-1.opengw.net%3A443" in url
    assert "&ts=" in url and "&sig=" in url


def test_selection_rejects_duplicate_exit_ip_and_rotates_ties():
    data = {
        "generated_at": "2026-11-17 00:00:00 UTC",
        "countries": {
            "JP": {
                "code": "JP",
                "name": "日本",
                "count": 3,
                "nodes": [
                    {"host": "a.opengw.net", "port": 443, "country_code": "JP", "country": "Japan",
                     "residential": "residential", "latency_ms": 10, "exit": {"ip": "9.9.9.9", "asn": "1"}},
                    {"host": "b.opengw.net", "port": 443, "country_code": "JP", "country": "Japan",
                     "residential": "residential", "latency_ms": 20, "exit": {"ip": "9.9.9.9", "asn": "2"}},
                    {"host": "c.opengw.net", "port": 443, "country_code": "JP", "country": "Japan",
                     "residential": "residential", "latency_ms": 30, "exit": {"ip": "8.8.8.8", "asn": "3"}},
                ],
            }
        },
    }
    selected = vpngate.select_publishable_nodes(data, make_config(max_residential_per_country=3))
    assert [n["host"] for n in selected] == ["a.opengw.net", "c.opengw.net"]


def test_default_min_success_ratio_is_guarded(monkeypatch):
    for name in (
        "CHECK_WORKER", "DOMAIN", "MIN_SUCCESS_RATIO", "CHECK_CONCURRENCY",
        "MAX_PER_EXIT_IP", "REQUIRE_EXIT_IP", "CHECK_HMAC_SECRET",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CHECK_WORKER", "https://checker.example.net/check?sstp=vpn:vpn@")
    cfg = vpngate.Config.load()
    assert cfg.min_success_ratio == 0.30
    assert cfg.concurrency == 8
    assert cfg.require_exit_ip is True


def test_check_one_maps_nested_location_and_requires_exit_ip():
    class Response:
        status_code = 200
        def json(self):
            return {
                "success": True,
                "responseTime": 123,
                "exit": {
                    "ip": "203.0.113.10",
                    "is_datacenter": False,
                    "asn": {"asn": 64500, "org": "Example Network"},
                    "location": {"country": "Japan", "country_code": "JP", "city": "Tokyo"},
                },
            }

    class Session:
        def get(self, url, timeout):
            assert "/check?target=" in url
            return Response()

    cfg = make_config(checker_hmac_secret="x" * 32, require_exit_ip=True)
    result = vpngate.check_one(Node("a.opengw.net", 443, "1.1.1.1", "Japan", "JP"), Session(), cfg)
    assert result["success"] is True
    assert result["exit"]["country_code"] == "JP"
    assert result["exit"]["city"] == "Tokyo"
    assert result["residential"] == "residential"
