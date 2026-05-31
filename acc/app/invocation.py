from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from acc.domain import AccError, CallableRef, EnvironmentFrame, NodeInvocationSpec, NodeSpec
from acc.engine import normalize_node_invocation_spec
from acc.registry import CapsuleRegistry
from acc.store import load_json

IN_PROCESS_FAKE_AGENTS: frozenset[str] = frozenset({"generic_fake_agent"})
_LEGACY_RUNTIME_SENTINELS: frozenset[str] = frozenset({"capsule"})


def _to_legacy_frame(frame: EnvironmentFrame):
    """Adapt the clean (domain) EnvironmentFrame to the legacy environment frame.

    Mirrors ``execute_legacy_capsule_node`` field-by-field so the capsule backend
    receives exactly the same execution context it does on the legacy path.
    """
    from acc.environment import EnvironmentFrame as LegacyEnvironmentFrame

    return LegacyEnvironmentFrame(
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


class CallableInvocationService:
    """App-layer single dispatch surface for one workflow run.

    One instance per run, reusing a single CapsuleRegistry to avoid re-scanning.
    Only used behind the ``ACC_USE_CALLABLE_DISPATCH`` feature flag.
    """

    def __init__(self, registry: CapsuleRegistry) -> None:
        self.registry = registry

    async def execute_node(
        self,
        node: NodeSpec,
        workflow_path: Path,
        run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
        *,
        node_invocation: NodeInvocationSpec | None = None,
    ) -> dict[str, Any]:
        invocation = node_invocation or normalize_node_invocation_spec(node)
        ref = invocation.callable_ref
        if node.kind == "workflow" or ref.kind == "workflow_function":
            return await self._invoke_workflow_function(
                node,
                workflow_path,
                run_dir,
                node_dir,
                frame,
                node_invocation=invocation,
            )
        if node.kind == "tool" or ref.kind == "tool_class":
            from acc.runtime import execute_tool_node

            return execute_tool_node(node, node_dir, frame)
        return await self._invoke_agent_class(
            node, invocation, workflow_path, run_dir, node_dir, frame
        )

    async def _invoke_agent_class(
        self,
        node: NodeSpec,
        invocation: NodeInvocationSpec,
        workflow_path: Path,
        run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> dict[str, Any]:
        backend = self._resolve_agent_backend(invocation.callable_ref, node)
        if backend == "fake":
            from acc.runtime import execute_clean_node

            return await execute_clean_node(node, workflow_path, run_dir, node_dir, frame)
        return await self._run_capsule_backend(
            node, invocation, workflow_path, run_dir, node_dir, frame
        )

    def _effective_capsule_id(self, ref: CallableRef, node: NodeSpec) -> str:
        candidate = ref.id
        if not candidate or candidate in _LEGACY_RUNTIME_SENTINELS:
            candidate = node.raw.get("callable_id") or node.raw.get("legacy_capsule_id")
        if (
            not isinstance(candidate, str)
            or not candidate
            or candidate in _LEGACY_RUNTIME_SENTINELS
        ):
            raise AccError(f"node {node.id} has no resolvable agent class id")
        return candidate

    def _resolve_agent_backend(self, ref: CallableRef, node: NodeSpec) -> str:
        cid = self._effective_capsule_id(ref, node)
        if cid in IN_PROCESS_FAKE_AGENTS:
            return "fake"
        if self.registry.has(cid):
            return "capsule"
        raise AccError(
            f"Unknown agent class: {cid!r} (not a fake backend and not a registered capsule)"
        )

    async def _run_capsule_backend(
        self,
        node: NodeSpec,
        invocation: NodeInvocationSpec,
        workflow_path: Path,
        run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> dict[str, Any]:
        from acc.environment import WorkflowExecutionContext, node_cwd, snapshot_behavior_pack
        from acc.runner import CapsuleRunner

        input_path = node_dir / "input.json"
        input_payload = load_json(input_path) if input_path.exists() else {}
        # Only the capsule backend clears node_dir (mirrors execute_legacy_capsule_node).
        # The fake backend must never rmtree the node attempt directory.
        if node_dir.exists() and not (node_dir / "session_manifest.json").exists():
            shutil.rmtree(node_dir)
        legacy_frame = _to_legacy_frame(frame)
        raw_node = dict(node.raw)
        # TODO(Phase 2): cwd_policy/relative_cwd still read from raw node dict.
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
        capsule_id = self._effective_capsule_id(invocation.callable_ref, node)
        runner = CapsuleRunner(registry=self.registry)
        conductor_output = await runner.run(
            capsule_id,
            input_payload if isinstance(input_payload, dict) else {},
            node_dir,
            execution_context,
        )
        status = str(conductor_output.get("status") or "failed")
        if status != "success":
            raise AccError(str(conductor_output.get("error") or conductor_output.get("summary")))
        output_path = conductor_output.get("output_path")
        if not output_path:
            raise AccError(f"Agent class node {node.id} did not produce output_path")
        output = load_json(Path(output_path))
        if not isinstance(output, dict):
            raise AccError(f"Agent class node {node.id} output is not an object")
        # Defensive backfill for the capsule backend only (the fake backend produces
        # these fields natively). Does not overwrite existing keys.
        output.setdefault("summary", conductor_output.get("summary") or "")
        output.setdefault("status", status)
        output.setdefault("cwd", str(frame.workspace_root))
        return output

    async def _invoke_workflow_function(
        self,
        node: NodeSpec,
        workflow_path: Path,
        run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
        *,
        node_invocation: NodeInvocationSpec,
    ) -> dict[str, Any]:
        # Phase 1 does not rewrite nested workflow behavior: reuse the exact existing
        # app-layer implementation so behavior stays identical to the flag-off path.
        from acc.app import execute_clean_workflow_call_node

        return await execute_clean_workflow_call_node(
            node,
            workflow_path,
            run_dir,
            node_dir,
            frame,
            registry=self.registry,
            node_invocation=node_invocation,
        )
