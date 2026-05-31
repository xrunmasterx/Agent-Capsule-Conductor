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
    payload["log_ref"] = node.log_ref or node.stdout_log
    payload["log_excerpt"] = node.log_excerpt or read_log_excerpt(payload["log_ref"])
    payload["transcript_ref"] = node.transcript_ref or node.stdout_log
    if project_root is not None and payload.get("log_ref"):
        payload["log_ref"] = _relative_or_keep(project_root, payload["log_ref"])
    if project_root is not None and payload.get("transcript_ref"):
        payload["transcript_ref"] = _relative_or_keep(project_root, payload["transcript_ref"])
    return payload


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
