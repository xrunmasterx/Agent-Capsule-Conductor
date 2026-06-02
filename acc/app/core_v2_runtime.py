from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from acc.app.core_v2_loader import load_workflow_function_template
from acc.app.workflow_refs import WorkflowCatalog
from acc.callable_registry import CallableRegistry
from acc.callable_runner import AgentExecutionContext, CallableClassRunner, acc_run_mode
from acc.domain import (
    AccError,
    ArtifactBundle,
    EventRecord,
    ExecutionPlan,
    FailureRecord,
    FunctionInvocation,
    NodeInvocationSpec,
    ResultStoreAddress,
    RunRecord,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)
from acc.engine import compile_execution_plan
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import (
    ArtifactBundle as StoredArtifactBundle,
)
from acc.result_store.types import (
    NodeId,
    NodeResult,
    PortId,
    RunId,
)
from acc.run_index import NodeRunSummary, RunSummary, rebuild_run_index
from acc.session import utc_now_iso


async def run_core_v2_workflow_path(
    workflow_path: Path,
    run_dir: Path,
    *,
    input_payload: dict[str, Any] | None = None,
    callable_registry: CallableRegistry | None = None,
    workspace: Path | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> RunRecord:
    template = load_workflow_function_template(workflow_path)
    workflow_input = dict(input_payload or {})
    plan = compile_execution_plan(template, workflow_input=workflow_input)
    invocation = FunctionInvocation(
        invocation_id=f"invocation_{run_dir.name}",
        workflow_function_id=template.id,
        run_id=run_dir.name,
        status="running",
        input_payload=workflow_input,
        root_scope_frame_id=f"scope_{run_dir.name}_root",
        started_at=utc_now_iso(),
    )
    scope = ScopeFrame(
        frame_id=invocation.root_scope_frame_id,
        invocation_id=invocation.invocation_id,
        parent_frame_id=None,
        call_depth=0,
        workflow_id=template.id,
        workspace_root=(workspace or run_dir).resolve(),
        environment_root=run_dir.resolve(),
        inbox_root=(run_dir / "inbox").resolve(),
        outbox_root=(run_dir / "outbox").resolve(),
        artifact_root=(run_dir / "artifacts").resolve(),
        behavior_snapshot_path=(run_dir / "behavior_snapshot").resolve(),
        ephemeral=True,
    )
    return await run_workflow_function_invocation(
        template,
        invocation,
        scope,
        plan,
        callable_registry=callable_registry,
        should_cancel=should_cancel,
    )


async def run_workflow_function_invocation(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
    *,
    callable_registry: CallableRegistry | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> RunRecord:
    run_dir = scope.environment_root
    runs_root = run_dir.parent
    if run_dir.exists():
        shutil.rmtree(run_dir)
    for path in (
        run_dir,
        scope.inbox_root,
        scope.outbox_root,
        scope.artifact_root,
        scope.behavior_snapshot_path,
        run_dir / "failures",
    ):
        path.mkdir(parents=True, exist_ok=True)

    event_log_path = run_dir / "events.jsonl"
    event_log_path.write_text("", encoding="utf-8")
    result_store = FilesystemResultStore(runs_root)
    invocation_path = run_dir / "function_invocation.json"
    scope_path = run_dir / "scope_frame.json"
    write_json(invocation_path, function_invocation_payload(invocation))
    write_json(scope_path, scope_frame_payload(scope))

    started_at = utc_now_iso()
    run_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status="running",
        event_log_path=event_log_path,
        result_store_root=run_dir / "result_store",
        started_at=started_at,
    )
    write_json(run_dir / "run_record.json", run_record_payload(run_record))
    write_core_v2_run_summary(
        run_dir,
        template,
        invocation.run_id,
        "running",
        started_at=started_at,
    )
    append_event(event_log_path, invocation.run_id, "workflow_started")

    outputs: dict[tuple[str, str], Any] = {}
    node_by_id = {node.node_id: node.invocation for node in plan.nodes}
    terminal_status = "success"
    try:
        for level in plan.levels:
            if should_cancel is not None and should_cancel():
                terminal_status = "cancelled"
                append_event(event_log_path, invocation.run_id, "workflow_cancelled")
                break
            results = await asyncio.gather(
                *[
                    execute_core_v2_node(
                        template,
                        node_by_id[node_id],
                        invocation,
                        scope,
                        result_store,
                        outputs,
                        event_log_path,
                        callable_registry,
                    )
                    for node_id in level
                ],
                return_exceptions=True,
            )
            failures = [result for result in results if isinstance(result, Exception)]
            if failures:
                raise failures[0]
        if terminal_status == "success":
            write_workflow_outputs(
                template,
                invocation.run_id,
                run_dir,
                result_store,
                outputs,
            )
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
            payload={"error": str(exc)},
        )

    ended_at = utc_now_iso()
    final_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status=terminal_status,
        event_log_path=event_log_path,
        result_store_root=run_dir / "result_store",
        started_at=started_at,
        ended_at=ended_at,
    )
    write_json(run_dir / "run_record.json", run_record_payload(final_record))
    final_invocation = FunctionInvocation(
        **{
            **invocation.__dict__,
            "status": terminal_status,
            "ended_at": ended_at,
        }
    )
    write_json(invocation_path, function_invocation_payload(final_invocation))
    write_core_v2_run_summary(
        run_dir,
        template,
        invocation.run_id,
        terminal_status,
        started_at=started_at,
        ended_at=ended_at,
    )
    return final_record


