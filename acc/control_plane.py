from __future__ import annotations

import copy
import os
import re
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from acc.app.core_v2_loader import LEGACY_GRAPH_SUFFIX, reject_legacy_graph_path
from acc.callable_registry import CallableAsset, CallableRegistry, template_kind
from acc.callable_runner import DEFAULT_AGENT_OUTPUT_SCHEMA
from acc.run_index import load_run_summary, load_run_summary_by_id
from acc.runtime.codex_models import normalize_codex_model, normalize_codex_reasoning_effort
from acc.storage import assert_acc_run_dir
from acc.storage_refs import parse_artifact_ref
from acc.store import is_clean_workflow_path
from acc.utils import AccError, load_json, repo_root

SECRET_EXACT_NAMES = {
    ".codex",
    ".env",
    ".env.local",
    ".envrc",
    "auth.json",
    "codex_home",
    "config.toml",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "known_hosts",
    "provider_events.jsonl",
    "stderr.log",
    "stdout.log",
}
SECRET_SUBSTRINGS = {
    "access_token",
    "api_key",
    "apikey",
    "cookie",
    "credential",
    "oauth",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "token",
}
MAX_ARTIFACT_READ_BYTES = 1_000_000
CALLABLE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class CallableAlreadyExistsError(AccError):
    pass


class CallableNotFoundError(AccError):
    pass


class ArtifactNotFoundError(AccError):
    pass


class ArtifactTooLargeError(AccError):
    pass


class ArtifactEncodingError(AccError):
    pass


class ArtifactPolicyDeniedError(AccError):
    pass


class SecretLikePathError(AccError):
    pass


def list_callables_payload(project_root: Path | None = None) -> dict[str, Any]:
    root = (project_root or repo_root()).resolve()
    registry = CallableRegistry.from_project_root(root)
    return {"callables": [callable_summary(asset, root) for asset in registry.iter_assets()]}


def show_callable_payload(callable_id: str, project_root: Path | None = None) -> dict[str, Any]:
    root = (project_root or repo_root()).resolve()
    registry = CallableRegistry.from_project_root(root)
    asset = registry.resolve_class_id(callable_id)
    return {"callable": callable_detail(asset, root)}


