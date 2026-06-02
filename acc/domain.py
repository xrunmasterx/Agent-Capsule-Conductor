from __future__ import annotations

import enum
from dataclasses import dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from acc.binding.selector import Selector

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
    "succeeded",
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
CORE_CALLABLE_KINDS: frozenset[str] = frozenset(
    {"agent_class", "tool_class", "workflow_function"}
)
EXECUTABLE_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "input" + "_mapping",
        "legacy" + "_value_edges",
        "legacy" + "_passthrough",
        "upstream" + "_context",
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
    }
)


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
    runtime_policy: RuntimePolicy = field(default_factory=RuntimePolicy)
    prompt_policy: PromptPolicy = field(default_factory=PromptPolicy)
    artifact_contract: ArtifactContract = field(default_factory=ArtifactContract)
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


@dataclass(frozen=True)
class FailureRecord:
    failure_id: str
    run_id: str
    layer: RuntimeLayer
    message: str
    node_id: str | None = None
    related_ids: dict[str, str] = field(default_factory=dict)
    evidence_paths: tuple[Path, ...] = ()


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


# ---------------------------------------------------------------------------
# DESIGN §7.6 / STRATEGY §6.1 PR-1.5 — 5 binding kinds + legacy union.
#
# Phase 1 substrate-only: these new selector-shaped binding dataclasses are
# additive. The pre-existing NodeInputBinding / NodeOutputBinding /
# WorkflowOutputBinding / WorkflowCallInputBinding above are intentionally
# preserved verbatim for backward compatibility with the current
# .accflow.json runtime (node_invocation.py, workflow_call.py); the new
# variants are exported under a "V2" suffix to avoid silently shadowing
# them. BindingResolver dispatches by the ``kind`` discriminator.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NodeInputBindingV2:
    kind: Literal["selector"] = "selector"
    target_field: str = ""
    selector: Selector | None = None


@dataclass(frozen=True)
class WorkflowInputBindingV2:
    kind: Literal["selector"] = "selector"
    target_field: str = ""
    selector: Selector | None = None


@dataclass(frozen=True)
class NodeOutputBindingV2:
    kind: Literal["selector"] = "selector"
    source_port_id: str = ""
    target_field: str = ""


@dataclass(frozen=True)
class WorkflowOutputBindingV2:
    kind: Literal["selector"] = "selector"
    source_node_id: str = ""
    source_port_id: str = ""
    target_field: str = ""


@dataclass(frozen=True)
class WorkflowCallInputBindingV2:
    kind: Literal["selector"] = "selector"
    target_field: str = ""
    selector: Selector | None = None


InputBinding = NodeInputBindingV2


class PromptAppendixPolicy(enum.StrEnum):
    TASK_ONLY = "task_only"
    NONE = "none"


def workflow_function_template_to_dict(template: WorkflowFunctionTemplate) -> dict[str, Any]:
    return {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": template.id,
        "version": template.version,
        "nodes": [
            node_invocation_to_wire_dict(node)
            for node in template.node_invocations.values()
        ],
        "control_edges": [
            {
                "from": edge.source,
                "to": edge.target,
                **({"condition": edge.condition} if edge.condition else {}),
                "context": edge.context,
            }
            for edge in template.control_edges
        ],
        "data_edges": _to_jsonable(template.data_edges),
        "exposed_inputs": _to_jsonable(template.exposed_inputs),
        "exposed_outputs": _to_jsonable(template.exposed_outputs),
        "workflow_input_bindings": _to_jsonable(template.workflow_input_bindings),
        "workflow_output_bindings": _to_jsonable(template.workflow_output_bindings),
        "policies": _to_jsonable(template.policies),
        "metadata": _to_jsonable(template.metadata),
    }


def node_invocation_to_wire_dict(node: NodeInvocationSpec) -> dict[str, Any]:
    payload = _to_jsonable(node)
    payload["ports"] = {
        "inputs": payload.pop("input_ports", {}),
        "outputs": payload.pop("output_ports", {}),
    }
    return payload


