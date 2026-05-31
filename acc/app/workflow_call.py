from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.domain import NodeInvocationSpec, NodeSpec, WorkflowTemplate
from acc.engine import normalize_node_invocation_spec
from acc.store import load_json
from acc.utils import AccError


def build_nested_workflow_input_payload(
    node: NodeSpec,
    node_dir: Path,
    child_template: WorkflowTemplate,
    *,
    node_invocation: NodeInvocationSpec | None = None,
) -> dict[str, Any]:
    explicit_payload = build_explicit_nested_workflow_input_payload(
        node,
        node_dir,
        node_invocation=node_invocation,
    )
    if explicit_payload:
        return explicit_payload
    if not child_template.exposed_inputs:
        return {}
    input_path = node_dir / "input.json"
    if not input_path.exists():
        return {}
    parent_input = load_json(input_path)
    if not isinstance(parent_input, dict) or not parent_input.get("upstream_context"):
        return {}
    target_port = (
        "main"
        if "main" in child_template.exposed_inputs
        else sorted(child_template.exposed_inputs)[0]
    )
    upstream_context = parent_input.get("upstream_context")
    if not isinstance(upstream_context, list):
        return {}
    return {
        target_port: {
            "__acc_control_context": True,
            "upstream_context": upstream_context,
        }
    }


def build_explicit_nested_workflow_input_payload(
    node: NodeSpec,
    node_dir: Path,
    *,
    node_invocation: NodeInvocationSpec | None = None,
) -> dict[str, Any]:
    invocation = node_invocation or normalize_node_invocation_spec(node)
    if not invocation.workflow_call_input_bindings:
        return {}
    parent_input = load_json(node_dir / "input.json") if (node_dir / "input.json").exists() else {}
    if not isinstance(parent_input, dict):
        parent_input = {}
    payload: dict[str, Any] = {}
    for binding in invocation.workflow_call_input_bindings:
        if binding.static_value is not None:
            payload[binding.workflow_input] = binding.static_value
            continue
        if binding.source is None:
            if binding.required:
                raise AccError(f"workflow call input {binding.workflow_input!r} has no source")
            continue
        value = bound_parent_input_value(parent_input, binding.source.node, binding.source.port)
        if value is None:
            if binding.required:
                raise AccError(
                    "Missing parent data for workflow call input "
                    f"{binding.source.node}.{binding.source.port} -> "
                    f"{binding.workflow_input}"
                )
            continue
        payload[binding.workflow_input] = value
    return payload


def bound_parent_input_value(
    parent_input: dict[str, Any],
    source_node: str,
    source_port: str,
) -> dict[str, Any] | None:
    inbox = parent_input.get("inbox")
    records = inbox.get("records") if isinstance(inbox, dict) else None
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, dict):
                continue
            if (
                record.get("source_node_id") == source_node
                and record.get("source_port_id") == source_port
            ):
                return {
                    "__acc_bound_parent_outbox": True,
                    "source_node_id": source_node,
                    "source_port_id": source_port,
                    "source_outbox": record.get("source_outbox"),
                    "target_inbox": record.get("target_inbox"),
                    "materialization": record.get("materialization"),
                    "inbox_manifest": record,
                }
    upstream_context = parent_input.get("upstream_context")
    if isinstance(upstream_context, list):
        for item in upstream_context:
            if isinstance(item, dict) and item.get("node_id") == source_node:
                return {
                    "__acc_control_context": True,
                    "upstream_context": [item],
                    "source_node_id": source_node,
                    "source_port_id": source_port,
                }
    return None


def workflow_call_manifest_payload(
    node: NodeSpec,
    *,
    parent_invocation_id: str | None,
    parent_scope_frame_id: str | None,
    nested_result: dict[str, Any],
    node_invocation: NodeInvocationSpec | None = None,
) -> dict[str, Any]:
    invocation = node_invocation or normalize_node_invocation_spec(node)
    return {
        "node_id": node.id,
        "parent_invocation_id": parent_invocation_id,
        "parent_scope_frame_id": parent_scope_frame_id,
        "child_invocation_manifest": nested_result.get("function_invocation_manifest"),
        "child_scope_frame_manifest": nested_result.get("scope_frame_manifest"),
        "child_workflow_id": nested_result.get("workflow_id"),
        "child_workflow_run_dir": nested_result.get("run_dir"),
        "input_bindings": [
            {
                "workflow_input": binding.workflow_input,
                "source_node": binding.source.node if binding.source else None,
                "source_port": binding.source.port if binding.source else None,
                "required": binding.required,
            }
            for binding in invocation.workflow_call_input_bindings
        ],
        "output_bindings": [
            {
                "workflow_output": binding.workflow_output,
                "parent_port": binding.parent_port,
                "required": binding.required,
            }
            for binding in invocation.workflow_call_output_bindings
        ],
        "status": str(nested_result.get("status")),
    }


def summarize_upstream_output(output: dict[str, Any]) -> str:
    summary = output.get("summary")
    if isinstance(summary, str) and summary:
        return summary
    compact = json.dumps(output, ensure_ascii=False, sort_keys=True)
    return compact[:240] + ("..." if len(compact) > 240 else "")
