from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

RuntimeType = Literal["generic_cli", "codex_cli", "claude_sdk"]
WorkspaceMode = Literal["existing_dir", "git_worktree_readonly", "git_worktree_write"]


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


class CapsuleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    version: str
    name: str
    description: str
    runtime: RuntimeSpec
    workspace: WorkspaceSpec = Field(default_factory=WorkspaceSpec)
    permissions: PermissionSpec
    prompt: PromptSpec
    schemas: SchemaSpec = Field(alias="schema")
    artifacts: ArtifactSpec
