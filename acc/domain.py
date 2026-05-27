from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

NodeKind = Literal["agent", "tool", "workflow"]
PortDirection = Literal["input", "output"]
MaterializationMode = Literal["copy", "reference", "symlink"]
ControlContextMode = Literal["upstream_output", "none"]
WorkspaceAccess = Literal["read_only", "writes_run_only", "writes_workspace"]
EnvPolicy = Literal["acc_whitelist", "explicit_allowlist"]
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
