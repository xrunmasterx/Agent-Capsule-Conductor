from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError

from acc.events import WorkflowEventEmitter, read_jsonl_events
from acc.registry import CapsuleRegistry
from acc.run_index import (
    NodeRunSummary,
    RunSummary,
    SummaryError,
    build_node_summary,
    update_project_run_index,
    write_json,
)
from acc.runner import CapsuleRunner
from acc.session import utc_now_iso
from acc.utils import AccError, load_json
from acc.workflow_graph import (
    load_workflow_graph,
    normalize_workflow_graph,
    topological_levels,
    validate_graph_semantics,
)

SUCCESS_STATUSES = {"success"}
TERMINAL_FAILURE_STATUSES = {
    "failed",
    "timeout",
    "schema_error",
    "artifact_error",
    "workspace_error",
    "adapter_error",
    "unavailable",
}


@dataclass
class WorkflowNodeResult:
    node_id: str
    capsule_id: str
    level: int
    status: str
    summary: str
    run_dir: Path
    conductor_output: dict[str, Any] = field(default_factory=dict)
    node_summary: NodeRunSummary | None = None
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    attempts: int = 1

    @property
    def succeeded(self) -> bool:
        return self.status in SUCCESS_STATUSES


async def run_workflow_graph(
    graph_path: Path,
    run_dir: Path,
    registry: CapsuleRegistry | None = None,
    input_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    registry = registry or CapsuleRegistry()
    graph = normalize_workflow_graph(load_workflow_graph(graph_path))
    if input_payload is not None:
        merged_input = dict(graph.get("input", {}) or {})
        merged_input.update(input_payload)
        graph["input"] = merged_input
    validate_graph_semantics(graph, registry)
    levels = topological_levels(graph)
    run_dir = run_dir.resolve()
    prepare_workflow_run_dir(run_dir)
    node_runs_dir = run_dir / "node_runs"
    node_runs_dir.mkdir(parents=True, exist_ok=True)
    legacy_nodes_dir = run_dir / "nodes"
    legacy_nodes_dir.mkdir(parents=True, exist_ok=True)

    workflow_run_id = f"workflow_{run_dir.name}"
    event_log_path = run_dir / "workflow_events.jsonl"
    event_log_path.write_text("", encoding="utf-8")
    emitter = WorkflowEventEmitter(event_log_path, workflow_run_id=workflow_run_id)
    started_at = utc_now_iso()
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    context: dict[str, Any] = {"workflow": {"input": graph.get("input", {})}, "nodes": {}}
    node_results: dict[str, WorkflowNodeResult] = {}
    node_summaries: list[NodeRunSummary] = []
    workflow_status = "success"
    errors: list[str] = []
    policy = graph["policy"]
    failure_mode = str(policy.get("failure_mode") or "fail_fast")
    max_concurrency = int(policy.get("max_concurrency") or 1)
    runner = CapsuleRunner(registry=registry)

    emitter.emit(
        "workflow_started",
        status="running",
        payload={
            "workflow_id": graph["id"],
            "graph_path": str(graph_path),
            "failure_mode": failure_mode,
            "max_concurrency": max_concurrency,
        },
    )

    for level_index, level_node_ids in enumerate(levels):
        emitter.emit(
            "workflow_level_started",
            status="running",
            level=level_index,
            payload={"nodes": level_node_ids},
        )
        semaphore = asyncio.Semaphore(max_concurrency)
        level_results = await asyncio.gather(
            *[
                run_level_node(
                    node_by_id[node_id],
                    graph,
                    context,
                    node_results,
                    node_runs_dir / node_id,
                    runner,
                    semaphore,
                    emitter,
                    level_index,
                )
                for node_id in level_node_ids
            ]
        )

        level_failed = False
        for result in level_results:
            node_results[result.node_id] = result
            node_summaries.append(result.node_summary or summary_from_result(result))
            copy_node_run_for_legacy_compat(result.run_dir, legacy_nodes_dir / result.node_id)
            if result.succeeded:
                context["nodes"][result.node_id] = {
                    "output": result.output,
                    "output_path": result.conductor_output.get("output_path"),
                    "artifact_dir": result.conductor_output.get("artifact_dir"),
                }
            else:
                context["nodes"][result.node_id] = {
                    "output": result.output,
                    "output_path": result.conductor_output.get("output_path"),
                    "artifact_dir": result.conductor_output.get("artifact_dir"),
                    "error": result.error,
                    "status": result.status,
                }
                level_failed = True
                errors.append(f"Node {result.node_id} failed: {result.error or result.summary}")

        if level_failed:
            workflow_status = apply_failure_mode(
                failure_mode,
                level_index,
                level_results,
                errors,
                emitter,
            )
        emitter.emit(
            "workflow_level_completed",
            status="failed" if level_failed else "success",
            level=level_index,
            payload={"nodes": [result.node_id for result in level_results]},
        )
        if workflow_status in TERMINAL_FAILURE_STATUSES or workflow_status == "manual_review":
            break

    ended_at = utc_now_iso()
    if workflow_status == "success":
        emitter.emit("workflow_completed", status="success", payload={"workflow_id": graph["id"]})
    elif workflow_status == "manual_review":
        emitter.emit("workflow_failed", status="manual_review", payload={"errors": errors})
    else:
        emitter.emit("workflow_failed", status=workflow_status, payload={"errors": errors})

    workflow_payload = workflow_result_payload(
        graph,
        run_dir,
        workflow_status,
        node_summaries,
        levels,
        started_at,
        ended_at,
        errors,
    )
    write_workflow_outputs(
        run_dir,
        graph_path,
        graph,
        workflow_payload,
        workflow_run_id,
        event_log_path,
        started_at,
        ended_at,
    )
    update_project_run_index(run_dir)
    return workflow_payload


def run_workflow_graph_sync(
    graph_path: Path,
    run_dir: Path,
    registry: CapsuleRegistry | None = None,
    input_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return asyncio.run(run_workflow_graph(graph_path, run_dir, registry, input_payload))


async def run_level_node(
    node: dict[str, Any],
    graph: dict[str, Any],
    context: dict[str, Any],
    node_results: dict[str, WorkflowNodeResult],
    node_run_dir: Path,
    runner: CapsuleRunner,
    semaphore: asyncio.Semaphore,
    emitter: WorkflowEventEmitter,
    level_index: int,
) -> WorkflowNodeResult:
    async with semaphore:
        node_id = node["id"]
        capsule_id = node["capsule_id"]
        emitter.emit(
            "node_scheduled",
            status="scheduled",
            level=level_index,
            node_id=node_id,
            payload={"capsule_id": capsule_id},
        )
        try:
            input_payload = resolve_node_input(node, graph, context, node_results)
        except AccError as exc:
            return failed_node_result(node, node_run_dir, level_index, str(exc), "schema_error")

        emitter.emit(
            "input_materialized",
            status="running",
            level=level_index,
            node_id=node_id,
            payload={"input_keys": sorted(input_payload)},
        )
        max_attempts = max(1, int((node.get("retry") or {}).get("max_attempts", 1)))
        backoff_seconds = float((node.get("retry") or {}).get("backoff_seconds", 0))
        last_output: dict[str, Any] = {}
        last_summary: NodeRunSummary | None = None
        last_conductor_output: dict[str, Any] = {}

        for attempt in range(1, max_attempts + 1):
            emitter.emit(
                "node_started",
                status="running",
                level=level_index,
                node_id=node_id,
                payload={"attempt": attempt, "max_attempts": max_attempts},
            )
            conductor_output = await run_capsule_with_optional_timeout(
                runner,
                capsule_id,
                input_payload,
                node_run_dir,
                node.get("timeout_seconds"),
            )
            last_conductor_output = conductor_output
            node_summary = load_node_summary(node_run_dir, conductor_output)
            last_summary = node_summary
            last_output = load_output_payload(conductor_output)
            status = str(conductor_output.get("status") or "failed")
            if status == "success":
                emitter.emit(
                    "node_completed",
                    status="success",
                    level=level_index,
                    node_id=node_id,
                    session_id=conductor_output.get("session_id"),
                    payload={"attempt": attempt, "summary": conductor_output.get("summary")},
                )
                return WorkflowNodeResult(
                    node_id=node_id,
                    capsule_id=capsule_id,
                    level=level_index,
                    status="success",
                    summary=str(conductor_output.get("summary") or ""),
                    run_dir=node_run_dir,
                    conductor_output=conductor_output,
                    node_summary=node_summary,
                    output=last_output,
                    attempts=attempt,
                )
            if attempt < max_attempts:
                await asyncio.sleep(backoff_seconds)

        error = str(
            last_conductor_output.get("error") or last_conductor_output.get("summary") or ""
        )
        status = node_failure_status(node, str(last_conductor_output.get("status") or "failed"))
        emitter.emit(
            "node_failed",
            status=status,
            level=level_index,
            node_id=node_id,
            session_id=last_conductor_output.get("session_id"),
            payload={"attempts": max_attempts, "error": error},
        )
        return WorkflowNodeResult(
            node_id=node_id,
            capsule_id=capsule_id,
            level=level_index,
            status=status,
            summary=str(last_conductor_output.get("summary") or "Node failed"),
            run_dir=node_run_dir,
            conductor_output=last_conductor_output,
            node_summary=last_summary,
            output=last_output,
            error=error,
            attempts=max_attempts,
        )


async def run_capsule_with_optional_timeout(
    runner: CapsuleRunner,
    capsule_id: str,
    input_payload: dict[str, Any],
    node_run_dir: Path,
    timeout_seconds: Any,
) -> dict[str, Any]:
    if timeout_seconds is None:
        return await runner.run(capsule_id, input_payload, node_run_dir)
    try:
        return await asyncio.wait_for(
            runner.run(capsule_id, input_payload, node_run_dir),
            timeout=float(timeout_seconds),
        )
    except TimeoutError:
        node_run_dir.mkdir(parents=True, exist_ok=True)
        return {
            "status": "timeout",
            "summary": "Workflow node timed out",
            "error": "timeout",
            "session_id": None,
            "output_path": None,
            "artifact_dir": str((node_run_dir / "artifacts").resolve()),
            "event_log": str((node_run_dir / "events.jsonl").resolve()),
            "session_manifest": str((node_run_dir / "session_manifest.json").resolve()),
        }


def node_failure_status(node: dict[str, Any], raw_status: str) -> str:
    if node.get("on_failure") == "manual_review":
        return "manual_review"
    if raw_status in TERMINAL_FAILURE_STATUSES:
        return raw_status
    return "failed"


def apply_failure_mode(
    failure_mode: str,
    level_index: int,
    level_results: list[WorkflowNodeResult],
    errors: list[str],
    emitter: WorkflowEventEmitter,
) -> str:
    if failure_mode == "continue_on_error":
        return "success"
    if failure_mode == "manual_review" or any(
        result.status == "manual_review" for result in level_results
    ):
        emitter.emit(
            "manual_review_requested",
            status="manual_review",
            level=level_index,
            payload={"errors": errors},
        )
        return "manual_review"
    if failure_mode == "all_or_nothing":
        return "failed"
    return "failed"


def resolve_node_input(
    node: dict[str, Any],
    graph: dict[str, Any],
    context: dict[str, Any],
    node_results: dict[str, WorkflowNodeResult],
) -> dict[str, Any]:
    static_input = dict(node.get("input", {}) or {})
    mapped_input = render_node_input(node.get("input_mapping", {}) or {}, context)
    if not isinstance(mapped_input, dict):
        raise AccError(f"Node {node['id']} input_mapping must render to an object")
    materialized = {**static_input, **mapped_input}
    for edge in graph.get("data_edges", []):
        if edge["to"]["node"] != node["id"]:
            continue
        if edge.get("required", True) and not node_results.get(edge["from"]["node"]):
            raise AccError(f"Required data edge {edge['id']} source is not available")
        materialized[edge["to"]["input"]] = resolve_data_edge_value(edge, context, node_results)
    return materialized


def resolve_data_edge_value(
    edge: dict[str, Any],
    context: dict[str, Any],
    node_results: dict[str, WorkflowNodeResult],
) -> Any:
    source_ref = edge["from"]
    source_node = source_ref["node"]
    source_result = node_results.get(source_node)
    if source_result is None or not source_result.succeeded:
        if edge.get("required", True):
            raise AccError(f"Required data edge {edge['id']} source {source_node!r} failed")
        return None
    if "output" in source_ref:
        output_name = source_ref["output"]
        if output_name not in source_result.output:
            raise AccError(f"Data edge {edge['id']} missing output field {output_name!r}")
        return source_result.output[output_name]
    if "artifact" in source_ref:
        artifact_dir = source_result.conductor_output.get("artifact_dir")
        if not artifact_dir:
            raise AccError(f"Data edge {edge['id']} source has no artifact directory")
        return str((Path(artifact_dir) / str(source_ref["artifact"])).resolve())
    if "path" in source_ref:
        return render_node_input(source_ref["path"], context)
    raise AccError(f"Data edge {edge['id']} has no supported source reference")


def render_node_input(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        environment = Environment(undefined=StrictUndefined, autoescape=False)
        try:
            return environment.from_string(value).render(**context)
        except TemplateError as exc:
            raise AccError(f"Failed to render node input template: {exc}") from exc
    if isinstance(value, list):
        return [render_node_input(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render_node_input(item, context) for key, item in value.items()}
    return value


def load_output_payload(conductor_output: dict[str, Any]) -> dict[str, Any]:
    output_path = conductor_output.get("output_path")
    if not output_path:
        return {}
    payload = load_json(Path(output_path))
    return payload if isinstance(payload, dict) else {}


def load_node_summary(run_dir: Path, conductor_output: dict[str, Any]) -> NodeRunSummary:
    summary_path = run_dir / "node_summary.json"
    if summary_path.exists():
        payload = load_json(summary_path)
        payload["node_id"] = run_dir.name
        write_json(summary_path, payload)
        return NodeRunSummary.model_validate(payload)
    manifest_path = run_dir / "session_manifest.json"
    manifest = load_json(manifest_path) if manifest_path.exists() else {}
    return build_node_summary(run_dir, manifest, conductor_output)


def failed_node_result(
    node: dict[str, Any],
    node_run_dir: Path,
    level_index: int,
    error: str,
    status: str,
) -> WorkflowNodeResult:
    node_run_dir.mkdir(parents=True, exist_ok=True)
    summary = NodeRunSummary(
        node_id=node["id"],
        capsule_id=node["capsule_id"],
        status=status,
        summary=error,
        run_dir=str(node_run_dir.resolve()),
        errors=[
            SummaryError(
                error_class=status,
                message=error,
                paths={"run_dir": str(node_run_dir.resolve())},
            )
        ],
    )
    write_json(node_run_dir / "node_summary.json", summary.model_dump())
    return WorkflowNodeResult(
        node_id=node["id"],
        capsule_id=node["capsule_id"],
        level=level_index,
        status=status,
        summary=error,
        run_dir=node_run_dir,
        node_summary=summary,
        error=error,
    )


def summary_from_result(result: WorkflowNodeResult) -> NodeRunSummary:
    return NodeRunSummary(
        node_id=result.node_id,
        capsule_id=result.capsule_id,
        status=result.status,
        summary=result.summary,
        run_dir=str(result.run_dir.resolve()),
        output_path=result.conductor_output.get("output_path"),
        artifact_dir=result.conductor_output.get("artifact_dir"),
        event_log=result.conductor_output.get("event_log"),
        errors=[
            SummaryError(
                error_class=result.status,
                message=result.error or result.summary,
                paths={"run_dir": str(result.run_dir.resolve())},
            )
        ]
        if result.error
        else [],
    )


def workflow_result_payload(
    graph: dict[str, Any],
    run_dir: Path,
    status: str,
    nodes: list[NodeRunSummary],
    levels: list[list[str]],
    started_at: str,
    ended_at: str,
    errors: list[str],
) -> dict[str, Any]:
    return {
        "workflow_id": graph["id"],
        "status": status,
        "run_dir": str(run_dir),
        "started_at": started_at,
        "ended_at": ended_at,
        "policy": graph["policy"],
        "failure_mode": graph["policy"].get("failure_mode"),
        "topological_levels": levels,
        "nodes": [node.model_dump() for node in nodes],
        "edges": graph.get("edges", graph.get("control_edges", [])),
        "control_edges": graph.get("control_edges", []),
        "data_edges": graph.get("data_edges", []),
        "errors": errors,
    }


def write_workflow_outputs(
    run_dir: Path,
    graph_path: Path,
    graph: dict[str, Any],
    workflow_payload: dict[str, Any],
    workflow_run_id: str,
    event_log_path: Path,
    started_at: str,
    ended_at: str,
) -> None:
    summary = RunSummary(
        run_id=run_dir.name,
        workflow_id=graph["id"],
        status=workflow_payload["status"],
        started_at=started_at,
        ended_at=ended_at,
        run_dir=str(run_dir.resolve()),
        node_count=len(workflow_payload["nodes"]),
        failed_nodes=[
            node["node_id"]
            for node in workflow_payload["nodes"]
            if node["status"] not in SUCCESS_STATUSES
        ],
        nodes=[NodeRunSummary.model_validate(node) for node in workflow_payload["nodes"]],
    )
    manifest = {
        "workflow_run_id": workflow_run_id,
        "workflow_id": graph["id"],
        "graph_path": str(graph_path),
        "graph_snapshot_path": str((run_dir / "workflow_graph.json").resolve()),
        "status": workflow_payload["status"],
        "policy": graph["policy"],
        "started_at": started_at,
        "ended_at": ended_at,
        "run_dir": str(run_dir.resolve()),
        "event_log_path": str(event_log_path.resolve()),
        "summary_path": str((run_dir / "workflow_summary.json").resolve()),
        "node_runs_dir": str((run_dir / "node_runs").resolve()),
    }
    write_json(run_dir / "workflow_run_manifest.json", manifest)
    write_json(run_dir / "workflow_graph.json", graph)
    write_json(run_dir / "workflow_summary.json", workflow_payload)
    write_json(run_dir / "workflow_run.json", workflow_payload)
    write_json(run_dir / "run_summary.json", summary.model_dump())


def prepare_workflow_run_dir(run_dir: Path) -> None:
    if not run_dir.exists():
        run_dir.mkdir(parents=True, exist_ok=True)
        return
    children = list(run_dir.iterdir())
    if not children:
        return
    known_markers = {
        "workflow_run_manifest.json",
        "workflow_run.json",
        "workflow_summary.json",
        "run_summary.json",
    }
    if not any((run_dir / marker).exists() for marker in known_markers):
        raise AccError(f"Refusing to reuse non-ACC workflow run directory: {run_dir}")
    for child in children:
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    run_dir.mkdir(parents=True, exist_ok=True)


def copy_node_run_for_legacy_compat(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    if source.exists():
        shutil.copytree(source, target)


def workflow_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def workflow_events_payload(run_dir: Path) -> dict[str, Any]:
    event_log_path = run_dir / "workflow_events.jsonl"
    return {
        "run_dir": str(run_dir.resolve()),
        "event_log": str(event_log_path.resolve()),
        "events": read_jsonl_events(event_log_path),
    }


def workflow_inspect_payload(run_dir: Path) -> dict[str, Any]:
    summary_path = run_dir / "workflow_summary.json"
    manifest_path = run_dir / "workflow_run_manifest.json"
    event_log_path = run_dir / "workflow_events.jsonl"
    summary = load_json(summary_path) if summary_path.exists() else None
    manifest = load_json(manifest_path) if manifest_path.exists() else None
    return {
        "run_dir": str(run_dir.resolve()),
        "status": (summary or {}).get("status") or (manifest or {}).get("status"),
        "workflow_id": (summary or {}).get("workflow_id") or (manifest or {}).get("workflow_id"),
        "event_log": str(event_log_path.resolve()),
        "summary_path": str(summary_path.resolve()),
        "manifest_path": str(manifest_path.resolve()),
        "summary": summary,
        "manifest": manifest,
    }
