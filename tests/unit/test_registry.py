from pathlib import Path

import pytest

from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.utils import AccError


def write_capsule(root: Path, directory: str, capsule_id: str) -> Path:
    capsule_dir = root / directory
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        f"""
id: {capsule_id}
version: "0.1.0"
name: Test
description: Test capsule
runtime:
  type: generic_cli
  command: python
workspace:
  mode: existing_dir
permissions:
  sandbox: read-only
  network: false
  write_files: false
  timeout_seconds: 30
  allow_dangerous: false
prompt:
  template: prompt_template.md
schema:
  input: input_schema.json
  output: output_schema.json
artifacts:
  manifest: artifact_manifest.yaml
""".strip(),
        encoding="utf-8",
    )
    for name in [
        "prompt_template.md",
        "input_schema.json",
        "output_schema.json",
        "artifact_manifest.yaml",
    ]:
        (capsule_dir / name).write_text("{}\n", encoding="utf-8")
    return capsule_dir


def test_discovers_capsules(tmp_path: Path) -> None:
    write_capsule(tmp_path, "one", "one.generic")

    capsules = CapsuleRegistry(tmp_path).discover()

    assert [capsule.spec.id for capsule in capsules] == ["one.generic"]


def test_get_returns_capsule_by_id(tmp_path: Path) -> None:
    write_capsule(tmp_path, "echo", "echo-test.generic")

    capsule = CapsuleRegistry(tmp_path).get("echo-test.generic")

    assert capsule.spec.name == "Test"


def test_duplicate_capsule_id_fails(tmp_path: Path) -> None:
    write_capsule(tmp_path, "one", "same.generic")
    write_capsule(tmp_path, "two", "same.generic")

    with pytest.raises(AccError, match="Duplicate capsule id"):
        CapsuleRegistry(tmp_path).discover()


def test_missing_capsule_id_raises_clear_error(tmp_path: Path) -> None:
    with pytest.raises(AccError, match="Capsule not found"):
        CapsuleRegistry(tmp_path).get("missing.generic")


def test_broken_yaml_produces_readable_error(tmp_path: Path) -> None:
    capsule_dir = tmp_path / "broken"
    capsule_dir.mkdir()
    (capsule_dir / "capsule.yaml").write_text("id: [unterminated\n", encoding="utf-8")

    with pytest.raises(AccError, match="Invalid YAML"):
        CapsuleRegistry(tmp_path).discover()


def test_validate_capsule_files_reports_missing_file(tmp_path: Path) -> None:
    capsule_dir = write_capsule(tmp_path, "one", "one.generic")
    (capsule_dir / "prompt_template.md").unlink()

    capsule = CapsuleRegistry(tmp_path).get("one.generic")
    errors = validate_capsule_files(capsule)

    assert any("Missing prompt template" in error for error in errors)

