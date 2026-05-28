from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.domain import NodeSpec, WorkflowTemplate
from acc.store import FileSystemWorkflowStore
from acc.utils import AccError


def materialize_clean_inboxes(
    template: WorkflowTemplate,
    node: NodeSpec,
    store: FileSystemWorkflowStore,
    node_dir: Path,
    source_outboxes: dict[str, dict[str, Path]],
    workflow_input_outboxes: dict[str, Path],
    workflow_input: dict[str, Any],
    materializations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
            continue
        if is_control_context_payload(workflow_input.get(binding.source_port)):
            skipped = {
                "port_id": binding.target.port,
                "node_id": node.id,
                "direction": "input",
                "source_node_id": f"{template.id}__workflow_inputs",
                "source_port_id": binding.source_port,
                "target_node_id": node.id,
                "target_port_id": binding.target.port,
                "materialization": binding.materialization,
                "skipped": True,
                "reason": "workflow input carries control context",
            }
            records.append(skipped)
            materializations.append(skipped)
            continue
        manifest = store.materialize_workflow_input_binding(
            binding,
            node_dir,
            workflow_input_outboxes,
        )
        if manifest is None:
            if binding.required:
                raise AccError(f"Missing workflow input for port {binding.source_port!r}")
            skipped = {
                "port_id": binding.target.port,
                "node_id": node.id,
                "direction": "input",
                "source_node_id": f"{template.id}__workflow_inputs",
                "source_port_id": binding.source_port,
                "target_node_id": node.id,
                "target_port_id": binding.target.port,
                "materialization": binding.materialization,
                "skipped": True,
                "reason": "optional workflow input not provided",
            }
            records.append(skipped)
            materializations.append(skipped)
            continue
        records.append(manifest)
        materializations.append(manifest)
    for edge in template.data_edges:
        if edge.target.node != node.id:
            continue
        manifest = store.materialize_data_edge(edge, node_dir, source_outboxes)
        records.append(manifest)
        materializations.append(manifest)
    return records


def build_clean_node_input_payload(
    node: NodeSpec,
    workflow_input: dict[str, Any],
    upstream_context: list[dict[str, Any]],
    inbox_records: list[dict[str, Any]],
) -> dict[str, Any]:
    static_input = node.raw.get("input") if isinstance(node.raw.get("input"), dict) else {}
    return {
        "node": {"id": node.id, "kind": node.kind},
        "input": dict(static_input),
        "workflow": {"input": workflow_input},
        "upstream_context": upstream_context,
        "inbox": {"records": inbox_records},
    }


def collect_upstream_context(
    template: WorkflowTemplate,
    node: NodeSpec,
    run_dir: Path,
    node_outputs: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    context: list[dict[str, Any]] = []
    for edge in template.control_edges:
        if edge.target != node.id or edge.context == "none":
            continue
        output = node_outputs.get(edge.source)
        if output is None:
            continue
        output_path = run_dir / "nodes" / edge.source / "output.json"
        context.append(
            {
                "node_id": edge.source,
                "status": str(output.get("status") or "success"),
                "output_path": str(output_path.resolve()),
                "output_summary": summarize_upstream_output(output),
                **inline_upstream_output(output),
            }
        )
    return context


def collect_workflow_input_context(
    template: WorkflowTemplate,
    node: NodeSpec,
    workflow_input: dict[str, Any],
) -> list[dict[str, Any]]:
    context: list[dict[str, Any]] = []
    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
            continue
        value = workflow_input.get(binding.source_port)
        if not is_control_context_payload(value):
            continue
        upstream_context = value.get("upstream_context")
        if not isinstance(upstream_context, list):
            continue
        for item in upstream_context:
            if not isinstance(item, dict):
                continue
            context.append(
                {
                    **item,
                    "via": "workflow_input_boundary",
                    "workflow_input_port": binding.source_port,
                    "target_port": binding.target.port,
                }
            )
    return context


def summarize_upstream_output(output: dict[str, Any]) -> str:
    summary = output.get("summary")
    if isinstance(summary, str) and summary:
        return summary
    compact = json.dumps(output, ensure_ascii=False, sort_keys=True)
    return compact[:240] + ("..." if len(compact) > 240 else "")


def inline_upstream_output(output: dict[str, Any]) -> dict[str, Any]:
    compact = json.dumps(output, ensure_ascii=False, sort_keys=True)
    if len(compact.encode("utf-8")) > 8192:
        return {"output_bytes": len(compact.encode("utf-8")), "output_inline": None}
    return {"output_bytes": len(compact.encode("utf-8")), "output_inline": output}


def is_control_context_payload(value: Any) -> bool:
    return isinstance(value, dict) and value.get("__acc_control_context") is True
