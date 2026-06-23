from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.app.agent_sessions import AgentTurnService
from acc.app.runtime.context import ExecutionContext
from acc.callable_registry import CallableRegistry
from acc.callable_runner import AgentExecutionContext, CallableClassRunner
from acc.models import (
    AccError,
    AgentClassTemplate,
    NodeInvocationSpec,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)

STREAMING_AGENT_RUNTIMES = frozenset({"codex_app_server", "codex_cli"})


@dataclass(frozen=True)
class NodeExecutionEnvelope:
    """Runtime callable invocation envelope for one fixed-workflow node."""

    template: WorkflowFunctionTemplate
    node: NodeInvocationSpec
    payload: dict[str, Any]
    node_dir: Path
    scope: ScopeFrame
    session: SessionInstance
    binding_materializations: list[dict[str, Any]]
    callable_registry: CallableRegistry | None = None
    execution_context: ExecutionContext | None = None

    @property
    def callable_ref(self):
        return self.node.callable_ref

    @property
    def workspace_root(self) -> Path:
        return self.scope.workspace_root

    @property
    def run_dir(self) -> Path:
        return self.scope.environment_root

    @property
    def cancel_path(self) -> Path:
        return self.scope.environment_root / "cancel_requested"


class CallableInvocationPort:
    """Concrete callable dispatch boundary for fixed-workflow node execution."""

    def __init__(
        self,
        *,
        agent_turn_service_factory: Any | None = None,
        class_runner: CallableClassRunner | None = None,
    ) -> None:
        self.agent_turn_service_factory = agent_turn_service_factory or AgentTurnService
        self.class_runner = class_runner or CallableClassRunner()

    async def invoke(self, envelope: NodeExecutionEnvelope) -> dict[str, Any]:
        ref = envelope.callable_ref
        if ref.kind == "workflow_function":
            return await self._invoke_workflow_function(envelope)
        if ref.kind == "agent_class":
            output = await self._maybe_invoke_registered_agent(envelope)
            if output is not None:
                return output
        return self._invoke_hermetic(envelope)

    async def _invoke_workflow_function(self, envelope: NodeExecutionEnvelope) -> dict[str, Any]:
        from acc.app.runtime.nested_workflow import execute_workflow_function_callable

        return await execute_workflow_function_callable(
            envelope.template,
            envelope.node,
            envelope.payload,
            envelope.node_dir,
            envelope.scope,
            envelope.session,
            envelope.callable_registry,
            envelope.execution_context,
        )

    async def _maybe_invoke_registered_agent(
        self,
        envelope: NodeExecutionEnvelope,
    ) -> dict[str, Any] | None:
        if envelope.callable_registry is None:
            return None
        try:
            asset = envelope.callable_registry.resolve(envelope.callable_ref)
        except AccError:
            return None
        template = asset.template
        if not isinstance(template, AgentClassTemplate):
            raise AccError(f"Callable asset is not an AgentClassTemplate: {asset.source_id}")
        if template.runtime in STREAMING_AGENT_RUNTIMES:
            service = self.agent_turn_service_factory(
                project_root_for_agent_sessions(envelope.scope, envelope.execution_context)
            )
            return await service.run_workflow_node_turn(
                asset,
                envelope.payload,
                envelope.node_dir,
                node=envelope.node,
                scope=envelope.scope,
                session=envelope.session,
                binding_materializations=envelope.binding_materializations,
            )
        return await self.class_runner.run_agent_class(
            asset,
            envelope.payload,
            envelope.node_dir,
            AgentExecutionContext(
                node=envelope.node,
                scope=envelope.scope,
                session=envelope.session,
                binding_materializations=envelope.binding_materializations,
            ),
        )

    def _invoke_hermetic(self, envelope: NodeExecutionEnvelope) -> dict[str, Any]:
        from acc.app.runtime.executor import execute_hermetic_callable

        return execute_hermetic_callable(
            envelope.node,
            envelope.payload,
            envelope.scope,
            envelope.callable_registry,
        )


def project_root_for_agent_sessions(
    scope: ScopeFrame,
    execution_context: ExecutionContext | None = None,
) -> Path:
    if execution_context is not None:
        return execution_context.project.project_root
    run_dir = scope.environment_root.resolve()
    if run_dir.parent.name == "runs":
        return run_dir.parent.parent
    return run_dir.parent
