from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from acc.app.workflow_normalization import (
    aggregate_normalization_summaries,
    normalize_workflow_payload_contracts,
)
from acc.callable_registry import CallableRegistry
from acc.callable_runner import normalize_output_schema_for_structured_output
from acc.domain import CORE_V2_SCHEMA_VERSION
from acc.engine import is_clean_workflow_payload, parse_workflow_function_template
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.store import is_clean_workflow_path
from acc.utils import AccError

CANONICAL_TEMPLATE_KEYS = {
    "schema_version",
    "id",
    "version",
    "name",
    "description",
    "nodes",
    "control_edges",
    "data_edges",
    "exposed_inputs",
    "exposed_outputs",
    "workflow_input_bindings",
    "workflow_output_bindings",
    "policies",
    "metadata",
}

CANONICAL_NODE_KEYS = {
    "id",
    "callable_ref",
    "overrides",
    "ports",
    "input_bindings",
    "output_bindings",
    "workflow_call_input_bindings",
    "workflow_call_output_bindings",
    "environment_policy",
    "invocation_policy",
    "runtime_policy",
    "prompt_policy",
    "control",
    "artifact_contract",
    "output_schema",
    "metadata",
}

EXECUTABLE_UI_NODE_KEYS = {
    "kind",
    "label",
    "input",
    "input_mapping",
    "cwd_policy",
    "relative_cwd",
    "input_ports",
    "output_ports",
    "position",
    "ui",
    "workflow_ref",
}

CODEX_LOCAL_READONLY_NO_SANDBOX = "local_readonly_no_sandbox"
CODEX_DANGER_FULL_ACCESS = "danger_full_access"
CODEX_EXECUTION_MODES = {
    CODEX_LOCAL_READONLY_NO_SANDBOX,
    CODEX_DANGER_FULL_ACCESS,
}


@dataclass(frozen=True)
class CompiledWorkbenchWorkflowBundle:
    root: dict[str, Any]
    children: dict[str, dict[str, Any]]
    validation_preview: dict[str, Any]
    ref_resolution_preview: list[dict[str, Any]] | None = None
    normalization: dict[str, Any] = field(default_factory=dict)


