from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from acc.registry import CapsuleRegistry
from acc.run_index import write_json
from acc.workflow_graph import (
    load_workflow_graph,
    normalize_workflow_graph,
    topological_order,
    validate_graph_semantics,
)


def export_conductor_yaml(
    graph_path: Path,
    out_path: Path,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    graph = normalize_workflow_graph(load_workflow_graph(graph_path))
    validate_graph_semantics(graph, registry or CapsuleRegistry())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    export_root = out_path.parent
    input_dir = export_root / "generated_inputs"
    input_dir.mkdir(parents=True, exist_ok=True)

    steps = []
    for node_id in topological_order(graph):
        node = next(item for item in graph["nodes"] if item["id"] == node_id)
        generated_input_path = input_dir / f"{node_id}.input.json"
        write_json(generated_input_path, node.get("input", {}))
        node_run_dir = f"runs/conductor/{graph['id']}/{node_id}"
        steps.append(
            {
                "id": node_id,
                "type": "script",
                "capsule_id": node["capsule_id"],
                "command": (
                    f"uv run acc run {node['capsule_id']} "
                    f"--input {generated_input_path.as_posix()} "
                    f"--run-dir {node_run_dir} "
                    "--emit-conductor-json"
                ),
                "depends_on": [
                    edge["from"] for edge in graph["control_edges"] if edge["to"] == node_id
                ],
            }
        )

    payload = {
        "name": graph["id"],
        "version": graph.get("version"),
        "description": graph.get("description", ""),
        "metadata": {
            "source": "acc",
            "source_graph": str(graph_path),
            "failure_mode": graph["policy"].get("failure_mode"),
            "notes": "ACC WorkflowGraph is the source of truth; this YAML is export-only.",
        },
        "steps": steps,
        "control_edges": graph["control_edges"],
        "data_edges": graph["data_edges"],
        "warnings": conductor_export_warnings(graph),
    }
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    return {
        "status": "success",
        "workflow_id": graph["id"],
        "out": str(out_path.resolve()),
        "step_count": len(steps),
        "warnings": payload["warnings"],
    }


def conductor_export_warnings(graph: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if graph.get("data_edges"):
        warnings.append(
            "Data edge input materialization is represented as metadata; ACC remains the "
            "authoring/runtime source for exact materialization."
        )
    if graph["policy"].get("failure_mode") not in {"fail_fast", None}:
        warnings.append(
            f"Failure mode {graph['policy'].get('failure_mode')} may require Conductor-side "
            "policy configuration."
        )
    return warnings
