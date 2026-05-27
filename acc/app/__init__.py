from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError

from acc.domain import AccError, EnvironmentFrame, NodeSpec, PermissionProfile, WorkflowTemplate
from acc.engine import (
    parse_clean_workflow_template,
    topological_levels,
    validate_clean_workflow_template,
    workflow_status_after_node_failure,
)
from acc.legacy_graph_importer import load_legacy_graph_template
from acc.registry import CapsuleRegistry
from acc.run_index import NodeRunSummary, RunSummary, update_project_run_index
from acc.runtime import NodeExecutor, execute_clean_node, execute_clean_node_with_policy
from acc.session import utc_now_iso
from acc.store import (
    FileSystemWorkflowStore,
    is_clean_workflow_path,
    load_clean_environment_binding,
    load_json,
    write_json,
)


class CapsuleAppService:
    def __init__(self, registry: CapsuleRegistry | None = None) -> None:
        self.registry = registry or CapsuleRegistry()

    async def run_capsule(
        self,
        capsule_id: str,
        input_payload: dict[str, Any],
        run_dir: Path,
    ) -> dict[str, Any]:
        from acc.runner import CapsuleRunner

        return await CapsuleRunner(registry=self.registry).run(capsule_id, input_payload, run_dir)

    def run_capsule_sync(
        self,
        capsule_id: str,
        input_payload: dict[str, Any],
        run_dir: Path,
    ) -> dict[str, Any]:
        return asyncio.run(self.run_capsule(capsule_id, input_payload, run_dir))

    async def run_batch(
        self,
        spec: Path,
        run_dir: Path,
        max_concurrency: int,
    ) -> dict[str, Any]:
        from acc.batch import run_batch
        from acc.runner import CapsuleRunner

        return await run_batch(
            spec,
            run_dir,
            max_concurrency,
            runner=CapsuleRunner(registry=self.registry),
        )

    def run_batch_sync(self, spec: Path, run_dir: Path, max_concurrency: int) -> dict[str, Any]:
        return asyncio.run(self.run_batch(spec, run_dir, max_concurrency))


def load_capsule_input(input_path: Path | None, input_json: str | None) -> dict[str, Any]:
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


class WorkflowAppService:
    def __init__(self, registry: CapsuleRegistry | None = None) -> None:
        self.registry = registry or CapsuleRegistry()

    def validate(self, workflow_path: Path) -> dict[str, Any]:
        if is_clean_workflow_path(workflow_path):
            return validate_clean_workflow_file(workflow_path)
        template, raw_graph = load_legacy_graph_template(workflow_path)
        validate_legacy_capsule_references(template, self.registry)
        template = hydrate_legacy_capsule_permissions(template, self.registry)
        validate_clean_workflow_template(
            template,
            hermetic=not external_agent_execution_enabled(),
        )
        levels = topological_levels(template)
        return {
            "status": "valid",
            "workflow_id": template.id,
            "version": template.version,
            "node_count": len(template.nodes),
            "control_edge_count": len(template.control_edges),
            "data_edge_count": len(template.data_edges),
            "topological_levels": levels,
            "policy": template.policies,
            "format": "legacy_graph",
            "canonical_format": "accflow",
            "legacy_compatibility": True,
            "legacy_node_count": len(raw_graph.get("nodes", [])),
        }

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
        node_executor: NodeExecutor | None = None,
    ) -> dict[str, Any]:
        if is_clean_workflow_path(workflow_path):
            return await run_clean_workflow_template(
                workflow_path,
                run_dir,
                workspace=workspace,
                binding_path=binding_path,
                input_payload=input_payload,
                inherited_workspace=inherited_workspace,
                inherited_ephemeral=inherited_ephemeral,
                node_executor=node_executor,
            )
        return await run_legacy_graph_template(
            workflow_path,
            run_dir,
            registry=self.registry,
            workspace=workspace,
            binding_path=binding_path,
            input_payload=input_payload,
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


def load_clean_workflow_template(path: Path) -> WorkflowTemplate:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"WorkflowTemplate must be a JSON object: {path}")
    template = parse_clean_workflow_template(payload, source_path=path)
    validate_clean_workflow_template(
        template,
        raw_payload=payload,
        hermetic=not external_agent_execution_enabled(),
    )
    return template


