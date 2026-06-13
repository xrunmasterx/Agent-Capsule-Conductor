from __future__ import annotations

import asyncio
import json
import re
import shutil
from dataclasses import asdict
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.adapters.codex_app_server import CodexAppServerAdapter
from acc.adapters.streaming import (
    AgentApprovalDecision,
    AgentTurnResponseMode,
    StreamingAgentAdapter,
    StreamingAgentTurnRequest,
    StreamingAgentTurnResult,
)
from acc.agent_events import append_agent_event, ensure_agent_event_projection, project_agent_event
from acc.app.authoring import (
    AUTHORING_CORE_RULES,
    AUTHORING_OUTPUT_SCHEMA,
    AUTHORING_OUTPUT_SCHEMA_VERSION,
    hermetic_authoring_output,
    validate_authoring_output_payload,
)
from acc.app.interactions import create_interaction, get_interaction, interaction_payload
from acc.callable_registry import CallableAsset
from acc.callable_runner import (
    adapter_command,
    codex_sandbox_for_permissions,
    effective_permission_profile,
    effective_timeout_seconds,
    hermetic_stub_output,
    output_schema_for_agent,
    render_agent_prompt,
    structured_output_schema_errors,
    validate_output_schema,
)
from acc.models import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    DecisionRecord,
    NodeInvocationSpec,
    PermissionProfile,
    ScopeFrame,
    SessionInstance,
)
from acc.utils import (
    read_jsonl,
    update_runtime_json,
    validate_agent_session_id,
)
from acc.runtime.policy import (
    HERMETIC_RUN_MODE,
    acc_run_mode,
    external_agent_execution_enabled,
    production_codex_timeout_seconds,
)
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.store.control_ledger import append_control_event, append_decision_record

AGENT_SESSION_SCHEMA_VERSION = "acc.agent_session.v1"
AGENT_TURN_SCHEMA_VERSION = "acc.agent_turn.v1"
AGENT_SESSIONS_ROOT = Path("runs") / "_agent_sessions"
SUPPORTED_STREAMING_RUNTIMES = frozenset({"codex_app_server", "codex_cli"})
WORKBENCH_ASSISTANT_NODE_ID = "workbench_assistant"
WORKBENCH_ASSISTANT_REASONS = frozenset(
    {"workbench_chat", "canvas_revision", "selected_node_revision"}
)
NODE_CHAT_REASONS = frozenset({"node_chat", "output_revision"})
WORKBENCH_AUTHORING_METADATA_DEFAULTS: dict[str, Any] = {
    "questions": [],
    "risk_notes": [],
    "confidence": "medium",
}

CHAT_RESPONSE_MODE: AgentTurnResponseMode = "chat_optional_output"
STRUCTURED_RESPONSE_MODE: AgentTurnResponseMode = "structured_required"
PRIMARY_CHANNEL_TEXT = "messages"
PRIMARY_CHANNEL_DRAFT = "output_draft"


def classify_agent_turn_failure(
    error: str,
    *,
    reason: str,
    stage: str,
    provider_session_id: str | None,
) -> dict[str, Any]:
    detail = error.strip() or "Agent turn failed"
    lower = detail.lower()
    is_structured_turn = reason in {"canvas_revision", "selected_node_revision", "workflow_node"}
    failed_at = utc_now_iso()
    payload: dict[str, Any] = {
        "failure_kind": "unknown",
        "failure_origin": "acc_runtime",
        "failed_stage": stage,
        "recoverability": "retry_allowed",
        "provider_session_policy": "reuse_allowed",
        "provider_session_health": "unknown",
        "can_submit_next_turn": True,
        "user_summary": "本轮执行失败，已保留对话。你可以继续输入，必要时我会重新尝试。",
        "technical_detail": detail,
        "raw_error_ref": None,
        "failed_at": failed_at,
        "previous_provider_session_id": provider_session_id,
        "next_provider_session_id": None,
    }
    if "stale" in lower and "provider_session_id" in lower:
        payload.update(
            {
                "failure_kind": "stale_provider_session",
                "failure_origin": "provider_protocol",
                "recoverability": "user_action_required",
                "provider_session_policy": "reuse_allowed",
                "provider_session_health": "unknown",
                "can_submit_next_turn": False,
                "user_summary": "当前 AI 会话状态已过期，请刷新后再继续。",
            }
        )
    elif "cancel" in lower or stage == "provider_cancelled":
        payload.update(
            {
                "failure_kind": "cancelled",
                "failure_origin": "user_cancel",
                "recoverability": "continue_allowed",
                "provider_session_policy": "clear_before_next_structured_turn",
                "provider_session_health": "poisoned_for_structured_output",
                "user_summary": "本轮已取消，已保留对话。你可以继续输入。",
            }
        )
    elif "timeout" in lower or "timed out" in lower or stage == "provider_timeout":
        payload.update(
            {
                "failure_kind": "timeout",
                "failure_origin": "provider_transport",
                "provider_session_policy": "clear_before_next_turn",
                "provider_session_health": "poisoned",
                "user_summary": "本轮等待 AI 响应超时，已保留对话。你可以重试或继续输入。",
            }
        )
    elif "permission" in lower or "denied" in lower or "approval denied" in lower:
        payload.update(
            {
                "failure_kind": "permission_denied",
                "failure_origin": "policy",
                "recoverability": "user_action_required",
                "provider_session_policy": "reuse_allowed",
                "provider_session_health": "healthy",
                "user_summary": "本轮需要权限或审批处理，已保留对话。处理后可以继续。",
            }
        )
    elif (
        "authoring agent output" in lower
        or "acc.authoring.output" in lower
        or "output_draft.json" in lower
    ) and is_structured_turn:
        payload.update(
            {
                "failure_kind": "invalid_authoring_output",
                "failure_origin": "acc_authoring_validation",
                "failed_stage": "post_provider_result_validation",
                "provider_session_policy": "clear_before_next_structured_turn",
                "provider_session_health": "poisoned_for_structured_output",
                "user_summary": (
                    "本轮结构化输出无效，已保留对话。你可以继续输入；如果要修改画布，"
                    "下一轮会使用干净的 AI 上下文重新生成草稿。"
                ),
            }
        )
    elif "schema" in lower or "validation" in lower or "validat" in lower:
        payload.update(
            {
                "failure_kind": "validation_failed",
                "failure_origin": "acc_output_validation",
                "provider_session_policy": "clear_before_next_structured_turn"
                if is_structured_turn
                else "reuse_allowed",
                "provider_session_health": "poisoned_for_structured_output"
                if is_structured_turn
                else "unknown",
                "user_summary": "本轮输出校验失败，已保留对话。你可以调整要求后继续。",
            }
        )
    elif any(token in lower for token in ("crash", "exit code", "connection", "transport")):
        payload.update(
            {
                "failure_kind": "transport_error",
                "failure_origin": "provider_transport",
                "provider_session_policy": "clear_immediately",
                "provider_session_health": "poisoned",
                "user_summary": "AI 运行通道异常中断，已保留对话。你可以重试或继续输入。",
            }
        )
    elif stage.startswith("provider"):
        payload.update(
            {
                "failure_kind": "provider_error",
                "failure_origin": "provider_transport",
                "provider_session_policy": "clear_before_next_turn",
                "provider_session_health": "unknown",
                "user_summary": "AI provider 返回失败，已保留对话。你可以重试或继续输入。",
            }
        )
    return payload


def should_clear_provider_session_before_turn(
    session_payload: dict[str, Any],
    *,
    expects_output_draft: bool,
) -> bool:
    policy = str(session_payload.get("provider_session_policy") or "")
    if policy in {"clear_before_next_turn", "clear_immediately"}:
        return True
    return expects_output_draft and policy == "clear_before_next_structured_turn"


