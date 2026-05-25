from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel, ConfigDict


class SessionManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    capsule_id: str
    capsule_version: str
    status: str
    created_at: str
    updated_at: str
    run_dir: str
    workspace_dir: str | None = None
    input_path: str | None = None
    prompt_path: str | None = None
    output_path: str | None = None
    artifact_dir: str
    event_log_path: str
    conductor_output_path: str
    template_snapshot_dir: str | None = None
    lifecycle_log_dir: str | None = None
    capsule_kind: str | None = None
    parent_workflow_run_id: str | None = None
    parent_node_id: str | None = None
    error: str | None = None


def new_session_id() -> str:
    return f"session_{uuid4().hex}"


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
