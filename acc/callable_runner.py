from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.adapters.base import AgentAdapter, AgentRunRequest
from acc.adapters.claude_sdk import ClaudeSdkAdapter
from acc.adapters.codex_cli import CodexCliAdapter, build_codex_command
from acc.adapters.generic_cli import GenericCliAdapter
from acc.callable_registry import CallableAsset
from acc.domain import (
    AccError,
    AgentClassTemplate,
    NodeInvocationSpec,
    PermissionProfile,
    ScopeFrame,
    SessionInstance,
)

PRODUCTION_RUN_MODE = "production"
HERMETIC_RUN_MODE = "hermetic"
DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS = 900


class CallableClassRunner:
    """Execute resolved class templates through Core v2 adapters."""

    async def run_agent_class(
        self,
        asset: CallableAsset,
        input_payload: dict[str, Any],
        run_dir: Path,
        execution_context: Any,
    ) -> dict[str, Any]:
        template = asset.template
        if not isinstance(template, AgentClassTemplate):
            raise AccError(f"Callable asset is not an AgentClassTemplate: {asset.source_id}")
        context = AgentExecutionContext.from_value(execution_context)
        write_json(run_dir / "agent_payload.json", input_payload)
        write_json(run_dir / "input.json", input_payload)
        schema = output_schema_for_agent(template)
        write_json(run_dir / "output_schema.json", schema)
        prompt = render_agent_prompt(template, context.node, input_payload)
        (run_dir / "resolved_prompt.md").write_text(prompt, encoding="utf-8")

        mode = acc_run_mode()
        if mode == HERMETIC_RUN_MODE:
            output = hermetic_stub_output(template, context.node, input_payload)
            write_json(run_dir / "output.json", output)
            write_json(
                run_dir / "runtime.json",
                runtime_payload(
                    template,
                    context,
                    mode="hermetic_stub",
                    command=[],
                    exit_code=0,
                    permissions=PermissionProfile(),
                    binding_materializations=context.binding_materializations,
                ),
            )
            return output

        if not external_agent_execution_enabled():
            raise AccError(
                "External agent execution is disabled. Set "
                "ACC_RUN_MODE=production and ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1 "
                f"to run {template.runtime!r} for {template.id!r}."
            )

        permissions = effective_permission_profile(template, context.node)
        sandbox = codex_sandbox_for_permissions(permissions)
        request = AgentRunRequest(
            callable_id=template.id,
            run_dir=run_dir,
            workspace_dir=context.scope.workspace_root,
            prompt_path=run_dir / "resolved_prompt.md",
            input_payload=input_payload,
            output_schema_path=run_dir / "output_schema.json",
            timeout_seconds=effective_timeout_seconds(template, context.node),
            command=adapter_command(template),
            args_base=adapter_args_base(template),
            sandbox=sandbox,
            allow_dangerous=permissions.dangerous,
            bypass_approvals_and_sandbox=permissions.dangerous,
            enable_search=permissions.network,
            session_id=context.session.session_id,
            inbox_dir=context.scope.inbox_root,
            outbox_dir=context.scope.outbox_root,
            environment_id=context.scope.frame_id,
            node_id=context.node.id,
            run_id=context.scope.environment_root.name,
            cancel_path=context.scope.environment_root / "cancel_requested",
        )
        adapter = AgentAdapterDispatcher().resolve(template.runtime)
        command = command_preview(template.runtime, request)
        write_json(
            run_dir / "runtime.json",
            runtime_payload(
                template,
                context,
                mode=PRODUCTION_RUN_MODE,
                command=command,
                exit_code=None,
                permissions=permissions,
                binding_materializations=context.binding_materializations,
            ),
        )
        result = await adapter.run(request)
        update_runtime_json(
            run_dir / "runtime.json",
            {"exit_code": result.exit_code, "adapter_status": result.status},
        )
        if result.status != "success":
            raise AccError(result.error or result.summary or "codex_cli adapter failed")
        try:
            output = json.loads(request.output_json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AccError(f"codex output.json invalid or missing: {exc}") from exc
        if not isinstance(output, dict):
            raise AccError("codex output.json must be a JSON object")
        validate_output_schema(output, schema)
        return output


class AgentExecutionContext:
    def __init__(
        self,
        *,
        node: NodeInvocationSpec,
        scope: ScopeFrame,
        session: SessionInstance,
        binding_materializations: list[dict[str, Any]],
    ) -> None:
        self.node = node
        self.scope = scope
        self.session = session
        self.binding_materializations = binding_materializations

    @classmethod
    def from_value(cls, value: Any) -> AgentExecutionContext:
        if isinstance(value, cls):
            return value
        if isinstance(value, dict):
            return cls(
                node=value["node"],
                scope=value["scope"],
                session=value["session"],
                binding_materializations=list(value.get("binding_materializations") or []),
            )
        raise AccError("Agent execution context is required for Core v2 adapter dispatch")


def acc_run_mode() -> str:
    value = os.getenv("ACC_RUN_MODE", HERMETIC_RUN_MODE).strip().lower()
    if value in {HERMETIC_RUN_MODE, "test", "ci"}:
        return HERMETIC_RUN_MODE
    return PRODUCTION_RUN_MODE


def external_agent_execution_enabled() -> bool:
    return os.getenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


class AgentAdapterDispatcher:
    """Resolve an agent runtime name to an external adapter."""

    def resolve(self, runtime: str) -> AgentAdapter:
        if runtime == "codex_cli":
            return CodexCliAdapter()
        if runtime == "generic_cli":
            return GenericCliAdapter()
        if runtime == "claude_sdk":
            return ClaudeSdkAdapter()
        raise AccError(f"Unsupported production agent runtime {runtime!r}")


def adapter_command(template: AgentClassTemplate) -> str | None:
    command = template.metadata.get("command")
    return str(command) if isinstance(command, str) and command else None


def adapter_args_base(template: AgentClassTemplate) -> list[str]:
    if template.runtime == "codex_cli":
        return ["exec"]
    raw_args = template.metadata.get("args_base") or template.metadata.get("args")
    if isinstance(raw_args, list):
        return [str(item) for item in raw_args]
    return []


def command_preview(runtime: str, request: AgentRunRequest) -> list[str]:
    if runtime == "codex_cli":
        return build_codex_command(request)
    if request.command:
        return [request.command, *request.args_base]
    return []


def effective_permission_profile(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
) -> PermissionProfile:
    default_profile = PermissionProfile()
    if node.invocation_policy.permission_profile is not None:
        return node.invocation_policy.permission_profile
    if node.overrides.permission_profile is not None:
        return node.overrides.permission_profile
    if node.runtime_policy.permission_profile != default_profile:
        return node.runtime_policy.permission_profile
    return template.default_permissions


def codex_sandbox_for_permissions(profile: PermissionProfile) -> str:
    if profile.dangerous:
        return "danger-full-access"
    if profile.workspace_access in {"writes_workspace", "writes_run_only"}:
        return "workspace-write"
    return "read-only"


def output_schema_for_agent(template: AgentClassTemplate) -> dict[str, Any]:
    raw_schema = template.artifact_contract.get("output_schema")
    if isinstance(raw_schema, dict):
        return raw_schema
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string"},
            "summary": {"type": "string"},
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "evidence": {"type": "array", "items": {"type": "string"}},
                        "sources": {"type": "array", "items": {"type": "string"}},
                        "confidence": {"type": "string"},
                    },
                    "required": ["title", "detail", "evidence", "sources", "confidence"],
                },
            },
            "analysis": {"type": "string"},
            "sources": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "url": {"type": "string"},
                        "publisher": {"type": "string"},
                        "published_at": {"type": "string"},
                        "accessed_at": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": [
                        "title",
                        "url",
                        "publisher",
                        "published_at",
                        "accessed_at",
                        "note",
                    ],
                },
            },
            "confidence": {"type": "string"},
            "uncertainties": {"type": "array", "items": {"type": "string"}},
            "artifacts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "path": {"type": "string"},
                        "type": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["name", "path", "type", "description"],
                },
            },
        },
        "required": [
            "status",
            "summary",
            "findings",
            "analysis",
            "sources",
            "confidence",
            "uncertainties",
            "artifacts",
        ],
    }


