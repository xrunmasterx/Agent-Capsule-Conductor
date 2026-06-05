from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from acc.domain import AccError, EnvironmentBinding, SessionInstance
from acc.session import utc_now_iso


def is_clean_workflow_path(path: Path) -> bool:
    """Return True for canonical `.accflow.json` workflow templates."""
    return path.suffixes[-2:] == [".accflow", ".json"] or path.name.endswith(".accflow.json")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AccError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AccError(f"Invalid JSON in {path}: {exc}") from exc


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def load_clean_environment_binding(path: Path) -> EnvironmentBinding:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"EnvironmentBinding must be a JSON object: {path}")
    workflow_id = require_string(payload, "workflow_id", "EnvironmentBinding")
    raw_workspace = require_string(payload, "workspace_root", "EnvironmentBinding")
    workspace_root = Path(raw_workspace).expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace_root}")
    behavior_policy = payload.get("behavior_policy") or {"mode": "workspace_native"}
    if not isinstance(behavior_policy, dict):
        raise AccError("EnvironmentBinding behavior_policy must be an object")
    return EnvironmentBinding(
        workflow_id=workflow_id,
        binding_name=str(payload.get("binding_name") or path.stem),
        workspace_root=workspace_root,
        behavior_policy=behavior_policy,
        binding_path=path,
    )


def prepare_run_dir(run_dir: Path) -> None:
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)


def safe_child_path(path: Path, root: Path) -> None:
    root_resolved = root.resolve()
    path_resolved = path.resolve()
    if path_resolved != root_resolved and root_resolved not in path_resolved.parents:
        raise AccError(f"Path escapes root: {path}")


def file_record(path: Path, root: Path) -> dict[str, Any]:
    safe_child_path(path, root)
    return {
        "path": str(path.resolve()),
        "relative_path": str(path.resolve().relative_to(root.resolve())),
        "size_bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit_event(
    event_log: Path,
    event_type: str,
    *,
    status: str,
    node_id: str | None = None,
    level: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = {
        "timestamp": utc_now_iso(),
        "event_type": event_type,
        "status": status,
        "node_id": node_id,
        "level": level,
        "payload": payload or {},
    }
    event_log.parent.mkdir(parents=True, exist_ok=True)
    with event_log.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def emit_node_event(
    node_dir: Path,
    event_type: str,
    *,
    status: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return emit_event(
        node_dir / "events.jsonl",
        event_type,
        status=status,
        node_id=node_dir.name,
        payload=payload,
    )


def session_id_from_node_dir(node_dir: Path) -> str | None:
    manifest = node_dir / "session_instance_manifest.json"
    if not manifest.exists():
        return None
    payload = load_json(manifest)
    if not isinstance(payload, dict):
        return None
    value = payload.get("session_id")
    return value if isinstance(value, str) else None


def session_instance_payload(instance: SessionInstance) -> dict[str, Any]:
    return {
        "session_id": instance.session_id,
        "node_invocation_id": instance.node_invocation_id,
        "callable_ref": {
            "kind": instance.callable_ref.kind,
            "id": instance.callable_ref.id,
            "version": instance.callable_ref.version,
        },
        "scope_frame_id": instance.scope_frame_id,
        "cwd": str(instance.cwd),
        "status": instance.status,
        "adapter": instance.adapter,
        "started_at": instance.started_at,
        "ended_at": instance.ended_at,
        "stdout_path": str(instance.stdout_path) if instance.stdout_path else None,
        "stderr_path": str(instance.stderr_path) if instance.stderr_path else None,
        "event_log_path": str(instance.event_log_path) if instance.event_log_path else None,
        "input_manifest_path": (
            str(instance.input_manifest_path) if instance.input_manifest_path else None
        ),
        "output_manifest_path": (
            str(instance.output_manifest_path) if instance.output_manifest_path else None
        ),
        "artifact_bundle_id": instance.artifact_bundle_id,
        "failure_id": instance.failure_id,
    }


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value