async def execute_core_v2_node(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
) -> None:
    node_dir = scope.environment_root / "nodes" / node.id
    for path in (node_dir, node_dir / "artifacts"):
        path.mkdir(parents=True, exist_ok=True)
    (node_dir / "events.jsonl").write_text("", encoding="utf-8")
    for log_name in ("stdout.log", "stderr.log", "stdout.txt", "stderr.txt"):
        (node_dir / log_name).write_text("", encoding="utf-8")
    append_event(event_log_path, invocation.run_id, "node_started", node_id=node.id)

    started_at = utc_now_iso()
    session = SessionInstance(
        session_id=f"session_{invocation.run_id}_{node.id}",
        invocation_id=invocation.invocation_id,
        scope_frame_id=scope.frame_id,
        node_id=node.id,
        callable_ref=node.callable_ref,
        callable_kind=node.callable_ref.kind,
        status="running",
        cwd=scope.workspace_root,
        env_keys=(),
        input_path=node_dir / "agent_payload.json",
        output_path=node_dir / "output.json",
        artifact_dir=node_dir / "artifacts",
        event_log_path=node_dir / "events.jsonl",
        started_at=started_at,
    )
    write_json(node_dir / "session_instance_manifest.json", session_instance_payload(session))
    try:
        resolved_payload = resolve_node_payload(
            template,
            node,
            invocation.input_payload,
            outputs,
            run_dir=scope.environment_root,
        )
        agent_payload = resolved_payload.payload
        runtime_payload = {
            "run_id": invocation.run_id,
            "workflow_function_id": template.id,
            "scope_frame_id": scope.frame_id,
            "node_id": node.id,
            "callable_ref": asdict(node.callable_ref),
            "execution_mode": acc_run_mode(),
            "binding_materializations": resolved_payload.binding_records,
        }
        write_json(node_dir / "agent_payload.json", agent_payload)
        write_json(node_dir / "input.json", agent_payload)
        write_json(node_dir / "runtime_payload.json", runtime_payload)
        write_json(node_dir / "runtime.json", runtime_payload)
        write_json(
            node_dir / "binding_manifest.json",
            {
                "inputs": sorted(agent_payload),
                "bindings": resolved_payload.binding_records,
            },
        )
        for record in resolved_payload.binding_records:
            append_event(
                event_log_path,
                invocation.run_id,
                "input_materialized",
                node_id=node.id,
                payload=record,
            )

        output = await execute_core_v2_callable(
            template,
            node,
            agent_payload,
            node_dir,
            scope,
            session,
            resolved_payload.binding_records,
            callable_registry,
        )
        write_json(node_dir / "output.json", output)
        write_json(node_dir / "artifacts" / "payload.json", output)
        validate_artifact_contract(node, node_dir)

        for port_id in output_port_ids(node):
            if port_id not in {"default", "main"} and port_id not in output:
                raise AccError(f"Required output port missing for node {node.id}: {port_id}")
            value = output if port_id in {"default", "main"} else output.get(port_id)
            outputs[(node.id, port_id)] = value
            put_result_store_value(
                result_store,
                invocation.run_id,
                node.id,
                port_id,
                value,
            )

        bundle = ArtifactBundle(
            bundle_id=f"bundle_{invocation.run_id}_{node.id}",
            node_id=node.id,
            run_id=invocation.run_id,
            outputs={port_id: outputs[(node.id, port_id)] for port_id in output_port_ids(node)},
            files=[],
            created_at=utc_now_iso(),
            provenance={"workflow_function_id": template.id},
        )
        write_json(node_dir / "artifact_bundle.json", artifact_bundle_payload(bundle))

        ended_at = utc_now_iso()
        completed_session = SessionInstance(
            **{
                **session.__dict__,
                "status": "succeeded",
                "ended_at": ended_at,
            }
        )
        write_json(
            node_dir / "session_instance_manifest.json",
            session_instance_payload(completed_session),
        )
        append_event(event_log_path, invocation.run_id, "node_completed", node_id=node.id)
    except Exception as exc:
        ended_at = utc_now_iso()
        failed_session = SessionInstance(
            **{
                **session.__dict__,
                "status": "failed",
                "ended_at": ended_at,
                "error": str(exc),
            }
        )
        write_json(
            node_dir / "session_instance_manifest.json",
            session_instance_payload(failed_session),
        )
        failure = FailureRecord(
            failure_id=f"failure_{invocation.run_id}_{node.id}",
            run_id=invocation.run_id,
            layer="adapter",
            message=str(exc),
            node_id=node.id,
            evidence_paths=(
                node_dir / "session_instance_manifest.json",
                node_dir / "stderr.txt",
            ),
        )
        write_json(
            scope.environment_root / "failures" / f"{failure.failure_id}.json",
            failure_record_payload(failure),
        )
        (node_dir / "stderr.txt").write_text(str(exc), encoding="utf-8")
        append_runtime_error_to_stderr_log(node_dir / "stderr.log", str(exc))
        append_event(
            event_log_path,
            invocation.run_id,
            "node_failed",
            node_id=node.id,
            payload={"failure_id": failure.failure_id, "error": str(exc)},
        )
        raise