def validate_clean_workflow_file(path: Path) -> dict[str, Any]:
    template = load_clean_workflow_template(path)
    levels = topological_levels(template)
    return {
        "status": "valid",
        "workflow_id": template.id,
        "version": template.version,
        "node_count": len(template.nodes),
        "control_edge_count": len(template.control_edges),
        "data_edge_count": len(template.data_edges),
        "topological_levels": levels,
        "policy": template.policies,
        "format": "accflow",
    }


def create_clean_environment_binding(
    workflow_path: Path,
    workspace: Path,
    out: Path,
) -> dict[str, Any]:
    template = load_clean_workflow_template(workflow_path)
    workspace_root = workspace.expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace}")
    project_root = Path.cwd().resolve()
    payload = {
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
    workspace: Path | None = None,
    binding_path: Path | None = None,
    input_payload: dict[str, Any] | None = None,
    inherited_workspace: Path | None = None,
    inherited_ephemeral: bool = False,
    node_executor: NodeExecutor | None = None,
) -> dict[str, Any]:
    template = load_clean_workflow_template(workflow_path)
    binding = load_clean_environment_binding(binding_path) if binding_path is not None else None
    if binding is not None and binding.workflow_id != template.id:
        raise AccError(
            f"Binding workflow_id {binding.workflow_id!r} does not match {template.id!r}"
        )
    store = FileSystemWorkflowStore(
        template=template,
        workflow_path=workflow_path,
        run_dir=run_dir,
        workspace=workspace,
        binding=binding,
        inherited_workspace=inherited_workspace,
        inherited_ephemeral=inherited_ephemeral,
    )
    return await run_workflow_template_instance(
        template,
        workflow_path,
        store,
        workflow_input=dict(
            input_payload or template.metadata.get("legacy_workflow_input", {}) or {}
        ),
        node_executor=node_executor,
    )


