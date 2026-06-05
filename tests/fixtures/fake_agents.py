from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m tests.fixtures.fake_agents <echo|fake>")
    mode = sys.argv[1]
    input_payload = read_json_env("ACC_INPUT_PATH")
    output_path = Path(required_env("ACC_OUTPUT_JSON"))
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    if mode == "echo":
        output = {
            "status": "success",
            "summary": f"Echoed message: {input_payload.get('message', '')}",
            "echo": input_payload,
        }
    elif mode == "fake":
        if input_payload.get("should_fail"):
            raise SystemExit("Fake agent was asked to fail")
        topic = input_payload["topic"]
        report_path = artifact_dir / "report.md"
        report_path.write_text(f"# Fake Agent Report\n\nTopic: {topic}\n", encoding="utf-8")
        output = {
            "status": "success",
            "summary": f"Created deterministic report for {topic}",
            "artifact": "report.md",
        }
    else:
        raise SystemExit(f"Unknown fake agent mode: {mode}")

    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(json.dumps({"event": "fake_agent_completed", "mode": mode}, sort_keys=True))
    print(f"fake agent {mode} completed", file=sys.stderr)


def read_json_env(name: str) -> dict[str, Any]:
    path = Path(required_env(name))
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"{name} must point to a JSON object")
    return payload


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
