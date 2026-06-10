from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.adapters.base import AgentAdapter, AgentRunRequest
from acc.adapters.claude_sdk import ClaudeSdkAdapter
from acc.adapters.codex_cli import CodexCliAdapter, build_codex_command
from acc.adapters.generic_cli import GenericCliAdapter
from acc.callable_registry import CallableAsset
from acc.models import (
    AccError,
    AgentClassTemplate,
    NodeInvocationSpec,
    PermissionProfile,
    ScopeFrame,
    SessionInstance,
)
from acc.runtime.policy import (
    HERMETIC_RUN_MODE,
    PRODUCTION_RUN_MODE,
    acc_run_mode,
    external_agent_execution_enabled,
    production_codex_app_server_timeout_seconds,
    production_codex_timeout_seconds,
)
from acc.store import write_json

CODEX_EXECUTION_MODE_METADATA_KEY = "codex_execution_mode"
CODEX_LOCAL_READONLY_NO_SANDBOX = "local_readonly_no_sandbox"
CODEX_DANGER_FULL_ACCESS = "danger_full_access"
CODEX_EXECUTION_MODES = {
    CODEX_LOCAL_READONLY_NO_SANDBOX,
    CODEX_DANGER_FULL_ACCESS,
}


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
        schema = output_schema_for_agent(template, context.node)
        schema_errors = structured_output_schema_errors(schema)
        if schema_errors:
            first_error = schema_errors[0]
            raise AccError(
                first_error.get("message")
                or "output_schema contains invalid JSON Schema for structured output"
            )
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


class AgentAdapterDispatcher:
    """Resolve an agent runtime name to an external adapter."""

    def resolve(self, runtime: str) -> AgentAdapter:
        if runtime == "codex_cli":
            return CodexCliAdapter()
        if runtime == "codex_app_server":
            raise AccError(
                "codex_app_server is a streaming runtime; use AgentTurnService instead"
            )
        if runtime == "generic_cli":
            return GenericCliAdapter()
        if runtime == "claude_sdk":
            return ClaudeSdkAdapter()
        raise AccError(f"Unsupported production agent runtime {runtime!r}")


def adapter_command(template: AgentClassTemplate) -> str | None:
    command = template.metadata.get("command")
    return str(command) if isinstance(command, str) and command else None


def adapter_args_base(template: AgentClassTemplate) -> list[str]:
    if template.runtime in {"codex_cli", "codex_app_server"}:
        return ["exec"]
    raw_args = template.metadata.get("args_base") or template.metadata.get("args")
    if isinstance(raw_args, list):
        return [str(item) for item in raw_args]
    return []


def command_preview(runtime: str, request: AgentRunRequest) -> list[str]:
    if runtime == "codex_cli":
        return build_codex_command(request)
    if runtime == "codex_app_server":
        return [request.command or "codex", "app-server", "--listen", "stdio://"]
    if request.command:
        return [request.command, *request.args_base]
    return []


def effective_permission_profile(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
) -> PermissionProfile:
    default_profile = PermissionProfile()
    codex_mode = codex_execution_mode_for_node(node)
    if codex_mode is not None:
        base_profile = (
            node.invocation_policy.permission_profile
            or node.overrides.permission_profile
            or (
                node.runtime_policy.permission_profile
                if node.runtime_policy.permission_profile != default_profile
                else None
            )
            or template.default_permissions
        )
        return permission_profile_for_codex_execution_mode(codex_mode, base_profile)
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


def codex_execution_mode_for_node(node: NodeInvocationSpec) -> str | None:
    raw_mode = node.metadata.get(CODEX_EXECUTION_MODE_METADATA_KEY)
    if not isinstance(raw_mode, str):
        return None
    mode = raw_mode.strip()
    return mode if mode in CODEX_EXECUTION_MODES else None


def permission_profile_for_codex_execution_mode(
    mode: str,
    base_profile: PermissionProfile,
) -> PermissionProfile:
    if mode == CODEX_LOCAL_READONLY_NO_SANDBOX:
        return PermissionProfile(
            workspace_access="read_only",
            network=False,
            shell=True,
            dangerous=True,
            env_policy=base_profile.env_policy,
            allowed_env=base_profile.allowed_env,
            timeout_seconds=base_profile.timeout_seconds,
        )
    if mode == CODEX_DANGER_FULL_ACCESS:
        return PermissionProfile(
            workspace_access="writes_workspace",
            network=True,
            shell=True,
            dangerous=True,
            env_policy=base_profile.env_policy,
            allowed_env=base_profile.allowed_env,
            timeout_seconds=base_profile.timeout_seconds,
        )
    return base_profile