async def run_legacy_graph_template(
    workflow_path: Path,
    run_dir: Path,
    *,
    registry: CapsuleRegistry | None = None,
    workspace: Path | None = None,
    binding_path: Path | None = None,
    input_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    template, raw_graph = load_legacy_graph_template(workflow_path)
    service_registry = registry or CapsuleRegistry()
    validate_legacy_capsule_references(template, service_registry)
    template = hydrate_legacy_capsule_permissions(template, service_registry)
    validate_clean_workflow_template(
        template,
        hermetic=not external_agent_execution_enabled(),
    )
    workspace_for_store = workspace
    if binding_path is not None and workspace_for_store is None:
        from acc.environment import load_workspace_binding

        workspace_for_store = load_workspace_binding(binding_path).workspace_root
    store = FileSystemWorkflowStore(
        template=template,
        workflow_path=workflow_path,
        run_dir=run_dir,
        workspace=workspace_for_store,
    )
    workflow_input = dict(raw_graph.get("input", {}) or {})
    if input_payload is not None:
        workflow_input.update(input_payload)

    async def legacy_executor(
        node: NodeSpec,
        current_workflow_path: Path,
        current_run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> dict[str, Any]:
        return await execute_app_clean_node(
            node,
            current_workflow_path,
            current_run_dir,
            node_dir,
            frame,
            registry=service_registry,
        )

    result = await run_workflow_template_instance(
        template,
        workflow_path,
        store,
        workflow_input=workflow_input,
        legacy_graph=raw_graph,
        legacy_compatibility=True,
        node_executor=legacy_executor,
    )
    result["format"] = "legacy_graph"
    result["canonical_format"] = "accflow"
    result["legacy_compatibility"] = True
    return result


async def run_workflow_template_instance(
    template: WorkflowTemplate,
    workflow_path: Path,
    store: FileSystemWorkflowStore,
    *,
    workflow_input: dict[str, Any],
    legacy_graph: dict[str, Any] | None = None,
    legacy_compatibility: bool = False,
    node_executor: NodeExecutor | None = None,
) -> dict[str, Any]:
    validate_required_workflow_inputs(template, workflow_input)
    store.prepare_run_dir()
    frame = store.create_environment_frame()
    levels = topological_levels(template)
    started_at = utc_now_iso()
    store.write_workflow_event(
        "workflow_started",
        status="running",
        payload={"workflow_id": template.id, "levels": levels},
    )

    source_outboxes: dict[str, dict[str, Path]] = {}
    workflow_input_outboxes = store.write_workflow_input_bundles(workflow_input)
    for port_id in sorted(template.exposed_inputs):
        if port_id not in workflow_input_outboxes and template.exposed_inputs[port_id].required:
            continue
        if port_id not in workflow_input_outboxes:
            store.write_workflow_event(
                "workflow_input_skipped",
                status="skipped",
                payload={"port_id": port_id, "reason": "optional input not provided"},
            )
    node_results: dict[str, dict[str, Any]] = {}
    node_outputs: dict[str, dict[str, Any]] = {}
    materializations: list[dict[str, Any]] = []
    workflow_outputs: dict[str, dict[str, Any]] = {}
    write_locks: dict[str, asyncio.Lock] = {frame.environment_id: asyncio.Lock()}
    max_concurrency = max(1, int(template.policies.get("max_concurrency") or 1))
    failure_mode = str(template.policies.get("failure_mode") or "fail_fast")
    workflow_status = "success"
    errors: list[str] = []

    for level_index, level in enumerate(levels):
        semaphore = asyncio.Semaphore(max_concurrency)
        tasks = [
            run_clean_node(
                template,
                template.nodes[node_id],
                workflow_path,
                store,
                frame,
                level_index,
                source_outboxes,
                workflow_input_outboxes,
                node_outputs,
                workflow_input,
                materializations,
                workflow_outputs,
                semaphore,
                write_locks[frame.environment_id],
                legacy_compatibility=legacy_compatibility,
                node_executor=node_executor,
            )
            for node_id in level
        ]
        level_results = await asyncio.gather(*tasks)
        for result in level_results:
            node_results[result["node_id"]] = result
            if result["status"] == "success":
                output_path = result.get("output_path")
                if output_path:
                    node_outputs[result["node_id"]] = load_json(Path(output_path))
                source_outboxes[result["node_id"]] = {
                    port: Path(path) for port, path in result.get("outboxes", {}).items()
                }
            else:
                workflow_status = workflow_status_after_node_failure(failure_mode)
                errors.append(str(result.get("error") or result.get("summary")))
        if workflow_status != "success" and failure_mode != "continue_on_error":
            break

    ended_at = utc_now_iso()
    payload = {
        "status": workflow_status,
        "workflow_id": template.id,
        "run_id": store.run_dir.name,
        "run_dir": str(store.run_dir),
        "workflow_run_manifest": str((store.run_dir / "workflow_run_manifest.json").resolve()),
        "environment_manifest": str(frame.environment_root / "environment_manifest.json"),
        "event_log": str(store.event_log.resolve()),
        "topological_levels": levels,
        "nodes": list(node_results.values()),
        "materializations": materializations,
        "workflow_outputs": workflow_outputs,
        "errors": errors,
        "started_at": started_at,
        "ended_at": ended_at,
    }
    if legacy_graph is not None:
        payload["policy"] = template.policies
        payload["failure_mode"] = template.policies.get("failure_mode")
        payload["edges"] = legacy_graph.get("edges", legacy_graph.get("control_edges", []))
        payload["control_edges"] = legacy_graph.get("control_edges", [])
        payload["data_edges"] = legacy_graph.get("data_edges", [])
    store.write_workflow_manifests(frame, payload, started_at, ended_at)
    if legacy_graph is not None:
        write_json(store.run_dir / "workflow_graph.json", legacy_graph)
        write_json(store.run_dir / "workflow_run.json", payload)
        write_json(store.run_dir / "workflow_summary.json", payload)
        write_legacy_run_compatibility_files(
            store.run_dir,
            workflow_path,
            template,
            payload,
            started_at,
            ended_at,
        )
    update_project_run_index(store.run_dir)
    store.write_workflow_event(
        "workflow_completed" if workflow_status == "success" else "workflow_failed",
        status=workflow_status,
        payload={"errors": errors},
    )
    return payload


def validate_required_workflow_inputs(
    template: WorkflowTemplate,
    workflow_input: dict[str, Any],
) -> None:
    missing = [
        binding.source_port
        for binding in template.workflow_input_bindings
        if template.exposed_inputs.get(binding.source_port) is not None
        and template.exposed_inputs[binding.source_port].required
        and binding.source_port not in workflow_input
    ]
    if missing:
        raise AccError(f"Missing required workflow input port(s): {', '.join(sorted(missing))}")


def write_legacy_run_compatibility_files(
    run_dir: Path,
    workflow_path: Path,
    template: WorkflowTemplate,
    payload: dict[str, Any],
    started_at: str,
    ended_at: str,
) -> None:
    manifest_path = run_dir / "workflow_run_manifest.json"
    manifest = load_json(manifest_path) if manifest_path.exists() else {}
    if isinstance(manifest, dict):
        manifest.update(
            {
                "graph_path": str(workflow_path),
                "graph_snapshot_path": str((run_dir / "workflow_graph.json").resolve()),
                "summary_path": str((run_dir / "workflow_summary.json").resolve()),
                "node_runs_dir": str((run_dir / "node_runs").resolve()),
            }
        )
        write_json(manifest_path, manifest)
    node_summaries = [
        NodeRunSummary(
            node_id=str(node.get("node_id")),
            capsule_id=legacy_summary_capsule_id(template, node),
            status=str(node.get("status") or "failed"),
            summary=str(node.get("summary") or ""),
            run_dir=str(node.get("run_dir") or ""),
            input_path=node.get("input_path"),
            prompt_path=node.get("prompt_path"),
            output_path=node.get("output_path"),
            artifact_dir=node.get("artifact_dir"),
            event_log=node.get("event_log"),
            stdout_log=node.get("stdout_log"),
            stderr_log=node.get("stderr_log"),
        )
        for node in payload.get("nodes", [])
        if isinstance(node, dict)
    ]
    summary = RunSummary(
        run_id=run_dir.name,
        workflow_id=template.id,
        status=str(payload.get("status") or "failed"),
        started_at=started_at,
        ended_at=ended_at,
        run_dir=str(run_dir.resolve()),
        node_count=len(node_summaries),
        failed_nodes=[
            node.node_id for node in node_summaries if node.status not in {"success"}
        ],
        nodes=node_summaries,
    )
    write_json(run_dir / "run_summary.json", summary.model_dump())


def legacy_summary_capsule_id(template: WorkflowTemplate, node: dict[str, Any]) -> str:
    node_id = str(node.get("node_id"))
    template_node = template.nodes.get(node_id)
    return str(
        node.get("capsule_id")
        or (template_node.raw.get("legacy_capsule_id") if template_node else "")
        or ""
    )


def validate_legacy_capsule_references(
    template: WorkflowTemplate,
    registry: CapsuleRegistry,
) -> None:
    for node in template.nodes.values():
        capsule_id = node.raw.get("legacy_capsule_id")
        if isinstance(capsule_id, str):
            registry.get(capsule_id)


def external_agent_execution_enabled() -> bool:
    return os.getenv("ACC_RUN_EXTERNAL_AGENT_TESTS", "").strip().lower() in {"1", "true", "yes"}


def hydrate_legacy_capsule_permissions(
    template: WorkflowTemplate,
    registry: CapsuleRegistry,
) -> WorkflowTemplate:
    nodes: dict[str, NodeSpec] = {}
    for node_id, node in template.nodes.items():
        capsule_id = node.raw.get("legacy_capsule_id")
        if not isinstance(capsule_id, str):
            nodes[node_id] = node
            continue
        capsule = registry.get(capsule_id)
        permissions = capsule.spec.permissions
        nodes[node_id] = NodeSpec(
            id=node.id,
            kind=node.kind,
            runtime=node.runtime,
            tool=node.tool,
            workflow_ref=node.workflow_ref,
            prompt=node.prompt,
            permission_profile=PermissionProfile(
                workspace_access="writes_workspace"
                if permissions.write_files
                else "read_only",
                network=permissions.network,
                shell=False,
                dangerous=permissions.allow_dangerous,
                env_policy="acc_whitelist",
                allowed_env=(),
                timeout_seconds=permissions.timeout_seconds,
            ),
            input_ports=node.input_ports,
            output_ports=node.output_ports,
            raw=node.raw,
        )
    return WorkflowTemplate(
        id=template.id,
        version=template.version,
        nodes=nodes,
        control_edges=template.control_edges,
        data_edges=template.data_edges,
        exposed_inputs=template.exposed_inputs,
        exposed_outputs=template.exposed_outputs,
        workflow_input_bindings=template.workflow_input_bindings,
        workflow_output_bindings=template.workflow_output_bindings,
        policies=template.policies,
        metadata=template.metadata,
        source_path=template.source_path,
    )


def run_clean_workflow_template_sync(
    workflow_path: Path,
    run_dir: Path,
    *,
    workspace: Path | None = None,
    binding_path: Path | None = None,
    input_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return asyncio.run(
        run_clean_workflow_template(
            workflow_path,
            run_dir,
            workspace=workspace,
            binding_path=binding_path,
            input_payload=input_payload,
        )
    )


async def run_clean_node(
    template: WorkflowTemplate,
    node: NodeSpec,
    workflow_path: Path,
    store: FileSystemWorkflowStore,
    frame: EnvironmentFrame,
    level_index: int,
    source_outboxes: dict[str, dict[str, Path]],
    workflow_input_outboxes: dict[str, Path],
    node_outputs: dict[str, dict[str, Any]],
    workflow_input: dict[str, Any],
    materializations: list[dict[str, Any]],
    workflow_outputs: dict[str, dict[str, Any]],
    semaphore: asyncio.Semaphore,
    write_lock: asyncio.Lock,
    *,
    legacy_compatibility: bool = False,
    node_executor: NodeExecutor | None = None,
) -> dict[str, Any]:
    async with semaphore:
        node_dir = store.create_node_attempt(node.id)
        store.write_workflow_event(
            "node_scheduled",
            node_id=node.id,
            level=level_index,
            status="scheduled",
            payload={"kind": node.kind},
        )
        store.write_node_event(node.id, "node_scheduled", status="scheduled")
        try:
            inbox_records = materialize_clean_inboxes(
                template,
                node,
                store,
                node_dir,
                source_outboxes,
                workflow_input_outboxes,
                materializations,
            )
            if is_legacy_capsule_node(node):
                input_payload = resolve_legacy_node_input(node, workflow_input, node_outputs)
                write_json(node_dir / "input.json", input_payload)
            store.write_workflow_event(
                "inbox_materialized",
                node_id=node.id,
                level=level_index,
                status="inbox_materialized",
                payload={"records": inbox_records},
            )
            store.write_node_event(
                node.id,
                "inbox_materialized",
                status="inbox_materialized",
                payload={"records": inbox_records},
            )
            result, attempts = await execute_clean_node_with_policy(
                node,
                workflow_path,
                store.run_dir,
                node_dir,
                frame,
                write_lock,
                node_executor=node_executor or execute_app_clean_node,
                prepare_attempt=store.cleanup_node_attempt,
            )
            outboxes = store.write_artifact_bundle(node, node_dir, result)
            published_outputs = store.publish_workflow_outputs_for_node(node, outboxes)
            workflow_outputs.update(published_outputs)
            result_payload = {
                "node_id": node.id,
                "capsule_id": str(node.raw.get("legacy_capsule_id") or ""),
                "kind": node.kind,
                "status": "success",
                "summary": result["summary"],
                "attempts": attempts,
                "run_dir": str(node_dir.resolve()),
                "input_path": str((node_dir / "input.json").resolve())
                if (node_dir / "input.json").exists()
                else None,
                "prompt_path": str((node_dir / "resolved_prompt.md").resolve())
                if (node_dir / "resolved_prompt.md").exists()
                else None,
                "output_path": str((node_dir / "output.json").resolve()),
                "artifact_dir": str((node_dir / "artifacts").resolve()),
                "event_log": str((node_dir / "events.jsonl").resolve()),
                "stdout_log": str((node_dir / "stdout.log").resolve())
                if (node_dir / "stdout.log").exists()
                else None,
                "stderr_log": str((node_dir / "stderr.log").resolve())
                if (node_dir / "stderr.log").exists()
                else None,
                "inbox_dir": str((node_dir / "inbox").resolve()),
                "outboxes": {port: str(path.resolve()) for port, path in outboxes.items()},
                "workflow_outputs": published_outputs,
            }
            store.write_node_manifest(node_dir, result_payload)
            store.write_workflow_event(
                "node_completed",
                node_id=node.id,
                level=level_index,
                status="success",
                payload={"outboxes": sorted(outboxes)},
            )
            store.write_node_event(
                node.id,
                "node_completed",
                status="success",
                payload={"attempts": attempts, "outboxes": sorted(outboxes)},
            )
            if legacy_compatibility:
                mirror_legacy_node_run(node_dir, store.run_dir / "node_runs" / node.id)
            return result_payload
        except Exception as exc:  # noqa: BLE001 - keep workflow failure manifest complete.
            result_payload = {
                "node_id": node.id,
                "capsule_id": str(node.raw.get("legacy_capsule_id") or ""),
                "kind": node.kind,
                "status": "failed",
                "summary": f"Node {node.id} failed",
                "run_dir": str(node_dir.resolve()),
                "input_path": str((node_dir / "input.json").resolve())
                if (node_dir / "input.json").exists()
                else None,
                "prompt_path": str((node_dir / "resolved_prompt.md").resolve())
                if (node_dir / "resolved_prompt.md").exists()
                else None,
                "event_log": str((node_dir / "events.jsonl").resolve()),
                "stdout_log": str((node_dir / "stdout.log").resolve())
                if (node_dir / "stdout.log").exists()
                else None,
                "stderr_log": str((node_dir / "stderr.log").resolve())
                if (node_dir / "stderr.log").exists()
                else None,
                "error": str(exc),
            }
            store.write_node_manifest(node_dir, result_payload)
            store.write_workflow_event(
                "node_failed",
                node_id=node.id,
                level=level_index,
                status="failed",
                payload={"error": str(exc)},
            )
            store.write_node_event(
                node.id,
                "node_failed",
                status="failed",
                payload={"error": str(exc)},
            )
            if legacy_compatibility:
                mirror_legacy_node_run(node_dir, store.run_dir / "node_runs" / node.id)
            return result_payload


def materialize_clean_inboxes(
    template: WorkflowTemplate,
    node: NodeSpec,
    store: FileSystemWorkflowStore,
    node_dir: Path,
    source_outboxes: dict[str, dict[str, Path]],
    workflow_input_outboxes: dict[str, Path],
    materializations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
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


async def execute_app_clean_node(
    node: NodeSpec,
    workflow_path: Path,
    run_dir: Path,
    node_dir: Path,
    frame: EnvironmentFrame,
    *,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    if is_legacy_capsule_node(node):
        return await execute_legacy_capsule_node(
            node,
            workflow_path,
            run_dir,
            node_dir,
            frame,
            registry=registry,
        )
    if node.kind != "workflow":
        return await execute_clean_node(node, workflow_path, run_dir, node_dir, frame)
    if node.workflow_ref is None:
        raise AccError(f"Workflow node {node.id} has no workflow_ref")
    child_path = (workflow_path.parent / node.workflow_ref).resolve()
    if not child_path.exists():
        child_path = Path(node.workflow_ref).resolve()
    if not child_path.exists():
        raise AccError(f"Nested workflow not found: {node.workflow_ref}")
    nested_result = await run_clean_workflow_template(
        child_path,
        node_dir / "nested_workflow",
        input_payload={},
        inherited_workspace=frame.workspace_root,
        inherited_ephemeral=frame.ephemeral,
    )
    status = str(nested_result.get("status"))
    output = {
        "status": status,
        "summary": f"Nested workflow {nested_result.get('workflow_id')} {status}",
        "child_workflow_id": nested_result.get("workflow_id"),
        "child_workflow_run_dir": nested_result.get("run_dir"),
        "child_errors": nested_result.get("errors", []),
    }
    write_json(node_dir / "output.json", output)
    if status != "success":
        raise AccError(output["summary"])
    return output


def is_legacy_capsule_node(node: NodeSpec) -> bool:
    return isinstance(node.raw.get("legacy_capsule_id"), str)


async def execute_legacy_capsule_node(
    node: NodeSpec,
    workflow_path: Path,
    run_dir: Path,
    node_dir: Path,
    frame: EnvironmentFrame,
    *,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    from acc.environment import (
        EnvironmentFrame as LegacyEnvironmentFrame,
    )
    from acc.environment import (
        WorkflowExecutionContext,
        node_cwd,
        snapshot_behavior_pack,
    )
    from acc.runner import CapsuleRunner

    input_payload = load_json(node_dir / "input.json") if (node_dir / "input.json").exists() else {}
    if node_dir.exists() and not (node_dir / "session_manifest.json").exists():
        shutil.rmtree(node_dir)
    legacy_frame = LegacyEnvironmentFrame(
        environment_id=frame.environment_id,
        workflow_id=frame.workflow_id,
        state_mode="stateless" if frame.ephemeral else "stateful",
        workspace_root=frame.workspace_root,
        environment_root=frame.environment_root,
        inbox_root=frame.inbox_root,
        outbox_root=frame.outbox_root,
        artifact_root=frame.artifact_root,
        snapshot_root=(frame.environment_root / ".acc" / "snapshots").resolve(),
        binding_path=frame.binding_path,
    )
    raw_node = dict(node.raw)
    cwd = node_cwd(legacy_frame, raw_node)
    behavior_snapshot_dir = legacy_frame.snapshot_root / "behavior_pack" / node.id
    behavior_manifest = snapshot_behavior_pack(
        workflow_path,
        {"id": frame.workflow_id, **dict(node.raw.get("legacy_graph_policy") or {})},
        cwd,
        behavior_snapshot_dir,
    )
    execution_context = WorkflowExecutionContext(
        workflow_run_id=f"workflow_{run_dir.name}",
        environment=legacy_frame,
        node_id=node.id,
        cwd=cwd,
        inbox_dir=frame.inbox_root / node.id,
        outbox_dir=frame.outbox_root / node.id,
        behavior_snapshot_dir=behavior_snapshot_dir,
        extra_env={
            "ACC_ENVIRONMENT_WORKSPACE": str(frame.workspace_root),
            "ACC_BEHAVIOR_PACK_EFFECTIVE": str(Path(behavior_manifest["effective_root"])),
            "ACC_BEHAVIOR_CONFLICTS": str(Path(behavior_manifest["conflict_report"])),
        },
    )
    runner = CapsuleRunner(registry=registry or CapsuleRegistry())
    conductor_output = await runner.run(
        str(node.raw["legacy_capsule_id"]),
        input_payload if isinstance(input_payload, dict) else {},
        node_dir,
        execution_context,
    )
    status = str(conductor_output.get("status") or "failed")
    if status != "success":
        raise AccError(str(conductor_output.get("error") or conductor_output.get("summary")))
    output_path = conductor_output.get("output_path")
    if not output_path:
        raise AccError(f"Legacy capsule node {node.id} did not produce output_path")
    return load_json(Path(output_path))


def resolve_legacy_node_input(
    node: NodeSpec,
    workflow_input: dict[str, Any],
    node_outputs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    context = {
        "workflow": {"input": workflow_input},
        "nodes": {node_id: {"output": output} for node_id, output in node_outputs.items()},
    }
    static_input = dict(node.raw.get("input", {}) or {})
    mapped = render_legacy_value(node.raw.get("input_mapping", {}) or {}, context)
    if not isinstance(mapped, dict):
        raise AccError(f"Node {node.id} input_mapping must render to an object")
    result = {**static_input, **mapped}
    for edge in node.raw.get("legacy_value_edges", []) or []:
        if not isinstance(edge, dict):
            continue
        target = edge.get("to")
        if not isinstance(target, dict) or "input" not in target:
            continue
        result[str(target["input"])] = resolve_legacy_value_edge(edge, context, node_outputs)
    return result


def resolve_legacy_value_edge(
    edge: dict[str, Any],
    context: dict[str, Any],
    node_outputs: dict[str, dict[str, Any]],
) -> Any:
    source = edge.get("from")
    if not isinstance(source, dict):
        raise AccError("Legacy data edge source must be an object")
    source_node = str(source.get("node") or "")
    output = node_outputs.get(source_node)
    if output is None:
        if edge.get("required", True):
            raise AccError(f"Required data edge source {source_node!r} is not available")
        return None
    if "output" in source:
        output_name = str(source["output"])
        if output_name not in output:
            raise AccError(f"Data edge source missing output field {output_name!r}")
        return output[output_name]
    if "path" in source:
        return render_legacy_value(str(source["path"]), context)
    if "artifact" in source:
        return str(source["artifact"])
    raise AccError("Legacy data edge source must reference output, path, or artifact")


def render_legacy_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        environment = Environment(undefined=StrictUndefined, autoescape=False)
        try:
            return environment.from_string(value).render(**context)
        except TemplateError as exc:
            raise AccError(f"Failed to render node input template: {exc}") from exc
    if isinstance(value, list):
        return [render_legacy_value(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render_legacy_value(item, context) for key, item in value.items()}
    return value


def mirror_legacy_node_run(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    if source.exists():
        shutil.copytree(source, target)


def workflow_events_payload(run_dir: Path) -> dict[str, Any]:
    event_log_path = run_dir / "workflow_events.jsonl"
    events = []
    if event_log_path.exists():
        for line in event_log_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            events.append(json.loads(line))
    return {
        "run_dir": str(run_dir.resolve()),
        "event_log": str(event_log_path.resolve()),
        "events": events,
    }


def workflow_inspect_payload(run_dir: Path) -> dict[str, Any]:
    summary_path = run_dir / "workflow_summary.json"
    manifest_path = run_dir / "workflow_run_manifest.json"
    event_log_path = run_dir / "workflow_events.jsonl"
    summary = load_json(summary_path) if summary_path.exists() else None
    manifest = load_json(manifest_path) if manifest_path.exists() else None
    return {
        "run_dir": str(run_dir.resolve()),
        "status": (summary or {}).get("status") or (manifest or {}).get("status"),
        "workflow_id": (summary or {}).get("workflow_id") or (manifest or {}).get("workflow_id"),
        "event_log": str(event_log_path.resolve()),
        "summary_path": str(summary_path.resolve()),
        "manifest_path": str(manifest_path.resolve()),
        "summary": summary,
        "manifest": manifest,
    }
