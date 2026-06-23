from __future__ import annotations

from typing import Any, Literal, TypedDict

BOUNDARY_TRANSFER_SCHEMA = "acc.workbench.boundary_transfer.v1"

BoundaryDirection = Literal["workflow_input", "workflow_output"]
Severity = Literal["error", "warning"]


class BoundaryTransferDiagnostic(TypedDict, total=False):
    code: str
    severity: Severity
    edge_id: str | None
    source_node: str | None
    target_node: str | None
    source_ports: list[str]
    target_ports: list[str]
    message: str


class BoundaryTransferExpansion(TypedDict):
    status: Literal["valid", "invalid"]
    bindings: dict[str, list[dict[str, Any]]]
    diagnostics: list[BoundaryTransferDiagnostic]
    canonical_preview: dict[str, Any]


def expand_boundary_transfer_bindings(
    *,
    workflow_id: str,
    edges: list[dict[str, Any]],
    internal_nodes: list[dict[str, Any]] | None = None,
    exposed_inputs: Any = None,
    exposed_outputs: Any = None,
    edge_id: str | None = None,
) -> BoundaryTransferExpansion:
    input_boundary = workflow_input_boundary_id(workflow_id)
    output_boundary = workflow_output_boundary_id(workflow_id)
    input_ports = port_ids_from_ui_ports(exposed_inputs)
    output_ports = port_ids_from_ui_ports(exposed_outputs)
    node_input_ports = internal_node_port_ids_by_direction(internal_nodes or [], "input")
    node_output_ports = internal_node_port_ids_by_direction(internal_nodes or [], "output")
    input_bindings: list[dict[str, Any]] = []
    output_bindings: list[dict[str, Any]] = []
    input_keys: set[tuple[str, str, str]] = set()
    output_keys: set[tuple[str, str, str]] = set()
    input_origins: dict[tuple[str, str, str], str | None] = {}
    output_origins: dict[tuple[str, str, str], str | None] = {}
    diagnostics: list[BoundaryTransferDiagnostic] = []

    for edge in edges:
        if not is_data_edge_payload(edge):
            continue
        source = edge_endpoint(edge.get("from") or edge.get("source"))
        target = edge_endpoint(edge.get("to") or edge.get("target"))
        if not source or not target:
            continue
        materialization = "reference" if edge.get("materialization") == "reference" else "copy"
        current_edge_id = string_or_none(edge.get("id"))
        if source["node"] == input_boundary:
            source_ports = input_ports
            target_ports = node_input_ports.get(target["node"], ["main"])
            if not validate_port_pair(
                diagnostics,
                code="unknown_boundary_transfer_port",
                edge_id=current_edge_id,
                source_node=source["node"],
                target_node=target["node"],
                source_port=source["port"],
                target_port=target["port"],
                source_ports=source_ports,
                target_ports=target_ports,
            ):
                continue
            append_input_binding(
                input_bindings,
                input_keys,
                input_origins,
                origin_edge_id=current_edge_id,
                source_port=source["port"],
                target_node=target["node"],
                target_port=target["port"],
                materialization=materialization,
                required=bool(edge.get("required", False)),
            )
        elif target["node"] == output_boundary:
            source_ports = node_output_ports.get(source["node"], ["main"])
            target_ports = output_ports
            if not validate_port_pair(
                diagnostics,
                code="unknown_boundary_transfer_port",
                edge_id=current_edge_id,
                source_node=source["node"],
                target_node=target["node"],
                source_port=source["port"],
                target_port=target["port"],
                source_ports=source_ports,
                target_ports=target_ports,
            ):
                continue
            append_output_binding(
                output_bindings,
                output_keys,
                output_origins,
                origin_edge_id=current_edge_id,
                source_node=source["node"],
                source_port=source["port"],
                target_port=target["port"],
                materialization=materialization,
                required=bool(edge.get("required", True)),
            )

    for edge in edges:
        if is_data_edge_payload(edge):
            continue
        source_id = edge.get("from") or edge.get("source")
        target_id = edge.get("to") or edge.get("target")
        if not isinstance(source_id, str) or not isinstance(target_id, str):
            continue
        current_edge_id = string_or_none(edge.get("id"))
        if source_id == input_boundary and not is_workflow_boundary_node(target_id):
            append_input_bindings_for_control(
                input_bindings,
                input_keys,
                input_origins,
                diagnostics,
                edge=edge,
                origin_edge_id=current_edge_id,
                source_node=source_id,
                target_node=target_id,
                source_ports=input_ports,
                target_ports=node_input_ports.get(target_id, ["main"]),
            )
        elif target_id == output_boundary and not is_workflow_boundary_node(source_id):
            append_output_bindings_for_control(
                output_bindings,
                output_keys,
                output_origins,
                diagnostics,
                edge=edge,
                origin_edge_id=current_edge_id,
                source_node=source_id,
                target_node=target_id,
                source_ports=node_output_ports.get(source_id, ["main"]),
                target_ports=output_ports,
            )

    if edge_id:
        input_bindings = [
            binding
            for binding in input_bindings
            if input_origins.get(
                (
                    str(binding.get("source_port") or "main"),
                    str((binding.get("target") or {}).get("node") or ""),
                    str((binding.get("target") or {}).get("port") or "main"),
                )
            )
            == edge_id
        ]
        output_bindings = [
            binding
            for binding in output_bindings
            if output_origins.get(
                (
                    str((binding.get("source") or {}).get("node") or ""),
                    str((binding.get("source") or {}).get("port") or "main"),
                    str(binding.get("target_port") or "main"),
                )
            )
            == edge_id
        ]
        diagnostics = [
            diagnostic for diagnostic in diagnostics if diagnostic.get("edge_id") in {edge_id, None}
        ]

    has_errors = any(diagnostic.get("severity") == "error" for diagnostic in diagnostics)
    return {
        "status": "invalid" if has_errors else "valid",
        "bindings": {
            "workflow_input_bindings": input_bindings,
            "workflow_output_bindings": output_bindings,
        },
        "diagnostics": diagnostics,
        "canonical_preview": {
            "workbench_projection": "boundary_control_port_binding",
            "runtime_control_edge": False,
        },
    }