@dataclass(frozen=True)
class ResolvedNodePayload:
    payload: dict[str, Any]
    binding_records: list[dict[str, Any]]


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
    return ResolvedNodePayload(payload=payload, binding_records=records)


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


def sha256_json(value: Any) -> str:
    inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(inline).hexdigest()


async def execute_core_v2_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    scope: ScopeFrame,
    session: SessionInstance,
    binding_materializations: list[dict[str, Any]],
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    if node.callable_ref.kind == "workflow_function":
        return await execute_workflow_function_callable(
            template,
            node,
            payload,
            node_dir,
            callable_registry,
        )
    if callable_registry is not None and node.callable_ref.kind == "agent_class":
        try:
            asset = callable_registry.resolve(node.callable_ref)
        except AccError:
            pass
        else:
            return await CallableClassRunner().run_agent_class(
                asset,
                payload,
                node_dir,
                AgentExecutionContext(
                    node=node,
                    scope=scope,
                    session=session,
                    binding_materializations=binding_materializations,
                ),
            )
    return execute_hermetic_callable(node, payload, scope, callable_registry)


async def execute_workflow_function_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    child_path = resolve_workflow_function_path(template, node.callable_ref.id)
    child_run_dir = node_dir / "nested_workflow"
    child_record = await run_core_v2_workflow_path(
        child_path,
        child_run_dir,
        input_payload=payload,
        callable_registry=callable_registry,
    )
    if child_record.status != "success":
        raise AccError(
            f"Nested workflow {child_record.workflow_function_id} failed for node {node.id}"
        )
    workflow_outputs = read_child_workflow_outputs(child_run_dir)
    return {
        "status": "success",
        "summary": f"Nested workflow {child_record.workflow_function_id} success",
        "child_workflow_id": child_record.workflow_function_id,
        "child_workflow_run_dir": str(child_run_dir.resolve()),
        "workflow_outputs": workflow_outputs,
        **workflow_outputs,
    }


