"""Pure data definitions for the ACC domain layer.

All frozen dataclasses, Literal type aliases, module-level constants, and the
base ``AccError`` exception live here.  This module has **no** dependency on
serialization or validation helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

# -- Literals & Constants -----------------------------------------------------

CallableKind = Literal["agent_class", "tool_class", "workflow_function"]
PortDirection = Literal["input", "output"]
MaterializationMode = Literal["copy", "reference", "symlink"]
ControlContextMode = Literal["none"]
WorkspaceAccess = Literal["read_only", "writes_run_only", "writes_workspace"]
EnvPolicy = Literal["acc_whitelist", "explicit_allowlist"]
EnvironmentPolicy = Literal["inherit_parent", "new_ephemeral", "binding_required", "forbidden"]
RuntimeLayer = Literal[
    "loader",
    "domain_validation",
    "plan_compilation",
    "binding_resolution",
    "payload_materialization",
    "callable_resolution",
    "adapter",
    "output_validation",
    "artifact_validation",
    "store",
    "event_log",
    "cancellation",
    "timeout",
]
RuntimeStatus = Literal[
    "planned",
    "scheduled",
    "running",
    "success",
    "failed",
    "cancelled",
    "timeout",
    "schema_error",
    "artifact_error",
    "workspace_error",
    "adapter_error",
    "unavailable",
]

CORE_V2_SCHEMA_VERSION = "acc.core.v2"
CONTROL_LEDGER_SCHEMA_VERSION = "acc.control.v1"
CORE_CALLABLE_KINDS: frozenset[str] = frozenset(
    {"agent_class", "tool_class", "workflow_function"}
)
EXECUTABLE_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "input_mapping",
        "legacy_value_edges",
        "legacy_passthrough",
        "upstream_context",
        "permissions",
        "permission_profile",
        "retry",
        "timeout_seconds",
        "runtime",
        "tool",
        "workflow_ref",
        "callable_id",
        "callable_version",
        "environment_policy",
        "artifact_contract",
        "prompt_policy",
        "run_dir",
        "run_id",
        "session_id",
        "previous_outputs",
        "conversation_memory",
        "workspace_root",
        "local_workspace_binding",
        "control",
        "require_human_approval",
        "requires_human_approval",
        "approval_prompt",
        "approval_reject_status",
    }
)

# -- Exceptions ---------------------------------------------------------------


class AccError(Exception):
    """Base exception for user-facing ACC failures."""


# -- Workflow Structure Models ------------------------------------------------


@dataclass(frozen=True)
class PortContract:
    id: str
    direction: PortDirection
    type: str = "artifact"
    required: bool = False
    cardinality: str = "one"


@dataclass(frozen=True)
class ControlEdge:
    source: str
    target: str
    condition: str | None = None
    context: ControlContextMode = "none"


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


# -- Environment & Workspace Models -------------------------------------------


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


# -- Run & Session Models -----------------------------------------------------


@dataclass(frozen=True)
class ArtifactBundle:
    bundle_id: str
    node_id: str
    run_id: str
    outputs: dict[str, Any]
    files: list[dict[str, Any]]
    created_at: str
    provenance: dict[str, Any]


# -- Policy & Permission Models -----------------------------------------------


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
class RetryPolicy:
    max_attempts: int = 1
    backoff_seconds: float = 0.0


@dataclass(frozen=True)
class TimeoutPolicy:
    seconds: int | None = None


@dataclass(frozen=True)
class RuntimePolicy:
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    timeout: TimeoutPolicy = field(default_factory=TimeoutPolicy)
    permission_profile: PermissionProfile = field(default_factory=PermissionProfile)


@dataclass(frozen=True)
class PromptPolicy:
    system_prompt: str | None = None
    user_prompt: str | None = None
    appendix_policy: str = "task_only"


@dataclass(frozen=True)
class ArtifactContract:
    required_paths: tuple[str, ...] = ()
    optional_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class RuntimeResult:
    status: RuntimeStatus
    summary: str
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    exit_code: int | None = None


# -- Callable & Node Models ---------------------------------------------------


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


ClassTemplate = AgentClassTemplate | ToolClassTemplate


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


ApprovalRejectStatus = Literal["failed", "skipped"]


@dataclass(frozen=True)
class NodeControlPolicy:
    require_human_approval: bool = False
    approval_prompt: str | None = None
    approval_reject_status: ApprovalRejectStatus = "failed"
    forward_main_output_on_control: bool | None = None


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
    runtime_policy: RuntimePolicy = field(default_factory=RuntimePolicy)
    prompt_policy: PromptPolicy = field(default_factory=PromptPolicy)
    control: NodeControlPolicy = field(default_factory=NodeControlPolicy)
    artifact_contract: ArtifactContract = field(default_factory=ArtifactContract)
    output_schema: dict[str, Any] | None = None
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
class ExecutionNode:
    node_id: str
    invocation: NodeInvocationSpec
    depends_on: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExecutionPlan:
    workflow_function_id: str
    schema_version: str
    nodes: tuple[ExecutionNode, ...]
    levels: tuple[tuple[str, ...], ...]


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
class ResultStoreAddress:
    run_id: str
    node_id: str
    port_id: str


@dataclass(frozen=True)
class NodeInvocationRun:
    node_id: str
    invocation_id: str
    scope_frame_id: str
    status: str
    session_id: str | None = None
    result_address: ResultStoreAddress | None = None
    failure_id: str | None = None


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    workflow_function_id: str
    invocation_id: str
    status: str
    event_log_path: Path
    result_store_root: Path
    started_at: str | None = None
    ended_at: str | None = None


@dataclass(frozen=True)
class EventRecord:
    event_id: str
    run_id: str
    type: str
    timestamp: str
    node_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


# -- Control Ledger Models ----------------------------------------------------

ControlPolicyMode = Literal["fixed", "supervisor", "handoff"]
RunPlanSource = Literal["fixed", "supervisor", "handoff", "replay"]
RunPlanStatus = Literal["proposed", "active", "completed", "failed", "cancelled"]
PlanStepSource = Literal["fixed", "supervisor", "handoff", "replay"]
PlanStepStatus = Literal[
    "pending",
    "ready",
    "waiting_interaction",
    "dispatching",
    "running",
    "success",
    "failed",
    "skipped",
    "cancelled",
]
DispatchStatus = Literal["pending", "started", "completed", "failed", "cancelled"]
DecisionKind = Literal[
    "compile_plan",
    "dispatch",
    "approval",
    "supervisor_plan",
    "handoff",
    "retry",
    "cancel",
    "no_action",
]
ReplayMode = Literal[
    "deterministic_recompile",
    "reuse_recorded_decisions",
    "require_reapproval",
    "disabled",
]
HandoffMode = Literal["new_session", "resume_session", "route_only"]
HandoffAcceptanceStatus = Literal[
    "pending",
    "accepted",
    "rejected",
    "timed_out",
    "not_required",
]


@dataclass(frozen=True)
class HandoffControlPolicy:
    policy_id: str
    actor: str
    source_node_id: str
    allowed_target_node_ids: tuple[str, ...] = ()
    allowed_target_callable_refs: tuple[CallableRef, ...] = ()
    allowed_modes: tuple[HandoffMode, ...] = ("new_session", "route_only")
    requires_acceptance: bool = False
    requires_human_approval: bool = False
    timeout_seconds: int | None = None
    fallback_target_node_id: str | None = None
    max_handoff_depth: int | None = None
    max_repeat_per_target: int | None = None
    replay_mode: ReplayMode = "reuse_recorded_decisions"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class HandoffRequest:
    handoff_id: str
    run_id: str
    run_plan_id: str
    source_plan_step_id: str
    source_node_id: str
    target_node_id: str
    target_callable_ref: CallableRef
    mode: HandoffMode
    input_payload: dict[str, Any] = field(default_factory=dict)
    payload_ref: str | None = None
    artifact_refs: tuple[str, ...] = ()
    acceptance_refs: tuple[str, ...] = ()
    scope_ref: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ControlPolicy:
    policy_id: str
    mode: ControlPolicyMode
    actor: str
    allowed_targets: tuple[str | CallableRef, ...] = ()
    requires_human_approval: bool = False
    allow_dynamic_dispatch: bool = False
    allow_handoff: bool = False
    max_dispatch_depth: int | None = None
    max_repeat_per_target: int | None = None
    max_concurrency: int | None = None
    replay_policy_ref: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RunPlan:
    run_plan_id: str
    run_id: str
    workflow_function_id: str
    invocation_id: str
    source: RunPlanSource
    schema_version: str
    template_snapshot_ref: str
    control_policy_id: str
    created_at: str
    status: RunPlanStatus
    step_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PlanStep:
    plan_step_id: str
    run_plan_id: str
    run_id: str
    node_id: str
    callable_ref: CallableRef
    depends_on: tuple[str, ...]
    source: PlanStepSource
    status: PlanStepStatus
    dependency_node_ids: tuple[str, ...] = ()
    input_snapshot_refs: tuple[str, ...] = ()
    required_interaction_id: str | None = None
    dispatch_id: str | None = None
    decision_id: str | None = None
    session_id: str | None = None
    artifact_bundle_id: str | None = None
    failure_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DispatchEnvelope:
    dispatch_id: str
    run_id: str
    run_plan_id: str
    plan_step_id: str
    node_id: str
    callable_ref: CallableRef
    scope_frame_id: str
    invocation_id: str
    idempotency_key: str
    correlation_id: str
    input_ref: str
    policy_snapshot_ref: str
    created_by_decision_id: str
    attempt: int
    created_at: str
    status: DispatchStatus
    result_refs: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DecisionRecord:
    decision_id: str
    run_id: str
    actor: str
    kind: DecisionKind
    timestamp: str
    input_evidence_refs: tuple[str, ...]
    run_plan_id: str | None = None
    policy_snapshot: dict[str, Any] = field(default_factory=dict)
    candidates: tuple[dict[str, Any], ...] = ()
    selected: dict[str, Any] = field(default_factory=dict)
    rejected: tuple[dict[str, Any], ...] = ()
    rationale: str | None = None
    result_refs: tuple[str, ...] = ()
    replay_binding: dict[str, Any] = field(default_factory=dict)
    correlation_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ReplayPolicy:
    replay_policy_id: str
    mode: ReplayMode
    template_snapshot_required: bool
    reuse_human_answers: bool = True
    reuse_supervisor_decisions: bool = True
    reuse_handoff_decisions: bool = True
    graphops_apply_allowed: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PlanStepTransitionRecord:
    sequence: int
    recorded_at: str
    plan_step_id: str
    previous_status: PlanStepStatus | None
    next_status: PlanStepStatus
    snapshot: PlanStep
    reason: str
    decision_id: str | None = None
    dispatch_id: str | None = None


@dataclass(frozen=True)
class DispatchTransitionRecord:
    sequence: int
    recorded_at: str
    dispatch_id: str
    previous_status: DispatchStatus | None
    next_status: DispatchStatus
    snapshot: DispatchEnvelope
    reason: str
    decision_id: str | None = None
    plan_step_id: str | None = None


@dataclass(frozen=True)
class ControlEventRecord:
    event_id: str
    type: str
    timestamp: str
    run_id: str
    scope_frame_id: str | None = None
    node_id: str | None = None
    session_id: str | None = None
    plan_step_id: str | None = None
    dispatch_id: str | None = None
    decision_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FailureRecord:
    failure_id: str
    run_id: str
    layer: RuntimeLayer
    message: str
    node_id: str | None = None
    related_ids: dict[str, str] = field(default_factory=dict)
    evidence_paths: tuple[Path, ...] = ()


# -- Event Models -------------------------------------------------------------


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


# -- Interaction & Supervisor Models ------------------------------------------

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