def preview_boundary_transfer_for_canvas_snapshot(
    canvas_snapshot: dict[str, Any],
    *,
    edge_id: str | None = None,
) -> BoundaryTransferExpansion:
    snapshot = canvas_snapshot.get("canvas_snapshot")
    if isinstance(snapshot, dict):
        canvas_snapshot = snapshot
    graph = canvas_snapshot.get("canonical_graph")
    if not isinstance(graph, dict):
        graph = canvas_snapshot
    aggregate = empty_expansion()
    append_graph_level_preview(aggregate, graph, edge_id=edge_id)
    for node in graph.get("nodes") if isinstance(graph.get("nodes"), list) else []:
        if not isinstance(node, dict):
            continue
        ui = node.get("ui")
        if not isinstance(ui, dict) or ui.get("semantic_kind") != "workflow_container":
            continue
        internal_nodes = (
            ui.get("internal_nodes") if isinstance(ui.get("internal_nodes"), list) else []
        )
        internal_edges = (
            ui.get("internal_edges") if isinstance(ui.get("internal_edges"), list) else []
        )
        expansion = expand_boundary_transfer_bindings(
            workflow_id=str(node.get("id") or ""),
            edges=[edge for edge in internal_edges if isinstance(edge, dict)],
            internal_nodes=[item for item in internal_nodes if isinstance(item, dict)],
            exposed_inputs=node.get("input_ports"),
            exposed_outputs=node.get("output_ports"),
            edge_id=edge_id,
        )
        merge_expansion(aggregate, expansion)
    return finalize_expansion(aggregate)