def workflow_function_template_from_dict(payload: dict[str, Any]) -> WorkflowFunctionTemplate:
    schema_version = payload.get("schema_version")
    if schema_version != CORE_V2_SCHEMA_VERSION:
        raise AccError(f"Unsupported schema_version: {schema_version}")
    nodes_payload = payload.get("nodes")
    if isinstance(nodes_payload, list):
        node_items = {
            str(item.get("id") or ""): item
            for item in nodes_payload
            if isinstance(item, dict)
        }
    else:
        legacy_nodes_payload = payload.get("node_invocations")
        if not isinstance(legacy_nodes_payload, dict):
            raise AccError("WorkflowFunctionTemplate nodes must be an array")
        node_items = legacy_nodes_payload
    return WorkflowFunctionTemplate(
        id=_required_string(payload, "id"),
        version=_required_string(payload, "version"),
        node_invocations={
            node_id: _node_invocation_from_dict(node_payload)
            for node_id, node_payload in node_items.items()
            if isinstance(node_id, str) and isinstance(node_payload, dict)
        },
        control_edges=[
            _control_edge_from_dict(edge)
            for edge in _required_list(payload.get("control_edges"), "control_edges")
        ],
        data_edges=[
            _data_edge_from_dict(edge)
            for edge in _required_list(payload.get("data_edges"), "data_edges")
        ],
        exposed_inputs=_port_map_from_dict(payload.get("exposed_inputs")),
        exposed_outputs=_port_map_from_dict(payload.get("exposed_outputs")),
        workflow_input_bindings=[
            _workflow_input_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_input_bindings"),
                "workflow_input_bindings",
            )
        ],
        workflow_output_bindings=[
            _workflow_output_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_output_bindings"),
                "workflow_output_bindings",
            )
        ],
        policies=_dict_or_empty(payload.get("policies"), "policies"),
        metadata=_dict_or_empty(payload.get("metadata"), "metadata"),
        source_path=Path(str(payload["source_path"])) if payload.get("source_path") else None,
    )


def execution_plan_to_dict(plan: ExecutionPlan) -> dict[str, Any]:
    return _to_jsonable(plan)


def validate_core_v2_workflow_function_template(template: WorkflowFunctionTemplate) -> None:
    if not template.id:
        raise AccError("WorkflowFunctionTemplate.id is required")
    if not template.version:
        raise AccError("WorkflowFunctionTemplate.version is required")
    _reject_executable_metadata(template.metadata, "workflow metadata")
    _reject_executable_metadata(template.policies, "workflow policies")
    node_ids = set(template.node_invocations)
    if not node_ids:
        raise AccError("WorkflowFunctionTemplate requires at least one node invocation")
    for node_id, node in template.node_invocations.items():
        if node.id != node_id:
            raise AccError(f"node key {node_id!r} does not match node id {node.id!r}")
        validate_core_v2_node_invocation_spec(node, node_ids=node_ids)
    for edge in template.control_edges:
        if edge.context != "none":
            raise AccError("Core v2 control edges must not carry data context")
        if edge.source not in node_ids or edge.target not in node_ids:
            raise AccError("Control edge references a missing node")
    for edge in template.data_edges:
        if edge.source.node not in node_ids or edge.target.node not in node_ids:
            raise AccError("Data edge references a missing node")
    for binding in template.workflow_output_bindings:
        if binding.source.node not in node_ids:
            raise AccError("Workflow output binding references a missing node")


def validate_core_v2_execution_plan(plan: ExecutionPlan) -> None:
    if plan.schema_version != CORE_V2_SCHEMA_VERSION:
        raise AccError(f"Unsupported ExecutionPlan schema_version: {plan.schema_version}")
    seen: set[str] = set()
    for node in plan.nodes:
        if node.node_id in seen:
            raise AccError(f"ExecutionPlan contains duplicate node id: {node.node_id}")
        seen.add(node.node_id)
        if node.invocation.id != node.node_id:
            raise AccError("ExecutionNode id must match its NodeInvocationSpec id")
        validate_core_v2_node_invocation_spec(node.invocation)
    unknown_level_nodes = {
        node_id for level in plan.levels for node_id in level if node_id not in seen
    }
    if unknown_level_nodes:
        raise AccError("ExecutionPlan level references a missing node")


