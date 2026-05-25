import json
import os
import sys
from pathlib import Path

import yaml


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: python scripts/fake_external_workflow.py <setup|run|collect|cleanup>"
        )
    stage = sys.argv[1]
    output_path = Path(required_env("ACC_OUTPUT_JSON"))
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    workflow_path = Path(required_env("ACC_WORKFLOW_PATH"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8")) or {}
    workflow_name = str(workflow.get("name") or workflow_path.stem)

    if stage == "setup":
        (artifact_dir / "external_setup.txt").write_text("setup complete\n", encoding="utf-8")
        return
    if stage == "run":
        report_name = "external_workflow_report.md"
        (artifact_dir / report_name).write_text(
            f"# External Workflow Report\n\nWorkflow: {workflow_name}\n",
            encoding="utf-8",
        )
        payload = {
            "status": "success",
            "summary": f"External workflow {workflow_name} completed",
            "workflow_name": workflow_name,
        }
        output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(payload, sort_keys=True))
        return
    if stage == "collect":
        collect = {
            "workflow_name": workflow_name,
            "summary": read_json(output_path).get("summary", ""),
        }
        (artifact_dir / "external_collect.json").write_text(
            json.dumps(collect, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        return
    if stage == "cleanup":
        (artifact_dir / "external_cleanup.txt").write_text("cleanup complete\n", encoding="utf-8")
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