def resolve_workflow_function_path(template: WorkflowFunctionTemplate, ref_id: str) -> Path:
    template_source_path = template.source_path
    base_dir = template_source_path.parent if template_source_path is not None else Path.cwd()
    project_root = infer_project_root(base_dir)
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


def validate_artifact_contract(node: NodeInvocationSpec, node_dir: Path) -> None:
    artifacts_dir = node_dir / "artifacts"
    for rel_path in (
        *node.artifact_contract.required_paths,
        *node.artifact_contract.optional_paths,
    ):
        reject_artifact_path_escape(rel_path)
    for rel_path in node.artifact_contract.required_paths:
        if not (artifacts_dir / rel_path).exists():
            raise AccError(f"Required artifact missing for node {node.id}: {rel_path}")


def reject_artifact_path_escape(rel_path: str) -> None:
    path = Path(rel_path)
    if (
        path.is_absolute()
        or PurePosixPath(rel_path).is_absolute()
        or PureWindowsPath(rel_path).is_absolute()
        or ".." in path.parts
        or ".." in PurePosixPath(rel_path).parts
        or ".." in PureWindowsPath(rel_path).parts
    ):
        raise AccError(f"Artifact path escapes node artifact directory: {rel_path}")


def append_runtime_error_to_stderr_log(path: Path, message: str) -> None:
    prefix = "\n" if path.exists() and path.stat().st_size > 0 else ""
    with path.open("a", encoding="utf-8") as file:
        file.write(f"{prefix}ACC runtime error: {message}\n")


def execute_hermetic_callable(
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    scope: ScopeFrame,
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    ref = node.callable_ref
    if ref.kind == "tool_class":
        if ref.id in {"fake_producer", "fake"}:
            return {
                "status": "success",
                "summary": f"Produced artifact from {node.id}",
                "producer_node_id": node.id,
                "input": payload,
                "cwd": str(scope.workspace_root),
            }
        if ref.id == "merge":
            return {
                "status": "success",
                "summary": f"Merged input for {node.id}",
                "merged": payload,
                "cwd": str(scope.workspace_root),
            }
        if ref.id == "fail":
            raise AccError(f"Tool node {node.id} failed by configuration")
    if ref.kind == "agent_class" and ref.id in {"generic_fake_agent", "fake-agent.generic"}:
        return {
            "status": "success",
            "summary": f"Fake agent {node.id} ran in {scope.workspace_root}",
            "input": payload,
            "prompt": node.prompt_policy.user_prompt or node.overrides.prompt or "",
            "cwd": str(scope.workspace_root),
        }
    if callable_registry is not None:
        try:
            callable_registry.resolve(ref)
        except AccError:
            pass
        else:
            return {
                "status": "success",
                "summary": f"Callable {ref.kind}:{ref.id} executed by Core v2 adapter stub",
                "input": payload,
                "callable_ref": asdict(ref),
                "cwd": str(scope.workspace_root),
            }
    raise AccError(f"Unsupported Core v2 callable: {ref.kind}:{ref.id}")


def write_workflow_outputs(
    template: WorkflowFunctionTemplate,
    run_id: str,
    run_dir: Path,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
) -> None:
    for binding in template.workflow_output_bindings:
        key = (binding.source.node, binding.source.port)
        if key not in outputs:
            if binding.required:
                raise AccError(
                    f"Missing workflow output source {binding.source.node}.{binding.source.port}"
                )
            continue
        output_dir = run_dir / "workflow_outputs" / binding.target_port
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "output.json", outputs[key])
        put_result_store_value(
            result_store,
            run_id,
            "__workflow_outputs",
            binding.target_port,
            outputs[key],
        )