def clear_session_failure_state(session_payload: dict[str, Any]) -> dict[str, Any]:
    cleared = dict(session_payload)
    for key in (
        "last_failure_kind",
        "last_recoverability",
        "last_failure_user_summary",
        "last_failure_technical_detail",
        "last_failure_turn_id",
        "last_failure_at",
    ):
        cleared[key] = None
    cleared["provider_session_health"] = "healthy"
    cleared["provider_session_policy"] = "reuse_allowed"
    cleared["can_submit_next_turn"] = True
    return cleared


def upsert_agent_terminal_failure_event(
    event_log_path: Path,
    event_type: str,
    *,
    session_id: str,
    turn_id: str,
    run_id: str | None,
    node_id: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    events = read_jsonl(event_log_path) if event_log_path.exists() else []
    for index, event in enumerate(events):
        current_type = str(event.get("type") or event.get("event") or "")
        if current_type not in {"agent_turn_failed", "agent_turn_cancelled"}:
            continue
        current_payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        merged_payload = {**current_payload, **payload}
        merged_event = {
            **event,
            "type": current_type,
            "payload": merged_payload,
            "projection": project_agent_event(current_type, merged_payload),
        }
        events[index] = merged_event
        write_jsonl(event_log_path, events)
        return merged_event
    return append_agent_event(
        event_log_path,
        event_type,
        session_id=session_id,
        turn_id=turn_id,
        run_id=run_id,
        node_id=node_id,
        payload=payload,
    )


def write_jsonl(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


class AgentTurnService:
    def __init__(
        self,
        project_root: Path,
        *,
        adapter: StreamingAgentAdapter | None = None,
    ) -> None:
        self.project_root = project_root.resolve()
        self.adapter = adapter
        self._session_index: dict[str, Path] = {}

    async def run_workflow_node_turn(
        self,
        asset: CallableAsset,
        input_payload: dict[str, Any],
        node_dir: Path,
        *,
        node: NodeInvocationSpec,
        scope: ScopeFrame,
        session: SessionInstance,
        binding_materializations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        template = asset.template
        if not isinstance(template, AgentClassTemplate):
            raise AccError(f"Callable asset is not an AgentClassTemplate: {asset.source_id}")

        schema = output_schema_for_agent(template, node)
        schema_errors = structured_output_schema_errors(schema)
        if schema_errors:
            raise AccError(
                schema_errors[0].get("message")
                or "output_schema contains invalid JSON Schema for structured output"
            )
        prompt = render_agent_prompt(template, node, input_payload)
        write_json(node_dir / "agent_payload.json", input_payload)
        write_json(node_dir / "input.json", input_payload)
        write_json(node_dir / "output_schema.json", schema)
        (node_dir / "resolved_prompt.md").write_text(prompt, encoding="utf-8")

        permissions = effective_permission_profile(template, node)
        session_dir, session_payload = self._ensure_session(
            task_id=scope.environment_root.name,
            node_id=node.id,
            callable_ref=node.callable_ref,
            runtime=streaming_runtime_name(template.runtime),
            workspace_ref=str(scope.workspace_root.resolve()),
            output_schema=schema,
            bound_run_id=scope.environment_root.name,
            bound_node_id=node.id,
            bound_node_output_ref=str((node_dir / "output.json").resolve()),
            permissions_effective=permission_payload(permissions),
        )
        turn_id = f"turn_{uuid4().hex[:12]}"
        turn_dir = session_dir / "turns" / turn_id
        turn_dir.mkdir(parents=True, exist_ok=False)
        copy_turn_inputs(
            turn_dir,
            input_payload=input_payload,
            prompt=prompt,
            output_schema=schema,
        )
        self._write_turn(
            turn_dir,
            session_id=str(session_payload["session_id"]),
            turn_id=turn_id,
            reason="workflow_node",
            status="running",
            prompt_ref="resolved_prompt.md",
            input_ref="input.json",
            draft_output_ref="output_draft.json",
            usage_ref="usage.json",
        )
        append_message(
            session_dir,
            {"role": "user", "content": prompt, "turn_id": turn_id, "created_at": utc_now_iso()},
        )
        runtime_binding = {
            "runtime": streaming_runtime_name(template.runtime),
            "adapter": streaming_runtime_name(template.runtime),
            "command_argv_redacted": [
                adapter_command(template) or "codex",
                "app-server",
                "--listen",
                "stdio://",
            ],
            "workspace_dir": str(scope.workspace_root.resolve()),
            "permissions_effective": {
                "workspace_access": permissions.workspace_access,
                "network": permissions.network,
                "shell": permissions.shell,
                "dangerous": permissions.dangerous,
                "sandbox": codex_sandbox_for_permissions(permissions),
            },
            "agent_session_ref": str(session_dir.resolve()),
            "turn_id": turn_id,
            "binding_materializations": binding_materializations,
        }
        update_runtime_json(node_dir / "runtime.json", runtime_binding)

        if acc_run_mode() == HERMETIC_RUN_MODE:
            output = hermetic_stub_output(template, node, input_payload)
            write_json(turn_dir / "output_draft.json", output)
            append_agent_event(
                turn_dir / "events.jsonl",
                "agent_output_draft",
                session_id=str(session_payload["session_id"]),
                turn_id=turn_id,
                run_id=scope.environment_root.name,
                node_id=node.id,
                payload={"output_path": str((turn_dir / "output_draft.json").resolve())},
            )
        else:
            if not external_agent_execution_enabled():
                raise AccError(
                    "External agent execution is disabled. Set "
                    "ACC_RUN_MODE=production and ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1 "
                    f"to run {template.runtime!r} for {template.id!r}."
                )
            output = await self._run_streaming_adapter(
                template,
                turn_dir,
                session_payload,
                node=node,
                scope=scope,
                input_payload=input_payload,
            )

        try:
            validate_output_schema(output, schema)
        except Exception as exc:
            self.mark_turn_failed(
                str(session_payload["session_id"]),
                turn_id,
                str(exc),
                stage="post_provider_result_validation",
            )
            raise
        write_json(session_dir / "current_output.json", output)
        write_json(session_dir / "published_output.json", output)
        append_agent_event(
            turn_dir / "events.jsonl",
            "agent_output_published",
            session_id=str(session_payload["session_id"]),
            turn_id=turn_id,
            run_id=scope.environment_root.name,
            node_id=node.id,
            payload={"output_path": str((session_dir / "published_output.json").resolve())},
        )
        self._finalize_turn(turn_dir, status="success")
        next_session = clear_session_failure_state(
            {
                **session_payload,
                "status": "ready",
                "updated_at": utc_now_iso(),
                "current_output_ref": "current_output.json",
                "published_output_ref": "published_output.json",
                "current_output_turn_id": turn_id,
                "published_output_turn_id": turn_id,
                "last_published_at": utc_now_iso(),
                "last_turn_id": turn_id,
            }
        )
        write_json(session_dir / "session.json", next_session)
        update_runtime_json(
            node_dir / "runtime.json",
            {
                "provider_session_id": next_session.get("provider_session_id"),
            },
        )
        append_message(
            session_dir,
            {
                "role": "assistant",
                "content": str(output.get("summary") or json.dumps(output, ensure_ascii=False)),
                "turn_id": turn_id,
                "created_at": utc_now_iso(),
            },
        )
        return output

    def create_session(
        self,
        *,
        task_id: str,
        node_id: str,
        callable_ref: dict[str, Any],
        runtime: str,
        workspace_ref: str,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        ref = CallableRef(
            kind=str(callable_ref.get("kind") or "agent_class"),
            id=str(callable_ref.get("id") or node_id),
            version=(
                callable_ref.get("version")
                if isinstance(callable_ref.get("version"), str)
                else None
            ),
        )
        session_dir, payload = self._ensure_session(
            task_id=task_id,
            node_id=node_id,
            callable_ref=ref,
            runtime=runtime,
            workspace_ref=workspace_ref,
            output_schema=output_schema or {},
            bound_run_id=None,
            bound_node_id=None,
            bound_node_output_ref=None,
            permissions_effective=None,
        )
        return {**payload, "session_dir": str(session_dir.resolve())}

    def create_session_from_run_node(
        self,
        *,
        run_id: str,
        node_id: str,
        node_run_dir: str | None = None,
    ) -> dict[str, Any]:
        validate_segment(run_id, "run_id")
        validate_segment(node_id, "node_id")
        node_dir = self._resolve_run_node_dir(
            run_id=run_id,
            node_id=node_id,
            node_run_dir=node_run_dir,
        )
        if not node_dir.exists() or not node_dir.is_dir():
            raise AccError(f"Run node not found: {run_id}/{node_id}")
        runtime_payload = load_optional_object(node_dir / "runtime.json")
        existing_ref = runtime_payload.get("agent_session_ref")
        if isinstance(existing_ref, str) and existing_ref:
            session_dir = Path(existing_ref)
            if not session_dir.is_absolute():
                session_dir = self.project_root / session_dir
            session_path = session_dir.resolve() / "session.json"
            if session_path.exists() and session_path.resolve().is_relative_to(self.project_root):
                payload = require_object(load_json(session_path), "session.json")
                return {**payload, "session_dir": str(session_path.parent.resolve())}
        output_schema = load_optional_object(node_dir / "output_schema.json")
        callable_id = str(
            runtime_payload.get("callable_id") or runtime_payload.get("callable") or node_id
        )
        callable_ref = CallableRef(kind="agent_class", id=callable_id)
        session_dir, payload = self._ensure_session(
            task_id=run_id,
            node_id=node_id,
            callable_ref=callable_ref,
            runtime=str(runtime_payload.get("runtime") or "codex_app_server"),
            workspace_ref=str(runtime_payload.get("workspace_dir") or self.project_root),
            output_schema=output_schema,
            bound_run_id=run_id,
            bound_node_id=node_id,
            bound_node_output_ref=str((node_dir / "output.json").resolve()),
            permissions_effective=runtime_payload.get("permissions_effective")
            if isinstance(runtime_payload.get("permissions_effective"), dict)
            else None,
        )
        update_runtime_json(
            node_dir / "runtime.json",
            {
                "agent_session_ref": str(session_dir.resolve()),
                "turn_id": payload.get("last_turn_id"),
            },
        )
        return {**payload, "session_dir": str(session_dir.resolve())}

    def _resolve_run_node_dir(
        self,
        *,
        run_id: str,
        node_id: str,
        node_run_dir: str | None,
    ) -> Path:
        run_dir = (self.project_root / "runs" / run_id).resolve()
        runs_root = (self.project_root / "runs").resolve()
        if not run_dir.is_relative_to(runs_root):
            raise AccError(f"Invalid run_id: {run_id}")
        if node_run_dir:
            try:
                candidate = Path(node_run_dir)
                if not candidate.is_absolute():
                    candidate = self.project_root / candidate
                candidate = candidate.resolve()
            except OSError as exc:
                raise AccError("Invalid node_run_dir") from exc
            if not candidate.is_relative_to(run_dir):
                raise AccError("node_run_dir is outside the requested run")
            if candidate.name != node_id:
                raise AccError("node_run_dir does not match node_id")
            return candidate
        return run_dir / "nodes" / node_id

    def create_workbench_assistant_session(
        self,
        *,
        task_id: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        selection: dict[str, Any] | None = None,
        agent_id: str | None = None,
        workspace_ref: str | None = None,
    ) -> dict[str, Any]:
        if not task_id.strip():
            raise AccError("task_id is required for workbench assistant session")
        if not canvas_hash.strip():
            raise AccError("canvas_hash is required for workbench assistant session")
        session_dir, payload = self._ensure_session(
            task_id=task_id,
            node_id=WORKBENCH_ASSISTANT_NODE_ID,
            callable_ref=CallableRef(
                kind="agent_class",
                id=agent_id or "workbench-assistant.codex",
            ),
            runtime="codex_app_server",
            workspace_ref=str(Path(workspace_ref or self.project_root).resolve()),
            output_schema=AUTHORING_OUTPUT_SCHEMA,
            bound_run_id=None,
            bound_node_id=None,
            bound_node_output_ref=None,
            permissions_effective=permission_payload(
                PermissionProfile(workspace_access="read_only", network=False, shell=False)
            ),
            extra_payload={
                "session_kind": "workbench_assistant",
                "canvas_hash": canvas_hash,
                "selection": selection or {},
                "authoring_output_schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
            },
        )
        write_json(
            session_dir / "context_snapshot.json",
            {
                "task_id": task_id,
                "canvas_hash": canvas_hash,
                "canvas_snapshot": canvas_snapshot,
                "selection": selection or {},
                "updated_at": utc_now_iso(),
            },
        )
        return {**payload, "session_dir": str(session_dir.resolve())}

    def get_session(self, session_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        payload = require_object(load_json(session_dir / "session.json"), "session.json")
        return {**payload, "session_dir": str(session_dir.resolve())}

    def messages(self, session_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        return {"session_id": session_id, "messages": read_jsonl(session_dir / "messages.jsonl")}

    def submit_agent_turn(
        self,
        session_id: str,
        *,
        message: str,
        reason: str,
        expected_provider_session_id: str | None = None,
        canvas_hash: str | None = None,
        canvas_snapshot: dict[str, Any] | None = None,
        selection: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if reason not in NODE_CHAT_REASONS and reason not in WORKBENCH_ASSISTANT_REASONS:
            raise AccError(
                "Agent turn reason must be node_chat, output_revision, workbench_chat, "
                "canvas_revision, or selected_node_revision"
            )
        session_dir = self._find_session_dir(session_id)
        state = require_object(load_json(session_dir / "session.json"), "session.json")
        is_workbench_assistant = state.get("session_kind") == "workbench_assistant"
        if reason in WORKBENCH_ASSISTANT_REASONS and not is_workbench_assistant:
            raise AccError("Workbench assistant turns require a workbench assistant session")
        if reason in NODE_CHAT_REASONS and is_workbench_assistant:
            raise AccError("Workbench assistant session does not accept node chat turn reasons")
        response_mode = turn_response_mode(reason, is_workbench_assistant=is_workbench_assistant)
        expects_output_draft = response_mode == STRUCTURED_RESPONSE_MODE
        current_provider_session_id = state.get("provider_session_id")
        if (
            expected_provider_session_id is not None
            and current_provider_session_id is not None
            and expected_provider_session_id != current_provider_session_id
        ):
            raise AccError("Agent session provider_session_id is stale")
        turn_id = f"turn_{uuid4().hex[:12]}"
        turn_dir = session_dir / "turns" / turn_id
        turn_dir.mkdir(parents=True, exist_ok=False)
        input_payload = {"message": message, "reason": reason}
        prompt = message
        primary_channel = PRIMARY_CHANNEL_DRAFT if expects_output_draft else PRIMARY_CHANNEL_TEXT
        if should_clear_provider_session_before_turn(state, expects_output_draft=expects_output_draft):
            state = {
                **state,
                "provider_session_id": None,
                "provider_session_policy": "fresh_session_started",
                "provider_session_health": "unknown",
                "updated_at": utc_now_iso(),
            }
            write_json(session_dir / "session.json", state)
        input_payload.update(
            {
                "response_mode": response_mode,
                "primary_channel": primary_channel,
                "expects_output_draft": expects_output_draft,
            }
        )
        if is_workbench_assistant:
            if canvas_hash is None or canvas_snapshot is None:
                raise AccError(
                    "canvas_hash and canvas_snapshot are required for workbench assistant turns"
                )
            input_payload.update(
                {
                    "canvas_hash": canvas_hash,
                    "canvas_snapshot": canvas_snapshot,
                    "selection": selection or {},
                }
            )
            prompt = render_workbench_assistant_prompt(
                message=message,
                reason=reason,
                canvas_hash=canvas_hash,
                canvas_snapshot=canvas_snapshot,
                selection=selection or {},
            )
            write_json(
                session_dir / "context_snapshot.json",
                {
                    "task_id": state.get("task_id"),
                    "canvas_hash": canvas_hash,
                    "canvas_snapshot": canvas_snapshot,
                    "selection": selection or {},
                    "updated_at": utc_now_iso(),
                },
            )
        (turn_dir / "resolved_prompt.md").write_text(prompt, encoding="utf-8")
        write_json(turn_dir / "input.json", input_payload)
        write_json(
            turn_dir / "output_schema.json",
            state.get("output_schema") if isinstance(state.get("output_schema"), dict) else {},
        )
        (turn_dir / "events.jsonl").write_text("", encoding="utf-8")
        (turn_dir / "provider_events.jsonl").write_text("", encoding="utf-8")
        (turn_dir / "stdout.log").write_text("", encoding="utf-8")
        (turn_dir / "stderr.log").write_text("", encoding="utf-8")
        self._write_turn(
            turn_dir,
            session_id=session_id,
            turn_id=turn_id,
            reason=reason,
            status="queued",
            prompt_ref="resolved_prompt.md",
            input_ref="input.json",
            draft_output_ref="output_draft.json" if expects_output_draft else None,
            usage_ref="usage.json",
            response_mode=response_mode,
            primary_channel=primary_channel,
            expects_output_draft=expects_output_draft,
        )
        append_message(
            session_dir,
            {"role": "user", "content": message, "turn_id": turn_id, "created_at": utc_now_iso()},
        )
        state = {
            **state,
            "status": "queued",
            "updated_at": utc_now_iso(),
            "last_turn_id": turn_id,
        }
        write_json(session_dir / "session.json", state)
        return {
            **self._turn_payload(turn_dir),
            "session_id": session_id,
            "events_url": f"/api/agent-sessions/{session_id}/turns/{turn_id}/events",
        }

    async def execute_agent_turn(self, session_id: str, turn_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        state = require_object(load_json(session_dir / "session.json"), "session.json")
        turn_dir = session_dir / "turns" / safe_segment(turn_id)
        if not turn_dir.exists():
            raise AccError(f"Agent turn not found: {turn_id}")
        self._set_turn_status(turn_dir, "running")
        write_json(
            session_dir / "session.json",
            {**state, "status": "running", "updated_at": utc_now_iso()},
        )
        if acc_run_mode() == HERMETIC_RUN_MODE:
            run_id = optional_string(state, "bound_run_id")
            node_id = optional_string(state, "bound_node_id")
            is_workbench_assistant = state.get("session_kind") == "workbench_assistant"
            input_payload = load_optional_object(turn_dir / "input.json")
            message = str(input_payload.get("message") or "")
            reason = str(input_payload.get("reason") or "")
            append_agent_event(
                turn_dir / "events.jsonl",
                "agent_message",
                session_id=session_id,
                turn_id=turn_id,
                run_id=run_id,
                node_id=node_id,
                payload={
                    "content": "Hermetic workbench assistant turn completed."
                    if is_workbench_assistant
                    else "Hermetic agent turn completed."
                },
            )
            if is_workbench_assistant and reason in {
                "canvas_revision",
                "selected_node_revision",
            }:
                context = {
                    "task_id": state.get("task_id"),
                    "canvas_hash": input_payload.get("canvas_hash"),
                    "canvas_snapshot": input_payload.get("canvas_snapshot")
                    if isinstance(input_payload.get("canvas_snapshot"), dict)
                    else {},
                    "selection": input_payload.get("selection")
                    if isinstance(input_payload.get("selection"), dict)
                    else {},
                    "callable_catalog": (
                        input_payload.get("canvas_snapshot", {}).get("callable_catalog")
                        if isinstance(input_payload.get("canvas_snapshot"), dict)
                        and isinstance(
                            input_payload.get("canvas_snapshot", {}).get("callable_catalog"),
                            list,
                        )
                        else []
                    ),
                    "workflow_catalog": (
                        input_payload.get("canvas_snapshot", {}).get("workflow_catalog")
                        if isinstance(input_payload.get("canvas_snapshot"), dict)
                        and isinstance(
                            input_payload.get("canvas_snapshot", {}).get("workflow_catalog"),
                            list,
                        )
                        else []
                    ),
                    "request_intent": {},
                }
                output = hermetic_authoring_output(message=message, context=context)
                validate_authoring_output_payload(output)
                write_json(turn_dir / "output_draft.json", output)
                write_json(session_dir / "current_output.json", output)
                append_agent_event(
                    turn_dir / "events.jsonl",
                    "agent_output_draft",
                    session_id=session_id,
                    turn_id=turn_id,
                    run_id=run_id,
                    node_id=node_id,
                    payload={"output_path": str((turn_dir / "output_draft.json").resolve())},
                )
            append_message(
                session_dir,
                {
                    "role": "assistant",
                    "content": "Hermetic workbench assistant turn completed."
                    if is_workbench_assistant
                    else "Hermetic agent turn completed.",
                    "turn_id": turn_id,
                    "created_at": utc_now_iso(),
                },
            )
            self._finalize_turn(turn_dir, status="success")
            ready_state = {
                **state,
                "status": "ready",
                "updated_at": utc_now_iso(),
                "last_turn_id": turn_id,
                **(
                    {
                        "current_output_ref": "current_output.json",
                        "current_output_turn_id": turn_id,
                    }
                    if is_workbench_assistant
                    and reason in {"canvas_revision", "selected_node_revision"}
                    else {}
                ),
            }
            write_json(session_dir / "session.json", clear_session_failure_state(ready_state))
            return {**self._turn_payload(turn_dir), "session_id": session_id}
        if not external_agent_execution_enabled():
            raise AccError(
                "External agent execution is disabled. Set "
                "ACC_RUN_MODE=production and ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1 "
                "to run node chat turns."
            )
        result = await self._run_session_streaming_adapter(session_dir, turn_dir, state)
        next_state = require_object(load_json(session_dir / "session.json"), "session.json")
        input_payload = load_optional_object(turn_dir / "input.json")
        reason = str(input_payload.get("reason") or "")
        is_workbench_assistant = next_state.get("session_kind") == "workbench_assistant"
        expects_workbench_draft = is_workbench_assistant and reason in {
            "canvas_revision",
            "selected_node_revision",
        }
        is_workbench_chat = is_workbench_assistant and reason == "workbench_chat"
        if result.status != "success":
            terminal_status = "cancelled" if result.status == "cancelled" else "failed"
            self.mark_turn_failed(
                session_id,
                turn_id,
                result.error or result.summary,
                status=terminal_status,
                stage="provider_cancelled"
                if result.status == "cancelled"
                else "provider_result",
                provider_session_id=result.provider_session_id,
            )
            if result.status == "cancelled":
                return {**self._turn_payload(turn_dir), "session_id": session_id}
            raise AccError(result.error or result.summary)
        for content in result.assistant_messages:
            append_message(
                session_dir,
                {
                    "role": "assistant",
                    "content": content,
                    "turn_id": turn_id,
                    "created_at": utc_now_iso(),
                },
            )
        if result.usage:
            write_json(turn_dir / "usage.json", result.usage)
        try:
            if is_workbench_chat:
                if result.output_json_path is not None and result.output_json_path.exists():
                    result.output_json_path.unlink()
                if not any(content.strip() for content in result.assistant_messages):
                    raise AccError("Workbench chat turn completed without assistant text")
            elif expects_workbench_draft and (
                result.output_json_path is None or not result.output_json_path.exists()
            ):
                raise AccError("Workbench authoring turn did not produce output_draft.json")
            elif result.output_json_path is not None and result.output_json_path.exists():
                draft = require_object(load_json(result.output_json_path), "output_draft.json")
                schema = (
                    next_state.get("output_schema")
                    if isinstance(next_state.get("output_schema"), dict)
                    else {}
                )
                if expects_workbench_draft:
                    draft = normalize_workbench_authoring_output(draft)
                    validate_authoring_output_payload(draft)
                if schema:
                    validate_output_schema(draft, schema)
                if expects_workbench_draft:
                    write_json(result.output_json_path, draft)
                write_json(session_dir / "current_output.json", draft)
                next_state = {
                    **next_state,
                    "current_output_ref": "current_output.json",
                    "current_output_turn_id": turn_id,
                }
        except Exception as exc:
            self.mark_turn_failed(
                session_id,
                turn_id,
                str(exc),
                stage="post_provider_result_validation",
            )
            raise
        self._finalize_turn(turn_dir, status="success")
        write_json(
            session_dir / "session.json",
            clear_session_failure_state(
                {**next_state, "status": "ready", "updated_at": utc_now_iso(), "last_turn_id": turn_id}
            ),
        )
        return {**self._turn_payload(turn_dir), "session_id": session_id}

    def turn_events(self, session_id: str, turn_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        turn_dir = session_dir / "turns" / safe_segment(turn_id)
        if not turn_dir.exists():
            raise AccError(f"Agent turn not found: {turn_id}")
        return {
            "session_id": session_id,
            "turn_id": turn_id,
            "events": [
                ensure_agent_event_projection(event, fallback_event_seq=index)
                for index, event in enumerate(read_jsonl(turn_dir / "events.jsonl"), start=1)
            ],
        }

    def get_turn(self, session_id: str, turn_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        turn_dir = session_dir / "turns" / safe_segment(turn_id)
        if not turn_dir.exists():
            raise AccError(f"Agent turn not found: {turn_id}")
        return {**self._turn_payload(turn_dir), "session_id": session_id}

    def is_turn_terminal(self, session_id: str, turn_id: str) -> bool:
        try:
            turn = self.get_turn(session_id, turn_id)
        except AccError:
            return False
        return str(turn.get("status") or "") in {"success", "failed", "cancelled", "timeout"}

    def validate_assistant_draft(self, session_id: str, *, expected_turn_id: str) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        state = require_object(load_json(session_dir / "session.json"), "session.json")
        if state.get("session_kind") != "workbench_assistant":
            raise AccError("Assistant draft validation requires a workbench assistant session")
        if state.get("current_output_turn_id") != expected_turn_id:
            raise AccError("Assistant draft is stale")
        current_path = session_dir / "current_output.json"
        if not current_path.exists():
            raise AccError("No assistant draft is available")
        output = normalize_workbench_authoring_output(
            require_object(load_json(current_path), "current_output.json")
        )
        validate_authoring_output_payload(output)
        schema = state.get("output_schema") if isinstance(state.get("output_schema"), dict) else {}
        if schema:
            validate_output_schema(output, schema)
        write_json(current_path, output)
        return {
            "session_id": session_id,
            "turn_id": expected_turn_id,
            "status": "valid",
            "assistant_message": output.get("assistant_message") or "",
            "proposal": output.get("proposal"),
            "required_actions": [],
            "risk_notes": output.get("risk_notes") or [],
            "questions": output.get("questions") or [],
            "confidence": output.get("confidence") or "low",
        }

    def mark_turn_failed(
        self,
        session_id: str,
        turn_id: str,
        error: str,
        *,
        status: str = "failed",
        stage: str = "agent_turn_execution",
        provider_session_id: str | None = None,
    ) -> None:
        session_dir = self._find_session_dir(session_id)
        turn_dir = session_dir / "turns" / safe_segment(turn_id)
        if not turn_dir.exists():
            return
        state = require_object(load_json(session_dir / "session.json"), "session.json")
        input_payload = load_optional_object(turn_dir / "input.json")
        reason = str(input_payload.get("reason") or self._turn_payload(turn_dir).get("reason") or "")
        current_provider_session_id = (
            provider_session_id
            if provider_session_id is not None
            else optional_string(state, "provider_session_id")
        )
        failure = classify_agent_turn_failure(
            error,
            reason=reason,
            stage=stage,
            provider_session_id=current_provider_session_id,
        )
        run_id = optional_string(state, "bound_run_id")
        node_id = optional_string(state, "bound_node_id")
        event_type = "agent_turn_cancelled" if status == "cancelled" else "agent_turn_failed"
        event = upsert_agent_terminal_failure_event(
            turn_dir / "events.jsonl",
            event_type,
            session_id=session_id,
            turn_id=turn_id,
            run_id=run_id,
            node_id=node_id,
            payload={**failure, "error": error},
        )
        failure["raw_error_ref"] = f"events.jsonl#{event.get('event_id')}"
        upsert_agent_terminal_failure_event(
            turn_dir / "events.jsonl",
            event_type,
            session_id=session_id,
            turn_id=turn_id,
            run_id=run_id,
            node_id=node_id,
            payload={**failure, "error": error},
        )
        turn_payload = self._turn_payload(turn_dir)
        turn_payload.update({**failure, "status": status, "ended_at": utc_now_iso()})
        write_json(turn_dir / "turn.json", turn_payload)
        write_json(
            session_dir / "session.json",
            {
                **state,
                "status": status,
                "updated_at": utc_now_iso(),
                "last_turn_id": turn_id,
                "last_failure_kind": failure["failure_kind"],
                "last_recoverability": failure["recoverability"],
                "provider_session_health": failure["provider_session_health"],
                "provider_session_policy": failure["provider_session_policy"],
                "can_submit_next_turn": failure["can_submit_next_turn"],
                "last_failure_user_summary": failure["user_summary"],
                "last_failure_technical_detail": failure["technical_detail"],
                "last_failure_turn_id": turn_id,
                "last_failure_at": failure["failed_at"],
            },
        )

    def publish_output(
        self,
        session_id: str,
        *,
        expected_turn_id: str,
    ) -> dict[str, Any]:
        session_dir = self._find_session_dir(session_id)
        state = require_object(load_json(session_dir / "session.json"), "session.json")
        bound_run_id = state.get("bound_run_id")
        bound_node_id = state.get("bound_node_id")
        if not isinstance(bound_run_id, str) or not isinstance(bound_node_id, str):
            raise AccError("Agent session is not bound to a run node")
        if state.get("current_output_turn_id") != expected_turn_id:
            raise AccError("Agent output draft is stale")
        current_path = session_dir / "current_output.json"
        if not current_path.exists():
            raise AccError("No current output draft to publish")
        output = require_object(load_json(current_path), "current_output.json")
        schema = state.get("output_schema") if isinstance(state.get("output_schema"), dict) else {}
        if schema:
            validate_output_schema(output, schema)
        node_dir = self.project_root / "runs" / bound_run_id / "nodes" / bound_node_id
        if not node_dir.exists() or not node_dir.is_dir():
            raise AccError("Bound run node no longer exists")
        runtime_payload = load_optional_object(node_dir / "runtime.json")
        runtime_session_ref = runtime_payload.get("agent_session_ref")
        if (
            not isinstance(runtime_session_ref, str)
            or Path(runtime_session_ref).resolve() != session_dir.resolve()
        ):
            raise AccError("Bound run node does not reference this agent session")
        published_path = session_dir / "published_output.json"
        write_json(published_path, output)
        target = node_dir / "output.json"
        write_json(target, output)
        append_agent_event(
            session_dir / "turns" / safe_segment(expected_turn_id) / "events.jsonl",
            "agent_output_published",
            session_id=session_id,
            turn_id=expected_turn_id,
            run_id=bound_run_id,
            node_id=bound_node_id,
            payload={"output_path": str(target.resolve())},
        )
        update_runtime_json(
            node_dir / "runtime.json",
            {
                "published_output_turn_id": expected_turn_id,
                "published_output_ref": str(target.resolve()),
            },
        )
        state = {
            **state,
            "status": "ready",
            "updated_at": utc_now_iso(),
            "published_output_ref": "published_output.json",
            "published_output_turn_id": expected_turn_id,
            "last_published_at": utc_now_iso(),
        }
        write_json(session_dir / "session.json", state)
        return {
            "session_id": session_id,
            "status": "published",
            "published_output_path": str(published_path.resolve()),
            "target_output_path": str(target.resolve()),
        }

    async def _run_streaming_adapter(
        self,
        template: AgentClassTemplate,
        turn_dir: Path,
        session_payload: dict[str, Any],
        *,
        node: NodeInvocationSpec,
        scope: ScopeFrame,
        input_payload: dict[str, Any],
    ) -> dict[str, Any]:
        runtime = streaming_runtime_name(template.runtime)
        adapter = self.adapter or StreamingAgentAdapterDispatcher().resolve(runtime)
        request = StreamingAgentTurnRequest(
            callable_id=template.id,
            runtime=runtime,
            run_dir=turn_dir,
            workspace_dir=scope.workspace_root,
            prompt_path=turn_dir / "resolved_prompt.md",
            input_payload=input_payload,
            output_schema_path=turn_dir / "output_schema.json",
            output_json_path=turn_dir / "output_draft.json",
            events_log_path=turn_dir / "events.jsonl",
            provider_events_log_path=turn_dir / "provider_events.jsonl",
            stdout_log_path=turn_dir / "stdout.log",
            stderr_log_path=turn_dir / "stderr.log",
            timeout_seconds=effective_timeout_seconds(template, node),
            command=adapter_command(template),
            session_id=str(session_payload["session_id"]),
            turn_id=turn_dir.name,
            run_id=scope.environment_root.name,
            node_id=node.id,
            provider_session_id=session_payload.get("provider_session_id")
            if isinstance(session_payload.get("provider_session_id"), str)
            else None,
            cancel_path=scope.environment_root / "cancel_requested",
            model=(
                template.metadata.get("model")
                if isinstance(template.metadata.get("model"), str)
                else None
            ),
            reasoning_effort=template.metadata.get("reasoning_effort")
            if isinstance(template.metadata.get("reasoning_effort"), str)
            else None,
            response_mode="structured_required",
            approval_bridge=FilesystemAgentApprovalBridge(
                project_root=self.project_root,
                session_dir=turn_dir.parent.parent,
                permissions=effective_permission_profile(template, node),
            ),
        )
        result = await adapter.run_turn(request)
        session_payload["provider_session_id"] = result.provider_session_id
        session_payload["updated_at"] = utc_now_iso()
        write_json(turn_dir.parent.parent / "session.json", session_payload)
        if result.status != "success":
            self.mark_turn_failed(
                str(session_payload["session_id"]),
                turn_dir.name,
                result.error or result.summary,
                status="cancelled" if result.status == "cancelled" else "failed",
                stage="provider_cancelled"
                if result.status == "cancelled"
                else "provider_result",
                provider_session_id=result.provider_session_id,
            )
            raise AccError(result.error or result.summary)
        if result.usage:
            write_json(turn_dir / "usage.json", result.usage)
        output = require_object(load_json(turn_dir / "output_draft.json"), "output_draft.json")
        return output

    async def _run_session_streaming_adapter(
        self,
        session_dir: Path,
        turn_dir: Path,
        session_payload: dict[str, Any],
    ) -> StreamingAgentTurnResult:
        runtime = streaming_runtime_name(str(session_payload.get("runtime") or "codex_app_server"))
        adapter = self.adapter or StreamingAgentAdapterDispatcher().resolve(runtime)
        run_id = session_payload.get("bound_run_id")
        node_id = session_payload.get("bound_node_id")
        input_payload = load_optional_object(turn_dir / "input.json")
        response_mode = turn_response_mode(
            str(input_payload.get("reason") or ""),
            is_workbench_assistant=session_payload.get("session_kind") == "workbench_assistant",
        )
        cancel_path = (
            self.project_root / "runs" / run_id / "cancel_requested"
            if isinstance(run_id, str)
            else session_dir / "cancel_requested"
        )
        request = StreamingAgentTurnRequest(
            callable_id=callable_id_from_session(session_payload),
            runtime=runtime,
            run_dir=turn_dir,
            workspace_dir=Path(str(session_payload.get("workspace_ref") or self.project_root)),
            prompt_path=turn_dir / "resolved_prompt.md",
            input_payload=input_payload,
            output_schema_path=turn_dir / "output_schema.json",
            output_json_path=turn_dir / "output_draft.json",
            events_log_path=turn_dir / "events.jsonl",
            provider_events_log_path=turn_dir / "provider_events.jsonl",
            stdout_log_path=turn_dir / "stdout.log",
            stderr_log_path=turn_dir / "stderr.log",
            timeout_seconds=production_codex_timeout_seconds(),
            command=None,
            session_id=str(session_payload["session_id"]),
            turn_id=turn_dir.name,
            run_id=run_id if isinstance(run_id, str) else None,
            node_id=node_id if isinstance(node_id, str) else None,
            provider_session_id=session_payload.get("provider_session_id")
            if isinstance(session_payload.get("provider_session_id"), str)
            else None,
            cancel_path=cancel_path,
            response_mode=response_mode,
            approval_bridge=FilesystemAgentApprovalBridge(
                project_root=self.project_root,
                session_dir=session_dir,
                permissions=permission_profile_from_session(session_payload),
            ),
        )
        result = await adapter.run_turn(request)
        session_payload["provider_session_id"] = result.provider_session_id
        session_payload["updated_at"] = utc_now_iso()
        write_json(session_dir / "session.json", session_payload)
        return result

    def _ensure_session(
        self,
        *,
        task_id: str,
        node_id: str,
        callable_ref: CallableRef,
        runtime: str,
        workspace_ref: str,
        output_schema: dict[str, Any],
        bound_run_id: str | None,
        bound_node_id: str | None,
        bound_node_output_ref: str | None,
        permissions_effective: dict[str, Any] | None,
        extra_payload: dict[str, Any] | None = None,
    ) -> tuple[Path, dict[str, Any]]:
        extra_payload = extra_payload or {}
        session_dir = self._session_dir(task_id, node_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        session_path = session_dir / "session.json"
        if session_path.exists():
            payload = require_object(load_json(session_path), "session.json")
            next_callable_ref = asdict(callable_ref)
            if (
                payload.get("runtime") != runtime
                or payload.get("workspace_ref") != workspace_ref
                or payload.get("callable_ref") != next_callable_ref
            ):
                payload = {**payload, "provider_session_id": None}
            payload = {
                **payload,
                "callable_ref": next_callable_ref,
                "runtime": runtime,
                "workspace_ref": workspace_ref,
                "updated_at": utc_now_iso(),
                "output_schema": output_schema,
                "bound_run_id": bound_run_id,
                "bound_node_id": bound_node_id,
                "bound_node_output_ref": bound_node_output_ref,
                "permissions_effective": permissions_effective,
                **extra_payload,
            }
            write_json(session_path, payload)
            self._session_index[str(payload["session_id"])] = session_dir
            return session_dir, payload
        payload = {
            "schema_version": AGENT_SESSION_SCHEMA_VERSION,
            "session_id": f"agent_session_{uuid4().hex[:12]}",
            "task_id": task_id,
            "node_id": node_id,
            "callable_ref": asdict(callable_ref),
            "runtime": runtime,
            "provider_session_id": None,
            "workspace_ref": workspace_ref,
            "status": "ready",
            "current_output_ref": None,
            "published_output_ref": None,
            "bound_run_id": bound_run_id,
            "bound_node_id": bound_node_id,
            "bound_node_output_ref": bound_node_output_ref,
            "current_output_turn_id": None,
            "published_output_turn_id": None,
            "last_published_at": None,
            "output_schema": output_schema,
            "permissions_effective": permissions_effective,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "last_turn_id": None,
            **extra_payload,
        }
        write_json(session_path, payload)
        (session_dir / "messages.jsonl").touch()
        self._session_index[str(payload["session_id"])] = session_dir
        return session_dir, payload

    def _session_dir(self, task_id: str, node_id: str) -> Path:
        return (
            self.project_root
            / AGENT_SESSIONS_ROOT
            / safe_segment(task_id)
            / safe_segment(node_id)
        )

    def _find_session_dir(self, session_id: str) -> Path:
        validate_agent_session_id(session_id)
        if session_id in self._session_index:
            cached = self._session_index[session_id]
            if (cached / "session.json").exists():
                return cached
            del self._session_index[session_id]
        root = self.project_root / AGENT_SESSIONS_ROOT
        if not root.exists():
            raise AccError(f"Agent session not found: {session_id}")
        for session_path in root.glob("*/*/session.json"):
            try:
                payload = require_object(load_json(session_path), "session.json")
            except AccError:
                continue
            found_id = payload.get("session_id")
            if isinstance(found_id, str):
                self._session_index[found_id] = session_path.parent
            if found_id == session_id:
                return session_path.parent
        raise AccError(f"Agent session not found: {session_id}")

    def _write_turn(
        self,
        turn_dir: Path,
        *,
        session_id: str,
        turn_id: str,
        reason: str,
        status: str,
        prompt_ref: str,
        input_ref: str,
        draft_output_ref: str | None,
        usage_ref: str,
        response_mode: str | None = None,
        primary_channel: str | None = None,
        expects_output_draft: bool | None = None,
    ) -> None:
        payload = {
            "schema_version": AGENT_TURN_SCHEMA_VERSION,
            "turn_id": turn_id,
            "session_id": session_id,
            "reason": reason,
            "status": status,
            "prompt_ref": prompt_ref,
            "input_ref": input_ref,
            "draft_output_ref": draft_output_ref,
            "usage_ref": usage_ref,
            "started_at": utc_now_iso(),
            "ended_at": None,
        }
        if response_mode is not None:
            payload["response_mode"] = response_mode
        if primary_channel is not None:
            payload["primary_channel"] = primary_channel
        if expects_output_draft is not None:
            payload["expects_output_draft"] = expects_output_draft
        write_json(turn_dir / "turn.json", payload)

    def _finalize_turn(self, turn_dir: Path, *, status: str) -> None:
        payload = self._turn_payload(turn_dir)
        payload.update({"status": status, "ended_at": utc_now_iso()})
        write_json(turn_dir / "turn.json", payload)

    def _set_turn_status(self, turn_dir: Path, status: str) -> None:
        payload = self._turn_payload(turn_dir)
        payload.update({"status": status})
        write_json(turn_dir / "turn.json", payload)

    def _turn_payload(self, turn_dir: Path) -> dict[str, Any]:
        return require_object(load_json(turn_dir / "turn.json"), "turn.json")


class AgentTurnTaskManager:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.tasks: dict[str, asyncio.Task[None]] = {}

    def submit(
        self,
        *,
        session_id: str,
        turn_id: str,
        adapter: StreamingAgentAdapter | None = None,
    ) -> None:
        key = f"{session_id}:{turn_id}"
        if key in self.tasks and not self.tasks[key].done():
            return
        task = asyncio.create_task(self._run(key, session_id, turn_id, adapter))
        self.tasks[key] = task

    async def _run(
        self,
        key: str,
        session_id: str,
        turn_id: str,
        adapter: StreamingAgentAdapter | None,
    ) -> None:
        service = AgentTurnService(self.project_root, adapter=adapter)
        try:
            await service.execute_agent_turn(session_id, turn_id)
        except Exception as exc:
            if not service.is_turn_terminal(session_id, turn_id):
                service.mark_turn_failed(session_id, turn_id, str(exc))
        finally:
            current = self.tasks.get(key)
            if current is asyncio.current_task():
                self.tasks.pop(key, None)


class FilesystemAgentApprovalBridge:
    def __init__(
        self,
        *,
        project_root: Path,
        session_dir: Path,
        permissions: PermissionProfile,
    ) -> None:
        self.project_root = project_root.resolve()
        self.session_dir = session_dir.resolve()
        self.permissions = permissions

    async def request_approval(
        self,
        *,
        run_id: str | None,
        node_id: str | None,
        session_id: str,
        turn_id: str,
        provider_method: str,
        provider_params: dict[str, Any],
        timeout_seconds: int,
    ) -> AgentApprovalDecision:
        run_dir = self.project_root / "runs" / run_id if run_id else None
        if self._deny_by_policy(provider_method):
            if run_dir is not None and run_dir.exists():
                self._append_system_approval_decision(
                    run_dir,
                    run_id=run_id or "",
                    node_id=node_id,
                    choice="reject",
                    reason="denied by read-only policy",
                    interaction_id=None,
                )
            return AgentApprovalDecision(
                approved=False,
                response={"approved": False},
                reason="denied by read-only policy",
            )
        if not run_id:
            interaction_id = self._write_session_interaction(
                session_id=session_id,
                turn_id=turn_id,
                provider_method=provider_method,
                provider_params=provider_params,
                status="expired",
            )
            return AgentApprovalDecision(
                approved=False,
                response={"approved": False},
                reason="session-scoped approvals require a bound run",
                interaction_id=interaction_id,
            )
        if run_dir is None or not run_dir.exists():
            return AgentApprovalDecision(
                approved=False,
                response={"approved": False},
                reason="approval run not found",
            )
        interaction = create_interaction(
            run_dir,
            run_id=run_id,
            kind="approval",
            prompt=f"Approve Codex provider request: {provider_method}",
            node_id=node_id,
            options=("approve", "reject"),
            payload={
                "session_id": session_id,
                "turn_id": turn_id,
                "provider_method": provider_method,
                "provider_params": provider_params,
            },
        )
        deadline = asyncio.get_running_loop().time() + max(1, timeout_seconds)
        while asyncio.get_running_loop().time() < deadline:
            current = get_interaction(run_dir, interaction.interaction_id)
            if current.status == "answered":
                choice = approval_choice(current.answer or {})
                approved = choice == "approve"
                return AgentApprovalDecision(
                    approved=approved,
                    response={"approved": approved},
                    reason=f"human {choice}",
                    interaction_id=interaction.interaction_id,
                )
            if current.status in {"expired", "cancelled"}:
                return AgentApprovalDecision(
                    approved=False,
                    response={"approved": False},
                    reason=current.status,
                    interaction_id=interaction.interaction_id,
                )
            await asyncio.sleep(0.5)
        expired = {
            **interaction_payload(interaction),
            "status": "expired",
            "answered_at": utc_now_iso(),
            "answer": {"choice": "reject", "reason": "timeout"},
        }
        write_json(run_dir / "interactions" / f"{interaction.interaction_id}.json", expired)
        self._append_system_approval_decision(
            run_dir,
            run_id=run_id,
            node_id=node_id,
            choice="reject",
            reason="timeout",
            interaction_id=interaction.interaction_id,
        )
        return AgentApprovalDecision(
            approved=False,
            response={"approved": False},
            reason="timeout",
            interaction_id=interaction.interaction_id,
        )

    def _deny_by_policy(self, provider_method: str) -> bool:
        if self.permissions.workspace_access != "read_only":
            return False
        return provider_method in {
            "item/commandExecution/requestApproval",
            "execCommandApproval",
            "item/fileChange/requestApproval",
            "applyPatchApproval",
        }

    def _write_session_interaction(
        self,
        *,
        session_id: str,
        turn_id: str,
        provider_method: str,
        provider_params: dict[str, Any],
        status: str,
    ) -> str:
        interaction_id = f"interaction_{uuid4().hex[:12]}"
        (self.session_dir / "interactions").mkdir(parents=True, exist_ok=True)
        payload = {
            "interaction_id": interaction_id,
            "run_id": None,
            "node_id": None,
            "kind": "approval",
            "status": status,
            "prompt": f"Approve Codex provider request: {provider_method}",
            "options": ["approve", "reject"],
            "payload": {
                "session_id": session_id,
                "turn_id": turn_id,
                "provider_method": provider_method,
                "provider_params": provider_params,
            },
            "created_at": utc_now_iso(),
            "answered_at": utc_now_iso() if status == "expired" else None,
            "answer": {"choice": "reject", "reason": status} if status == "expired" else None,
        }
        write_json(self.session_dir / "interactions" / f"{interaction_id}.json", payload)
        return interaction_id

    def _append_system_approval_decision(
        self,
        run_dir: Path,
        *,
        run_id: str,
        node_id: str | None,
        choice: str,
        reason: str,
        interaction_id: str | None,
    ) -> None:
        evidence_ref = (
            f"interactions/{interaction_id}.json"
            if interaction_id
            else "agent approval provider request"
        )
        decision = DecisionRecord(
            decision_id=f"decision_{run_id}_agent_approval_{uuid4().hex[:12]}",
            run_id=run_id,
            actor="system",
            kind="approval",
            timestamp=utc_now_iso(),
            input_evidence_refs=(evidence_ref,),
            selected={
                "action": choice,
                "reason": reason,
                **({"node_id": node_id} if node_id else {}),
                **({"interaction_id": interaction_id} if interaction_id else {}),
            },
            result_refs=("decisions.jsonl", "events.jsonl"),
            rationale=f"Agent approval {choice}: {reason}",
        )
        append_decision_record(run_dir, decision)
        append_control_event(
            run_dir,
            event_type="decision_recorded",
            run_id=run_id,
            node_id=node_id,
            decision_id=decision.decision_id,
            payload={
                "kind": "approval",
                "choice": choice,
                "interaction_id": interaction_id,
                "reason": reason,
            },
        )


class StreamingAgentAdapterDispatcher:
    def resolve(self, runtime: str) -> StreamingAgentAdapter:
        if runtime in SUPPORTED_STREAMING_RUNTIMES:
            return CodexAppServerAdapter()
        raise AccError(f"Unsupported streaming agent runtime {runtime!r}")


def streaming_runtime_name(runtime: str) -> str:
    if runtime == "codex_cli":
        return "codex_app_server"
    return runtime


def copy_turn_inputs(
    turn_dir: Path,
    *,
    input_payload: dict[str, Any],
    prompt: str,
    output_schema: dict[str, Any],
) -> None:
    write_json(turn_dir / "input.json", input_payload)
    write_json(turn_dir / "output_schema.json", output_schema)
    (turn_dir / "resolved_prompt.md").write_text(prompt, encoding="utf-8")
    (turn_dir / "events.jsonl").write_text("", encoding="utf-8")
    (turn_dir / "provider_events.jsonl").write_text("", encoding="utf-8")
    (turn_dir / "stdout.log").write_text("", encoding="utf-8")
    (turn_dir / "stderr.log").write_text("", encoding="utf-8")


def render_workbench_assistant_prompt(
    *,
    message: str,
    reason: str,
    canvas_hash: str,
    canvas_snapshot: dict[str, Any],
    selection: dict[str, Any],
) -> str:
    if reason == "workbench_chat":
        return render_workbench_chat_prompt(
            message=message,
            reason=reason,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
            selection=selection,
        )
    return render_workbench_authoring_prompt(
        message=message,
        reason=reason,
        canvas_hash=canvas_hash,
        canvas_snapshot=canvas_snapshot,
        selection=selection,
    )


def render_workbench_chat_prompt(
    *,
    message: str,
    reason: str,
    canvas_hash: str,
    canvas_snapshot: dict[str, Any],
    selection: dict[str, Any],
) -> str:
    return "\n".join(
        [
            "You are ACC's Workbench AI assistant.",
            "You help the user understand and discuss the current workflow canvas.",
            "Reply in natural language. Do not wrap the reply in acc.authoring.output.v1 JSON.",
            "If the user asks for JSON examples, show them as ordinary explanatory text only.",
            "Do not propose or apply canvas mutations in this chat response.",
            "",
            f"Turn reason: {reason}",
            "Response mode: chat_optional_output",
            f"Canvas hash: {canvas_hash}",
            "",
            "Current selection JSON:",
            json.dumps(selection, ensure_ascii=False, indent=2, sort_keys=True),
            "",
            "Current canvas snapshot JSON:",
            json.dumps(canvas_snapshot, ensure_ascii=False, indent=2, sort_keys=True),
            "",
            "User request:",
            message,
        ]
    )


def render_workbench_authoring_prompt(
    *,
    message: str,
    reason: str,
    canvas_hash: str,
    canvas_snapshot: dict[str, Any],
    selection: dict[str, Any],
) -> str:
    response_contract = (
        f"Return exactly one JSON object matching {AUTHORING_OUTPUT_SCHEMA_VERSION}. "
        "The JSON may contain a CanvasAuthoringProposal draft only; do not write files. "
        "If you do not need to change the canvas, set proposal to null."
    )
    response_shape = {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": "用户可读回答",
        "proposal_kind": "canvas",
        "proposal": None,
        "questions": [],
        "risk_notes": [],
        "confidence": "medium",
    }
    return "\n".join(
        [
            "You are ACC's Workbench AI assistant.",
            "You help the user understand and revise the current workflow canvas.",
            response_contract,
            "Always include questions, risk_notes, and confidence. Use questions: [], "
            'risk_notes: [], confidence: "medium" when there is no specific metadata.',
            "",
            "Required response shape:",
            json.dumps(response_shape, ensure_ascii=False, indent=2),
            "",
            "Authoring rules:",
            *[f"- {rule}" for rule in AUTHORING_CORE_RULES],
            "",
            f"Turn reason: {reason}",
            f"Canvas hash: {canvas_hash}",
            "",
            "Current selection JSON:",
            json.dumps(selection, ensure_ascii=False, indent=2, sort_keys=True),
            "",
            "Current canvas snapshot JSON:",
            json.dumps(canvas_snapshot, ensure_ascii=False, indent=2, sort_keys=True),
            "",
            "User request:",
            message,
        ]
    )


def turn_response_mode(reason: str, *, is_workbench_assistant: bool) -> AgentTurnResponseMode:
    if is_workbench_assistant:
        return CHAT_RESPONSE_MODE if reason == "workbench_chat" else STRUCTURED_RESPONSE_MODE
    return STRUCTURED_RESPONSE_MODE if reason == "output_revision" else CHAT_RESPONSE_MODE


def normalize_workbench_authoring_output(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    for key, default_value in WORKBENCH_AUTHORING_METADATA_DEFAULTS.items():
        if key not in normalized:
            normalized[key] = list(default_value) if isinstance(default_value, list) else default_value
    return normalized


def append_message(session_dir: Path, payload: dict[str, Any]) -> None:
    with (session_dir / "messages.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")



def require_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccError(f"{context} must be a JSON object")
    return value


def load_optional_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    value = load_json(path)
    return value if isinstance(value, dict) else {}


def safe_segment(value: str) -> str:
    segment = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._")
    return segment or "default"


def validate_segment(value: str, label: str) -> None:
    if safe_segment(value) != value:
        raise AccError(f"Invalid {label}: {value}")


def permission_payload(profile: PermissionProfile) -> dict[str, Any]:
    return {
        "workspace_access": profile.workspace_access,
        "network": profile.network,
        "shell": profile.shell,
        "dangerous": profile.dangerous,
    }


def permission_profile_from_session(session_payload: dict[str, Any]) -> PermissionProfile:
    payload = session_payload.get("permissions_effective")
    if not isinstance(payload, dict):
        return PermissionProfile()
    return PermissionProfile(
        workspace_access=str(payload.get("workspace_access") or "read_only"),  # type: ignore[arg-type]
        network=bool(payload.get("network", False)),
        shell=bool(payload.get("shell", False)),
        dangerous=bool(payload.get("dangerous", False)),
    )


def callable_id_from_session(session_payload: dict[str, Any]) -> str:
    ref = session_payload.get("callable_ref")
    if isinstance(ref, dict) and isinstance(ref.get("id"), str):
        return ref["id"]
    return str(session_payload.get("node_id") or "agent")


def optional_string(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def approval_choice(answer: dict[str, Any]) -> str:
    for key in ("decision", "choice", "action", "value"):
        value = answer.get(key)
        if isinstance(value, str) and value.strip().lower() in {"approve", "reject"}:
            return value.strip().lower()
    return "reject"


def copy_published_output(session_dir: Path, target: Path) -> None:
    published = session_dir / "published_output.json"
    if not published.exists():
        raise AccError("Published output does not exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(published, target)
