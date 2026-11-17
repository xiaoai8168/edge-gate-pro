import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_patch_relay_md5_is_idempotent(tmp_path):
    target = tmp_path / "_worker.js"
    target.write_text(
        "async function MD5MD5(文本) {\n"
        "\tconst 编码器 = new TextEncoder();\n"
        "\treturn 'old';\n"
        "}\n"
        "console.log(MD5MD5);\n",
        encoding="utf-8",
    )
    command = [sys.executable, str(ROOT / "scripts" / "patch_relay_md5.py"), str(target)]
    first = subprocess.run(command, capture_output=True, text=True, check=False)
    assert first.returncode == 0, first.stderr
    patched = target.read_text(encoding="utf-8")
    assert "function md5Bytes(bytes)" in patched
    assert "第一次十六进制" in patched
    assert "return 'old'" not in patched
    second = subprocess.run(command, capture_output=True, text=True, check=False)
    assert second.returncode == 0, second.stderr
    assert "already patched" in second.stdout
