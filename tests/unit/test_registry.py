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


def write_agent_workflow_capsule(root: Path, directory: str, capsule_id: str, command: str) -> Path:
    capsule_dir = root / directory
    behavior_dir = capsule_dir / "behavior"
    behavior_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        f"""
id: {capsule_id}
version: "0.1.0"
name: Workflow Test
description: Workflow capsule test
kind: agent_workflow
runtime:
  type: generic_cli
  command: python
workspace:
  mode: existing_dir
permissions:
  sandbox: read-only
  network: false
  write_files: true
  timeout_seconds: 30
  allow_dangerous: false
behavior_pack:
  root: behavior
  files:
    - AGENTS.md
lifecycle:
  setup:
    - {command}
schema:
  input: input_schema.json
  output: output_schema.json
artifacts:
  manifest: artifact_manifest.yaml
""".strip(),
        encoding="utf-8",
    )
    for name in ["input_schema.json", "output_schema.json", "artifact_manifest.yaml"]:
        (capsule_dir / name).write_text("{}\n", encoding="utf-8")
    (behavior_dir / "AGENTS.md").write_text("# Behavior\n", encoding="utf-8")
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


def test_registry_get_uses_cached_discovery_within_instance(tmp_path: Path, monkeypatch) -> None:
    write_capsule(tmp_path, "one", "one.generic")
    registry = CapsuleRegistry(tmp_path)
    calls = 0
    original_load_path = registry.load_path

    def tracked_load_path(path: Path):
        nonlocal calls
        calls += 1
        return original_load_path(path)

    monkeypatch.setattr(registry, "load_path", tracked_load_path)

    first = registry.get("one.generic")
    second = registry.get("one.generic")

    assert first.spec.id == "one.generic"
    assert second.spec.id == "one.generic"
    assert calls == 1


def test_validate_capsule_files_rejects_unsafe_lifecycle_shell_syntax(tmp_path: Path) -> None:
    write_agent_workflow_capsule(
        tmp_path,
        "workflow",
        "workflow.generic",
        "python scripts/fake_workflow.py run && whoami",
    )

    capsule = CapsuleRegistry(tmp_path).get("workflow.generic")
    errors = validate_capsule_files(capsule)

    assert any("Invalid lifecycle setup command" in error for error in errors)


def test_stock_market_demo_capsules_use_least_privilege_permissions() -> None:
    capsules_dir = Path(__file__).resolve().parents[2] / "capsules"
    registry = CapsuleRegistry(capsules_dir)

    for capsule_id, network in [
        ("stock-market-research.codex", True),
        ("stock-market-info-curation.codex", True),
        ("stock-market-deep-analysis.codex", False),
    ]:
        capsule = registry.get(capsule_id)
        assert capsule.spec.permissions.sandbox == "read-only"
        assert capsule.spec.permissions.network is network
        assert capsule.spec.permissions.write_files is False
