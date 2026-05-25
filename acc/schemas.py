from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

RuntimeType = Literal["generic_cli", "codex_cli", "claude_sdk", "acc_workflow"]
WorkspaceMode = Literal["existing_dir", "git_worktree_readonly", "git_worktree_write"]
CapsuleKind = Literal[
    "atomic",
    "agent_session",
    "agent_workflow",
    "acc_workflow",
    "external_workflow",
]


class RuntimeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: RuntimeType
    command: str | None = None
    args_base: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def generic_cli_requires_command(self) -> RuntimeSpec:
        if self.type == "generic_cli" and not self.command:
            raise ValueError("generic_cli runtime requires command")
        return self


class WorkspaceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: WorkspaceMode = "existing_dir"
    repo_path_input: str | None = None
    base_ref: str | None = None
    allowed_paths: list[str] = Field(default_factory=list)


class PermissionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sandbox: str = "read-only"
    network: bool = False
    write_files: bool = False
    timeout_seconds: int
    allow_dangerous: bool = False

    @field_validator("timeout_seconds")
    @classmethod
    def timeout_must_be_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("timeout_seconds must be positive")
        return value

    @model_validator(mode="after")
    def reject_unapproved_dangerous_sandbox(self) -> PermissionSpec:
        if self.sandbox == "danger-full-access" and not self.allow_dangerous:
            raise ValueError("danger-full-access requires allow_dangerous=true")
        return self


class PromptSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: str


class SchemaSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str
    output: str


class ArtifactSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest: str


class BehaviorPackSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    root: str
    files: list[str] = Field(default_factory=list)


class LifecycleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setup: list[str] = Field(default_factory=list)
    run: list[str] = Field(default_factory=list)
    collect: list[str] = Field(default_factory=list)
    cleanup: list[str] = Field(default_factory=list)

    @field_validator("setup", "run", "collect", "cleanup")
    @classmethod
    def commands_must_not_be_blank(cls, value: list[str]) -> list[str]:
        if any(not command.strip() for command in value):
            raise ValueError("lifecycle commands must not be blank")
        return value


class WorkflowSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["acc_graph", "conductor", "custom"]
    path: str


class CapsuleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    version: str
    name: str
    description: str
    kind: CapsuleKind | None = None
    runtime: RuntimeSpec
    workspace: WorkspaceSpec = Field(default_factory=WorkspaceSpec)
    permissions: PermissionSpec
    prompt: PromptSpec | None = None
    schemas: SchemaSpec = Field(alias="schema")
    artifacts: ArtifactSpec
    behavior_pack: BehaviorPackSpec | None = None
    workflow: WorkflowSpec | None = None
    lifecycle: LifecycleSpec | None = None

    @model_validator(mode="after")
    def validate_workflow_capsule_requirements(self) -> CapsuleSpec:
        kind = self.kind or "agent_session"
        if kind == "agent_workflow" and self.behavior_pack is None:
            raise ValueError("agent_workflow capsule requires behavior_pack")
        if kind in {"acc_workflow", "external_workflow"} and self.workflow is None:
            raise ValueError(f"{kind} capsule requires workflow")
        return self