def render_agent_prompt(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
    input_payload: dict[str, Any],
) -> str:
    user_prompt = node.prompt_policy.user_prompt or node.overrides.prompt or ""
    input_json = json.dumps(input_payload, ensure_ascii=False, indent=2, sort_keys=True)
    return "\n".join(
        [
            "# Agent Methodology",
            "",
            template.default_prompt or "",
            "",
            "# User Task",
            "",
            user_prompt,
            "",
            "# ACC Runtime Input",
            "",
            "```json",
            input_json,
            "```",
            "",
            "# Output Contract",
            "",
            "Return exactly one JSON object matching the provided output schema.",
            "",
        ]
    )


def effective_timeout_seconds(template: AgentClassTemplate, node: NodeInvocationSpec) -> int:
    if node.invocation_policy.timeout_seconds is not None:
        return int(node.invocation_policy.timeout_seconds)
    if node.overrides.timeout_seconds is not None:
        return int(node.overrides.timeout_seconds)
    if node.runtime_policy.timeout.seconds is not None:
        return int(node.runtime_policy.timeout.seconds)
    if template.runtime == "codex_cli" and acc_run_mode() == PRODUCTION_RUN_MODE:
        raw_value = os.getenv("ACC_CODEX_TIMEOUT_SECONDS")
        if raw_value:
            try:
                value = int(raw_value)
            except ValueError as exc:
                raise AccError("ACC_CODEX_TIMEOUT_SECONDS must be an integer") from exc
            if value <= 0:
                raise AccError("ACC_CODEX_TIMEOUT_SECONDS must be positive")
            return value
        return DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS
    return int(template.default_permissions.timeout_seconds or 60)