def canonicalize_workbench_workflow_payload(
    payload: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    """Return a canonical Core v2 workflow payload from a Workbench draft or payload."""

    copied = json.loads(json.dumps(payload))
    if is_clean_workflow_payload(copied):
        canonical = normalize_core_v2_payload(copied, source_path=source_path)
    else:
        canonical = workbench_draft_to_core_v2_payload(copied, source_path=source_path)
    validate_canonical_workflow_payload(canonical, source_path=source_path)
    return canonical


def merge_workbench_codex_execution_modes(
    graph: dict[str, Any],
    canvas_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Fill missing Codex execution modes from the latest Workbench snapshot.

    The browser owns interaction state. In practice a run request can race with
    graph projection updates, while the snapshot has the latest node settings.
    This merge is deliberately narrow: it only copies Codex execution mode onto
    matching root or inline-container internal nodes when the submitted graph did
    not already carry an explicit mode.
    """

    mode_index = codex_execution_mode_index(canvas_snapshot)
    if not mode_index:
        return graph
    merged = copy.deepcopy(graph)
    for node in merged.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "")
        root_mode = mode_index.get((None, node_id))
        if root_mode and not codex_execution_mode_from_ui_node(node):
            metadata = safe_metadata(node.get("metadata"))
            metadata["codex_execution_mode"] = root_mode
            node["metadata"] = metadata
        ui = node.get("ui")
        if not isinstance(ui, dict):
            continue
        internal_nodes = ui.get("internal_nodes")
        if not isinstance(internal_nodes, list):
            continue
        for internal_node in internal_nodes:
            if not isinstance(internal_node, dict):
                continue
            internal_id = str(internal_node.get("id") or "")
            internal_mode = mode_index.get((node_id, internal_id))
            if internal_mode and not codex_execution_mode_from_ui_node(internal_node):
                internal_node["codexExecutionMode"] = internal_mode
    return merged


def codex_execution_mode_index(
    canvas_snapshot: dict[str, Any],
) -> dict[tuple[str | None, str], str]:
    graph = canvas_snapshot.get("canonical_graph")
    if not isinstance(graph, dict):
        graph = canvas_snapshot
    modes: dict[tuple[str | None, str], str] = {}
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "")
        root_mode = codex_execution_mode_from_ui_node(node)
        if node_id and root_mode:
            modes[(None, node_id)] = root_mode
        ui = node.get("ui")
        if not isinstance(ui, dict):
            continue
        for internal_node in ui.get("internal_nodes") or []:
            if not isinstance(internal_node, dict):
                continue
            internal_id = str(internal_node.get("id") or "")
            internal_mode = codex_execution_mode_from_ui_node(internal_node)
            if node_id and internal_id and internal_mode:
                modes[(node_id, internal_id)] = internal_mode
    workflows = canvas_snapshot.get("workflows")
    if isinstance(workflows, list):
        for workflow in workflows:
            if not isinstance(workflow, dict):
                continue
            workflow_id = str(workflow.get("id") or "")
            root_mode = codex_execution_mode_from_ui_node(workflow)
            if workflow_id and root_mode:
                modes[(None, workflow_id)] = root_mode
            for internal_node in workflow.get("internalNodes") or []:
                if not isinstance(internal_node, dict):
                    continue
                internal_id = str(internal_node.get("id") or "")
                internal_mode = codex_execution_mode_from_ui_node(internal_node)
                if workflow_id and internal_id and internal_mode:
                    modes[(workflow_id, internal_id)] = internal_mode
    return modes


def compile_workbench_workflow_bundle(
    payload: dict[str, Any],
    *,
    source_path: Path,
    callable_registry: CallableRegistry | None = None,
    force_main_data_edge_migration: bool = False,
    allow_normalization_conflicts: bool = False,
) -> CompiledWorkbenchWorkflowBundle:
    """Compile a Workbench draft into root + child Core v2 templates.

    UI container internals are layout/projection state. This function is the
    app-layer boundary that turns those internals into real child workflow
    function templates before anything is saved or run.
    """

    copied = json.loads(json.dumps(payload))
    children: dict[str, dict[str, Any]] = {}
    if is_clean_workflow_payload(copied):
        root = normalize_core_v2_payload(copied, source_path=source_path)
    else:
        rewritten = rewrite_inline_workflow_containers(copied, source_path=source_path)
        children = rewritten.pop("__compiled_children__", {})
        root = workbench_draft_to_core_v2_payload(rewritten, source_path=source_path)
    root, root_normalization = normalize_workflow_payload_contracts(
        root,
        callable_registry=callable_registry,
        force=force_main_data_edge_migration,
        allow_conflicts=allow_normalization_conflicts,
    )
    child_normalizations = {}
    for child_name, child_payload in list(children.items()):
        normalized_child, child_summary = normalize_workflow_payload_contracts(
            child_payload,
            callable_registry=callable_registry,
            force=force_main_data_edge_migration,
            allow_conflicts=allow_normalization_conflicts,
        )
        children[child_name] = normalized_child
        child_normalizations[child_name] = child_summary
    normalization = aggregate_normalization_summaries(
        root_normalization,
        child_normalizations,
        root_id=str(root.get("id") or ""),
    ).as_dict()
    validate_canonical_workflow_payload(root, source_path=source_path)
    for child_name, child_payload in children.items():
        validate_canonical_workflow_payload(
            child_payload,
            source_path=source_path.parent / child_name,
        )
    return CompiledWorkbenchWorkflowBundle(
        root=root,
        children=children,
        validation_preview={
            "root": root.get("id"),
            "children": sorted(children),
            "format": "accflow_bundle",
        },
        ref_resolution_preview=None,
        normalization=normalization,
    )


def validate_canonical_workflow_payload(
    payload: dict[str, Any],
    *,
    source_path: Path | None,
) -> None:
    template = parse_workflow_function_template(payload, source_path=source_path)
    errors = [
        issue
        for issue in collect_callable_validation_issues(template)
        if issue.severity == "error"
    ]
    if not errors:
        return
    details = "; ".join(f"{issue.code}: {issue.message}" for issue in errors)
    raise AccError(details)


def normalize_core_v2_payload(
    payload: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    canonical = {key: payload[key] for key in payload if key in CANONICAL_TEMPLATE_KEYS}
    canonical.setdefault("schema_version", CORE_V2_SCHEMA_VERSION)
    canonical.setdefault("version", "0.1.0")
    canonical.setdefault("control_edges", [])
    canonical.setdefault("data_edges", [])
    canonical["nodes"] = [
        normalize_core_v2_node(node, source_path=source_path)
        for node in canonical.get("nodes") or []
    ]
    canonical["control_edges"] = [
        normalize_control_edge(edge) for edge in canonical.get("control_edges") or []
    ]
    canonical["data_edges"] = [
        normalize_data_edge(edge) for edge in canonical.get("data_edges") or []
    ]
    metadata = canonical.get("metadata")
    canonical["metadata"] = metadata if isinstance(metadata, dict) else {}
    canonical["metadata"]["canonical_format"] = "accflow"
    return canonical


def workbench_draft_to_core_v2_payload(
    draft: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    if "tasks" in draft or draft.get("format") == "graph":
        raise AccError(
            "Legacy workflow graph payloads are not accepted by Workbench save/run. "
            "Convert them to Core v2 .accflow.json first."
        )
    nodes = draft.get("nodes")
    metadata = safe_metadata(draft.get("metadata"))
    allow_empty_nodes = bool(metadata.get("compiled_from_workbench_container"))
    if not isinstance(nodes, list) or (not nodes and not allow_empty_nodes):
        raise AccError("Workbench workflow draft requires a non-empty nodes array")

    metadata["canonical_format"] = "accflow"
    metadata["workbench_draft"] = True
    metadata["ui_layout"] = {
        "layout": metadata.get("layout") or draft.get("layout"),
        "root_workflow_id": metadata.get("root_workflow_id"),
        "nodes": [
            {
                "id": str(node.get("id") or ""),
                "position": safe_position(node.get("position")),
                "label": str(node.get("label") or node.get("id") or ""),
            }
            for node in nodes
            if isinstance(node, dict)
        ],
    }

    canonical = {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": str(draft.get("id") or "").strip(),
        "version": str(draft.get("version") or "0.1.0"),
        "name": draft.get("name"),
        "description": draft.get("description"),
        "nodes": [
            workbench_node_to_core_v2_node(node, source_path=source_path)
            for node in nodes
            if isinstance(node, dict)
        ],
        "control_edges": [
            normalize_control_edge(edge)
            for edge in (draft.get("control_edges") or draft.get("edges") or [])
            if isinstance(edge, dict)
        ],
        "data_edges": [
            normalize_data_edge(edge)
            for edge in draft.get("data_edges") or []
            if isinstance(edge, dict)
        ],
        "metadata": metadata,
    }
    if not canonical["id"]:
        raise AccError("Workbench workflow draft id is required")
    copy_optional_ports(draft, canonical, "exposed_inputs")
    copy_optional_ports(draft, canonical, "exposed_outputs")
    for key in ("workflow_input_bindings", "workflow_output_bindings"):
        if isinstance(draft.get(key), list):
            canonical[key] = draft[key]
    policies = draft.get("policies") or draft.get("policy")
    if isinstance(policies, dict):
        canonical["policies"] = {
            key: value for key, value in policies.items() if key != "workspace"
        }
    return prune_none(canonical)


def rewrite_inline_workflow_containers(
    draft: dict[str, Any],
    *,
    source_path: Path,
) -> dict[str, Any]:
    nodes = draft.get("nodes")
    if not isinstance(nodes, list):
        return draft
    parent_id = slug_identifier(str(draft.get("id") or source_path.stem))
    children: dict[str, dict[str, Any]] = {}
    rewritten_nodes: list[Any] = []
    for node in nodes:
        if not isinstance(node, dict):
            rewritten_nodes.append(node)
            continue
        if not is_inline_workflow_container_node(node):
            rewritten_nodes.append(node)
            continue
        child_id = unique_child_workflow_id(parent_id, str(node.get("id") or "workflow"), children)
        child_name = f"{child_id}.accflow.json"
        child_draft = workflow_container_child_draft(node, child_id, child_name)
        children[child_name] = workbench_draft_to_core_v2_payload(
            child_draft,
            source_path=source_path.parent / child_name,
        )
        rewritten_nodes.append(parent_workflow_call_node(node, child_name))
    next_draft = {**draft, "nodes": rewritten_nodes}
    if children:
        next_draft["__compiled_children__"] = children
    return next_draft


def is_inline_workflow_container_node(node: dict[str, Any]) -> bool:
    ui = node.get("ui")
    if not isinstance(ui, dict):
        return False
    return ui.get("semantic_kind") == "workflow_container" or isinstance(
        ui.get("internal_nodes"),
        list,
    )


def workflow_container_internal_nodes(node: dict[str, Any]) -> list[dict[str, Any]]:
    ui = node.get("ui")
    if not isinstance(ui, dict):
        return []
    internal_nodes = ui.get("internal_nodes")
    if not isinstance(internal_nodes, list):
        return []
    return [item for item in internal_nodes if isinstance(item, dict)]


def workflow_container_internal_edges(node: dict[str, Any]) -> list[dict[str, Any]]:
    ui = node.get("ui")
    if not isinstance(ui, dict):
        return []
    internal_edges = ui.get("internal_edges")
    if not isinstance(internal_edges, list):
        return []
    return [item for item in internal_edges if isinstance(item, dict)]


def validate_unique_workflow_container_internal_node_ids(
    container_node: dict[str, Any],
    internal_nodes: list[dict[str, Any]],
) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for internal_node in internal_nodes:
        node_id = str(internal_node.get("id") or "").strip()
        if not node_id:
            continue
        if node_id in seen:
            duplicates.add(node_id)
        seen.add(node_id)
    if duplicates:
        container_id = str(container_node.get("id") or "<unknown>")
        duplicate_ids = ", ".join(sorted(duplicates))
        raise AccError(
            "duplicate_workflow_internal_node_id: "
            f"workflow container {container_id!r} contains duplicate internal node id(s): "
            f"{duplicate_ids}"
        )


def workflow_container_child_draft(
    node: dict[str, Any],
    child_id: str,
    child_name: str,
) -> dict[str, Any]:
    internal_nodes = workflow_container_internal_nodes(node)
    validate_unique_workflow_container_internal_node_ids(node, internal_nodes)
    child_nodes = [internal_ui_node_to_workbench_node(item) for item in internal_nodes]
    edges = workflow_container_internal_edges(node)
    control_edges, data_edges, workflow_input_bindings, workflow_output_bindings = (
        split_internal_edges_for_child_workflow(str(node.get("id") or ""), edges)
    )
    metadata = {
        "canonical_format": "accflow",
        "compiled_from_workbench_container": str(node.get("id") or ""),
        "compiled_child_path": child_name,
    }
    binding_ref = workflow_container_binding_ref(node)
    if binding_ref:
        metadata["binding_ref"] = binding_ref
    return {
        "id": child_id,
        "version": str(node.get("version") or "0.1.0"),
        "name": str(node.get("label") or node.get("id") or child_id),
        "description": f"Child workflow compiled from Workbench container {node.get('id')}.",
        "nodes": child_nodes,
        "control_edges": control_edges,
        "data_edges": data_edges,
        "exposed_inputs": node.get("input_ports") or [{"id": "main", "required": False}],
        "exposed_outputs": node.get("output_ports") or [{"id": "main", "required": False}],
        "workflow_input_bindings": workflow_input_bindings,
        "workflow_output_bindings": workflow_output_bindings,
        "policy": {"failure_mode": "fail_fast", "max_concurrency": 8},
        "metadata": metadata,
    }


def internal_ui_node_to_workbench_node(node: dict[str, Any]) -> dict[str, Any]:
    node_id = str(node.get("id") or "").strip()
    node_kind = str(node.get("kind") or "")
    callable_id = str(
        node.get("callableId") or node.get("callable_id") or node.get("runtime") or ""
    )
    is_tool = node_kind.lower() == "tool"
    label = str(node.get("name") or node.get("label") or node_id)
    input_payload = node.get("input") if isinstance(node.get("input"), dict) else {}
    if not input_payload:
        task = str(node.get("task") or label)
        input_payload = {"topic": task, "prompt": task}
    result = {
        "id": node_id,
        "callable_ref": {
            "kind": "tool_class" if is_tool else "agent_class",
            "id": callable_id,
        },
        "kind": "tool" if is_tool else "agent_session",
        "label": label,
        "input": input_payload,
        "input_mapping": {},
        "input_ports": normalize_ui_ports(node.get("inputPorts") or node.get("input_ports")),
        "output_ports": normalize_ui_ports(node.get("outputPorts") or node.get("output_ports")),
        "position": safe_position(node.get("position")),
    }
    codex_mode = codex_execution_mode_from_ui_node(node)
    if codex_mode:
        result["metadata"] = {"codex_execution_mode": codex_mode}
        result["invocation_policy"] = codex_invocation_policy_for_mode(codex_mode)
    output_schema = node.get("outputSchema") or node.get("output_schema")
    if isinstance(output_schema, dict):
        result["output_schema"] = normalize_output_schema_for_structured_output(output_schema)
    control_payload = dict(node.get("control")) if isinstance(node.get("control"), dict) else {}
    forward_main = node.get("forwardMainOutputOnControl")
    if forward_main is None:
        forward_main = control_payload.get("forward_main_output_on_control")
    if isinstance(forward_main, bool):
        control_payload["forward_main_output_on_control"] = forward_main
    if control_payload:
        result["control"] = control_payload
    return result


def codex_execution_mode_from_ui_node(node: dict[str, Any]) -> str | None:
    for value in (
        node.get("codexExecutionMode"),
        node.get("codex_execution_mode"),
        (node.get("metadata") or {}).get("codex_execution_mode")
        if isinstance(node.get("metadata"), dict)
        else None,
    ):
        if isinstance(value, str) and value in CODEX_EXECUTION_MODES:
            return value
    return None


def codex_invocation_policy_for_mode(mode: str) -> dict[str, Any]:
    if mode == CODEX_LOCAL_READONLY_NO_SANDBOX:
        return {
            "permission_profile": {
                "workspace_access": "read_only",
                "network": False,
                "shell": True,
                "dangerous": True,
            }
        }
    if mode == CODEX_DANGER_FULL_ACCESS:
        return {
            "permission_profile": {
                "workspace_access": "writes_workspace",
                "network": True,
                "shell": True,
                "dangerous": True,
            }
        }
    return {}


def normalize_ui_ports(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return [{"id": "main", "required": False}]
    ports: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        ports.append(
            {
                "id": str(item.get("id") or "main"),
                "required": bool(item.get("required", False)),
                "cardinality": str(item.get("cardinality") or "one"),
            }
        )
    return ports or [{"id": "main", "required": False}]


def split_internal_edges_for_child_workflow(
    workflow_id: str,
    edges: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    control_edges: list[dict[str, Any]] = []
    data_edges: list[dict[str, Any]] = []
    workflow_input_bindings: list[dict[str, Any]] = []
    workflow_output_bindings: list[dict[str, Any]] = []
    workflow_input_binding_keys: set[tuple[str, str, str]] = set()
    workflow_output_binding_keys: set[tuple[str, str, str]] = set()
    input_boundary = f"{workflow_id}__workflow_inputs"
    output_boundary = f"{workflow_id}__workflow_outputs"
    for edge in edges:
        if is_data_edge_payload(edge):
            source = edge_endpoint(edge.get("from") or edge.get("source"))
            target = edge_endpoint(edge.get("to") or edge.get("target"))
            if not source or not target:
                continue
            materialization = edge.get("materialization") or "copy"
            if source["node"] == input_boundary:
                binding_key = (source["port"], target["node"], target["port"])
                if binding_key in workflow_input_binding_keys:
                    continue
                workflow_input_binding_keys.add(binding_key)
                workflow_input_bindings.append(
                    {
                        "source_port": source["port"],
                        "target": {"node": target["node"], "port": target["port"]},
                        "materialization": materialization,
                        "required": bool(edge.get("required", False)),
                    }
                )
            elif target["node"] == output_boundary:
                binding_key = (source["node"], source["port"], target["port"])
                if binding_key in workflow_output_binding_keys:
                    continue
                workflow_output_binding_keys.add(binding_key)
                workflow_output_bindings.append(
                    {
                        "source": {"node": source["node"], "port": source["port"]},
                        "target_port": target["port"],
                        "materialization": materialization,
                        "required": bool(edge.get("required", True)),
                    }
                )
            elif not is_workflow_boundary_node(source["node"]) and not is_workflow_boundary_node(
                target["node"]
            ):
                data_edges.append(
                    {
                        "id": edge.get("id"),
                        "from": {"node": source["node"], "port": source["port"]},
                        "to": {"node": target["node"], "port": target["port"]},
                        "materialization": materialization,
                    }
                )
            continue
        source_id = edge.get("from") or edge.get("source")
        target_id = edge.get("to") or edge.get("target")
        if not isinstance(source_id, str) or not isinstance(target_id, str):
            continue
        if is_workflow_boundary_node(source_id) or is_workflow_boundary_node(target_id):
            continue
        control_edges.append(
            {
                "id": edge.get("id"),
                "from": source_id,
                "to": target_id,
                "condition": edge.get("condition"),
                "context": "none",
            }
        )
    control_edges = ensure_control_edges_for_data_edges(control_edges, data_edges)
    return control_edges, data_edges, workflow_input_bindings, workflow_output_bindings


def is_data_edge_payload(edge: dict[str, Any]) -> bool:
    source = edge.get("from") or edge.get("source")
    target = edge.get("to") or edge.get("target")
    return isinstance(source, dict) or isinstance(target, dict) or "materialization" in edge


def edge_endpoint(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    node = value.get("node")
    if not isinstance(node, str) or not node:
        return None
    port = str(value.get("port") or value.get("input") or value.get("output") or "main")
    return {"node": node, "port": port}


def is_workflow_boundary_node(node_id: str) -> bool:
    return node_id.endswith("__workflow_inputs") or node_id.endswith("__workflow_outputs")


def ensure_control_edges_for_data_edges(
    control_edges: list[dict[str, Any]],
    data_edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    existing = {(edge.get("from"), edge.get("to")) for edge in control_edges}
    next_edges = list(control_edges)
    for edge in data_edges:
        source = edge.get("from")
        target = edge.get("to")
        if not isinstance(source, dict) or not isinstance(target, dict):
            continue
        key = (source.get("node"), target.get("node"))
        if key in existing:
            continue
        if not isinstance(key[0], str) or not isinstance(key[1], str):
            continue
        next_edges.append(
            {
                "id": f"control_for_{key[0]}_{key[1]}",
                "from": key[0],
                "to": key[1],
                "context": "none",
                "metadata": {"auto_added_for_data_edge": True},
            }
        )
        existing.add(key)
    return next_edges


def parent_workflow_call_node(node: dict[str, Any], child_name: str) -> dict[str, Any]:
    ui = node.get("ui") if isinstance(node.get("ui"), dict) else {}
    clean_ui = {
        key: value
        for key, value in ui.items()
        if key not in {"internal_nodes", "internal_edges"}
    }
    metadata = safe_metadata(node.get("metadata"))
    binding_ref = workflow_container_binding_ref(node)
    if binding_ref:
        metadata["binding_ref"] = binding_ref
    rewritten = {
        **node,
        "callable_ref": {"kind": "workflow_function", "id": child_name},
        "workflow_ref": child_name,
        "workflow_call_output_bindings": optional_workflow_call_output_bindings(node),
        "metadata": metadata,
        "ui": clean_ui,
    }
    if not clean_ui:
        rewritten.pop("ui", None)
    return rewritten


def workflow_container_binding_ref(node: dict[str, Any]) -> str | None:
    metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
    ui = node.get("ui") if isinstance(node.get("ui"), dict) else {}
    for value in (
        metadata.get("binding_ref"),
        node.get("binding_ref"),
        node.get("bindingPath"),
        node.get("binding_path"),
        ui.get("binding_ref"),
        ui.get("bindingPath"),
        ui.get("binding_path"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def optional_workflow_call_output_bindings(node: dict[str, Any]) -> list[dict[str, Any]]:
    ports = normalize_ui_ports(node.get("output_ports"))
    return [
        {
            "workflow_output": str(port.get("id") or "main"),
            "parent_port": str(port.get("id") or "main"),
            "required": False,
        }
        for port in ports
    ]


def unique_child_workflow_id(
    parent_id: str,
    node_id: str,
    children: dict[str, dict[str, Any]],
) -> str:
    base = slug_identifier(f"{parent_id}__{node_id}")
    candidate = base
    index = 2
    while f"{candidate}.accflow.json" in children:
        candidate = f"{base}_{index}"
        index += 1
    return candidate


def slug_identifier(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._-")
    if not slug:
        slug = "workflow"
    if not re.match(r"^[A-Za-z_]", slug):
        slug = f"workflow_{slug}"
    return slug


def normalize_core_v2_node(
    node: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    canonical = {key: node[key] for key in node if key in CANONICAL_NODE_KEYS}
    callable_ref = canonical.get("callable_ref")
    if isinstance(callable_ref, dict) and callable_ref.get("kind") == "workflow_function":
        canonical["callable_ref"] = {
            **callable_ref,
            "id": workflow_function_ref(str(callable_ref.get("id") or ""), source_path=source_path),
        }
    if "input_ports" in node or "output_ports" in node:
        canonical["ports"] = ports_from_legacy_fields(node)
    canonical.setdefault("ports", {"inputs": {}, "outputs": {}})
    return prune_none(canonical)


def workbench_node_to_core_v2_node(
    node: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    node_id = str(node.get("id") or "").strip()
    if not node_id:
        raise AccError("Workbench node id is required")
    callable_ref = normalize_callable_ref(node, source_path=source_path)
    raw_input = node.get("input") if isinstance(node.get("input"), dict) else {}
    static_input = invocation_static_input(raw_input)
    user_prompt = raw_input.get("user_prompt") or raw_input.get("prompt")
    topic = raw_input.get("topic")
    if not user_prompt and isinstance(topic, str):
        user_prompt = topic

    metadata = safe_metadata(node.get("metadata"))
    metadata.update(
        {
            "label": str(node.get("label") or node_id),
            "ui_label": ui_label_for_node(node, node_id),
            "workbench_kind": str(node.get("kind") or ""),
        }
    )
    canonical: dict[str, Any] = {
        "id": node_id,
        "callable_ref": callable_ref,
        "ports": ports_from_legacy_fields(node),
        "overrides": {"static_input": static_input},
        "prompt_policy": {"user_prompt": user_prompt} if isinstance(user_prompt, str) else {},
        "input_bindings": input_bindings_from_mapping(node),
        "metadata": metadata,
    }
    for key in (
        "output_bindings",
        "workflow_call_input_bindings",
        "workflow_call_output_bindings",
        "environment_policy",
        "invocation_policy",
        "runtime_policy",
        "artifact_contract",
        "control",
    ):
        if key in node:
            canonical[key] = node[key]
    output_schema = node.get("output_schema") or node.get("outputSchema")
    if isinstance(output_schema, dict):
        canonical["output_schema"] = normalize_output_schema_for_structured_output(output_schema)
    if callable_ref["kind"] == "workflow_function" and not canonical.get(
        "workflow_call_output_bindings"
    ):
        canonical["workflow_call_output_bindings"] = [
            {
                "workflow_output": "main",
                "parent_port": "main",
                "materialization": "copy",
                "required": False,
            }
        ]
    return prune_none(canonical)


def invocation_static_input(input_value: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in input_value.items()
        if key not in {"user_prompt", "prompt", "topic"}
    }


def ui_label_for_node(node: dict[str, Any], fallback: str) -> str:
    metadata = node.get("metadata") if isinstance(node.get("metadata"), dict) else {}
    value = metadata.get("ui_label") or node.get("invocationLabel") or node.get("label")
    return str(value or fallback)


def normalize_callable_ref(
    node: dict[str, Any],
    *,
    source_path: Path | None,
) -> dict[str, str]:
    raw = node.get("callable_ref")
    if isinstance(raw, dict):
        kind = str(raw.get("kind") or "")
        ref_id = str(raw.get("id") or "")
        version = raw.get("version")
    else:
        kind = ""
        ref_id = ""
        version = None
    node_kind = str(node.get("kind") or node.get("sourceKind") or "")
    if kind not in {"agent_class", "tool_class", "workflow_function"}:
        if node_kind in {"tool", "tool_class"}:
            kind = "tool_class"
        elif node_kind in {"workflow", "workflow_function"}:
            kind = "workflow_function"
        else:
            kind = "agent_class"
    if not ref_id:
        ref_id = str(
            node.get("workflow_ref") or node.get("callableId") or node.get("callable_id") or ""
        )
    if kind == "workflow_function":
        ref_id = workflow_function_ref(ref_id, source_path=source_path)
    if not ref_id:
        node_id = node.get("id") or "<unknown>"
        raise AccError(f"Workbench node {node_id} callable_ref.id is required")
    payload = {"kind": kind, "id": ref_id}
    if isinstance(version, str) and version:
        payload["version"] = version
    return payload


def workflow_function_ref(ref_id: str, *, source_path: Path | None) -> str:
    _ = source_path
    if not ref_id:
        return ref_id
    path = Path(ref_id)
    if is_clean_workflow_path(path):
        if path.is_absolute():
            return str(path.resolve())
        return ref_id.replace("\\", "/")
    return ref_id


def ports_from_legacy_fields(node: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        "inputs": ports_from_value(node.get("input_ports"), "input"),
        "outputs": ports_from_value(node.get("output_ports"), "output"),
    }


def ports_from_value(value: Any, direction: str) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        return {"main": {"type": "artifact", "required": False}}
    ports: dict[str, dict[str, Any]] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        port_id = str(item.get("id") or "main")
        ports[port_id] = {
            "type": "artifact",
            "required": bool(item.get("required", False)),
            "cardinality": str(item.get("cardinality") or "one"),
        }
    return ports or {"main": {"type": "artifact", "required": False}}


def input_bindings_from_mapping(node: dict[str, Any]) -> list[dict[str, Any]]:
    mapping = node.get("input_mapping")
    if not isinstance(mapping, dict):
        return []
    bindings: list[dict[str, Any]] = []
    for target_port, raw_source in mapping.items():
        if not isinstance(target_port, str):
            continue
        if isinstance(raw_source, dict):
            source_node = raw_source.get("node")
            source_port = raw_source.get("port") or raw_source.get("output") or "main"
            if isinstance(source_node, str):
                bindings.append(
                    {
                        "source": {"node": source_node, "port": str(source_port)},
                        "target_port": target_port,
                        "materialization": "copy",
                    }
                )
    return bindings


def normalize_control_edge(edge: dict[str, Any]) -> dict[str, Any]:
    source = edge.get("from") or edge.get("source")
    target = edge.get("to") or edge.get("target")
    payload = {"from": source, "to": target}
    if isinstance(edge.get("condition"), str):
        payload["condition"] = edge["condition"]
    payload["context"] = "none"
    return payload


def normalize_data_edge(edge: dict[str, Any]) -> dict[str, Any]:
    source = edge.get("source") or edge.get("from")
    target = edge.get("target") or edge.get("to")
    materialization = str(edge.get("materialization") or "copy")
    if materialization not in {"copy", "reference"}:
        materialization = "copy"
    return {"source": source, "target": target, "materialization": materialization}


def copy_optional_ports(source: dict[str, Any], target: dict[str, Any], key: str) -> None:
    value = source.get(key)
    if isinstance(value, list):
        target[key] = {
            str(item.get("id") or "main"): {
                "type": "artifact",
                "required": bool(item.get("required", False)),
                "cardinality": str(item.get("cardinality") or "one"),
            }
            for item in value
            if isinstance(item, dict)
        }
    elif isinstance(value, dict):
        target[key] = value


def safe_metadata(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    blocked = {"workflow_ref", "input_mapping", "run_id", "run_dir", "workspace_root"}
    return {str(key): item for key, item in value.items() if str(key) not in blocked}


def safe_position(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    x = value.get("x")
    y = value.get("y")
    if isinstance(x, (int, float)) and isinstance(y, (int, float)):
        return {"x": float(x), "y": float(y)}
    return None


def prune_none(value: dict[str, Any]) -> dict[str, Any]:
    keep_empty_lists = {
        "nodes",
        "control_edges",
        "data_edges",
        "workflow_input_bindings",
        "workflow_output_bindings",
    }
    return {
        key: item
        for key, item in value.items()
        if item is not None and item != {} and (item != [] or key in keep_empty_lists)
    }
