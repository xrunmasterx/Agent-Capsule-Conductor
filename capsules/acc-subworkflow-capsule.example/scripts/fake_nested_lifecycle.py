import json
import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/fake_nested_lifecycle.py <setup|collect|cleanup>")
    stage = sys.argv[1]
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    if stage == "setup":
        (artifact_dir / "nested_setup.txt").write_text("setup complete\n", encoding="utf-8")
        return
    if stage == "collect":
        nested_summary = artifact_dir / "nested_workflow" / "workflow_summary.json"
        payload = json.loads(nested_summary.read_text(encoding="utf-8"))
        (artifact_dir / "nested_collect.md").write_text(
            f"# Nested Collect\n\nStatus: {payload.get('status')}\n",
            encoding="utf-8",
        )
        return
    if stage == "cleanup":
        (artifact_dir / "nested_cleanup.txt").write_text("cleanup complete\n", encoding="utf-8")
        return
    raise SystemExit(f"Unknown stage: {stage}")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
