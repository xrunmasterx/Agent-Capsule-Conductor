from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

NodeKind = Literal["agent", "tool", "workflow"]
CallableKind = Literal["agent_class", "tool_class", "workflow_function", "legacy_capsule"]
PortDirection = Literal["input", "output"]
MaterializationMode = Literal["copy", "reference", "symlink"]
ControlContextMode = Literal["upstream_output", "none"]
WorkspaceAccess = Literal["read_only", "writes_run_only", "writes_workspace"]
EnvPolicy = Literal["acc_whitelist", "explicit_allowlist"]
EnvironmentPolicy = Literal["inherit_parent", "new_ephemeral", "binding_required", "forbidden"]
RuntimeStatus = Literal[
    "success",
    "failed",
    "timeout",
    "schema_error",
    "artifact_error",
    "workspace_error",
    "adapter_error",
    "unavailable",
]


class AccError(Exception):
    """Base exception for user-facing ACC failures."""


@dataclass(frozen=True)
class PortContract:
    id: str
    direction: PortDirection
    type: str = "artifact"
    required: bool = False
    cardinality: str = "one"


@dataclass(frozen=True)
class NodeSpec:
    """Legacy workflow node view used for scheduling, ports, and edges.

    ``raw`` is a read-only compatibility snapshot from the source template.
    Runtime execution should consume ``NodeInvocationSpec`` from load-time
    normalization rather than re-parsing ``raw`` on the hot path.
    """

    id: str
    kind: NodeKind
    runtime: str | None = None
    tool: str | None = None
    workflow_ref: str | None = None
    prompt: str | None = None
    permission_profile: PermissionProfile | None = None
    input_ports: dict[str, PortContract] = field(default_factory=dict)
    output_ports: dict[str, PortContract] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ControlEdge:
    source: str
    target: str
    condition: str | None = None
    context: ControlContextMode = "upstream_output"


@dataclass(frozen=True)
class DataEndpoint:
    node: str
    port: str


@dataclass(frozen=True)
class DataEdge:
    source: DataEndpoint
    target: DataEndpoint
    materialization: MaterializationMode = "copy"


@dataclass(frozen=True)
class WorkflowInputBinding:
    source_port: str
    target: DataEndpoint
    materialization: MaterializationMode = "copy"
    required: bool = True


@dataclass(frozen=True)
class WorkflowOutputBinding:
    source: DataEndpoint
    target_port: str
    materialization: MaterializationMode = "copy"
    required: bool = True


@dataclass(frozen=True)
class WorkflowTemplate:
    id: str
    version: str
    nodes: dict[str, NodeSpec]
    control_edges: list[ControlEdge]
    data_edges: list[DataEdge]
    exposed_inputs: dict[str, PortContract] = field(default_factory=dict)
    exposed_outputs: dict[str, PortContract] = field(default_factory=dict)
    workflow_input_bindings: list[WorkflowInputBinding] = field(default_factory=list)
    workflow_output_bindings: list[WorkflowOutputBinding] = field(default_factory=list)
    policies: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    source_path: Path | None = None


@dataclass(frozen=True)
class EnvironmentBinding:
    workflow_id: str
    binding_name: str
    workspace_root: Path
    behavior_policy: dict[str, Any] = field(default_factory=dict)
    binding_path: Path | None = None


@dataclass(frozen=True)
class EnvironmentFrame:
    environment_id: str
    run_id: str
    workflow_id: str
    workspace_root: Path
    environment_root: Path
    inbox_root: Path
    outbox_root: Path
    artifact_root: Path
    behavior_snapshot_path: Path
    ephemeral: bool
    binding_path: Path | None = None
    function_invocation_id: str | None = None
    scope_frame_id: str | None = None
    parent_scope_frame_id: str | None = None
    call_depth: int = 0


@dataclass(frozen=True)
class ArtifactBundle:
    bundle_id: str
    node_id: str
    run_id: str
    outputs: dict[str, Any]
    files: list[dict[str, Any]]
    created_at: str
    provenance: dict[str, Any]


@dataclass(frozen=True)
class PermissionProfile:
    workspace_access: WorkspaceAccess = "read_only"
    network: bool = False
    shell: bool = False
    dangerous: bool = False
    env_policy: EnvPolicy = "acc_whitelist"
    allowed_env: tuple[str, ...] = ()
    timeout_seconds: int = 60