def validate_core_v2_node_invocation_spec(
    node: NodeInvocationSpec,
    *,
    node_ids: set[str] | None = None,
) -> None:
    if not node.id:
        raise AccError("NodeInvocationSpec.id is required")
    validate_core_v2_callable_ref(node.callable_ref)
    _reject_executable_metadata(node.metadata, f"node {node.id} metadata")
    _validate_permission_profile(
        node.runtime_policy.permission_profile,
        f"node {node.id} runtime permission profile",
    )
    if node.invocation_policy.permission_profile is not None:
        _validate_permission_profile(
            node.invocation_policy.permission_profile,
            f"node {node.id} invocation permission profile",
        )
    if node.overrides.permission_profile is not None:
        _validate_permission_profile(
            node.overrides.permission_profile,
            f"node {node.id} override permission profile",
        )
    _validate_artifact_contract(node.artifact_contract, f"node {node.id} artifact contract")
    for binding in node.input_bindings:
        source = getattr(binding, "source", None)
        if node_ids is not None and source is not None and source.node not in node_ids:
            raise AccError("Input binding references a missing source node")
    for binding in node.workflow_call_input_bindings:
        if (
            node_ids is not None
            and binding.source is not None
            and binding.source.node not in node_ids
        ):
            raise AccError("Workflow call input binding references a missing source node")


def validate_core_v2_callable_ref(ref: CallableRef) -> None:
    if ref.kind not in CORE_CALLABLE_KINDS:
        raise AccError(f"Unsupported Core v2 callable kind: {ref.kind}")
    if not ref.id:
        raise AccError("CallableRef.id is required")


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: _to_jsonable(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    return value


def _node_invocation_from_dict(payload: dict[str, Any]) -> NodeInvocationSpec:
    input_ports, output_ports = _node_ports_from_dict(payload)
    return NodeInvocationSpec(
        id=_required_string(payload, "id"),
        callable_ref=_callable_ref_from_dict(
            _required_dict(payload.get("callable_ref"), "callable_ref")
        ),
        overrides=_callable_override_from_dict(payload.get("overrides")),
        input_bindings=[
            _node_input_binding_from_dict(binding)
            for binding in _required_list(payload.get("input_bindings"), "input_bindings")
        ],
        output_bindings=[
            _node_output_binding_from_dict(binding)
            for binding in _required_list(payload.get("output_bindings"), "output_bindings")
        ],
        workflow_call_input_bindings=[
            _workflow_call_input_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_call_input_bindings"),
                "workflow_call_input_bindings",
            )
        ],
        workflow_call_output_bindings=[
            _workflow_call_output_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_call_output_bindings"),
                "workflow_call_output_bindings",
            )
        ],
        environment_policy=str(payload.get("environment_policy") or "inherit_parent"),  # type: ignore[arg-type]
        invocation_policy=_invocation_policy_from_dict(payload.get("invocation_policy")),
        runtime_policy=_runtime_policy_from_dict(payload.get("runtime_policy")),
        prompt_policy=_prompt_policy_from_dict(payload.get("prompt_policy")),
        artifact_contract=_artifact_contract_from_dict(payload.get("artifact_contract")),
        input_ports=input_ports,
        output_ports=output_ports,
        metadata=_dict_or_empty(payload.get("metadata"), "metadata"),
    )


def _callable_ref_from_dict(payload: dict[str, Any]) -> CallableRef:
    version = payload.get("version")
    return CallableRef(
        kind=str(payload.get("kind") or ""),  # type: ignore[arg-type]
        id=_required_string(payload, "id"),
        version=version if isinstance(version, str) else None,
    )


def _callable_override_from_dict(value: Any) -> CallableOverride:
    payload = _dict_or_empty(value, "overrides")
    return CallableOverride(
        prompt=payload.get("prompt") if isinstance(payload.get("prompt"), str) else None,
        permission_profile=_permission_profile_from_dict(payload.get("permission_profile")),
        timeout_seconds=payload.get("timeout_seconds")
        if isinstance(payload.get("timeout_seconds"), int)
        else None,
        retry=_dict_or_empty(payload.get("retry"), "retry"),
        static_input=_dict_or_empty(payload.get("static_input"), "static_input"),
        behavior_overlay=_dict_or_empty(payload.get("behavior_overlay"), "behavior_overlay"),
    )


