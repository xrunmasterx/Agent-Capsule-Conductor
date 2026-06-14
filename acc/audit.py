from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso

AUDIT_SCHEMA_VERSION = "acc.audit.event.v1"
SENSITIVE_KEY_PARTS = ("token", "secret", "password", "credential", "cookie", "oauth")


def write_audit_event(
    project_root: Path,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "event_type": event_type,
        "created_at": utc_now_iso(),
        "payload": sanitize_payload(payload or {}),
    }
    path = project_root.resolve() / ".acc" / "audit" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def sanitize_payload(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            if any(part in key_text.lower() for part in SENSITIVE_KEY_PARTS):
                result[key_text] = "[redacted]"
            else:
                result[key_text] = sanitize_payload(child)
        return result
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, str):
        return sanitize_string(value)
    return value


def sanitize_string(value: str) -> str:
    if is_probable_absolute_path(value):
        return "[local_path]"
    return value


def is_probable_absolute_path(value: str) -> bool:
    if os.name == "nt":
        return (len(value) >= 3 and value[1:3] == ":\\") or value.startswith("\\\\")
    return value.startswith("/")
