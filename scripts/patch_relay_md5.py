"""Patch edgetunnel MD5MD5 to use the bundled pure-JavaScript MD5 helper."""
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch_relay_md5.py <path-to-_worker.js>", file=sys.stderr)
        return 2
    worker_path = Path(sys.argv[1]).resolve()
    root = Path(__file__).resolve().parents[1]
    helper = (root / "scripts" / "assets" / "md5-bytes.js").read_text(encoding="utf-8").strip()
    source = worker_path.read_text(encoding="utf-8-sig")
    if "function md5Bytes(bytes)" in source:
        print("already patched")
        return 0
    start = source.find("async function MD5MD5")
    end = source.find("\n}", start)
    if start < 0 or end < 0:
        print("MD5MD5 block not found", file=sys.stderr)
        return 1
    replacement = """async function MD5MD5(文本) {
	const 编码器 = new TextEncoder();
	const 第一次十六进制 = Array.from(md5Bytes(编码器.encode(文本))).map(字节 => 字节.toString(16).padStart(2, "0")).join("");
	const 第二次十六进制 = Array.from(md5Bytes(编码器.encode(第一次十六进制.slice(7, 27)))).map(字节 => 字节.toString(16).padStart(2, "0")).join("");
	return 第二次十六进制.toLowerCase();
}"""
    worker_path.write_text(source[:start] + helper + "\n\n" + replacement + source[end + 2:], encoding="utf-8")
    print("patched", worker_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