def normalize_boundary_transfer_metadata(edge: dict[str, Any]) -> dict[str, Any] | None:
    transfer = raw_boundary_transfer(edge)
    if not transfer:
        return None
    direction = transfer.get("direction")
    if direction not in {"workflow_input", "workflow_output"}:
        return None
    mappings = boundary_transfer_mappings(transfer)
    return {
        "schema": BOUNDARY_TRANSFER_SCHEMA,
        "direction": direction,
        "materialization": boundary_transfer_materialization(transfer),
        "inference": "explicit" if mappings else boundary_transfer_inference(transfer),
        **({"mappings": mappings} if mappings else {}),
    }


def first_error_message(diagnostics: list[BoundaryTransferDiagnostic]) -> str | None:
    for diagnostic in diagnostics:
        if diagnostic.get("severity") == "error":
            return f"{diagnostic.get('code')}: {diagnostic.get('message')}"
    return None


def append_graph_level_preview(
    aggregate: BoundaryTransferExpansion,
    graph: dict[str, Any],
    *,
    edge_id: str | None,
) -> None:
    metadata = graph.get("metadata")
    if not isinstance(metadata, dict):
        return
    if metadata.get("layout") != "workflow-focus":
        return
    raw_edges = metadata.get("workflow_port_edges")
    if not isinstance(raw_edges, list):
        return
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    expansion = expand_boundary_transfer_bindings(
        workflow_id=str(graph.get("id") or ""),
        edges=[edge for edge in raw_edges if isinstance(edge, dict)],
        internal_nodes=[node for node in nodes if isinstance(node, dict)],
        exposed_inputs=graph.get("exposed_inputs"),
        exposed_outputs=graph.get("exposed_outputs"),
        edge_id=edge_id,
    )
    merge_expansion(aggregate, expansion)


def append_input_bindings_for_control(
    bindings: list[dict[str, Any]],
    seen: set[tuple[str, str, str]],
    origins: dict[tuple[str, str, str], str | None],
    diagnostics: list[BoundaryTransferDiagnostic],
    *,
    edge: dict[str, Any],
    origin_edge_id: str | None,
    source_node: str,
    target_node: str,
    source_ports: list[str],
    target_ports: list[str],
) -> None:
    transfer = raw_boundary_transfer(edge)
    if has_direction_mismatch(
        diagnostics,
        transfer,
        expected="workflow_input",
        edge_id=origin_edge_id,
        source_node=source_node,
        target_node=target_node,
        source_ports=source_ports,
        target_ports=target_ports,
    ):
        return
    pairs = explicit_or_inferred_pairs(
        diagnostics,
        transfer=transfer,
        direction="workflow_input",
        edge_id=origin_edge_id,
        source_node=source_node,
        target_node=target_node,
        source_ports=source_ports,
        target_ports=target_ports,
    )
    materialization = boundary_transfer_materialization(transfer or {})
    already_bound_targets = {target_port for _, node, target_port in seen if node == target_node}
    for source_port, target_port in pairs:
        if target_port in already_bound_targets:
            continue
        if not validate_port_pair(
            diagnostics,
            code="unknown_boundary_transfer_port",
            edge_id=origin_edge_id,
            source_node=source_node,
            target_node=target_node,
            source_port=source_port,
            target_port=target_port,
            source_ports=source_ports,
            target_ports=target_ports,
        ):
            continue
        append_input_binding(
            bindings,
            seen,
            origins,
            origin_edge_id=origin_edge_id,
            source_port=source_port,
            target_node=target_node,
            target_port=target_port,
            materialization=materialization,
            required=False,
        )


