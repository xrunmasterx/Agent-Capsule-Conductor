from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from acc.utils import AccError, load_json

INDEX_VERSION = "2.0"
SUCCESS_STATUSES = {"success"}


class SummaryError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error_class: str
    message: str
    paths: dict[str, str] = Field(default_factory=dict)


class NodeRunSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    node_id: str
    capsule_id: str
    session_id: str | None = None
    status: str
    summary: str = ""
    duration_ms: int | None = None
    run_dir: str
    input_path: str | None = None
    prompt_path: str | None = None
    output_path: str | None = None
    artifact_dir: str | None = None
    event_log: str | None = None
    stdout_log: str | None = None
    stderr_log: str | None = None
    errors: list[SummaryError] = Field(default_factory=list)


class RunSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    run_id: str
    workflow_id: str | None = None
    status: str
    started_at: str | None = None
    ended_at: str | None = None
    duration_ms: int | None = None
    run_dir: str
    node_count: int = 0
    failed_nodes: list[str] = Field(default_factory=list)
    output_path: str | None = None
    artifact_dir: str | None = None
    nodes: list[NodeRunSummary] = Field(default_factory=list)


class RunIndex(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = INDEX_VERSION
    runs: list[RunSummary] = Field(default_factory=list)


def write_node_summary(
    run_dir: Path,
    manifest: dict[str, Any],
    conductor_output: dict[str, Any],
    error_class: str | None = None,
    error_message: str | None = None,
) -> NodeRunSummary:
    summary = build_node_summary(run_dir, manifest, conductor_output, error_class, error_message)
    write_json(run_dir / "node_summary.json", summary.model_dump())
    return summary


def write_run_summary(run_dir: Path, node_summary: NodeRunSummary) -> RunSummary:
    summary = build_run_summary(run_dir, [node_summary])
    write_json(run_dir / "run_summary.json", summary.model_dump())
    return summary


def update_project_run_index(run_dir: Path) -> None:
    runs_root = Path("runs").resolve()
    resolved_run_dir = run_dir.resolve()
    if resolved_run_dir.parent != runs_root:
        return
    index = rebuild_run_index(runs_root)
    runs_root.mkdir(parents=True, exist_ok=True)
    write_json(runs_root / "index.json", index.model_dump())


def load_or_rebuild_run_index(runs_root: Path = Path("runs")) -> RunIndex:
    index_path = runs_root / "index.json"
    if index_path.exists():
        try:
            return RunIndex.model_validate(load_json(index_path))
        except AccError:
            return rebuild_run_index(runs_root)
    return rebuild_run_index(runs_root)


def rebuild_run_index(runs_root: Path = Path("runs")) -> RunIndex:
    if not runs_root.exists():
        return RunIndex()
    summaries: list[RunSummary] = []
    for run_dir in sorted(path for path in runs_root.iterdir() if path.is_dir()):
        summary = load_run_summary(run_dir)
        if summary is not None:
            summaries.append(summary)
    summaries.sort(key=lambda item: item.started_at or item.run_id, reverse=True)
    return RunIndex(runs=summaries)


def load_run_summary_by_id(run_id: str, runs_root: Path = Path("runs")) -> RunSummary:
    index = load_or_rebuild_run_index(runs_root)
    for summary in index.runs:
        if summary.run_id == run_id:
            return summary
    summary = load_run_summary(runs_root / run_id)
    if summary is not None:
        return summary
    raise AccError(f"Run not found: {run_id}")


def load_run_summary(run_dir: Path) -> RunSummary | None:
    summary_path = run_dir / "run_summary.json"
    if summary_path.exists():
        try:
            return RunSummary.model_validate(load_json(summary_path))
        except AccError:
            return invalid_run_summary(run_dir, "Invalid run_summary.json")

    node_path = run_dir / "node_summary.json"
    if node_path.exists():
        try:
            node = NodeRunSummary.model_validate(load_json(node_path))
        except AccError:
            return invalid_run_summary(run_dir, "Invalid node_summary.json")
        return build_run_summary(run_dir, [node])

    conductor_path = run_dir / "conductor_output.json"
    manifest_path = run_dir / "session_manifest.json"
    if not conductor_path.exists() and not manifest_path.exists():
        return None

    try:
        conductor_output = load_json(conductor_path) if conductor_path.exists() else {}
        manifest = load_json(manifest_path) if manifest_path.exists() else {}
    except AccError:
        return invalid_run_summary(run_dir, "Invalid run metadata")

    node = build_node_summary(run_dir, manifest, conductor_output)
    return build_run_summary(run_dir, [node])


def build_node_summary(
    run_dir: Path,
    manifest: dict[str, Any],
    conductor_output: dict[str, Any],
    error_class: str | None = None,
    error_message: str | None = None,
) -> NodeRunSummary:
    status = str(conductor_output.get("status") or manifest.get("status") or "unknown")
    message = error_message or conductor_output.get("error") or manifest.get("error")
    errors: list[SummaryError] = []
    if message:
        errors.append(
            SummaryError(
                error_class=error_class or classify_error(status, str(message)),
                message=str(message),
                paths=debug_paths(run_dir, manifest, conductor_output),
            )
        )

    return NodeRunSummary(
        node_id=str(manifest.get("parent_node_id") or run_dir.name),
        capsule_id=str(manifest.get("capsule_id") or "unknown"),
        session_id=manifest.get("session_id") or conductor_output.get("session_id"),
        status=status,
        summary=str(conductor_output.get("summary") or ""),
        duration_ms=duration_ms(manifest.get("created_at"), manifest.get("updated_at")),
        run_dir=str(run_dir.resolve()),
        input_path=manifest.get("input_path") or existing_path(run_dir / "input.json"),
        prompt_path=manifest.get("prompt_path") or existing_path(run_dir / "resolved_prompt.md"),
        output_path=conductor_output.get("output_path") or manifest.get("output_path"),
        artifact_dir=conductor_output.get("artifact_dir") or manifest.get("artifact_dir"),
        event_log=conductor_output.get("event_log") or manifest.get("event_log_path"),
        stdout_log=existing_path(run_dir / "stdout.log"),
        stderr_log=existing_path(run_dir / "stderr.log"),
        errors=errors,
    )


def build_run_summary(run_dir: Path, nodes: list[NodeRunSummary]) -> RunSummary:
    status = (
        "success" if nodes and all(node.status in SUCCESS_STATUSES for node in nodes) else "failed"
    )
    if len(nodes) == 1:
        status = nodes[0].status
    failed_nodes = [node.node_id for node in nodes if node.status not in SUCCESS_STATUSES]
    first_node = nodes[0] if nodes else None
    return RunSummary(
        run_id=run_dir.name,
        workflow_id=None,
        status=status,
        started_at=read_manifest_value(run_dir, "created_at"),
        ended_at=read_manifest_value(run_dir, "updated_at"),
        duration_ms=first_node.duration_ms if first_node and len(nodes) == 1 else None,
        run_dir=str(run_dir.resolve()),
        node_count=len(nodes),
        failed_nodes=failed_nodes,
        output_path=first_node.output_path if first_node else None,
        artifact_dir=first_node.artifact_dir if first_node else None,
        nodes=nodes,
    )


def invalid_run_summary(run_dir: Path, message: str) -> RunSummary:
    node = NodeRunSummary(
        node_id=run_dir.name,
        capsule_id="unknown",
        status="invalid",
        summary=message,
        run_dir=str(run_dir.resolve()),
        errors=[
            SummaryError(
                error_class="workspace_error",
                message=message,
                paths={"run_dir": str(run_dir.resolve())},
            )
        ],
    )
    return build_run_summary(run_dir, [node])


def classify_error(status: str, message: str) -> str:
    lowered = message.lower()
    if status in {"schema_error", "artifact_error", "timeout", "unavailable"}:
        return status
    if "json schema" in lowered or "schema" in lowered or "invalid json" in lowered:
        return "schema_error"
    if "artifact" in lowered:
        return "artifact_error"
    if "workspace" in lowered or "worktree" in lowered or "repository directory" in lowered:
        return "workspace_error"
    if "timed out" in lowered or status == "timeout":
        return "timeout"
    if "unavailable" in lowered or "not installed" in lowered or "not found" in lowered:
        return "unavailable"
    return "adapter_error"


def debug_paths(
    run_dir: Path,
    manifest: dict[str, Any],
    conductor_output: dict[str, Any],
) -> dict[str, str]:
    paths = {
        "run_dir": str(run_dir.resolve()),
        "stderr": str((run_dir / "stderr.log").resolve()),
        "events": str((run_dir / "events.jsonl").resolve()),
        "session_manifest": str((run_dir / "session_manifest.json").resolve()),
    }
    output_path = conductor_output.get("output_path") or manifest.get("output_path")
    artifact_dir = conductor_output.get("artifact_dir") or manifest.get("artifact_dir")
    if output_path:
        paths["output"] = str(output_path)
    if artifact_dir:
        paths["artifact_dir"] = str(artifact_dir)
    return paths


def duration_ms(started_at: Any, ended_at: Any) -> int | None:
    if not isinstance(started_at, str) or not isinstance(ended_at, str):
        return None
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, int((end - start).total_seconds() * 1000))


def read_manifest_value(run_dir: Path, key: str) -> str | None:
    manifest_path = run_dir / "session_manifest.json"
    if not manifest_path.exists():
        return None
    try:
        value = load_json(manifest_path).get(key)
    except AccError:
        return None
    return value if isinstance(value, str) else None


def existing_path(path: Path) -> str | None:
    return str(path.resolve()) if path.exists() else None


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json_dumps(payload), encoding="utf-8")


def json_dumps(payload: Any) -> str:
    import json

    return json.dumps(payload, indent=2, sort_keys=True)
