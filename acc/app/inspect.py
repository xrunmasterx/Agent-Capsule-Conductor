from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.store import load_json


def workflow_inspect_payload(run_dir: Path) -> dict[str, Any]:
    summary_path = run_dir / "workflow_summary.json"
    manifest_path = run_dir / "workflow_run_manifest.json"
    event_log_path = run_dir / "workflow_events.jsonl"
    invocation_path = run_dir / "function_invocation_manifest.json"
    scope_path = run_dir / "scope_frame_manifest.json"
    summary = load_json(summary_path) if summary_path.exists() else None
    manifest = load_json(manifest_path) if manifest_path.exists() else None
    function_invocation = load_json(invocation_path) if invocation_path.exists() else None
    scope_frame = load_json(scope_path) if scope_path.exists() else None
    sessions = inspect_session_instances(run_dir)
    workflow_calls = inspect_workflow_calls(run_dir)
    return {
        "run_dir": str(run_dir.resolve()),
        "status": (summary or {}).get("status") or (manifest or {}).get("status"),
        "workflow_id": (summary or {}).get("workflow_id") or (manifest or {}).get("workflow_id"),
        "event_log": str(event_log_path.resolve()),
        "summary_path": str(summary_path.resolve()),
        "manifest_path": str(manifest_path.resolve()),
        "summary": summary,
        "manifest": manifest,
        "function_invocation": function_invocation,
        "scope_frame": scope_frame,
        "node_sessions": sessions,
        "workflow_calls": workflow_calls,
        "call_stack": build_workflow_call_stack(function_invocation, scope_frame, workflow_calls),
        "lineage": inspect_inbox_outbox_lineage(run_dir),
    }


def inspect_session_instances(run_dir: Path) -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    for path in sorted((run_dir / "nodes").glob("*/session_instance_manifest.json")):
        payload = load_json(path)
        if isinstance(payload, dict):
            sessions.append({**payload, "manifest_path": str(path.resolve())})
    return sessions


def inspect_workflow_calls(run_dir: Path) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for path in sorted((run_dir / "nodes").glob("*/workflow_call_manifest.json")):
        payload = load_json(path)
        if isinstance(payload, dict):
            calls.append({**payload, "manifest_path": str(path.resolve())})
    return calls


def build_workflow_call_stack(
    function_invocation: Any,
    scope_frame: Any,
    workflow_calls: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    stack: list[dict[str, Any]] = []
    if isinstance(function_invocation, dict) and isinstance(scope_frame, dict):
        stack.append(
            {
                "invocation_id": function_invocation.get("invocation_id"),
                "workflow_function_id": function_invocation.get("workflow_function_id"),
                "scope_frame_id": scope_frame.get("frame_id"),
                "parent_invocation_id": function_invocation.get("parent_invocation_id"),
                "parent_frame_id": scope_frame.get("parent_frame_id"),
                "call_depth": scope_frame.get("call_depth"),
            }
        )
    for call in workflow_calls:
        stack.append(
            {
                "node_id": call.get("node_id"),
                "child_workflow_id": call.get("child_workflow_id"),
                "child_invocation_manifest": call.get("child_invocation_manifest"),
                "child_scope_frame_manifest": call.get("child_scope_frame_manifest"),
                "status": call.get("status"),
            }
        )
    return stack


def inspect_inbox_outbox_lineage(run_dir: Path) -> dict[str, list[dict[str, Any]]]:
    return {
        "inboxes": read_manifest_tree(run_dir / "nodes", "inbox_manifest.json"),
        "outboxes": read_manifest_tree(run_dir / "nodes", "outbox_manifest.json"),
        "artifact_bundles": read_manifest_tree(run_dir / "nodes", "artifact_bundle.json"),
    }


def read_manifest_tree(root: Path, filename: str) -> list[dict[str, Any]]:
    manifests: list[dict[str, Any]] = []
    if not root.exists():
        return manifests
    for path in sorted(root.rglob(filename)):
        payload = load_json(path)
        if isinstance(payload, dict):
            manifests.append({**payload, "manifest_path": str(path.resolve())})
    return manifests