@dataclass(frozen=True)
class RuntimeResult:
    status: RuntimeStatus
    summary: str
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    exit_code: int | None = None


@dataclass(frozen=True)
class CallableRef:
    kind: CallableKind
    id: str
    version: str | None = None


@dataclass(frozen=True)
class CallableOverride:
    prompt: str | None = None
    permission_profile: PermissionProfile | None = None
    timeout_seconds: int | None = None
    retry: dict[str, Any] = field(default_factory=dict)
    static_input: dict[str, Any] = field(default_factory=dict)
    behavior_overlay: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentClassTemplate:
    id: str
    version: str
    runtime: str
    default_prompt: str | None = None
    default_rules: tuple[str, ...] = ()
    default_skills: tuple[str, ...] = ()
    default_permissions: PermissionProfile = field(default_factory=PermissionProfile)
    input_ports: dict[str, PortContract] = field(default_factory=dict)
    output_ports: dict[str, PortContract] = field(default_factory=dict)
    artifact_contract: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolClassTemplate:
    id: str
    version: str
    runner: str
    default_permissions: PermissionProfile = field(default_factory=PermissionProfile)
    input_ports: dict[str, PortContract] = field(default_factory=dict)
    output_ports: dict[str, PortContract] = field(default_factory=dict)
    artifact_contract: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NodeInputBinding:
    source: DataEndpoint | None = None
    target_port: str = "main"
    static_value: Any | None = None
    materialization: MaterializationMode = "copy"
    required: bool = True


@dataclass(frozen=True)
class NodeOutputBinding:
    source_port: str = "main"
    target: DataEndpoint | None = None
    materialization: MaterializationMode = "copy"
    required: bool = True


@dataclass(frozen=True)
class WorkflowCallInputBinding:
    source: DataEndpoint | None = None
    workflow_input: str = "main"
    static_value: Any | None = None
    materialization: MaterializationMode = "copy"
    required: bool = True


@dataclass(frozen=True)
class WorkflowCallOutputBinding:
    workflow_output: str
    parent_port: str
    materialization: MaterializationMode = "copy"
    required: bool = True


WorkflowCallBinding = WorkflowCallInputBinding
WorkflowReturnBinding = WorkflowCallOutputBinding


@dataclass(frozen=True)
class InvocationPolicy:
    retry: dict[str, Any] = field(default_factory=dict)
    timeout_seconds: int | None = None
    permission_profile: PermissionProfile | None = None


@dataclass(frozen=True)
class CallDepthPolicy:
    default_max_depth: int = 2
    allow_deeper_with_explicit_flag: bool = False
    recursion_guard: bool = True


@dataclass(frozen=True)
class RecursionPolicy:
    allow_recursive: bool = False
    max_depth: int = 2


@dataclass(frozen=True)
class NodeInvocationSpec:
    id: str
    callable_ref: CallableRef
    overrides: CallableOverride = field(default_factory=CallableOverride)
    input_bindings: list[NodeInputBinding] = field(default_factory=list)
    output_bindings: list[NodeOutputBinding] = field(default_factory=list)
    workflow_call_input_bindings: list[WorkflowCallInputBinding] = field(default_factory=list)
    workflow_call_output_bindings: list[WorkflowCallOutputBinding] = field(default_factory=list)
    environment_policy: EnvironmentPolicy = "inherit_parent"
    invocation_policy: InvocationPolicy = field(default_factory=InvocationPolicy)
    input_ports: dict[str, PortContract] = field(default_factory=dict)
    output_ports: dict[str, PortContract] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkflowFunctionTemplate:
    id: str
    version: str
    node_invocations: dict[str, NodeInvocationSpec]
    control_edges: list[ControlEdge]
    data_edges: list[DataEdge]
    exposed_inputs: dict[str, PortContract] = field(default_factory=dict)
    exposed_outputs: dict[str, PortContract] = field(default_factory=dict)
    workflow_input_bindings: list[WorkflowInputBinding] = field(default_factory=list)
    workflow_output_bindings: list[WorkflowOutputBinding] = field(default_factory=list)
    policies: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    source_path: Path | None = None