def output_port_ids(node: NodeInvocationSpec) -> tuple[str, ...]:
    if node.output_bindings:
        return tuple(binding.source_port for binding in node.output_bindings)
    if node.output_ports:
        return tuple(node.output_ports)
    return ("default", "main")


def put_result_store_value(
    result_store: FilesystemResultStore,
    run_id: str,
    node_id: str,
    port_id: str,
    value: Any,
) -> ResultStoreAddress:
    inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(inline).hexdigest()
    result = NodeResult(
        run_id=RunId(run_id),
        node_id=NodeId(node_id),
        port_id=PortId(port_id),
        bundle=StoredArtifactBundle(
            bundle_id=f"bundle_{run_id}_{node_id}_{port_id}",
            relative_path=f"{run_id}/result_store/{node_id}/{port_id}.bin",
            sha256=digest,
            size_bytes=len(inline),
            materialization_mode="inline",
        ),
        inline_value=inline,
        produced_at=utc_now_iso(),
    )
    result_store.put(result)
    return ResultStoreAddress(run_id=run_id, node_id=node_id, port_id=port_id)


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
    failed_nodes = [node.node_id for node in nodes if node.status not in {"success", "succeeded"}]
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
    if status == "succeeded":
        status = "success"
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


def append_event(
    event_log_path: Path,
    run_id: str,
    event_type: str,
    *,
    node_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    event = EventRecord(
        event_id=f"event_{utc_now_iso()}_{event_type}",
        run_id=run_id,
        type=event_type,
        timestamp=utc_now_iso(),
        node_id=node_id,
        payload=payload or {},
    )
    with event_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event_record_payload(event), ensure_ascii=False) + "\n")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def function_invocation_payload(invocation: FunctionInvocation) -> dict[str, Any]:
    return asdict(invocation)


def scope_frame_payload(scope: ScopeFrame) -> dict[str, Any]:
    payload = asdict(scope)
    for key in (
        "workspace_root",
        "environment_root",
        "inbox_root",
        "outbox_root",
        "artifact_root",
        "behavior_snapshot_path",
        "binding_path",
    ):
        if payload[key] is not None:
            payload[key] = str(payload[key])
    return payload


def session_instance_payload(session: SessionInstance) -> dict[str, Any]:
    payload = asdict(session)
    payload["cwd"] = str(session.cwd)
    payload["input_path"] = str(session.input_path)
    payload["output_path"] = str(session.output_path)
    payload["artifact_dir"] = str(session.artifact_dir)
    payload["event_log_path"] = str(session.event_log_path)
    return payload


def artifact_bundle_payload(bundle: ArtifactBundle) -> dict[str, Any]:
    return asdict(bundle)


def run_record_payload(record: RunRecord) -> dict[str, Any]:
    payload = asdict(record)
    payload["event_log_path"] = str(record.event_log_path)
    payload["result_store_root"] = str(record.result_store_root)
    return payload


def event_record_payload(event: EventRecord) -> dict[str, Any]:
    return asdict(event)


def failure_record_payload(failure: FailureRecord) -> dict[str, Any]:
    payload = asdict(failure)
    payload["evidence_paths"] = [str(path) for path in failure.evidence_paths]
    return payload
