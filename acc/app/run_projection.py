"""Run/node API projections for progressive disclosure (REQ-B1-002)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.events import iter_jsonl_events, sanitize_event_payload
from acc.run_index import NodeRunSummary
from acc.utils import AccError, load_json

OUTPUT_PREVIEW_MAX_BYTES = 32 * 1024
STEPS_MAX_COUNT = 50
LOG_EXCERPT_MAX_CHARS = 2048


def build_node_run_projection(
    node: NodeRunSummary,
    *,
    project_root: Path | None = None,
) -> dict[str, Any]:
    payload = node.model_dump()
    run_dir = Path(node.run_dir)
    payload["output_preview"] = build_output_preview(node.output_path)
    payload["steps"] = build_event_steps(node.event_log, run_dir=run_dir)
    runtime_payload = load_optional_json(run_dir / "runtime.json")
    binding_manifest = load_optional_json(run_dir / "binding_manifest.json")
    payload["runtime"] = runtime_payload
    payload["binding_manifest"] = binding_manifest
    payload["binding_summary"] = build_binding_summary_projection(binding_manifest)
    payload["node_inspector"] = build_node_inspector_projection(
        node,
        runtime_payload=runtime_payload,
        binding_manifest=binding_manifest,
    )
    if isinstance(runtime_payload, dict):
        payload["execution_mode"] = runtime_payload.get("execution_mode")
        payload["adapter"] = runtime_payload.get("adapter")
        payload["binding_resolved"] = runtime_payload.get("binding_materializations") or []
    effective_stdout = effective_agent_turn_log(run_dir, runtime_payload, "stdout")
    effective_stderr = effective_agent_turn_log(run_dir, runtime_payload, "stderr")
    payload["log_ref"] = node.log_ref or effective_stdout or effective_stderr or node.stdout_log
    payload["log_excerpt"] = node.log_excerpt or read_log_excerpt(payload["log_ref"])
    payload["transcript_ref"] = node.transcript_ref or effective_stdout or node.stdout_log
    if project_root is not None and payload.get("log_ref"):
        payload["log_ref"] = _relative_or_keep(project_root, payload["log_ref"])
    if project_root is not None and payload.get("transcript_ref"):
        payload["transcript_ref"] = _relative_or_keep(project_root, payload["transcript_ref"])
    return payload


def build_node_inspector_projection(
    node: NodeRunSummary,
    *,
    runtime_payload: Any,
    binding_manifest: Any,
) -> dict[str, Any]:
    runtime = runtime_payload if isinstance(runtime_payload, dict) else {}
    return {
        "schema_version": "acc.projection.node_inspector.v1",
        "node_id": node.node_id,
        "callable_id": node.callable_id,
        "status": node.status,
        "summary": node.summary,
        "execution": {
            "execution_mode": runtime.get("execution_mode"),
            "adapter": runtime.get("adapter"),
            "session_id": node.session_id,
        },
        "evidence_refs": {
            "run_dir": node.run_dir,
            "input_path": node.input_path,
            "prompt_path": node.prompt_path,
            "output_path": node.output_path,
            "artifact_dir": node.artifact_dir,
            "event_log": node.event_log,
            "stdout_log": node.stdout_log,
            "stderr_log": node.stderr_log,
        },
        "binding_summary": build_binding_summary_projection(binding_manifest),
        "raw_evidence_debug": {
            "runtime_path": str(Path(node.run_dir) / "runtime.json"),
            "binding_manifest_path": str(Path(node.run_dir) / "binding_manifest.json"),
        },
    }


def build_binding_summary_projection(binding_manifest: Any) -> dict[str, Any]:
    manifest = binding_manifest if isinstance(binding_manifest, dict) else {}
    bindings = manifest.get("bindings") if isinstance(manifest.get("bindings"), list) else []
    inputs = manifest.get("inputs") if isinstance(manifest.get("inputs"), list) else []
    source_kinds: dict[str, int] = {}
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        source_kind = str(binding.get("source_kind") or binding.get("binding_kind") or "unknown")
        source_kinds[source_kind] = source_kinds.get(source_kind, 0) + 1
    return {
        "schema_version": "acc.projection.binding_summary.v1",
        "input_count": len(inputs),
        "binding_count": len(bindings),
        "inputs": [str(item) for item in inputs],
        "source_kinds": source_kinds,
    }


def load_optional_json(path: Path) -> Any:
    if not path.exists() or not path.is_file():
        return None
    try:
        return load_json(path)
    except AccError:
        return None


def build_output_preview(output_path: str | None) -> Any:
    if not output_path:
        return None
    path = Path(output_path)
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    if len(raw.encode("utf-8")) <= OUTPUT_PREVIEW_MAX_BYTES:
        try:
            return load_json(path)
        except AccError:
            return {"text": raw}
    preview_text = raw[:OUTPUT_PREVIEW_MAX_BYTES]
    return {
        "_truncated": True,
        "preview_bytes": OUTPUT_PREVIEW_MAX_BYTES,
        "size_bytes": len(raw.encode("utf-8")),
        "preview": preview_text,
    }


def build_event_steps(
    event_log: str | None,
    *,
    run_dir: Path | None = None,
) -> list[dict[str, Any]]:
    if not event_log:
        return []
    path = Path(event_log)
    if not path.exists() and run_dir is not None:
        candidate = run_dir / "events.jsonl"
        if candidate.exists():
            path = candidate
    if not path.exists():
        return []
    steps: list[dict[str, Any]] = []
    for event in iter_jsonl_events(path):
        if len(steps) >= STEPS_MAX_COUNT:
            break
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        sanitized = sanitize_event_payload(payload)
        steps.append(
            {
                "event_id": event.get("event_id"),
                "type": event.get("type"),
                "timestamp": event.get("timestamp"),
                "status": event.get("status"),
                "summary": _step_summary(sanitized),
                "log_ref": sanitized.get("log_ref"),
            }
        )
    return steps


def read_log_excerpt(log_ref: str | None) -> str | None:
    if not log_ref:
        return None
    path = Path(log_ref)
    if not path.exists() or not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    if len(text) <= LOG_EXCERPT_MAX_CHARS:
        return text
    return text[:LOG_EXCERPT_MAX_CHARS] + "\n... [truncated]"


def effective_agent_turn_log(run_dir: Path, runtime_payload: Any, stream: str) -> str | None:
    if not isinstance(runtime_payload, dict):
        return None
    session_ref = runtime_payload.get("agent_session_ref")
    turn_id = runtime_payload.get("turn_id")
    if not isinstance(session_ref, str) or not isinstance(turn_id, str):
        return None
    if (
        turn_id in {"", ".", ".."}
        or Path(turn_id).name != turn_id
        or "/" in turn_id
        or "\\" in turn_id
    ):
        return None
    project_root = project_root_for_run_projection(run_dir)
    agent_sessions_root = (project_root / "runs" / "_agent_sessions").resolve()
    try:
        session_dir = Path(session_ref).resolve()
        session_dir.relative_to(agent_sessions_root)
    except (OSError, ValueError):
        return None
    log_path = session_dir / "turns" / turn_id / f"{stream}.log"
    return str(log_path) if log_path.exists() and log_path.is_file() else None


def project_root_for_run_projection(run_dir: Path) -> Path:
    resolved = run_dir.resolve()
    if resolved.parent.name == "nodes" and resolved.parent.parent.parent.name == "runs":
        return resolved.parent.parent.parent.parent
    if resolved.parent.name == "runs":
        return resolved.parent.parent
    return resolved.parent


def _step_summary(payload: dict[str, Any]) -> str:
    for key in ("summary", "message", "error"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    excerpt = payload.get("excerpt")
    if isinstance(excerpt, str) and excerpt.strip():
        return excerpt.strip()[:240]
    return ""


def _relative_or_keep(project_root: Path, path_value: str) -> str:
    path = Path(path_value).resolve()
    try:
        return str(path.relative_to(project_root.resolve()))
    except ValueError:
        return path_value