def save_agent_callable_payload(
    project_root: Path,
    callable_id: str,
    payload: dict[str, Any],
    *,
    overwrite: bool,
) -> dict[str, Any]:
    root = project_root.resolve()
    validate_callable_id(callable_id)
    if payload.get("id") != callable_id:
        raise AccError("Callable id in path and body must match")

    path = agent_callable_path(root, callable_id)
    if path.exists() and not overwrite:
        raise CallableAlreadyExistsError(f"Agent callable already exists: {callable_id}")

    path.parent.mkdir(parents=True, exist_ok=True)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    temp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp")
    temp_path.write_text(
        yaml.safe_dump(agent_payload_to_yaml(payload), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    try:
        temp_path.replace(path)
        CallableRegistry.from_project_root(root).resolve_class_id(callable_id)
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(previous, encoding="utf-8")
        raise AccError(str(exc)) from exc

    return {
        "status": "saved",
        "callable": show_callable_payload(callable_id, root)["callable"],
    }


def delete_agent_callable_payload(project_root: Path, callable_id: str) -> dict[str, Any]:
    root = project_root.resolve()
    validate_callable_id(callable_id)
    path = agent_callable_path(root, callable_id)
    if not path.exists():
        raise CallableNotFoundError(f"Agent callable not found: {callable_id}")
    path.unlink()
    return {"status": "deleted", "id": callable_id}


def agent_payload_to_yaml(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(payload.get("metadata") or {})
    name = payload.get("name")
    description = payload.get("description")
    runtime = payload.get("runtime") or "codex_cli"
    if name:
        metadata["name"] = name
    if description:
        metadata["description"] = description
    if runtime in {"codex_cli", "codex_app_server"}:
        metadata["model"] = normalize_codex_model(metadata.get("model"))
        reasoning_effort = normalize_codex_reasoning_effort(metadata.get("reasoning_effort"))
        if reasoning_effort:
            metadata["reasoning_effort"] = reasoning_effort

    data: dict[str, Any] = {
        "id": payload["id"],
        "version": payload.get("version") or "0.1.0",
        "runtime": runtime,
    }
    if payload.get("default_prompt"):
        data["default_prompt"] = payload["default_prompt"]
    if payload.get("default_permissions"):
        data["default_permissions"] = payload["default_permissions"]
    data["input_ports"] = payload.get("input_ports") or {
        "main": {"type": "artifact", "required": False}
    }
    data["output_ports"] = payload.get("output_ports") or {
        "main": {"type": "artifact", "required": True}
    }
    artifact_contract = dict(payload.get("artifact_contract") or {})
    artifact_contract.setdefault("output_schema", copy.deepcopy(DEFAULT_AGENT_OUTPUT_SCHEMA))
    data["artifact_contract"] = artifact_contract
    if metadata:
        data["metadata"] = metadata
    return data


def validate_callable_id(callable_id: str) -> None:
    if not CALLABLE_ID_RE.fullmatch(callable_id):
        raise AccError("Callable id must match ^[A-Za-z0-9_.-]+$")


def agent_callable_path(project_root: Path, callable_id: str) -> Path:
    agents_dir = (project_root / "callables" / "agents").resolve()
    path = (agents_dir / f"{callable_id}.yaml").resolve()
    if not path.is_relative_to(agents_dir):
        raise AccError("Callable path is outside agents directory")
    return path


def list_workflows_payload(
    project_root: Path | None = None,
    workflows_dir: Path | None = None,
) -> dict[str, Any]:
    project_root = (project_root or repo_root()).resolve()
    workflows = [
        workflow_metadata(path, project_root)
        for path in discover_workflow_files(project_root, workflows_dir)
    ]
    workflows.sort(key=lambda item: item["path"])
    return {"workflows": workflows}


def show_workflow_payload(
    workflow_ref: str,
    project_root: Path | None = None,
    workflows_dir: Path | None = None,
) -> dict[str, Any]:
    project_root = (project_root or repo_root()).resolve()
    path = resolve_workflow_reference(project_root, workflow_ref, workflows_dir)
    metadata = workflow_metadata(path, project_root)
    payload = read_workflow_payload(path)
    result = {
        "workflow": payload,
        **metadata,
    }
    if path.suffix == ".json":
        if is_clean_workflow_path(path):
            from acc.app import validate_clean_workflow_file

            result["validation"] = validate_clean_workflow_file(path)
        else:
            reject_legacy_graph_path(path)
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


def read_artifact_payload(
    artifact_ref: str,
    project_root: Path | None = None,
) -> dict[str, Any]:
    project_root = (project_root or repo_root()).resolve()
    path = resolve_registered_artifact_reference(project_root, artifact_ref)
    reject_secret_like_path(path)
    if not path.exists() or not path.is_file():
        raise ArtifactNotFoundError(f"Artifact not found: {artifact_ref}")
    size = path.stat().st_size
    if size > MAX_ARTIFACT_READ_BYTES:
        raise ArtifactTooLargeError(f"Artifact is too large to read: {artifact_ref}")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ArtifactEncodingError(f"Artifact is not UTF-8 text: {artifact_ref}") from exc
    return {
        "artifact_ref": artifact_ref,
        "path": relative_project_path(project_root, path),
        "name": path.name,
        "type": infer_artifact_type(path),
        "size_bytes": size,
        "content": content,
    }


def callable_summary(asset: CallableAsset, project_root: Path) -> dict[str, Any]:
    template = asset.template
    payload: dict[str, Any] = {
        "id": template.id,
        "version": template.version,
        "kind": template_kind(template),
        "backend": asset.backend,
        "source_id": asset.source_id,
        "source_path": None,
    }
    name = template.metadata.get("name")
    description = template.metadata.get("description")
    if isinstance(name, str) and name:
        payload["name"] = name
    if isinstance(description, str) and description:
        payload["description"] = description
    if asset.source_path is not None:
        payload["source_path"] = relative_project_path(project_root, asset.source_path)
    payload["input_ports"] = {
        key: value.__dict__ for key, value in template.input_ports.items()
    }
    payload["output_ports"] = {
        key: value.__dict__ for key, value in template.output_ports.items()
    }
    payload["artifact_contract"] = template.artifact_contract
    return payload


def callable_detail(asset: CallableAsset, project_root: Path) -> dict[str, Any]:
    template = asset.template
    payload = callable_summary(asset, project_root)
    payload.update(
        {
            "metadata": template.metadata,
            "input_ports": {
                key: value.__dict__ for key, value in template.input_ports.items()
            },
            "output_ports": {
                key: value.__dict__ for key, value in template.output_ports.items()
            },
            "artifact_contract": template.artifact_contract,
        }
    )
    if hasattr(template, "runtime"):
        payload["runtime"] = template.runtime
    if hasattr(template, "default_prompt"):
        payload["default_prompt"] = template.default_prompt
    if hasattr(template, "runner"):
        payload["runner"] = template.runner
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
        for path in sorted(root.glob("*.accflow.json")):
            files.append(path.resolve())
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
    if workflow_ref.endswith((".accflow.json", LEGACY_GRAPH_SUFFIX, ".json", ".yaml", ".yml")):
        path = resolve_inside_project(project_root, candidate)
        if not path.exists():
            raise AccError(f"Workflow not found: {workflow_ref}")
        reject_legacy_graph_path(path)
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
) -> dict[str, Any]:
    payload = read_workflow_payload(path)
    if path.suffix == ".json":
        workflow_id = str(payload.get("id") or workflow_file_id(path))
        if is_clean_workflow_path(path):
            from acc.app import validate_clean_workflow_file

            validation = validate_clean_workflow_file(path)
            workflow_type = "accflow"
        else:
            reject_legacy_graph_path(path)
            workflow_type = "graph"
        node_count = validation.get("node_count", len(payload.get("nodes", [])))
        control_edge_count = validation.get(
            "control_edge_count", len(payload.get("control_edges", []))
        )
        data_edge_count = validation.get("data_edge_count", len(payload.get("data_edges", [])))
        return {
            "workflow_id": workflow_id,
            "file_id": workflow_file_id(path),
            "path": relative_project_path(project_root, path),
            "type": workflow_type,
            "name": payload.get("name"),
            "description": payload.get("description"),
            "version": payload.get("version"),
            "node_count": node_count,
            "control_edge_count": control_edge_count,
            "data_edge_count": data_edge_count,
            "validation_status": validation.get("status"),
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
    if path.name.endswith(".accflow.json"):
        return path.name.removesuffix(".accflow.json")
    if path.name.endswith(LEGACY_GRAPH_SUFFIX):
        return path.name.removesuffix(LEGACY_GRAPH_SUFFIX)
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
    parts = artifact_ref.split(":", 2)
    if len(parts) == 3:
        run_id, node_id, relative_path = parts
        if not run_id or not node_id or not relative_path:
            raise AccError(f"Invalid artifact ref: {artifact_ref}")
        v2_artifact_path = resolve_inside_project(
            project_root,
            Path("runs") / run_id / "nodes" / node_id / "artifacts" / relative_path,
        )
        if v2_artifact_path.exists():
            return v2_artifact_path
        v2_node_path = resolve_inside_project(
            project_root,
            Path("runs") / run_id / "nodes" / node_id / relative_path,
        )
        if v2_node_path.exists():
            return v2_node_path
        return resolve_inside_project(
            project_root,
            Path("runs") / run_id / "nodes" / node_id / relative_path,
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
    candidate = Path(artifact_ref)
    if candidate.drive or candidate.exists() or "/" in artifact_ref or "\\" in artifact_ref:
        return resolve_inside_project(project_root, candidate)
    return resolve_inside_project(project_root, candidate)


def resolve_registered_artifact_reference(project_root: Path, artifact_ref: str) -> Path:
    ref = str(artifact_ref or "").strip()
    try:
        parsed = parse_artifact_ref(ref)
    except AccError as exc:
        raise ArtifactPolicyDeniedError(
            "Artifact ref must be a registered run artifact ref"
        ) from exc
    if parsed.node_id is None:
        return _resolve_run_artifact_ref(project_root, parsed.run_id, parsed.relative_path)
    return _resolve_node_artifact_ref(
        project_root,
        parsed.run_id,
        parsed.node_id,
        parsed.relative_path,
    )


def _resolve_run_artifact_ref(project_root: Path, run_id: str, relative_path: str) -> Path:
    run_dir, summary = _load_owned_run(project_root, run_id)
    if not summary.artifact_dir:
        raise ArtifactNotFoundError(f"Run has no registered artifact directory: {run_id}")
    artifact_dir = Path(summary.artifact_dir or "")
    return _resolve_registered_artifact_path(
        project_root,
        run_dir,
        artifact_dir,
        relative_path,
    )


def _resolve_node_artifact_ref(
    project_root: Path,
    run_id: str,
    node_id: str,
    relative_path: str,
) -> Path:
    run_dir, summary = _load_owned_run(project_root, run_id)
    for node in summary.nodes:
        if node.node_id != node_id:
            continue
        if not node.artifact_dir:
            raise ArtifactNotFoundError(f"Node has no registered artifact directory: {node_id}")
        artifact_dir = Path(node.artifact_dir or "")
        return _resolve_registered_artifact_path(
            project_root,
            run_dir,
            artifact_dir,
            relative_path,
        )
    raise ArtifactNotFoundError(f"Node is not registered in run evidence: {node_id}")


def _load_owned_run(project_root: Path, run_id: str) -> tuple[Path, Any]:
    run_dir = (project_root / "runs" / run_id).resolve()
    assert_acc_run_dir(run_dir, project_root=project_root)
    return run_dir, load_run_summary_by_id(run_id, project_root / "runs")


def _resolve_registered_artifact_path(
    project_root: Path,
    run_dir: Path,
    artifact_dir: Path,
    relative_path: str,
) -> Path:
    if not relative_path or relative_path in {".", ".."}:
        raise ArtifactPolicyDeniedError("Artifact relative path is required")
    rel = Path(relative_path)
    if rel.is_absolute() or rel.drive or ".." in rel.parts:
        raise ArtifactPolicyDeniedError("Artifact ref contains an unsafe relative path")
    artifact_root = artifact_dir.resolve()
    if not artifact_root.is_relative_to(run_dir) or not artifact_root.is_relative_to(project_root):
        raise ArtifactPolicyDeniedError("Registered artifact root is outside ACC run evidence")
    path = (artifact_root / rel).resolve()
    if not path.is_relative_to(artifact_root):
        raise ArtifactPolicyDeniedError("Artifact ref escapes its registered artifact root")
    return path


def _validate_ref_component(value: str, label: str) -> str:
    if value in {"", ".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise ArtifactPolicyDeniedError(f"Invalid {label}: {value}")
    return value


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
        raise SecretLikePathError("Secret-like files are not exposed")
    if any(marker in name for marker in SECRET_SUBSTRINGS):
        raise SecretLikePathError("Secret-like files are not exposed")


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
