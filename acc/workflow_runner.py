from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError

from acc.registry import CapsuleRegistry
from acc.run_index import (
    NodeRunSummary,
    RunSummary,
    build_node_summary,
    update_project_run_index,
    write_json,
)
from acc.runner import CapsuleRunner
from acc.session import utc_now_iso
from acc.utils import AccError, load_json
from acc.workflow_graph import load_workflow_graph, topological_order, validate_graph_semantics


async def run_workflow_graph(
    graph_path: Path,
    run_dir: Path,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    registry = registry or CapsuleRegistry()
    graph = load_workflow_graph(graph_path)
    validate_graph_semantics(graph, registry)
    run_dir = run_dir.resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    nodes_dir = run_dir / "nodes"
    nodes_dir.mkdir(exist_ok=True)

    started_at = utc_now_iso()
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    context: dict[str, Any] = {"workflow": {"input": graph.get("input", {})}, "nodes": {}}
    node_summaries: list[NodeRunSummary] = []
    errors: list[str] = []
    status = "success"
    runner = CapsuleRunner(registry=registry)

    for node_id in topological_order(graph):
        node = node_by_id[node_id]
        node_run_dir = nodes_dir / node_id
        try:
            input_payload = resolve_node_input(node, context)
            conductor_output = await runner.run(node["capsule_id"], input_payload, node_run_dir)
            node_summary = load_node_summary(node_run_dir, conductor_output)
            node_summaries.append(node_summary)
            node_output = (
                load_json(Path(conductor_output["output_path"]))
                if conductor_output.get("output_path")
                else {}
            )
            context["nodes"][node_id] = {
                "output": node_output,
                "output_path": conductor_output.get("output_path"),
                "artifact_dir": conductor_output.get("artifact_dir"),
            }
            if conductor_output["status"] != "success":
                status = "failed"
                errors.append(f"Node {node_id} failed: {conductor_output.get('error', '')}")
                break
        except Exception as exc:  # noqa: BLE001 - persist workflow failure summary.
            status = "failed"
            errors.append(f"Node {node_id} failed: {exc}")
            node_summaries.append(
                NodeRunSummary(
                    node_id=node_id,
                    capsule_id=node["capsule_id"],
                    status="failed",
                    summary=str(exc),
                    run_dir=str(node_run_dir.resolve()),
                    errors=[],
                )
            )
            break

    ended_at = utc_now_iso()
    workflow_payload = {
        "workflow_id": graph["id"],
        "status": status,
        "run_dir": str(run_dir),
        "started_at": started_at,
        "ended_at": ended_at,
        "nodes": [node.model_dump() for node in node_summaries],
        "edges": graph.get("edges", []),
        "errors": errors,
    }
    write_json(run_dir / "workflow_run.json", workflow_payload)
    write_run_summary_for_workflow(
        run_dir,
        graph["id"],
        status,
        node_summaries,
        started_at,
        ended_at,
    )
    update_project_run_index(run_dir)
    return workflow_payload


def run_workflow_graph_sync(
    graph_path: Path,
    run_dir: Path,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    return asyncio.run(run_workflow_graph(graph_path, run_dir, registry))


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


def resolve_node_input(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    static_input = node.get("input", {})
    mapped_input = render_node_input(node.get("input_mapping", {}), context)
    if not isinstance(static_input, dict):
        raise AccError(f"Node {node['id']} input must be an object")
    if not isinstance(mapped_input, dict):
        raise AccError(f"Node {node['id']} input_mapping must render to an object")
    return {**static_input, **mapped_input}


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


def write_run_summary_for_workflow(
    run_dir: Path,
    workflow_id: str,
    status: str,
    nodes: list[NodeRunSummary],
    started_at: str,
    ended_at: str,
) -> None:
    failed_nodes = [node.node_id for node in nodes if node.status != "success"]
    first_node = nodes[0] if nodes else None
    summary = RunSummary(
        run_id=run_dir.name,
        workflow_id=workflow_id,
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        run_dir=str(run_dir.resolve()),
        node_count=len(nodes),
        failed_nodes=failed_nodes,
        output_path=first_node.output_path if first_node else None,
        artifact_dir=first_node.artifact_dir if first_node else None,
        nodes=nodes,
    )
    write_json(run_dir / "run_summary.json", summary.model_dump())


def workflow_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)
