import json
from pathlib import Path

from acc.validation import validate_artifacts, validate_json_file


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_valid_output_json_passes_schema_validation(tmp_path: Path) -> None:
    schema = tmp_path / "schema.json"
    output = tmp_path / "output.json"
    write_json(schema, {"type": "object", "required": ["summary"], "properties": {"summary": {}}})
    write_json(output, {"summary": "ok"})

    assert validate_json_file(output, schema)["summary"] == "ok"


def test_missing_required_output_field_fails(tmp_path: Path) -> None:
    schema = tmp_path / "schema.json"
    output = tmp_path / "output.json"
    write_json(schema, {"type": "object", "required": ["summary"], "properties": {"summary": {}}})
    write_json(output, {})

    try:
        validate_json_file(output, schema)
    except Exception as exc:
        assert "required property" in str(exc)
    else:
        raise AssertionError("expected schema validation failure")


def test_required_artifact_missing_fails(tmp_path: Path) -> None:
    manifest = tmp_path / "artifact_manifest.yaml"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    manifest.write_text("required:\n  - path: report.md\noptional: []\n", encoding="utf-8")

    errors = validate_artifacts(artifact_dir, manifest)

    assert errors == ["Missing required artifact: report.md"]


def test_optional_artifact_missing_passes(tmp_path: Path) -> None:
    manifest = tmp_path / "artifact_manifest.yaml"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    manifest.write_text("required: []\noptional:\n  - path: optional.md\n", encoding="utf-8")

    assert validate_artifacts(artifact_dir, manifest) == []


def test_artifact_path_traversal_is_rejected(tmp_path: Path) -> None:
    manifest = tmp_path / "artifact_manifest.yaml"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    manifest.write_text("required:\n  - path: ../outside.txt\n", encoding="utf-8")

    errors = validate_artifacts(artifact_dir, manifest)

    assert "escapes artifact directory" in errors[0]