DEFAULT_AGENT_OUTPUT_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "schema_version": {
            "type": "string",
            "enum": ["acc.agent.output.v1"],
            "description": "ACC agent output contract version.",
        },
        "status": {
            "type": "string",
            "enum": ["success", "partial", "failed"],
            "description": "Task-level result status, not the ACC runtime status.",
        },
        "summary": {
            "type": "string",
            "description": "Concise human-readable result summary.",
        },
        "report_markdown": {
            "type": "string",
            "description": "Detailed report content in Markdown. Empty string when not applicable.",
        },
        "findings": {
            "type": "array",
            "description": "Structured findings extracted from the work.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["info", "low", "medium", "high", "critical"],
                    },
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "recommendation": {"type": "string"},
                    "evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "confidence": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                },
                "required": [
                    "id",
                    "severity",
                    "title",
                    "detail",
                    "recommendation",
                    "evidence_ids",
                    "confidence",
                ],
            },
        },
        "evidence": {
            "type": "array",
            "description": "Evidence references used by findings or report.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "input",
                            "file",
                            "artifact",
                            "url",
                            "command",
                            "log",
                            "observation",
                        ],
                    },
                    "ref": {"type": "string"},
                    "note": {"type": "string"},
                    "quote": {"type": "string"},
                },
                "required": ["id", "kind", "ref", "note", "quote"],
            },
        },
        "artifacts": {
            "type": "array",
            "description": "Files or directories produced by the agent.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "json",
                            "markdown",
                            "text",
                            "html",
                            "image",
                            "pdf",
                            "directory",
                            "other",
                        ],
                    },
                    "path": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["id", "name", "kind", "path", "description"],
            },
        },
        "quality": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                },
                "assumptions": {"type": "array", "items": {"type": "string"}},
                "uncertainties": {"type": "array", "items": {"type": "string"}},
                "limitations": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["confidence", "assumptions", "uncertainties", "limitations"],
        },
        "next_actions": {
            "type": "array",
            "description": "Recommended follow-up actions.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "reason": {"type": "string"},
                    "owner": {
                        "type": "string",
                        "enum": ["human", "downstream_agent", "tool", "unknown"],
                    },
                },
                "required": ["title", "reason", "owner"],
            },
        },
        "outputs": {
            "type": "object",
            "description": "Named non-main output ports. Empty when only main is exposed.",
            "additionalProperties": False,
            "properties": {},
            "required": [],
        },
    },
    "required": [
        "schema_version",
        "status",
        "summary",
        "report_markdown",
        "findings",
        "evidence",
        "artifacts",
        "quality",
        "next_actions",
        "outputs",
    ],
}


def output_schema_for_agent(
    template: AgentClassTemplate,
    node: NodeInvocationSpec | None = None,
) -> dict[str, Any]:
    if node is not None and isinstance(node.output_schema, dict):
        return normalize_output_schema_for_structured_output(node.output_schema)
    raw_schema = template.artifact_contract.get("output_schema")
    if isinstance(raw_schema, dict):
        return normalize_output_schema_for_structured_output(raw_schema)
    return copy.deepcopy(DEFAULT_AGENT_OUTPUT_SCHEMA)


def render_agent_prompt(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
    input_payload: dict[str, Any],
) -> str:
    user_prompt = node.prompt_policy.user_prompt or node.overrides.prompt or ""
    input_json = json.dumps(input_payload, ensure_ascii=False, indent=2, sort_keys=True)
    output_schema = output_schema_for_agent(template, node)
    output_schema_json = json.dumps(output_schema, ensure_ascii=False, indent=2, sort_keys=True)
    local_readonly_contract = codex_local_readonly_prompt_contract(node)
    return "\n".join(
        [
            "# Agent Methodology",
            "",
            template.default_prompt or "",
            *(["", local_readonly_contract] if local_readonly_contract else []),
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
            "Return exactly one JSON object matching this output schema.",
            "Do not include properties that are not declared in this schema.",
            "Property names must match the schema exactly.",
            "",
            "```json",
            output_schema_json,
            "```",
            "",
        ]
    )


