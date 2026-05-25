from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from acc.registry import CapsuleDefinition, CapsuleRegistry
from acc.run_index import load_run_summary, load_run_summary_by_id
from acc.utils import AccError, load_json, repo_root
from acc.workflow_graph import validate_workflow_graph

SECRET_EXACT_NAMES = {
    ".env",
    ".env.local",
    ".envrc",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "known_hosts",
}
SECRET_SUBSTRINGS = {
    "api_key",
    "apikey",
    "credential",
    "password",
    "private_key",
    "secret",
    "token",
}
MAX_ARTIFACT_READ_BYTES = 1_000_000


def list_capsules_payload(capsules_dir: Path | None = None) -> dict[str, Any]:
    project_root = repo_root().resolve()
    registry = CapsuleRegistry(capsules_dir)
    capsules = [capsule_summary(capsule, project_root) for capsule in registry.discover()]
    return {"capsules": capsules}


def show_capsule_payload(capsule_id: str, capsules_dir: Path | None = None) -> dict[str, Any]:
    project_root = repo_root().resolve()
    registry = CapsuleRegistry(capsules_dir)
    capsule = registry.get(capsule_id)
    payload = capsule_summary(capsule, project_root)
    payload.update(
        {
            "description": capsule.spec.description,
            "permissions": capsule.spec.permissions.model_dump(),
            "schemas": capsule.spec.schemas.model_dump(),
            "artifacts": capsule.spec.artifacts.model_dump(),
            "workspace_config": capsule.spec.workspace.model_dump(),
            "runtime_config": capsule.spec.runtime.model_dump(),
            "behavior_pack": None
            if capsule.spec.behavior_pack is None
            else capsule.spec.behavior_pack.model_dump(),
            "workflow": None
            if capsule.spec.workflow is None
            else capsule.spec.workflow.model_dump(),
            "prompt": None if capsule.spec.prompt is None else capsule.spec.prompt.model_dump(),
            "lifecycle": None
            if capsule.spec.lifecycle is None
            else capsule.spec.lifecycle.model_dump(),
        }
    )
    return {"capsule": payload}


def list_workflows_payload(
    workflows_dir: Path | None = None,
    capsules_dir: Path | None = None,
) -> dict[str, Any]:
    project_root = repo_root().resolve()
    registry = CapsuleRegistry(capsules_dir)
    workflows = [
        workflow_metadata(path, project_root, registry)
        for path in discover_workflow_files(project_root, workflows_dir)
    ]
    workflows.sort(key=lambda item: item["path"])
    return {"workflows": workflows}


def show_workflow_payload(
    workflow_ref: str,
    workflows_dir: Path | None = None,
    capsules_dir: Path | None = None,
) -> dict[str, Any]:
    project_root = repo_root().resolve()
    registry = CapsuleRegistry(capsules_dir)
    path = resolve_workflow_reference(project_root, workflow_ref, workflows_dir)
    metadata = workflow_metadata(path, project_root, registry)
    payload = read_workflow_payload(path)
    result = {
        "workflow": payload,
        **metadata,
    }
    if path.suffix == ".json":
        result["validation"] = validate_workflow_graph(path, registry=registry)
        result["graph"] = payload
    return result


def show_run_payload(run_ref: str, runs_root: Path = Path("runs")) -> dict[str, Any]:
    run_path = Path(run_ref)
    if run_path.exists():
        summary = load_run_summary(resolve_inside_project(repo_root().resolve(), run_path))
        if summary is None:
            raise AccError(f"Run not found: {run_ref}")
        return summary.model_dump()
    return load_run_summary_by_id(run_ref, runs_root).model_dump()


def read_artifact_payload(artifact_ref: str) -> dict[str, Any]:
    project_root = repo_root().resolve()
    path = resolve_artifact_reference(project_root, artifact_ref)
    reject_secret_like_path(path)
    if not path.exists() or not path.is_file():
        raise AccError(f"Artifact not found: {artifact_ref}")
    size = path.stat().st_size
    if size > MAX_ARTIFACT_READ_BYTES:
        raise AccError(f"Artifact is too large to read: {artifact_ref}")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise AccError(f"Artifact is not UTF-8 text: {artifact_ref}") from exc
    return {
        "artifact_ref": artifact_ref,
        "path": relative_project_path(project_root, path),
        "name": path.name,
        "type": infer_artifact_type(path),
        "size_bytes": size,
        "content": content,
    }


def capsule_summary(capsule: CapsuleDefinition, project_root: Path) -> dict[str, Any]:
    payload = capsule.to_metadata()
    payload["capsule_dir"] = relative_project_path(project_root, capsule.capsule_dir)
    payload["yaml_path"] = relative_project_path(project_root, capsule.yaml_path)
    return payload


def discover_workflow_files(project_root: Path, workflows_dir: Path | None = None) -> list[Path]:
    roots: list[Path] = []
    configured = workflows_dir or Path(os.environ.get("ACC_WORKFLOWS_DIR", "workflows"))
    roots.append(resolve_inside_project(project_root, configured))
    examples_dir = project_root / "examples" / "workflows"
    if examples_dir.exists() and examples_dir.resolve() not in {root.resolve() for root in roots}:
        roots.append(examples_dir.resolve())

    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        files.extend(sorted(root.glob("*.graph.json")))
        files.extend(sorted(root.glob("*.yaml")))
        files.extend(sorted(root.glob("*.yml")))
    return dedupe_paths(files)


