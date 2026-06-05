from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from acc.app.callable_refs import discover_known_callable_refs, expand_workflow_ids_for_template
from acc.app.core_v2_loader import (
    load_workflow_function_template,
    reject_legacy_graph_path,
)
from acc.app.inspect import workflow_inspect_payload
from acc.app.workflow_refs import WorkflowCatalog
from acc.callable_registry import CallableRegistry
from acc.domain import CORE_V2_SCHEMA_VERSION, AccError, WorkflowFunctionTemplate
from acc.engine.workflow_validation import (
    build_workflow_dry_run_report,
    validate_callable_workflow_function_report,
)
from acc.runtime.policy import (
    external_agent_execution_enabled as external_agent_execution_enabled,
)
from acc.runtime.policy import use_submit_validate as use_submit_validate
from acc.runtime.policy import use_supervisor as use_supervisor
from acc.session import utc_now_iso
from acc.store import is_clean_workflow_path, load_json, write_json


def load_cli_input(input_path: Path | None, input_json: str | None) -> dict[str, Any]:
    if input_path is not None and input_json is not None:
        raise AccError("Provide either --input or --input-json, not both")
    if input_json is not None:
        payload = json_loads_object(input_json)
    elif input_path is not None:
        payload = load_json(input_path)
        if not isinstance(payload, dict):
            raise AccError(f"Input JSON must be an object: {input_path}")
    else:
        payload = {}
    return payload


def json_loads_object(value: str) -> dict[str, Any]:
    payload = json.loads(value)
    if not isinstance(payload, dict):
        raise AccError("--input-json must be a JSON object")
    return payload


def resolve_callable_registry(
    *,
    callable_registry: CallableRegistry | None = None,
    registry: Any | None = None,
) -> CallableRegistry:
    if callable_registry is not None:
        return callable_registry
    _ = registry
    return CallableRegistry.from_project_root(Path.cwd())


class WorkflowAppService:
    def __init__(
        self,
        registry: Any | None = None,
        callable_registry: CallableRegistry | None = None,
        project_root: Path | None = None,
    ) -> None:
        if callable_registry is None and project_root is not None:
            callable_registry = CallableRegistry.from_project_root(project_root)
        self.callable_registry = resolve_callable_registry(
            callable_registry=callable_registry,
            registry=registry,
        )
        self.registry = None

    def validate(
        self,
        workflow_path: Path,
        *,
        dry_run: bool = False,
        workflows_dir: Path | None = None,
        workflow_catalog: WorkflowCatalog | None = None,
    ) -> dict[str, Any]:
        if not is_clean_workflow_path(workflow_path):
            reject_legacy_graph_path(workflow_path)
        return validate_clean_workflow_file(
            workflow_path,
            callable_registry=self.callable_registry,
            dry_run=dry_run,
            workflows_dir=workflows_dir,
            workflow_catalog=workflow_catalog,
        )

    async def run(
        self,
        workflow_path: Path,
        run_dir: Path,
        *,
        workspace: Path | None = None,
        binding_path: Path | None = None,
        input_payload: dict[str, Any] | None = None,
        inherited_workspace: Path | None = None,
        inherited_ephemeral: bool = False,
        parent_invocation_id: str | None = None,
        parent_scope_frame_id: str | None = None,
        call_depth: int = 0,
        node_executor: Any | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        _ = (
            binding_path,
            inherited_workspace,
            inherited_ephemeral,
            parent_invocation_id,
            parent_scope_frame_id,
            call_depth,
            node_executor,
        )
        if not is_clean_workflow_path(workflow_path):
            reject_legacy_graph_path(workflow_path)
        return await run_clean_workflow_template(
            workflow_path,
            run_dir,
            workspace=workspace,
            callable_registry=self.callable_registry,
            input_payload=input_payload,
            should_cancel=should_cancel,
        )

    def run_sync(
        self,
        workflow_path: Path,
        run_dir: Path,
        *,
        workspace: Path | None = None,
        binding_path: Path | None = None,
        input_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return asyncio.run(
            self.run(
                workflow_path,
                run_dir,
                workspace=workspace,
                binding_path=binding_path,
                input_payload=input_payload,
            )
        )

    def inspect(self, run_dir: Path) -> dict[str, Any]:
        return workflow_inspect_payload(run_dir)

    def events(self, run_dir: Path) -> dict[str, Any]:
        return workflow_events_payload(run_dir)


def load_clean_workflow_template(path: Path) -> WorkflowFunctionTemplate:
    return load_workflow_function_template(path)


def validate_clean_workflow_file(
    path: Path,
    *,
    registry: Any | None = None,
    callable_registry: CallableRegistry | None = None,
    dry_run: bool = False,
    workflows_dir: Path | None = None,
    workflow_catalog: WorkflowCatalog | None = None,
) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"WorkflowFunctionTemplate must be a JSON object: {path}")
    if payload.get("schema_version") != CORE_V2_SCHEMA_VERSION:
        raise AccError(
            "Only canonical Core v2 .accflow.json workflows are runnable. "
            "Migrate legacy workflows with `acc workflow import-graph <path.graph"
            + ".json>` "
            "or rewrite the template with schema_version `acc.core.v2`."
        )
    function_template = load_workflow_function_template(path)
    resolved_callable_registry = resolve_callable_registry(
        callable_registry=callable_registry,
        registry=registry,
    )
    known_refs, known_workflow_ids = discover_known_callable_refs(
        resolved_callable_registry,
        workflows_dir=workflows_dir or path.parent,
    )
    if workflow_catalog is not None:
        known_refs.update(workflow_catalog.known_callable_refs())
        known_workflow_ids.update(workflow_catalog.known_workflow_ids())
    expanded_workflow_ids = expand_workflow_ids_for_template(
        function_template,
        base_dir=path.parent,
        known_workflow_ids=known_workflow_ids,
    )
    if dry_run:
        return build_workflow_dry_run_report(
            function_template,
            known_callable_refs=known_refs,
            known_workflow_ids=expanded_workflow_ids,
        )
    return validate_callable_workflow_function_report(
        function_template,
        known_callable_refs=known_refs,
        known_workflow_ids=expanded_workflow_ids,
    )


def validate_clean_workflow_file_strict(
    path: Path,
    *,
    registry: Any | None = None,
    callable_registry: CallableRegistry | None = None,
    workflows_dir: Path | None = None,
    workflow_catalog: WorkflowCatalog | None = None,
) -> dict[str, Any]:
    report = validate_clean_workflow_file(
        path,
        registry=registry,
        callable_registry=callable_registry,
        workflows_dir=workflows_dir,
        workflow_catalog=workflow_catalog,
    )
    if report.get("status") != "valid":
        errors = report.get("errors") or []
        message = (
            errors[0].get("message", "Workflow validation failed")
            if errors
            else "Workflow validation failed"
        )
        raise AccError(message)
    return report


def create_clean_environment_binding(
    workflow_path: Path,
    workspace: Path,
    out: Path,
) -> dict[str, Any]:
    template = load_workflow_function_template(workflow_path)
    workspace_root = workspace.expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace}")
    project_root = Path.cwd().resolve()
    payload: dict[str, Any] = {
        "workflow_id": template.id,
        "binding_name": out.stem,
        "workspace_root": str(workspace_root),
        "behavior_policy": {"mode": "workspace_native"},
        "created_at": utc_now_iso(),
        "warnings": [],
    }
    if workspace_root == project_root:
        payload["warnings"].append(
            "workspace_root is the ACC project root; this is explicit stateful binding only"
        )
    write_json(out, payload)
    return {**payload, "binding_path": str(out.resolve())}


