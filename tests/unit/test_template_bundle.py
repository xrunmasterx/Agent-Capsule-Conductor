from __future__ import annotations

import zipfile
from pathlib import Path

import pytest
import yaml

from acc.app.template_bundle import export_template_bundle, import_template_bundle
from acc.models import AccError


def _seed_callable(root: Path, class_id: str = "demo.generic") -> None:
    callables_dir = root / "callables" / "agents"
    callables_dir.mkdir(parents=True)
    (callables_dir / f"{class_id}.yaml").write_text(
        f"""
id: {class_id}
version: 0.1.0
runtime: generic_fake_agent
default_prompt: Demo
metadata:
  owner: test
""".strip(),
        encoding="utf-8",
    )


def test_export_template_bundle_excludes_runs(tmp_path: Path) -> None:
    _seed_callable(tmp_path)
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
    _seed_callable(tmp_path)
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
    assert not (target_root / "callables").exists()


def test_import_writes_lineage(tmp_path: Path) -> None:
    _seed_callable(tmp_path)
    bundle_path = tmp_path / "good.zip"
    export_template_bundle(project_root=tmp_path, output_path=bundle_path, class_id="demo.generic")
    target_root = tmp_path / "import_target"
    target_root.mkdir()
    import_template_bundle(
        project_root=target_root,
        bundle_path=bundle_path,
        fork_id="demo.fork",
    )
    callable_path = target_root / "callables" / "agents" / "demo.fork.yaml"
    raw = yaml.safe_load(callable_path.read_text(encoding="utf-8"))
    assert raw["id"] == "demo.fork"
    assert raw.get("metadata", {}).get("acc_lineage") is not None