@dataclass(frozen=True)
class FunctionInvocation:
    invocation_id: str
    workflow_function_id: str
    run_id: str
    status: str
    input_payload: dict[str, Any]
    root_scope_frame_id: str
    parent_invocation_id: str | None = None
    started_at: str | None = None
    ended_at: str | None = None


@dataclass(frozen=True)
class ScopeFrame:
    frame_id: str
    invocation_id: str
    parent_frame_id: str | None
    call_depth: int
    workflow_id: str
    workspace_root: Path
    environment_root: Path
    inbox_root: Path
    outbox_root: Path
    artifact_root: Path
    behavior_snapshot_path: Path
    ephemeral: bool
    binding_path: Path | None = None


@dataclass(frozen=True)
class SessionInstance:
    session_id: str
    invocation_id: str
    scope_frame_id: str
    node_id: str
    callable_ref: CallableRef
    callable_kind: CallableKind
    status: str
    cwd: Path
    env_keys: tuple[str, ...]
    input_path: Path
    output_path: Path
    artifact_dir: Path
    event_log_path: Path
    started_at: str | None = None
    ended_at: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class WorkflowEvent:
    type: str
    timestamp: str
    workflow_run_id: str
    status: str
    node_id: str | None = None
    level: int | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NodeEvent:
    type: str
    timestamp: str
    node_id: str
    status: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentCapabilities:
    resumable_session: bool = False
    status_updates: bool = False
    log_streaming: bool = False
    token_usage: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "resumable_session": self.resumable_session,
            "status_updates": self.status_updates,
            "log_streaming": self.log_streaming,
            "token_usage": self.token_usage,
        }

    def effective_keys(self) -> tuple[str, ...]:
        return tuple(key for key, enabled in self.as_dict().items() if enabled)


SupervisorDecisionKind = Literal["action", "no_action", "failed"]
InteractionKind = Literal["approval", "ask", "confirm", "suggest"]
InteractionStatus = Literal["pending", "answered", "expired", "cancelled"]
SupervisorPlanStatus = Literal["proposed", "approved", "executing", "completed", "failed"]
WakeupReason = Literal["supervisor", "dependency_met", "timer", "human", "retry"]
SessionHealth = Literal["healthy", "stale", "failed", "unknown"]
RecoveryLevel = Literal["none", "L1", "L2", "L3"]


@dataclass(frozen=True)
class RosterEntry:
    callable_ref: CallableRef
    title: str
    capabilities: AgentCapabilities
    input_ports: dict[str, PortContract]
    output_ports: dict[str, PortContract]


@dataclass(frozen=True)
class SupervisorRoster:
    entries: tuple[RosterEntry, ...]
    generated_at: str


@dataclass(frozen=True)
class DynamicInvocationIntent:
    target_callable_ref: CallableRef
    input_payload: dict[str, Any]
    rationale: str
    correlation_id: str
    node_id_suggestion: str | None = None


@dataclass(frozen=True)
class SupervisorPlan:
    plan_id: str
    supervisor_node_id: str
    intents: tuple[DynamicInvocationIntent, ...]
    created_at: str
    status: SupervisorPlanStatus = "proposed"


@dataclass(frozen=True)
class DynamicInvocationProposal:
    proposal_id: str
    plan: SupervisorPlan
    graph_patch: dict[str, Any] | None = None


@dataclass(frozen=True)
class SupervisorDecision:
    decision: SupervisorDecisionKind
    correlation_id: str
    rationale: str
    supervisor_node_id: str
    plan_id: str | None = None
    target_callable_ref: CallableRef | None = None


@dataclass(frozen=True)
class WakeupRequest:
    request_id: str
    run_id: str
    reason: WakeupReason
    priority: int
    created_at: str
    target_node_id: str | None = None
    target_callable_ref: CallableRef | None = None
    coalesce_key: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class InteractionRequest:
    interaction_id: str
    run_id: str
    kind: InteractionKind
    status: InteractionStatus
    prompt: str
    created_at: str
    node_id: str | None = None
    options: tuple[str, ...] = ()
    payload: dict[str, Any] = field(default_factory=dict)
    answered_at: str | None = None
    answer: dict[str, Any] | None = None
