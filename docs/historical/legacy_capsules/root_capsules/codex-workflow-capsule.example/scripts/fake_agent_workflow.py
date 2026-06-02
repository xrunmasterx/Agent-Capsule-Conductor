import json
import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/fake_agent_workflow.py <setup|run|collect|cleanup>")
    stage = sys.argv[1]
    input_payload = read_json(Path(required_env("ACC_INPUT_PATH")))
    output_path = Path(required_env("ACC_OUTPUT_JSON"))
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    if stage == "setup":
        (artifact_dir / "setup.txt").write_text("setup complete\n", encoding="utf-8")
        return
    if stage == "run":
        topic = input_payload.get("topic") or input_payload.get("message") or "workflow"
        report_name = "agent_workflow_report.md"
        (artifact_dir / report_name).write_text(
            f"# Agent Workflow Report\n\nTopic: {topic}\n",
            encoding="utf-8",
        )
        payload = {
            "status": "success",
            "summary": f"Agent workflow completed for {topic}",
            "artifact": report_name,
        }
        output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(payload, sort_keys=True))
        return
    if stage == "collect":
        summary = read_json(output_path).get("summary", "")
        collect_path = artifact_dir / "collect.json"
        collect_path.write_text(
            json.dumps({"summary": summary}, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        return
    if stage == "cleanup":
        (artifact_dir / "cleanup.txt").write_text("cleanup complete\n", encoding="utf-8")
        return
    raise SystemExit(f"Unknown stage: {stage}")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing environment variable: {name}")
    return value


def read_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"Expected JSON object in {path}")
    return payload


if __name__ == "__main__":
    main()