async def run_clean_workflow_template(
    workflow_path: Path,
    run_dir: Path,
    *,
    registry: Any | None = None,
    callable_registry: CallableRegistry | None = None,
    workspace: Path | None = None,
    binding_path: Path | None = None,
    input_payload: dict[str, Any] | None = None,
    inherited_workspace: Path | None = None,
    inherited_ephemeral: bool = False,
    parent_invocation_id: str | None = None,
    parent_scope_frame_id: str | None = None,
    call_depth: int = 0,
    node_executor: Any | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    _ = (
        binding_path,
        inherited_workspace,
        inherited_ephemeral,
        parent_invocation_id,
        parent_scope_frame_id,
        call_depth,
        node_executor,
    )
    from acc.app.core_v2_runtime import run_core_v2_workflow_path

    record = await run_core_v2_workflow_path(
        workflow_path,
        run_dir,
        input_payload=input_payload,
        workspace=workspace,
        should_cancel=should_cancel,
        callable_registry=resolve_callable_registry(
            callable_registry=callable_registry,
            registry=registry,
        ),
    )
    return {
        "status": record.status,
        "workflow_id": record.workflow_function_id,
        "run_id": record.run_id,
        "run_dir": str(run_dir.resolve()),
        "event_log": str(record.event_log_path.resolve()),
        "result_store_root": str(record.result_store_root.resolve()),
    }


def run_clean_workflow_template_sync(
    workflow_path: Path,
    run_dir: Path,
    *,
    registry: Any | None = None,
    callable_registry: CallableRegistry | None = None,
    input_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return asyncio.run(
        run_clean_workflow_template(
            workflow_path,
            run_dir,
            registry=registry,
            callable_registry=callable_registry,
            input_payload=input_payload,
        )
    )


def workflow_events_payload(run_dir: Path) -> dict[str, Any]:
    event_log_path = run_dir / "events.jsonl"
    if not event_log_path.exists():
        historical_event_log = run_dir / "workflow_events.jsonl"
        if historical_event_log.exists():
            event_log_path = historical_event_log
    events = []
    if event_log_path.exists():
        for line in event_log_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(json.loads(line))
    return {
        "run_dir": str(run_dir.resolve()),
        "event_log": str(event_log_path.resolve()),
        "events": events,
    }