def append_output_bindings_for_control(
    bindings: list[dict[str, Any]],
    seen: set[tuple[str, str, str]],
    origins: dict[tuple[str, str, str], str | None],
    diagnostics: list[BoundaryTransferDiagnostic],
    *,
    edge: dict[str, Any],
    origin_edge_id: str | None,
    source_node: str,
    target_node: str,
    source_ports: list[str],
    target_ports: list[str],
) -> None:
    transfer = raw_boundary_transfer(edge)
    if has_direction_mismatch(
        diagnostics,
        transfer,
        expected="workflow_output",
        edge_id=origin_edge_id,
        source_node=source_node,
        target_node=target_node,
        source_ports=source_ports,
        target_ports=target_ports,
    ):
        return
    pairs = explicit_or_inferred_pairs(
        diagnostics,
        transfer=transfer,
        direction="workflow_output",
        edge_id=origin_edge_id,
        source_node=source_node,
        target_node=target_node,
        source_ports=source_ports,
        target_ports=target_ports,
    )
    materialization = boundary_transfer_materialization(transfer or {})
    already_bound_sources = {source_port for node, source_port, _ in seen if node == source_node}
    already_bound_targets = {target_port for node, _, target_port in seen if node == source_node}
    for source_port, target_port in pairs:
        if source_port in already_bound_sources or target_port in already_bound_targets:
            continue
        if not validate_port_pair(
            diagnostics,
            code="unknown_boundary_transfer_port",
            edge_id=origin_edge_id,
            source_node=source_node,
            target_node=target_node,
            source_port=source_port,
            target_port=target_port,
            source_ports=source_ports,
            target_ports=target_ports,
        ):
            continue
        append_output_binding(
            bindings,
            seen,
            origins,
            origin_edge_id=origin_edge_id,
            source_node=source_node,
            source_port=source_port,
            target_port=target_port,
            materialization=materialization,
            required=True,
        )


def explicit_or_inferred_pairs(
    diagnostics: list[BoundaryTransferDiagnostic],
    *,
    transfer: dict[str, Any] | None,
    direction: BoundaryDirection,
    edge_id: str | None,
    source_node: str,
    target_node: str,
    source_ports: list[str],
    target_ports: list[str],
) -> list[tuple[str, str]]:
    mappings = boundary_transfer_mappings(transfer or {})
    if mappings:
        duplicate_pairs = duplicate_mapping_pairs(mappings)
        for source_port, target_port in duplicate_pairs:
            diagnostics.append(
                diagnostic(
                    code="duplicate_boundary_transfer_mapping",
                    edge_id=edge_id,
                    source_node=source_node,
                    target_node=target_node,
                    source_ports=source_ports,
                    target_ports=target_ports,
                    message=(
                        f"边界传输映射重复: {source_port} -> {target_port}。请删除重复 mapping。"
                    ),
                )
            )
        return [(item["source_port"], item["target_port"]) for item in mappings]
    return infer_boundary_pairs(
        diagnostics,
        direction=direction,
        edge_id=edge_id,
        source_node=source_node,
        target_node=target_node,
        source_ports=source_ports,
        target_ports=target_ports,
    )


def infer_boundary_pairs(
    diagnostics: list[BoundaryTransferDiagnostic],
    *,
    direction: BoundaryDirection,
    edge_id: str | None,
    source_node: str,
    target_node: str,
    source_ports: list[str],
    target_ports: list[str],
) -> list[tuple[str, str]]:
    source = unique_port_ids(source_ports)
    target = unique_port_ids(target_ports)
    same_name = [port_id for port_id in source if port_id in target]
    specific = [port_id for port_id in same_name if port_id != "main"]
    if specific:
        return [(port_id, port_id) for port_id in specific]
    if "main" in same_name:
        return [("main", "main")]
    if len(source) == 1 and len(target) == 1:
        return [(source[0], target[0])]
    code = (
        "ambiguous_workflow_input_boundary_control"
        if direction == "workflow_input"
        else "ambiguous_workflow_output_boundary_control"
    )
    diagnostics.append(
        diagnostic(
            code=code,
            edge_id=edge_id,
            source_node=source_node,
            target_node=target_node,
            source_ports=source,
            target_ports=target,
            message=(
                "无法从该边界控制线唯一推断 workflow "
                f"{'输入' if direction == 'workflow_input' else '输出'}端口，"
                "请配置 boundary_transfer.mappings。"
            ),
        )
    )
    return []


