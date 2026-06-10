"""Template bundle export/import (REQ-B5)."""

from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from acc.callable_registry import CallableRegistry
from acc.models import AccError, AgentClassTemplate
from acc.session import utc_now_iso
from acc.store import load_json, write_json

BUNDLE_VERSION = "1.0.0"
STATE_DENYLIST = {
    "runs",
    "session_manifest.json",
    "session_id",
    "run_dir",
    "last_output",
}
ABSOLUTE_PATH_RE = re.compile(r"^[A-Za-z]:\\|^/|^\\\\")


def _scan_for_secrets_and_state(root: Path) -> list[str]:
    issues: list[str] = []
    for path in root.rglob("*"):
        if path.is_dir():
            if path.name in STATE_DENYLIST:
                issues.append(f"Forbidden directory: {path.relative_to(root)}")
            continue
        rel = str(path.relative_to(root)).replace("\\", "/")
        if any(part in STATE_DENYLIST for part in rel.split("/")):
            issues.append(f"Forbidden path segment in {rel}")
        if path.suffix in {".json", ".yaml", ".yml", ".md"}:
            text = path.read_text(encoding="utf-8")
            if ABSOLUTE_PATH_RE.search(text):
                issues.append(f"Absolute path reference in {rel}")
            for key in STATE_DENYLIST:
                if f'"{key}"' in text or f"{key}:" in text:
                    issues.append(f"Forbidden field {key!r} in {rel}")
    return issues


def export_template_bundle(
    *,
    project_root: Path,
    output_path: Path,
    class_id: str | None = None,
    workflow_id: str | None = None,
    parent_bundle_id: str | None = None,
) -> dict[str, Any]:
    if not class_id and not workflow_id:
        raise AccError("export requires --class or --workflow")
    bundle_id = uuid4().hex
    staging = output_path.parent / f".accbundle_staging_{bundle_id}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "bundle_id": bundle_id,
        "bundle_version": BUNDLE_VERSION,
        "exported_at": utc_now_iso(),
        "lineage": {
            "parent_bundle_id": parent_bundle_id,
            "parent_version": BUNDLE_VERSION if parent_bundle_id else None,
            "forked_at": utc_now_iso() if parent_bundle_id else None,
        },
        "classes": [],
        "workflows": [],
        "skills": [],
    }
    if class_id:
        callable_registry = CallableRegistry.from_project_root(project_root)
        asset = callable_registry.resolve_class_id(class_id)
        source = asset.source_path
        if source is None:
            raise AccError(f"Callable class has no exportable source path: {class_id}")
        target = staging / "classes" / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
            skills_src = source / "skills"
            if skills_src.exists():
                shutil.copytree(skills_src, staging / "skills" / source.name)
                manifest["skills"].append({"class_id": class_id, "path": f"skills/{source.name}"})
        else:
            shutil.copy2(source, target)
        class_kind = (
            "agent_class" if isinstance(asset.template, AgentClassTemplate) else "tool_class"
        )
        manifest["classes"].append(
            {"id": class_id, "kind": class_kind, "path": f"classes/{source.name}"}
        )
    if workflow_id:
        workflows_dir = project_root / "workflows"
        workflow_path = workflows_dir / f"{workflow_id}.accflow.json"
        if not workflow_path.exists():
            raise AccError(f"Workflow template not found: {workflow_id}")
        wf_target = staging / "workflows"
        wf_target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(workflow_path, wf_target / workflow_path.name)
        manifest["workflows"].append({"id": workflow_id, "path": f"workflows/{workflow_path.name}"})
    write_json(staging / "manifest.json", manifest)
    issues = _scan_for_secrets_and_state(staging)
    if issues:
        shutil.rmtree(staging)
        raise AccError("; ".join(issues))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in staging.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(staging).as_posix())
    shutil.rmtree(staging)
    return manifest


def import_template_bundle(
    *,
    project_root: Path,
    bundle_path: Path,
    dry_run: bool = False,
    fork_id: str | None = None,
    replace: bool = False,
    human_approved: bool = False,
) -> dict[str, Any]:
    if replace and not human_approved:
        raise AccError("Import with --replace requires --human-approved")
    staging = project_root / ".acc" / "import_staging" / uuid4().hex
    staging.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(bundle_path) as archive:
            for member in archive.namelist():
                if member.startswith("/") or ".." in Path(member).parts:
                    raise AccError(f"Unsafe zip entry: {member}")
                archive.extract(member, staging)
        manifest_path = staging / "manifest.json"
        if not manifest_path.exists():
            raise AccError("Bundle missing manifest.json")
        manifest = load_json(manifest_path)
        issues = _scan_for_secrets_and_state(staging)
        if issues:
            raise AccError("; ".join(issues))
        result: dict[str, Any] = {
            "status": "validated" if dry_run else "imported",
            "bundle_id": manifest.get("bundle_id"),
            "imported_classes": [],
            "imported_workflows": [],
        }
        if dry_run:
            return result
        for entry in manifest.get("classes") or []:
            rel = entry.get("path")
            if not isinstance(rel, str):
                continue
            source = staging / rel
            class_kind = entry.get("kind")
            target_name = fork_id or source.stem if source.is_file() else fork_id or source.name
            if class_kind == "tool_class":
                target_root = project_root / "callables" / "tools"
            else:
                target_root = project_root / "callables" / "agents"
            target = (
                target_root / f"{target_name}.yaml"
                if source.is_file()
                else target_root / target_name
            )
            if target.exists() and not replace:
                raise AccError(f"Class already exists: {target_name}; use --fork-id or --replace")
            if target.exists():
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, target)
                callable_yaml = target / "callable.yaml"
            else:
                shutil.copy2(source, target)
                callable_yaml = target
            if isinstance(manifest.get("lineage"), dict) and callable_yaml.exists():
                raw = yaml.safe_load(callable_yaml.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    if fork_id:
                        raw["id"] = fork_id
                    metadata = raw.setdefault("metadata", {})
                    if isinstance(metadata, dict):
                        metadata["acc_lineage"] = manifest["lineage"]
                    callable_yaml.write_text(
                        yaml.safe_dump(raw, sort_keys=False, allow_unicode=True),
                        encoding="utf-8",
                    )
            result["imported_classes"].append(target_name)
        for entry in manifest.get("workflows") or []:
            rel = entry.get("path")
            if not isinstance(rel, str):
                continue
            source = staging / rel
            workflow_id = fork_id or Path(rel).name
            target = project_root / "workflows" / workflow_id
            if target.exists() and not replace:
                raise AccError(f"Workflow already exists: {workflow_id}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            result["imported_workflows"].append(workflow_id)
        skills_root = staging / "skills"
        if skills_root.exists():
            for skill_dir in skills_root.iterdir():
                if skill_dir.is_dir():
                    dest = project_root / ".acc" / "skills" / skill_dir.name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if dest.exists():
                        shutil.rmtree(dest)
                    shutil.copytree(skill_dir, dest)
        return result
    finally:
        if staging.exists():
            shutil.rmtree(staging)