def codex_local_readonly_prompt_contract(node: NodeInvocationSpec) -> str:
    if codex_execution_mode_for_node(node) != CODEX_LOCAL_READONLY_NO_SANDBOX:
        return ""
    return "\n".join(
        [
            "# Local Read-Only No-Sandbox Contract",
            "",
            "You are running without an operating-system sandbox because the Codex read-only "
            "sandbox cannot read this local workspace reliably on this host.",
            "",
            "Hard rule: inspect and reason about files only. Do not create, edit, delete, move, "
            "rename, format, overwrite, stage, commit, or otherwise modify files or directories. "
            "Do not run commands whose purpose is to write files, change repository state, install "
            "packages, launch long-running services, or mutate the workspace.",
            "",
            "Allowed actions are read-only inspection commands such as listing files, searching "
            "text, and reading source files. If a useful answer would require a write or a "
            "state-changing command, explain the limitation instead of performing it.",
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
        return production_codex_timeout_seconds()
    if template.runtime == "codex_app_server" and acc_run_mode() == PRODUCTION_RUN_MODE:
        return production_codex_app_server_timeout_seconds()
    return int(template.default_permissions.timeout_seconds or 60)


def hermetic_stub_output(
    template: AgentClassTemplate,
    node: NodeInvocationSpec,
    input_payload: dict[str, Any],
) -> dict[str, Any]:
    report = json.dumps(
        {
            "node_id": node.id,
            "callable_id": template.id,
            "input": input_payload,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return {
        "schema_version": "acc.agent.output.v1",
        "status": "success",
        "summary": f"Callable agent_class:{template.id} executed in hermetic stub mode",
        "findings": [],
        "report_markdown": report,
        "evidence": [],
        "artifacts": [],
        "quality": {
            "confidence": "high",
            "assumptions": [],
            "uncertainties": [
                "External codex_cli execution was disabled by ACC_RUN_MODE=hermetic."
            ],
            "limitations": [],
        },
        "next_actions": [],
        "outputs": {},
    }


def validate_output_schema(output: dict[str, Any], schema: dict[str, Any]) -> None:
    try:
        Draft202012Validator(schema).validate(output)
    except (JsonSchemaValidationError, SchemaError) as exc:
        raise AccError(f"codex output.json failed schema validation: {exc.message}") from exc


def normalize_output_schema_for_structured_output(schema: dict[str, Any]) -> dict[str, Any]:
    normalized = strip_none_mapping_values(copy.deepcopy(schema))
    add_object_schema_guards(normalized)
    return normalized


def strip_none_mapping_values(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: strip_none_mapping_values(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, list):
        return [strip_none_mapping_values(item) for item in value]
    return value


def add_object_schema_guards(value: Any) -> None:
    if isinstance(value, dict):
        schema_type = value.get("type")
        if schema_type == "object" or (
            isinstance(schema_type, list) and "object" in schema_type
        ):
            value.setdefault("additionalProperties", False)
        for item in value.values():
            add_object_schema_guards(item)
    elif isinstance(value, list):
        for item in value:
            add_object_schema_guards(item)


def structured_output_schema_errors(schema: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    errors.extend(null_schema_keyword_errors(schema))
    try:
        Draft202012Validator.check_schema(schema)
    except (JsonSchemaValidationError, SchemaError) as exc:
        errors.append(
            {
                "code": "output_schema_invalid",
                "message": f"output_schema contains invalid JSON Schema: {exc.message}",
                "path": schema_error_path(exc),
                "repair_hint": output_schema_repair_hint(),
            }
        )
    return errors


def null_schema_keyword_errors(value: Any, path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        errors: list[dict[str, Any]] = []
        for key, item in value.items():
            next_path = (*path, str(key))
            if item is None:
                errors.append(
                    {
                        "code": "output_schema_invalid",
                        "message": (
                            "output_schema contains invalid JSON Schema at "
                            f"{format_schema_path(next_path)}"
                        ),
                        "path": format_schema_path(next_path),
                        "repair_hint": output_schema_repair_hint(),
                    }
                )
            else:
                errors.extend(null_schema_keyword_errors(item, next_path))
        return errors
    if isinstance(value, list):
        errors = []
        for index, item in enumerate(value):
            if isinstance(item, (dict, list)):
                errors.extend(null_schema_keyword_errors(item, (*path, str(index))))
        return errors
    return []


def schema_error_path(exc: JsonSchemaValidationError) -> str:
    path = [str(item) for item in exc.absolute_schema_path]
    return format_schema_path(tuple(path))


def format_schema_path(path: tuple[str, ...]) -> str:
    return ".".join(path) if path else "$"


def output_schema_repair_hint() -> str:
    return "Remove items from non-array properties; use items only when type is array."


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
    payload = {
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
    codex_mode = codex_execution_mode_for_node(context.node)
    if codex_mode is not None:
        payload["codex_execution_mode"] = codex_mode
    return payload


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