def _permission_profile_from_dict(value: Any) -> PermissionProfile | None:
    if value is None:
        return None
    payload = _required_dict(value, "permission_profile")
    return PermissionProfile(
        workspace_access=str(payload.get("workspace_access") or "read_only"),  # type: ignore[arg-type]
        network=bool(payload.get("network", False)),
        shell=bool(payload.get("shell", False)),
        dangerous=bool(payload.get("dangerous", False)),
        env_policy=str(payload.get("env_policy") or "acc_whitelist"),  # type: ignore[arg-type]
        allowed_env=tuple(str(item) for item in payload.get("allowed_env") or []),
        timeout_seconds=int(payload.get("timeout_seconds") or 60),
    )


def _runtime_policy_from_dict(value: Any) -> RuntimePolicy:
    payload = _dict_or_empty(value, "runtime_policy")
    retry = _dict_or_empty(payload.get("retry"), "runtime_policy.retry")
    timeout = _dict_or_empty(payload.get("timeout"), "runtime_policy.timeout")
    permission_profile = _permission_profile_from_dict(payload.get("permission_profile"))
    return RuntimePolicy(
        retry=RetryPolicy(
            max_attempts=int(retry.get("max_attempts") or 1),
            backoff_seconds=float(retry.get("backoff_seconds") or 0.0),
        ),
        timeout=TimeoutPolicy(
            seconds=timeout.get("seconds") if isinstance(timeout.get("seconds"), int) else None
        ),
        permission_profile=permission_profile or PermissionProfile(),
    )


def _prompt_policy_from_dict(value: Any) -> PromptPolicy:
    payload = _dict_or_empty(value, "prompt_policy")
    return PromptPolicy(
        system_prompt=payload.get("system_prompt")
        if isinstance(payload.get("system_prompt"), str)
        else None,
        user_prompt=payload.get("user_prompt")
        if isinstance(payload.get("user_prompt"), str)
        else None,
        appendix_policy=str(payload.get("appendix_policy") or "task_only"),
    )


def _artifact_contract_from_dict(value: Any) -> ArtifactContract:
    payload = _dict_or_empty(value, "artifact_contract")
    return ArtifactContract(
        required_paths=tuple(str(item) for item in payload.get("required_paths") or []),
        optional_paths=tuple(str(item) for item in payload.get("optional_paths") or []),
    )


def _invocation_policy_from_dict(value: Any) -> InvocationPolicy:
    payload = _dict_or_empty(value, "invocation_policy")
    return InvocationPolicy(
        retry=_dict_or_empty(payload.get("retry"), "invocation_policy.retry"),
        timeout_seconds=payload.get("timeout_seconds")
        if isinstance(payload.get("timeout_seconds"), int)
        else None,
        permission_profile=_permission_profile_from_dict(payload.get("permission_profile")),
    )


