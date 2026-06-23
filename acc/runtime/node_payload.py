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

from acc.engine.control_flow import (
    control_main_source_nodes_for_target,
    source_node_forwards_main_by_default,
)
from acc.engine.schema_ports import (
    MAIN_OUTPUT_PORT,
    effective_output_ports,
    has_projected_output_ports,
)
from acc.models import AccError, NodeInvocationSpec, WorkflowFunctionTemplate

MISSING_PORT_VALUE = object()
LEGACY_CONTROL_MAIN_WARNING = (
    "compatibility: control_edges currently synthesize main input data; "
    "strict explicit-dataflow mode treats control_edges as execution order only"
)


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


def strict_explicit_dataflow_enabled(template: WorkflowFunctionTemplate) -> bool:
    """Return whether control edges must be dataflow-silent for this template.

    The compatibility default remains false while wf-02 migrates fixtures and
    projections. Tests and new workflows can opt in with either
    ``policies.dataflow == "strict"``, ``policies.explicit_dataflow == "strict"``
    or a truthy ``policies.strict_explicit_dataflow`` / ``policies.explicit_dataflow``.
    """

    policies = template.policies if isinstance(template.policies, dict) else {}
    dataflow = policies.get("dataflow")
    if dataflow == "strict":
        return True
    if isinstance(dataflow, dict) and dataflow.get("mode") == "strict":
        return True
    explicit_dataflow = policies.get("explicit_dataflow")
    if explicit_dataflow in {True, "strict"}:
        return True
    return bool(policies.get("strict_explicit_dataflow"))


