"""Single-node execution: invoke callable, write outputs, handle failures.

Extracted from the God Module core_v2_runtime.py.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections.abc import Mapping
from dataclasses import asdict
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from acc.app.runtime.context import ExecutionContext
from acc.app.runtime.invocation_port import CallableInvocationPort, NodeExecutionEnvelope
from acc.app.runtime.repository import NodeExecutionRecorder
from acc.app.runtime.results import NodeExecutionResult
from acc.callable_registry import CallableRegistry
from acc.hermetic_callables import HERMETIC_AGENT_CLASS_IDS, HERMETIC_TOOL_CLASS_IDS
from acc.models import (
    AccError,
    ArtifactBundle,
    FailureRecord,
    FunctionInvocation,
    NodeInvocationSpec,
    ResultStoreAddress,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)
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
from acc.runtime.node_payload import (
    MISSING_PORT_VALUE,
    is_empty_runtime_input,
    materialized_output_port_ids,
    output_value_for_port,
    resolve_node_payload,
)
from acc.runtime.policy import acc_run_mode
from acc.session import utc_now_iso
from acc.store import load_clean_environment_binding


async def execute_core_v2_node(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    result_store: FilesystemResultStore,
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
    *,
    execution_context: ExecutionContext | None = None,
    upstream_outputs: Mapping[tuple[str, str], Any] | None = None,
) -> NodeExecutionResult:
    recorder = NodeExecutionRecorder(
        scope=scope,
        event_log_path=event_log_path,
        invocation=invocation,
    )
    node_dir = recorder.prepare_node_dir(node.id)
    recorder.append_event("node_started", node_id=node.id)

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
    recorder.write_session(node.id, session)
    try:
        resolved_payload = resolve_node_payload(
            template,
            node,
            invocation.input_payload,
            dict(upstream_outputs or {}),
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
        recorder.write_payloads(
            node.id,
            agent_payload=agent_payload,
            runtime_payload=runtime_payload,
        )
        binding_manifest_path = recorder.write_binding_manifest(
            node.id,
            inputs=sorted(agent_payload),
            bindings=resolved_payload.binding_records,
        )
        for record in resolved_payload.binding_records:
            recorder.append_event(
                "input_materialized",
                node_id=node.id,
                payload=record,
            )
        if node.metadata.get("empty_input_policy") == "block" and is_empty_runtime_input(
            agent_payload
        ):
            message = (
                f"Node {node.id} requires runtime input, but input.json is empty. "
                "Provide ticker, theme, main input, or switch empty_input_policy to allow."
            )
            recorder.append_event(
                "node_input_blocked",
                node_id=node.id,
                payload={"reason": "empty_input_policy", "message": message},
            )
            raise AccError(message)

        # Use module-level lookup so monkeypatch can intercept
        _this_module = sys.modules[__name__]
        output = await _this_module.execute_core_v2_callable(
            template,
            node,
            agent_payload,
            node_dir,
            scope,
            session,
            resolved_payload.binding_records,
            callable_registry,
            execution_context,
        )
        recorder.write_output(node.id, output)
        validate_artifact_contract(node, node_dir)

        materialized_ports = materialized_output_port_ids(node, output)
        node_outputs: dict[str, Any] = {}
        result_addresses: dict[str, ResultStoreAddress] = {}
        for port_id in materialized_ports:
            value = output_value_for_port(output, port_id)
            if value is MISSING_PORT_VALUE:
                raise AccError(f"Required output port missing for node {node.id}: {port_id}")
            node_outputs[port_id] = value
            result_addresses[port_id] = put_result_store_value(
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
            outputs=dict(node_outputs),
            files=[],
            created_at=utc_now_iso(),
            provenance={"workflow_function_id": template.id},
        )
        artifact_bundle_path = recorder.write_artifact_bundle(node.id, bundle)

        ended_at = utc_now_iso()
        completed_session = SessionInstance(
            **{
                **session.__dict__,
                "status": "success",
                "ended_at": ended_at,
            }
        )
        recorder.write_session(node.id, completed_session)
        recorder.append_event("node_completed", node_id=node.id)
        return NodeExecutionResult.success(
            node_id=node.id,
            outputs=node_outputs,
            result_addresses=result_addresses,
            artifact_bundle_path=artifact_bundle_path,
            binding_manifest_path=binding_manifest_path,
            started_at=started_at,
            ended_at=ended_at,
        )
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
        recorder.write_session(node.id, failed_session)
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
        recorder.write_failure(node.id, failure, str(exc))
        recorder.append_event(
            "node_failed",
            node_id=node.id,
            payload={"failure_id": failure.failure_id, "error": str(exc)},
        )
        raise


async def execute_core_v2_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    scope: ScopeFrame,
    session: SessionInstance,
    binding_materializations: list[dict[str, Any]],
    callable_registry: CallableRegistry | None,
    execution_context: ExecutionContext | None = None,
) -> dict[str, Any]:
    envelope = NodeExecutionEnvelope(
        template=template,
        node=node,
        payload=payload,
        node_dir=node_dir,
        scope=scope,
        session=session,
        binding_materializations=binding_materializations,
        callable_registry=callable_registry,
        execution_context=execution_context,
    )
    return await CallableInvocationPort().invoke(envelope)


def project_root_for_agent_sessions(
    scope: ScopeFrame,
    *,
    execution_context: ExecutionContext | None = None,
) -> Path:
    if execution_context is not None:
        return execution_context.project.project_root
    run_dir = scope.environment_root.resolve()
    if run_dir.parent.name == "runs":
        return run_dir.parent.parent
    return run_dir.parent


def execute_hermetic_callable(
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    scope: ScopeFrame,
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    ref = node.callable_ref
    if ref.kind == "tool_class" and ref.id in HERMETIC_TOOL_CLASS_IDS:
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
    if ref.kind == "agent_class" and ref.id in HERMETIC_AGENT_CLASS_IDS:
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


# ---------------------------------------------------------------------------
# Artifact contract validation
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Result store helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Workflow binding resolution (for nested workflows)
# ---------------------------------------------------------------------------


def resolve_node_workflow_binding(
    node: NodeInvocationSpec,
    *,
    callable_registry: CallableRegistry | None,
    execution_context: ExecutionContext | None = None,
) -> tuple[Path | None, Path | None]:
    binding_ref = node.metadata.get("binding_ref")
    if not isinstance(binding_ref, str) or not binding_ref.strip():
        return None, None
    project_root = (
        execution_context.project.project_root
        if execution_context is not None
        else callable_registry.project_root
        if callable_registry is not None
        else None
    )
    if project_root is None:
        project_root = Path.cwd()
    candidate = (project_root / binding_ref).resolve()
    bindings_root = (project_root / "bindings").resolve()
    if not candidate.is_relative_to(bindings_root):
        raise AccError(
            f"Workflow node {node.id} binding_ref must point inside bindings/: {binding_ref}"
        )
    binding = load_clean_environment_binding(candidate)
    return binding.workspace_root, binding.binding_path
