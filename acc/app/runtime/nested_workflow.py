"""Nested workflow execution: resolve child workflow path, run, and map outputs.

Extracted from the God Module core_v2_runtime.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.app.runtime.context import ExecutionContext
from acc.app.runtime.executor import resolve_node_workflow_binding
from acc.app.workflow_refs import WorkflowCatalog
from acc.callable_registry import CallableRegistry
from acc.models import (
    AccError,
    NodeInvocationSpec,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)


async def execute_workflow_function_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    scope: ScopeFrame,
    session: SessionInstance,
    callable_registry: CallableRegistry | None,
    execution_context: ExecutionContext | None = None,
) -> dict[str, Any]:
    # Lazy import to avoid circular dependency
    from acc.app.runtime.orchestrator import run_core_v2_workflow_path

    child_path = resolve_workflow_function_path(
        template,
        node.callable_ref.id,
        execution_context=execution_context,
    )
    child_run_dir = node_dir / "nested_workflow"
    child_input_payload = resolve_workflow_call_input_payload(node, payload)
    bound_workspace, bound_binding_path = resolve_node_workflow_binding(
        node,
        callable_registry=callable_registry,
        execution_context=execution_context,
    )
    child_workspace: Path | None
    child_binding_path: Path | None
    child_ephemeral: bool
    if node.environment_policy == "inherit_parent":
        child_workspace = bound_workspace or scope.workspace_root
        child_binding_path = bound_binding_path or scope.binding_path
        child_ephemeral = False if bound_workspace is not None else scope.ephemeral
    elif node.environment_policy == "new_ephemeral":
        child_workspace = None
        child_binding_path = None
        child_ephemeral = True
    elif node.environment_policy == "forbidden":
        raise AccError(f"Nested workflow execution is forbidden for node {node.id}")
    elif node.environment_policy == "binding_required":
        if bound_workspace is None or bound_binding_path is None:
            raise AccError(
                "Nested workflow binding_required is not satisfied for node "
                f"{node.id}; configure an explicit child binding before running."
            )
        child_workspace = bound_workspace
        child_binding_path = bound_binding_path
        child_ephemeral = False
    else:
        raise AccError(
            f"Unsupported environment_policy for nested workflow node {node.id}: "
            f"{node.environment_policy}"
        )
    child_context = (
        execution_context.with_run_dir(child_run_dir) if execution_context is not None else None
    )
    child_record = await run_core_v2_workflow_path(
        child_path,
        child_run_dir,
        input_payload=child_input_payload,
        callable_registry=callable_registry,
        workspace=child_workspace,
        binding_path=child_binding_path,
        ephemeral=child_ephemeral,
        parent_invocation_id=session.invocation_id,
        parent_scope_frame_id=scope.frame_id,
        call_depth=scope.call_depth + 1,
        execution_context=child_context,
    )
    if child_record.status != "success":
        raise AccError(
            f"Nested workflow {child_record.workflow_function_id} failed for node {node.id}"
        )
    workflow_outputs = read_child_workflow_outputs(child_run_dir)
    mapped_outputs = apply_workflow_call_output_bindings(node, workflow_outputs)
    return {
        "status": "success",
        "summary": f"Nested workflow {child_record.workflow_function_id} success",
        "child_workflow_id": child_record.workflow_function_id,
        "child_workflow_run_dir": str(child_run_dir.resolve()),
        "workflow_outputs": workflow_outputs,
        **mapped_outputs,
    }


def resolve_workflow_call_input_payload(
    node: NodeInvocationSpec,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not node.workflow_call_input_bindings:
        return payload
    child_input: dict[str, Any] = {}
    for binding in node.workflow_call_input_bindings:
        if binding.static_value is not None:
            child_input[binding.workflow_input] = binding.static_value
            continue
        if binding.source is None:
            if binding.required:
                raise AccError(
                    f"Workflow call input {binding.workflow_input!r} on node {node.id} "
                    "requires a source or static_value"
                )
            continue
        if binding.source.port not in payload:
            if binding.required:
                raise AccError(
                    f"Missing workflow call input source {binding.source.node}."
                    f"{binding.source.port} for {node.id}.{binding.workflow_input}"
                )
            continue
        child_input[binding.workflow_input] = payload[binding.source.port]
    return child_input


def apply_workflow_call_output_bindings(
    node: NodeInvocationSpec,
    workflow_outputs: dict[str, Any],
) -> dict[str, Any]:
    if not node.workflow_call_output_bindings:
        return dict(workflow_outputs)
    mapped: dict[str, Any] = {}
    for binding in node.workflow_call_output_bindings:
        if binding.workflow_output not in workflow_outputs:
            if binding.required:
                raise AccError(
                    f"Missing workflow call output {binding.workflow_output!r} "
                    f"for node {node.id}.{binding.parent_port}"
                )
            continue
        mapped[binding.parent_port] = workflow_outputs[binding.workflow_output]
    return mapped


def resolve_workflow_function_path(
    template: WorkflowFunctionTemplate,
    ref_id: str,
    *,
    execution_context: ExecutionContext | None = None,
) -> Path:
    template_source_path = template.source_path
    base_dir = template_source_path.parent if template_source_path is not None else Path.cwd()
    project_root = (
        execution_context.project.project_root
        if execution_context is not None
        else infer_project_root(base_dir)
    )
    workflows_dir = project_root / "workflows"
    overlay_payloads = load_runtime_overlay_payloads(base_dir)
    catalog = WorkflowCatalog(
        project_root=project_root,
        workflows_dir=workflows_dir,
        overlay_payloads=overlay_payloads,
    )
    try:
        return catalog.resolve(
            ref_id,
            template_source_path=template_source_path,
            mode="runtime",
        ).resolved_path
    except AccError as exc:
        candidates = workflow_resolution_candidates(base_dir, workflows_dir, ref_id)
        raise AccError(
            "Nested workflow not found: "
            f"node_ref={ref_id!r}; template_source_path={template_source_path}; "
            f"resolution_candidates={candidates}; "
            f"detail={exc}"
        ) from exc


def infer_project_root(base_dir: Path) -> Path:
    current = base_dir.resolve()
    for candidate in (current, *current.parents):
        if (candidate / "workflows").exists() or (candidate / "pyproject.toml").exists():
            return candidate
    return Path.cwd().resolve()


def load_runtime_overlay_payloads(base_dir: Path) -> dict[Path, dict[str, Any]]:
    payloads: dict[Path, dict[str, Any]] = {}
    if not base_dir.exists():
        return payloads
    for path in sorted(base_dir.glob("*.accflow.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            payloads[path.resolve()] = payload
    return payloads


def workflow_resolution_candidates(base_dir: Path, workflows_dir: Path, ref_id: str) -> list[str]:
    path = Path(ref_id)
    candidates = [path] if path.is_absolute() else [base_dir / path, workflows_dir / path.name]
    return [str(candidate.resolve()) for candidate in candidates]


def read_child_workflow_outputs(child_run_dir: Path) -> dict[str, Any]:
    outputs: dict[str, Any] = {}
    outputs_dir = child_run_dir / "workflow_outputs"
    if not outputs_dir.exists():
        return outputs
    for output_path in sorted(outputs_dir.glob("*/output.json")):
        outputs[output_path.parent.name] = json.loads(output_path.read_text(encoding="utf-8"))
    return outputs