def has_direction_mismatch(
    diagnostics: list[BoundaryTransferDiagnostic],
    transfer: dict[str, Any] | None,
    *,
    expected: BoundaryDirection,
    edge_id: str | None,
    source_node: str,
    target_node: str,
    source_ports: list[str],
    target_ports: list[str],
) -> bool:
    if not transfer:
        return False
    direction = transfer.get("direction")
    if direction in {None, expected}:
        return False
    diagnostics.append(
        diagnostic(
            code="boundary_transfer_direction_mismatch",
            edge_id=edge_id,
            source_node=source_node,
            target_node=target_node,
            source_ports=source_ports,
            target_ports=target_ports,
            message=(f"边界传输方向为 {direction!r}，但该控制线需要 {expected!r}。"),
        )
    )
    return True


def validate_port_pair(
    diagnostics: list[BoundaryTransferDiagnostic],
    *,
    code: str,
    edge_id: str | None,
    source_node: str,
    target_node: str,
    source_port: str,
    target_port: str,
    source_ports: list[str],
    target_ports: list[str],
) -> bool:
    source = unique_port_ids(source_ports)
    target = unique_port_ids(target_ports)
    missing: list[str] = []
    if source_port not in source:
        missing.append(f"source_port={source_port}")
    if target_port not in target:
        missing.append(f"target_port={target_port}")
    if not missing:
        return True
    diagnostics.append(
        diagnostic(
            code=code,
            edge_id=edge_id,
            source_node=source_node,
            target_node=target_node,
            source_ports=source,
            target_ports=target,
            message=(
                "边界传输端口不存在: "
                f"{', '.join(missing)}。请更新端口或 boundary_transfer.mappings。"
            ),
        )
    )
    return False


def append_input_binding(
    bindings: list[dict[str, Any]],
    seen: set[tuple[str, str, str]],
    origins: dict[tuple[str, str, str], str | None],
    *,
    origin_edge_id: str | None,
    source_port: str,
    target_node: str,
    target_port: str,
    materialization: str,
    required: bool,
) -> None:
    key = (source_port, target_node, target_port)
    if key in seen:
        return
    seen.add(key)
    origins[key] = origin_edge_id
    bindings.append(
        {
            "source_port": source_port,
            "target": {"node": target_node, "port": target_port},
            "materialization": materialization,
            "required": required,
        }
    )


def append_output_binding(
    bindings: list[dict[str, Any]],
    seen: set[tuple[str, str, str]],
    origins: dict[tuple[str, str, str], str | None],
    *,
    origin_edge_id: str | None,
    source_node: str,
    source_port: str,
    target_port: str,
    materialization: str,
    required: bool,
) -> None:
    key = (source_node, source_port, target_port)
    if key in seen:
        return
    seen.add(key)
    origins[key] = origin_edge_id
    bindings.append(
        {
            "source": {"node": source_node, "port": source_port},
            "target_port": target_port,
            "materialization": materialization,
            "required": required,
        }
    )


def raw_boundary_transfer(edge: dict[str, Any]) -> dict[str, Any] | None:
    transfer = edge.get("boundaryTransfer") or edge.get("boundary_transfer")
    if isinstance(transfer, dict):
        return transfer
    mapping = edge.get("mapping")
    return mapping if isinstance(mapping, dict) and mapping.get("mappings") else None


def boundary_transfer_mappings(transfer: dict[str, Any]) -> list[dict[str, str]]:
    raw_mappings = transfer.get("mappings")
    if not isinstance(raw_mappings, list):
        return []
    mappings: list[dict[str, str]] = []
    for item in raw_mappings:
        if not isinstance(item, dict):
            continue
        source_port = item.get("source_port") or item.get("sourcePort")
        target_port = item.get("target_port") or item.get("targetPort")
        if (
            isinstance(source_port, str)
            and source_port
            and isinstance(target_port, str)
            and target_port
        ):
            mappings.append({"source_port": source_port, "target_port": target_port})
    return mappings


def duplicate_mapping_pairs(mappings: list[dict[str, str]]) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    duplicates: list[tuple[str, str]] = []
    for mapping in mappings:
        pair = (mapping["source_port"], mapping["target_port"])
        if pair in seen and pair not in duplicates:
            duplicates.append(pair)
        seen.add(pair)
    return duplicates