def resolve_node_payload(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    workflow_input: dict[str, Any],
    outputs: dict[tuple[str, str], Any],
    *,
    run_dir: Path,
    strict_dataflow: bool | None = None,
) -> ResolvedNodePayload:
    strict = (
        strict_explicit_dataflow_enabled(template)
        if strict_dataflow is None
        else strict_dataflow
    )
    payload: dict[str, Any] = {}
    records: list[dict[str, Any]] = []

    for port, value in sorted(node.overrides.static_input.items()):
        payload[port] = value
        snapshot_ref = node.metadata.get("snapshot_input_ref")
        if isinstance(snapshot_ref, dict):
            source_kind = "snapshot_input"
            source_ref = str(
                snapshot_ref.get("path")
                or snapshot_ref.get("ref")
                or f"{snapshot_ref.get('kind', 'snapshot_input')}:{port}"
            )
            extra = {"snapshot_input_ref": snapshot_ref}
        else:
            source_kind = "static_input"
            source_ref = f"node:{node.id}:overrides.static_input.{port}"
            extra = None
        records.append(
            static_binding_record(
                binding_kind="static_input",
                target_node=node.id,
                target_port=port,
                source_ref=source_ref,
                value=value,
                source_kind=source_kind,
                extra=extra,
            )
        )

    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
            continue
        if binding.source_port not in workflow_input:
            if binding.required:
                raise AccError(f"Missing workflow input: {binding.source_port}")
            continue
        value = workflow_input[binding.source_port]
        payload[binding.target.port] = value
        records.append(
            value_binding_record(
                binding_kind="workflow_input",
                source_kind="workflow_input",
                source_ref=f"workflow_input:{binding.source_port}",
                target_node=node.id,
                target_port=binding.target.port,
                materialization=binding.materialization,
                value=value,
                required=binding.required,
                extra={"source_port": binding.source_port},
            )
        )
    for binding in node.input_bindings:
        if binding.static_value is not None:
            value = binding.static_value
            payload[binding.target_port] = value
            records.append(
                static_binding_record(
                    binding_kind="input_binding_static",
                    target_node=node.id,
                    target_port=binding.target_port,
                    source_ref=f"node:{node.id}:input_bindings.{binding.target_port}.static_value",
                    value=value,
                    required=binding.required,
                    source_kind="static_value",
                )
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
        value = outputs[key]
        payload[binding.target_port] = value
        records.append(
            binding_record(
                binding_kind="input_binding",
                source_node=binding.source.node,
                source_port=binding.source.port,
                target_node=node.id,
                target_port=binding.target_port,
                materialization=binding.materialization,
                value=value,
                run_dir=run_dir,
                required=binding.required,
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
        value = outputs[key]
        payload[edge.target.port] = value
        records.append(
            binding_record(
                binding_kind="data_edge",
                source_node=edge.source.node,
                source_port=edge.source.port,
                target_node=node.id,
                target_port=edge.target.port,
                materialization=edge.materialization,
                value=value,
                run_dir=run_dir,
                required=True,
            )
        )
    if not strict and "main" not in payload:
        control_main_sources: list[tuple[str, Any]] = []
        for source_node_id in control_main_source_nodes_for_target(template, node.id):
            key = (source_node_id, "main")
            if key not in outputs:
                continue
            control_main_sources.append((source_node_id, outputs[key]))
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
                    source_kind="control_edge_compat",
                    required=False,
                    compatibility_warning=LEGACY_CONTROL_MAIN_WARNING,
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
                        source_kind="control_edge_compat",
                        required=False,
                        compatibility_warning=LEGACY_CONTROL_MAIN_WARNING,
                        materialized_target=False,
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
    template = WorkflowFunctionTemplate(
        id="single_node_control_policy",
        version="0.0.0",
        node_invocations={node.id: node},
        control_edges=[],
        data_edges=[],
    )
    return source_node_forwards_main_by_default(template, node.id)


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


def static_binding_record(
    *,
    binding_kind: str,
    target_node: str,
    target_port: str,
    source_ref: str,
    value: Any,
    required: bool = False,
    source_kind: str = "static_input",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return value_binding_record(
        binding_kind=binding_kind,
        source_kind=source_kind,
        source_ref=source_ref,
        target_node=target_node,
        target_port=target_port,
        materialization="inline",
        value=value,
        required=required,
        extra=extra,
    )


def value_binding_record(
    *,
    binding_kind: str,
    source_kind: str,
    source_ref: str,
    target_node: str,
    target_port: str,
    materialization: str,
    value: Any,
    required: bool = False,
    compatibility_warning: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "binding_kind": binding_kind,
        "source_kind": source_kind,
        "source_ref": source_ref,
        "target_node": target_node,
        "target_port": target_port,
        "target_key": target_port,
        "materialization": materialization,
        "materialization_mode": materialization,
        "required": required,
        "materialized_sha256": sha256_json(value),
        "value_sha256": sha256_json(value),
    }
    if compatibility_warning:
        record["compatibility_warning"] = compatibility_warning
    if extra:
        record.update(extra)
    return record


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
    source_kind: str | None = None,
    required: bool = True,
    compatibility_warning: str | None = None,
    materialized_target: bool = True,
) -> dict[str, Any]:
    source_output_path = run_dir / "nodes" / source_node / "output.json"
    record = value_binding_record(
        binding_kind=binding_kind,
        source_kind=source_kind or binding_kind,
        source_ref=f"node:{source_node}.{source_port}",
        target_node=target_node,
        target_port=target_port,
        materialization=materialization,
        value=value,
        required=required,
        compatibility_warning=compatibility_warning,
        extra={
            "source_node": source_node,
            "source_port": source_port,
            "source_output_path": str(source_output_path.resolve()),
            "source_evidence_ref": f"nodes/{source_node}/output.json",
            "source_result_sha256": sha256_json(value),
        },
    )
    if not materialized_target:
        record["source_only"] = True
        record.pop("target_key", None)
        record.pop("materialized_sha256", None)
        record.pop("value_sha256", None)
    return record


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
        "source_kind": "control_edge_compat_aggregate",
        "source_ref": "control_edges:" + ",".join(source_node for source_node, _ in source_values),
        "target_node": target_node,
        "target_port": target_port,
        "target_key": target_port,
        "materialization": "copy",
        "materialization_mode": "copy",
        "required": False,
        "compatibility_warning": LEGACY_CONTROL_MAIN_WARNING,
        "aggregate_order": [source_node for source_node, _ in source_values],
        "aggregate_sha256": sha256_json(aggregate),
        "materialized_sha256": sha256_json(aggregate),
        "value_sha256": sha256_json(aggregate),
        "sources": [
            {
                "source_node": source_node,
                "source_port": "main",
                "source_output_path": str(
                    (run_dir / "nodes" / source_node / "output.json").resolve()
                ),
                "source_evidence_ref": f"nodes/{source_node}/output.json",
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
    ports = effective_output_ports(node)
    if node.output_ports or has_projected_output_ports(node.output_schema):
        return tuple(ports)
    if set(ports) != {MAIN_OUTPUT_PORT}:
        return tuple(ports)
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
