from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_workflow(name: str) -> dict:
    with (ROOT / ".github" / "workflows" / name).open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def test_workflows_are_valid_yaml():
    assert load_workflow("check.yml")["name"] == "Edge Gate Pro Node Check"
    assert load_workflow("ci.yml")["name"] == "CI"


def test_schedule_minutes_are_valid():
    workflow = load_workflow("check.yml")
    # PyYAML parses the key "on" as boolean True under YAML 1.1.
    triggers = workflow.get("on", workflow.get(True))
    cron = triggers["schedule"][0]["cron"]
    minute = cron.split()[0]
    assert minute == "0"
    assert 0 <= int(minute.removeprefix("*/")) <= 59


def test_publish_workflow_uses_direct_checker():
    text = (ROOT / ".github" / "workflows" / "check.yml").read_text(encoding="utf-8")
    assert "DOMAIN" in text
    assert "CHECK_WORKER" in text
    assert "CHECK_HMAC_SECRET" not in text
    assert "REQUIRE_EXIT_IP: 'true'" in text
    assert "MIN_SUCCESS_RATIO: '0.30'" in text