def _node_input_binding_from_dict(payload: dict[str, Any]) -> NodeInputBinding:
    source_payload = payload.get("source")
    return NodeInputBinding(
        source=_data_endpoint_from_dict(source_payload)
        if isinstance(source_payload, dict)
        else None,
        target_port=str(payload.get("target_port") or "main"),
        static_value=payload.get("static_value"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _node_output_binding_from_dict(payload: dict[str, Any]) -> NodeOutputBinding:
    target_payload = payload.get("target")
    return NodeOutputBinding(
        source_port=str(payload.get("source_port") or "main"),
        target=_data_endpoint_from_dict(target_payload)
        if isinstance(target_payload, dict)
        else None,
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_input_binding_from_dict(payload: dict[str, Any]) -> WorkflowInputBinding:
    return WorkflowInputBinding(
        source_port=_required_string(payload, "source_port"),
        target=_data_endpoint_from_dict(_required_dict(payload.get("target"), "target")),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_output_binding_from_dict(payload: dict[str, Any]) -> WorkflowOutputBinding:
    return WorkflowOutputBinding(
        source=_data_endpoint_from_dict(_required_dict(payload.get("source"), "source")),
        target_port=_required_string(payload, "target_port"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_call_input_binding_from_dict(payload: dict[str, Any]) -> WorkflowCallInputBinding:
    source_payload = payload.get("source")
    return WorkflowCallInputBinding(
        source=_data_endpoint_from_dict(source_payload)
        if isinstance(source_payload, dict)
        else None,
        workflow_input=str(payload.get("workflow_input") or "main"),
        static_value=payload.get("static_value"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_call_output_binding_from_dict(payload: dict[str, Any]) -> WorkflowCallOutputBinding:
    return WorkflowCallOutputBinding(
        workflow_output=_required_string(payload, "workflow_output"),
        parent_port=_required_string(payload, "parent_port"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _control_edge_from_dict(payload: dict[str, Any]) -> ControlEdge:
    return ControlEdge(
        source=_required_string(payload, "source")
        if isinstance(payload.get("source"), str)
        else _required_string(payload, "from"),
        target=_required_string(payload, "target")
        if isinstance(payload.get("target"), str)
        else _required_string(payload, "to"),
        condition=payload.get("condition") if isinstance(payload.get("condition"), str) else None,
        context=str(payload.get("context") or "none"),  # type: ignore[arg-type]
    )


def _data_edge_from_dict(payload: dict[str, Any]) -> DataEdge:
    return DataEdge(
        source=_data_endpoint_from_dict(_required_dict(payload.get("source"), "source")),
        target=_data_endpoint_from_dict(_required_dict(payload.get("target"), "target")),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
    )


def _data_endpoint_from_dict(payload: dict[str, Any]) -> DataEndpoint:
    return DataEndpoint(
        node=_required_string(payload, "node"),
        port=_required_string(payload, "port"),
    )


def _port_map_from_dict(value: Any, direction: str = "input") -> dict[str, PortContract]:
    payload = _dict_or_empty(value, "ports")
    return {
        port_id: PortContract(
            id=str(port_payload.get("id") or port_id),
            direction=str(port_payload.get("direction") or direction),  # type: ignore[arg-type]
            type=str(port_payload.get("type") or "artifact"),
            required=bool(port_payload.get("required", False)),
            cardinality=str(port_payload.get("cardinality") or "one"),
        )
        for port_id, port_payload in payload.items()
        if isinstance(port_id, str) and isinstance(port_payload, dict)
    }


def _node_ports_from_dict(
    payload: dict[str, Any],
) -> tuple[dict[str, PortContract], dict[str, PortContract]]:
    ports = payload.get("ports")
    if isinstance(ports, dict):
        return (
            _port_map_from_dict(ports.get("inputs"), "input"),
            _port_map_from_dict(ports.get("outputs"), "output"),
        )
    return (
        _port_map_from_dict(payload.get("input_ports"), "input"),
        _port_map_from_dict(payload.get("output_ports"), "output"),
    )


def _reject_executable_metadata(payload: dict[str, Any], label: str) -> None:
    for key, value in payload.items():
        if key in EXECUTABLE_METADATA_KEYS or key.startswith("legacy_"):
            raise AccError(f"{label} contains executable metadata key: {key}")
        if isinstance(value, dict):
            _reject_executable_metadata(value, f"{label}.{key}")


def _validate_artifact_contract(contract: ArtifactContract, label: str) -> None:
    for raw_path in (*contract.required_paths, *contract.optional_paths):
        path = Path(raw_path)
        if path.is_absolute() or ".." in path.parts:
            raise AccError(f"{label} contains unsafe artifact path: {raw_path}")


def _validate_permission_profile(profile: PermissionProfile, label: str) -> None:
    if profile.workspace_access not in {"read_only", "writes_run_only", "writes_workspace"}:
        raise AccError(f"{label} has invalid workspace_access")
    if profile.env_policy not in {"acc_whitelist", "explicit_allowlist"}:
        raise AccError(f"{label} has invalid env_policy")
    if profile.timeout_seconds <= 0:
        raise AccError(f"{label} timeout_seconds must be positive")
    if "ALL" in profile.allowed_env or "*" in profile.allowed_env:
        raise AccError(f"{label} must not allow the full host environment")


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{key} must be a non-empty string")
    return value


def _required_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccError(f"{label} must be an object")
    return value


def _dict_or_empty(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"{label} must be an object")
    return value


def _required_list(value: Any, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise AccError(f"{label} must be an array of objects")
    return value
