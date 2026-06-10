"""Workflow-level I/O: write outputs, run summaries, and result store values.

Extracted from the God Module core_v2_runtime.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.models import (
    AccError,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.run_index import NodeRunSummary, RunSummary, rebuild_run_index
from acc.app.runtime.executor import put_result_store_value
from acc.store import write_json


def write_workflow_outputs(
    template: WorkflowFunctionTemplate,
    run_id: str,
    run_dir: Path,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
) -> None:
    grouped: dict[str, list[tuple[str, Any]]] = {}
    for binding in template.workflow_output_bindings:
        key = (binding.source.node, binding.source.port)
        if key not in outputs:
            if binding.required:
                raise AccError(
                    f"Missing workflow output source {binding.source.node}.{binding.source.port}"
                )
            continue
        grouped.setdefault(binding.target_port, []).append((binding.source.node, outputs[key]))

    for target_port, values in grouped.items():
        if len(values) == 1:
            value: Any = values[0][1]
        else:
            value = {source_node: output_value for source_node, output_value in values}
        output_dir = run_dir / "workflow_outputs" / target_port
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "output.json", value)
        put_result_store_value(
            result_store,
            run_id,
            "__workflow_outputs",
            target_port,
            value,
        )


def write_core_v2_run_summary(
    run_dir: Path,
    template: WorkflowFunctionTemplate,
    run_id: str,
    status: str,
    *,
    started_at: str | None = None,
    ended_at: str | None = None,
) -> None:
    nodes = [
        node_summary_from_session_manifest(run_dir, node_id)
        for node_id in sorted(template.node_invocations)
        if (run_dir / "nodes" / node_id / "session_instance_manifest.json").exists()
    ]
    failed_nodes = [node.node_id for node in nodes if node.status != "success"]
    summary = RunSummary(
        run_id=run_id,
        workflow_id=template.id,
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        run_dir=str(run_dir.resolve()),
        node_count=len(nodes),
        failed_nodes=failed_nodes,
        output_path=str((run_dir / "workflow_outputs").resolve())
        if (run_dir / "workflow_outputs").exists()
        else None,
        artifact_dir=str((run_dir / "artifacts").resolve())
        if (run_dir / "artifacts").exists()
        else None,
        nodes=nodes,
    )
    write_json(run_dir / "run_summary.json", summary.model_dump())
    if run_dir.parent.name == "runs":
        write_json(run_dir.parent / "index.json", rebuild_run_index(run_dir.parent).model_dump())


def node_summary_from_session_manifest(run_dir: Path, node_id: str) -> NodeRunSummary:
    node_dir = run_dir / "nodes" / node_id
    manifest = json.loads((node_dir / "session_instance_manifest.json").read_text(encoding="utf-8"))
    status = str(manifest.get("status") or "unknown")
    error = manifest.get("error")
    return NodeRunSummary(
        node_id=node_id,
        callable_id=str((manifest.get("callable_ref") or {}).get("id") or "unknown"),
        session_id=manifest.get("session_id"),
        status=status,
        summary=str(error or ""),
        run_dir=str(run_dir.resolve()),
        input_path=str((node_dir / "agent_payload.json").resolve())
        if (node_dir / "agent_payload.json").exists()
        else None,
        prompt_path=str((node_dir / "resolved_prompt.md").resolve())
        if (node_dir / "resolved_prompt.md").exists()
        else None,
        output_path=str((node_dir / "output.json").resolve())
        if (node_dir / "output.json").exists()
        else None,
        artifact_dir=str((node_dir / "artifacts").resolve())
        if (node_dir / "artifacts").exists()
        else None,
        event_log=str((node_dir / "events.jsonl").resolve())
        if (node_dir / "events.jsonl").exists()
        else None,
        stdout_log=str((node_dir / "stdout.log").resolve())
        if (node_dir / "stdout.log").exists()
        else None,
        stderr_log=str((node_dir / "stderr.log").resolve())
        if (node_dir / "stderr.log").exists()
        else None,
    )
