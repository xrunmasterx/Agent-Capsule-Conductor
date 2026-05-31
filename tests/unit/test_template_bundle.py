from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from acc.app.template_bundle import export_template_bundle, import_template_bundle
from acc.domain import AccError
from acc.registry import CapsuleRegistry


def _seed_capsule(root: Path, capsule_id: str = "demo.generic") -> None:
    capsule_dir = root / "capsules" / "demo.generic"
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        f"""
id: {capsule_id}
version: 0.1.0
name: Demo
description: Demo
runtime:
  type: generic_cli
  command: python
  args_base: ["-c", "print('ok')"]
workspace:
  mode: existing_dir
permissions:
  sandbox: read-only
  network: false
  write_files: false
  timeout_seconds: 10
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
    for name in (
        "prompt_template.md",
        "input_schema.json",
        "output_schema.json",
        "artifact_manifest.yaml",
    ):
        (capsule_dir / name).write_text("{}", encoding="utf-8")


def test_export_template_bundle_excludes_runs(tmp_path: Path) -> None:
    _seed_capsule(tmp_path)
    output = tmp_path / "bundle.zip"
    manifest = export_template_bundle(
        project_root=tmp_path,
        output_path=output,
        class_id="demo.generic",
    )
    assert output.exists()
    assert manifest["bundle_version"] == "1.0.0"
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
    assert not any(name.startswith("runs/") for name in names)


def test_import_rejects_bundle_with_runs(tmp_path: Path) -> None:
    bundle = tmp_path / "bad.zip"
    staging = tmp_path / "stage"
    staging.mkdir()
    (staging / "manifest.json").write_text(
        '{"bundle_id":"x","bundle_version":"1.0.0"}', encoding="utf-8"
    )
    runs_dir = staging / "runs" / "bad"
    runs_dir.mkdir(parents=True)
    (runs_dir / "session_manifest.json").write_text("{}", encoding="utf-8")
    with zipfile.ZipFile(bundle, "w") as archive:
        for path in staging.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(staging).as_posix())
    with pytest.raises(AccError, match="Forbidden"):
        import_template_bundle(project_root=tmp_path / "proj", bundle_path=bundle, dry_run=True)


def test_import_dry_run_no_write(tmp_path: Path) -> None:
    _seed_capsule(tmp_path)
    bundle_path = tmp_path / "good.zip"
    export_template_bundle(project_root=tmp_path, output_path=bundle_path, class_id="demo.generic")
    target_root = tmp_path / "import_target"
    target_root.mkdir()
    result = import_template_bundle(
        project_root=target_root,
        bundle_path=bundle_path,
        dry_run=True,
    )
    assert result["status"] == "validated"
    assert not (target_root / "capsules").exists()


def test_import_writes_lineage(tmp_path: Path) -> None:
    _seed_capsule(tmp_path)
    bundle_path = tmp_path / "good.zip"
    export_template_bundle(project_root=tmp_path, output_path=bundle_path, class_id="demo.generic")
    target_root = tmp_path / "import_target"
    target_root.mkdir()
    import_template_bundle(
        project_root=target_root,
        bundle_path=bundle_path,
        fork_id="demo.fork",
    )
    registry = CapsuleRegistry(target_root / "capsules")
    capsule = registry.get("demo.generic")
    assert capsule.raw.get("metadata", {}).get("acc_lineage") is not None