def boundary_transfer_materialization(transfer: dict[str, Any]) -> str:
    return "reference" if transfer.get("materialization") == "reference" else "copy"


def boundary_transfer_inference(transfer: dict[str, Any]) -> str:
    value = transfer.get("inference")
    return value if value in {"same_name", "main_compat", "single_port"} else "same_name"


def port_ids_from_ui_ports(value: Any) -> list[str]:
    if isinstance(value, dict):
        ids = [str(port_id) for port_id in value if isinstance(port_id, str) and port_id]
        return ids or ["main"]
    if not isinstance(value, list):
        return ["main"]
    ids: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        port_id = str(item.get("id") or "main")
        if port_id not in ids:
            ids.append(port_id)
    return ids or ["main"]


def internal_node_port_ids_by_direction(
    nodes: list[dict[str, Any]],
    direction: str,
) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for node in nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            continue
        raw_ports = node.get("inputPorts") if direction == "input" else node.get("outputPorts")
        if raw_ports is None:
            raw_ports = (
                node.get("input_ports") if direction == "input" else node.get("output_ports")
            )
        result[node_id] = port_ids_from_ui_ports(raw_ports)
    return result


def edge_endpoint(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    node = value.get("node") or value.get("workflowId")
    if not isinstance(node, str) or not node:
        return None
    port = value.get("port") or value.get("portId") or "main"
    return {"node": node, "port": str(port)}


def is_data_edge_payload(edge: dict[str, Any]) -> bool:
    if edge.get("kind") == "data":
        return True
    source = edge.get("from") or edge.get("source")
    target = edge.get("to") or edge.get("target")
    return isinstance(source, dict) and isinstance(target, dict)


def workflow_input_boundary_id(workflow_id: str) -> str:
    return f"{workflow_id}__workflow_inputs"


def workflow_output_boundary_id(workflow_id: str) -> str:
    return f"{workflow_id}__workflow_outputs"


def is_workflow_boundary_node(node_id: str) -> bool:
    return node_id.endswith("__workflow_inputs") or node_id.endswith("__workflow_outputs")


def unique_port_ids(port_ids: list[str]) -> list[str]:
    result: list[str] = []
    for port_id in port_ids:
        value = str(port_id or "main")
        if value not in result:
            result.append(value)
    return result or ["main"]


def diagnostic(
    *,
    code: str,
    edge_id: str | None,
    source_node: str | None,
    target_node: str | None,
    source_ports: list[str],
    target_ports: list[str],
    message: str,
    severity: Severity = "error",
) -> BoundaryTransferDiagnostic:
    return {
        "code": code,
        "severity": severity,
        "edge_id": edge_id,
        "source_node": source_node,
        "target_node": target_node,
        "source_ports": unique_port_ids(source_ports),
        "target_ports": unique_port_ids(target_ports),
        "message": message,
    }


def empty_expansion() -> BoundaryTransferExpansion:
    return {
        "status": "valid",
        "bindings": {
            "workflow_input_bindings": [],
            "workflow_output_bindings": [],
        },
        "diagnostics": [],
        "canonical_preview": {
            "workbench_projection": "boundary_control_port_binding",
            "runtime_control_edge": False,
        },
    }


def merge_expansion(
    target: BoundaryTransferExpansion,
    source: BoundaryTransferExpansion,
) -> None:
    target["bindings"]["workflow_input_bindings"].extend(
        source["bindings"]["workflow_input_bindings"]
    )
    target["bindings"]["workflow_output_bindings"].extend(
        source["bindings"]["workflow_output_bindings"]
    )
    target["diagnostics"].extend(source["diagnostics"])


def finalize_expansion(expansion: BoundaryTransferExpansion) -> BoundaryTransferExpansion:
    expansion["status"] = (
        "invalid"
        if any(diagnostic.get("severity") == "error" for diagnostic in expansion["diagnostics"])
        else "valid"
    )
    return expansion


def string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None
