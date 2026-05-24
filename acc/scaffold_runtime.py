from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def main() -> None:
    input_path = Path(required_env("ACC_INPUT_PATH"))
    output_path = Path(required_env("ACC_OUTPUT_JSON"))
    artifact_dir = Path(required_env("ACC_ARTIFACT_DIR"))
    output_schema_path = Path(required_env("ACC_OUTPUT_SCHEMA_PATH"))
    artifact_entries = json.loads(required_env("ACC_SCAFFOLD_ARTIFACTS"))
    artifact_dir.mkdir(parents=True, exist_ok=True)

    input_payload = json.loads(input_path.read_text(encoding="utf-8"))
    output_schema = json.loads(output_schema_path.read_text(encoding="utf-8"))
    output_payload = build_output(input_payload, output_schema)
    output_path.write_text(
        json.dumps(output_payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    write_artifacts(input_payload, output_payload, artifact_dir, artifact_entries)
    print(json.dumps({"event": "scaffold_runtime_completed"}, sort_keys=True))


def build_output(input_payload: dict[str, Any], output_schema: dict[str, Any]) -> dict[str, Any]:
    topic = str(input_payload.get("topic") or input_payload.get("message") or "scaffolded input")
    output: dict[str, Any] = {"status": "success"}
    properties = output_schema.get("properties", {})
    if not isinstance(properties, dict):
        return output
    for name, schema in properties.items():
        if name == "status":
            continue
        output[name] = example_value(name, schema, topic)
    return output


def example_value(name: str, schema: Any, topic: str) -> Any:
    field_type = schema.get("type") if isinstance(schema, dict) else "string"
    if name == "summary":
        return f"Generated scaffolded summary for {topic}"
    if name == "recommendation":
        return f"Review the generated artifact for {topic}"
    if field_type == "number":
        return 1.0
    if field_type == "integer":
        return 1
    if field_type == "boolean":
        return True
    if field_type == "object":
        return {"topic": topic}
    if field_type == "array":
        return [topic]
    return f"Generated {name} for {topic}"


def write_artifacts(
    input_payload: dict[str, Any],
    output_payload: dict[str, Any],
    artifact_dir: Path,
    artifact_entries: list[dict[str, Any]],
) -> None:
    topic = str(input_payload.get("topic") or input_payload.get("message") or "scaffolded input")
    for entry in artifact_entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            continue
        relative_path = Path(entry["path"])
        target = artifact_dir / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix.lower() == ".json":
            target.write_text(
                json.dumps(
                    {"topic": topic, "output": output_payload},
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
        else:
            target.write_text(
                "\n".join(
                    [
                        "# Scaffolded Artifact",
                        "",
                        f"Topic: {topic}",
                        "",
                        f"Summary: {output_payload.get('summary', '')}",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