def dedupe_paths(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    deduped: list[Path] = []
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        deduped.append(resolved)
    return deduped


def resolve_workflow_reference(
    project_root: Path,
    workflow_ref: str,
    workflows_dir: Path | None = None,
) -> Path:
    candidate = Path(workflow_ref)
    if workflow_ref.endswith((".graph.json", ".json", ".yaml", ".yml")):
        path = resolve_inside_project(project_root, candidate)
        if not path.exists():
            raise AccError(f"Workflow not found: {workflow_ref}")
        return path

    for path in discover_workflow_files(project_root, workflows_dir):
        payload = read_workflow_payload(path)
        file_id = workflow_file_id(path)
        workflow_id = str(payload.get("id") or payload.get("name") or file_id)
        if workflow_ref in {file_id, workflow_id}:
            return path
    raise AccError(f"Workflow not found: {workflow_ref}")


def workflow_metadata(
    path: Path,
    project_root: Path,
    registry: CapsuleRegistry,
) -> dict[str, Any]:
    payload = read_workflow_payload(path)
    if path.suffix == ".json":
        workflow_id = str(payload.get("id") or workflow_file_id(path))
        validation = validate_workflow_graph(path, registry=registry)
        return {
            "workflow_id": workflow_id,
            "file_id": workflow_file_id(path),
            "path": relative_project_path(project_root, path),
            "type": "graph",
            "name": payload.get("name"),
            "description": payload.get("description"),
            "version": payload.get("version"),
            "node_count": validation["node_count"],
            "control_edge_count": validation["control_edge_count"],
            "data_edge_count": validation["data_edge_count"],
        }
    workflow_id = str(payload.get("name") or workflow_file_id(path))
    task_count = len(payload.get("tasks", [])) if isinstance(payload.get("tasks"), list) else 0
    return {
        "workflow_id": workflow_id,
        "file_id": workflow_file_id(path),
        "path": relative_project_path(project_root, path),
        "type": "yaml",
        "name": payload.get("name"),
        "description": payload.get("description"),
        "version": payload.get("version"),
        "task_count": task_count,
    }


def workflow_file_id(path: Path) -> str:
    if path.name.endswith(".graph.json"):
        return path.name.removesuffix(".graph.json")
    return path.stem


def read_workflow_payload(path: Path) -> dict[str, Any]:
    if path.suffix == ".json":
        payload = load_json(path)
    else:
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise AccError(f"Invalid workflow YAML in {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise AccError(f"Workflow file must be an object: {path}")
    return payload


def resolve_artifact_reference(project_root: Path, artifact_ref: str) -> Path:
    candidate = Path(artifact_ref)
    if candidate.drive or candidate.exists() or "/" in artifact_ref or "\\" in artifact_ref:
        return resolve_inside_project(project_root, candidate)

    parts = artifact_ref.split(":", 2)
    if len(parts) == 3:
        run_id, node_id, relative_path = parts
        if not run_id or not node_id or not relative_path:
            raise AccError(f"Invalid artifact ref: {artifact_ref}")
        artifact_path = resolve_inside_project(
            project_root,
            Path("runs") / run_id / "node_runs" / node_id / "artifacts" / relative_path,
        )
        if artifact_path.exists():
            return artifact_path
        return resolve_inside_project(
            project_root,
            Path("runs") / run_id / "node_runs" / node_id / relative_path,
        )
    if len(parts) == 2:
        run_id, relative_path = parts
        if not run_id or not relative_path:
            raise AccError(f"Invalid artifact ref: {artifact_ref}")
        artifact_path = resolve_inside_project(
            project_root,
            Path("runs") / run_id / "artifacts" / relative_path,
        )
        if artifact_path.exists():
            return artifact_path
        return resolve_inside_project(project_root, Path("runs") / run_id / relative_path)
    return resolve_inside_project(project_root, candidate)


def resolve_inside_project(project_root: Path, value: str | Path) -> Path:
    raw_path = Path(value)
    candidate = raw_path if raw_path.is_absolute() else project_root / raw_path
    resolved = candidate.resolve()
    if not resolved.is_relative_to(project_root):
        raise AccError(f"Path is outside project root: {value}")
    return resolved


def relative_project_path(project_root: Path, path: Path) -> str:
    return str(path.resolve().relative_to(project_root)).replace("\\", "/")


def reject_secret_like_path(path: Path) -> None:
    lower_parts = [part.lower() for part in path.parts]
    name = path.name.lower()
    if name in SECRET_EXACT_NAMES or any(part in SECRET_EXACT_NAMES for part in lower_parts):
        raise AccError("Secret-like files are not exposed")
    if any(marker in name for marker in SECRET_SUBSTRINGS):
        raise AccError("Secret-like files are not exposed")


def infer_artifact_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "markdown"
    if suffix == ".json":
        return "json"
    if suffix in {".log", ".jsonl"}:
        return "log"
    if suffix in {".patch", ".diff"}:
        return "patch"
    return "text"
