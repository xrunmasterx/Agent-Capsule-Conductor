from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.callable_registry import CallableAsset, CallableRegistry
from acc.callable_runner import CallableClassRunner
from acc.domain import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    EnvironmentFrame,
    NodeInvocationSpec,
)
from acc.hermetic_callables import HERMETIC_AGENT_CLASS_IDS
from acc.store import load_json

IN_PROCESS_FAKE_AGENTS: frozenset[str] = HERMETIC_AGENT_CLASS_IDS


class CallableInvocationService:
    """App-layer dispatch surface for a Core v2 node invocation."""

    def __init__(
        self,
        callable_registry: CallableRegistry | None = None,
        class_runner: CallableClassRunner | None = None,
        *,
        registry: Any | None = None,
    ) -> None:
        if callable_registry is None:
            _ = registry
            raise AccError("CallableInvocationService requires a Core v2 CallableRegistry")
        self.callable_registry = callable_registry
        self.class_runner = class_runner or CallableClassRunner()

    async def execute_node(
        self,
        invocation: NodeInvocationSpec,
        workflow_path: Path,
        run_dir: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> dict[str, Any]:
        _ = workflow_path, run_dir
        if invocation.callable_ref.kind == "workflow_function":
            raise AccError("Nested workflow_function calls are executed by Core v2 runtime.")
        if invocation.callable_ref.kind == "tool_class":
            raise AccError("Tool class calls are executed by Core v2 runtime.")
        return await self._invoke_agent_class(invocation, node_dir, frame)

    async def _invoke_agent_class(
        self,
        invocation: NodeInvocationSpec,
        node_dir: Path,
        frame: EnvironmentFrame,
    ) -> dict[str, Any]:
        asset = self._resolve_agent_asset(invocation.callable_ref)
        if asset.template.id in IN_PROCESS_FAKE_AGENTS:
            output = {
                "status": "success",
                "summary": f"Fake agent {invocation.id} ran in {frame.workspace_root}",
                "cwd": str(frame.workspace_root),
            }
            return output
        input_path = node_dir / "input.json"
        input_payload = load_json(input_path) if input_path.exists() else {}
        if not isinstance(input_payload, dict):
            input_payload = {}
        raise AccError(
            "External agent class execution is owned by Core v2 runtime adapters; "
            f"cannot dispatch {asset.template.id!r} from CallableInvocationService."
        )

    def _resolve_agent_asset(self, ref: CallableRef) -> CallableAsset:
        if ref.id in IN_PROCESS_FAKE_AGENTS:
            return CallableAsset(
                template=ref_as_fake_template(ref, ref.id),
                backend="in_process",
                source_id=ref.id,
            )
        try:
            return self.callable_registry.resolve(
                CallableRef(kind="agent_class", id=ref.id, version=ref.version)
            )
        except AccError as exc:
            raise AccError(f"Unknown agent class: {ref.id!r}") from exc


def ref_as_fake_template(ref: CallableRef, callable_id: str) -> AgentClassTemplate:
    return AgentClassTemplate(
        id=callable_id,
        version=ref.version or "0.0.0",
        runtime="generic_fake_agent",
    )