def hermetic_stub_output(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
    input_payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": "success",
        "summary": f"Callable agent_class:{template.id} executed in hermetic stub mode",
        "findings": [],
        "analysis": json.dumps(
            {
                "node_id": node.id,
                "callable_id": template.id,
                "input": input_payload,
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        "sources": [],
        "confidence": "hermetic_stub",
        "uncertainties": ["External codex_cli execution was disabled by ACC_RUN_MODE=hermetic."],
        "artifacts": [],
    }


def validate_output_schema(output: dict[str, Any], schema: dict[str, Any]) -> None:
    try:
        Draft202012Validator(schema).validate(output)
    except JsonSchemaValidationError as exc:
        raise AccError(f"codex output.json failed schema validation: {exc.message}") from exc


def runtime_payload(
    template: AgentClassTemplate,
    context: AgentExecutionContext,
    *,
    mode: str,
    command: list[str],
    exit_code: int | None,
    permissions: PermissionProfile,
    binding_materializations: list[dict[str, Any]],
) -> dict[str, Any]:
    run_dir = context.session.output_path.parent
    return {
        "execution_mode": mode,
        "adapter": template.runtime,
        "callable_id": template.id,
        "node_id": context.node.id,
        "command_argv_redacted": command,
        "workspace_dir": str(context.scope.workspace_root.resolve()),
        "prompt_path": str((run_dir / "resolved_prompt.md").resolve()),
        "input_path": str((run_dir / "agent_payload.json").resolve()),
        "output_schema_path": str((run_dir / "output_schema.json").resolve()),
        "output_path": str((run_dir / "output.json").resolve()),
        "exit_code": exit_code,
        "permissions_effective": {
            "workspace_access": permissions.workspace_access,
            "network": permissions.network,
            "shell": permissions.shell,
            "dangerous": permissions.dangerous,
            "sandbox": codex_sandbox_for_permissions(permissions),
        },
        "binding_materializations": binding_materializations,
    }


def update_runtime_json(path: Path, updates: dict[str, Any]) -> None:
    payload: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload = loaded
        except json.JSONDecodeError:
            payload = {}
    payload.update(updates)
    write_json(path, payload)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
