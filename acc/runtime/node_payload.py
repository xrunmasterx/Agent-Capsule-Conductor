"""Node payload resolution: binding, data-edge, and control-main propagation.

Extracts payload resolution logic from the God Module core_v2_runtime.py.
Pure-function module (no async, no I/O aside from sha256 hashing).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.models import AccError, NodeInvocationSpec, WorkflowFunctionTemplate

MISSING_PORT_VALUE = object()


@dataclass(frozen=True)
class ResolvedNodePayload:
    payload: dict[str, Any]
    binding_records: list[dict[str, Any]]


def is_empty_runtime_input(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (int, float, bool)):
        return False
    if isinstance(value, dict):
        return all(is_empty_runtime_input(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return all(is_empty_runtime_input(item) for item in value)
    return False


def resolve_node_payload(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    workflow_input: dict[str, Any],
    outputs: dict[tuple[str, str], Any],
    *,
    run_dir: Path,
) -> ResolvedNodePayload:
    payload: dict[str, Any] = dict(node.overrides.static_input)
    records: list[dict[str, Any]] = [
        {
            "binding_kind": "static_input",
            "target_node": node.id,
            "target_port": port,
        }
        for port in sorted(payload)
    ]
    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
            continue
        if binding.source_port not in workflow_input:
            if binding.required:
                raise AccError(f"Missing workflow input: {binding.source_port}")
            continue
        payload[binding.target.port] = workflow_input[binding.source_port]
        records.append(
            {
                "binding_kind": "workflow_input",
                "source_port": binding.source_port,
                "target_node": node.id,
                "target_port": binding.target.port,
                "materialization": binding.materialization,
            }
        )
    for binding in node.input_bindings:
        if binding.static_value is not None:
            payload[binding.target_port] = binding.static_value
            records.append(
                {
                    "binding_kind": "input_binding_static",
                    "target_node": node.id,
                    "target_port": binding.target_port,
                }
            )
            continue
        if binding.source is None:
            continue
        key = (binding.source.node, binding.source.port)
        if key not in outputs:
            if binding.required:
                raise AccError(
                    f"Missing binding source {binding.source.node}.{binding.source.port}"
                )
            continue
        payload[binding.target_port] = outputs[key]
        records.append(
            binding_record(
                binding_kind="input_binding",
                source_node=binding.source.node,
                source_port=binding.source.port,
                target_node=node.id,
                target_port=binding.target_port,
                materialization=binding.materialization,
                value=outputs[key],
                run_dir=run_dir,
            )
        )
    for edge in template.data_edges:
        if edge.target.node != node.id:
            continue
        key = (edge.source.node, edge.source.port)
        if key not in outputs:
            raise AccError(
                f"Missing data edge source {edge.source.node}.{edge.source.port} "
                f"for {node.id}.{edge.target.port}"
            )
        payload[edge.target.port] = outputs[key]
        records.append(
            binding_record(
                binding_kind="data_edge",
                source_node=edge.source.node,
                source_port=edge.source.port,
                target_node=node.id,
                target_port=edge.target.port,
                materialization=edge.materialization,
                value=outputs[key],
                run_dir=run_dir,
            )
        )
    if "main" not in payload:
        control_main_sources: list[tuple[str, Any]] = []
        for edge in template.control_edges:
            if edge.target != node.id:
                continue
            source_node = template.node_invocations.get(edge.source)
            if source_node is None or not should_forward_main_output_on_control(source_node):
                continue
            key = (edge.source, "main")
            if key not in outputs:
                continue
            control_main_sources.append((edge.source, outputs[key]))
        if len(control_main_sources) == 1:
            source_node_id, value = control_main_sources[0]
            payload["main"] = value
            records.append(
                binding_record(
                    binding_kind="control_main_default",
                    source_node=source_node_id,
                    source_port="main",
                    target_node=node.id,
                    target_port="main",
                    materialization="copy",
                    value=value,
                    run_dir=run_dir,
                )
            )
        elif len(control_main_sources) > 1:
            aggregate = control_main_aggregate_payload(control_main_sources)
            payload["main"] = aggregate
            for source_node_id, value in control_main_sources:
                records.append(
                    binding_record(
                        binding_kind="control_main_default",
                        source_node=source_node_id,
                        source_port="main",
                        target_node=node.id,
                        target_port="main",
                        materialization="copy",
                        value=value,
                        run_dir=run_dir,
                    )
                )
            records.append(
                control_main_aggregate_record(
                    source_values=control_main_sources,
                    target_node=node.id,
                    target_port="main",
                    aggregate=aggregate,
                    run_dir=run_dir,
                )
            )
    return ResolvedNodePayload(payload=payload, binding_records=records)


def should_forward_main_output_on_control(node: NodeInvocationSpec) -> bool:
    return node.control.forward_main_output_on_control is not False


def control_main_aggregate_payload(source_values: list[tuple[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "acc.control_main.aggregate.v1",
        "kind": "control_main_aggregate",
        "order": [source_node for source_node, _ in source_values],
        "sources": {source_node: value for source_node, value in source_values},
    }


def output_value_for_port(output: Any, port_id: str) -> Any:
    if port_id in {"default", "main"}:
        return output
    if not isinstance(output, dict):
        return MISSING_PORT_VALUE
    outputs = output.get("outputs")
    if isinstance(outputs, dict) and port_id in outputs:
        return outputs[port_id]
    if port_id in output:
        return output[port_id]
    return MISSING_PORT_VALUE


def binding_record(
    *,
    binding_kind: str,
    source_node: str,
    source_port: str,
    target_node: str,
    target_port: str,
    materialization: str,
    value: Any,
    run_dir: Path,
) -> dict[str, Any]:
    return {
        "binding_kind": binding_kind,
        "source_node": source_node,
        "source_port": source_port,
        "target_node": target_node,
        "target_port": target_port,
        "materialization": materialization,
        "source_output_path": str((run_dir / "nodes" / source_node / "output.json").resolve()),
        "source_result_sha256": sha256_json(value),
    }


def control_main_aggregate_record(
    *,
    source_values: list[tuple[str, Any]],
    target_node: str,
    target_port: str,
    aggregate: dict[str, Any],
    run_dir: Path,
) -> dict[str, Any]:
    return {
        "binding_kind": "control_main_aggregate",
        "target_node": target_node,
        "target_port": target_port,
        "materialization": "copy",
        "aggregate_order": [source_node for source_node, _ in source_values],
        "aggregate_sha256": sha256_json(aggregate),
        "sources": [
            {
                "source_node": source_node,
                "source_port": "main",
                "source_output_path": str(
                    (run_dir / "nodes" / source_node / "output.json").resolve()
                ),
                "source_result_sha256": sha256_json(value),
            }
            for source_node, value in source_values
        ],
    }


def sha256_json(value: Any) -> str:
    inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(inline).hexdigest()


def output_port_ids(node: NodeInvocationSpec) -> tuple[str, ...]:
    if node.workflow_call_output_bindings:
        return tuple(binding.parent_port for binding in node.workflow_call_output_bindings)
    if node.output_bindings:
        return tuple(binding.source_port for binding in node.output_bindings)
    if node.output_ports:
        return tuple(node.output_ports)
    return ("default", "main")


def materialized_output_port_ids(
    node: NodeInvocationSpec,
    output: Any,
) -> tuple[str, ...]:
    if not node.workflow_call_output_bindings:
        return output_port_ids(node)
    workflow_outputs = output.get("workflow_outputs") if isinstance(output, dict) else None
    if not isinstance(workflow_outputs, dict):
        return output_port_ids(node)
    ports: list[str] = []
    for binding in node.workflow_call_output_bindings:
        if binding.required or binding.workflow_output in workflow_outputs:
            ports.append(binding.parent_port)
    return tuple(ports)
