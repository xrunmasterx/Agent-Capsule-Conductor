from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.callable_registry import CallableAsset, CallableRegistry
from acc.callable_runner import (
    AgentExecutionContext,
    CallableClassRunner,
    normalize_output_schema_for_structured_output,
    structured_output_schema_errors,
)
from acc.domain import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    InvocationPolicy,
    NodeInvocationSpec,
    PermissionProfile,
    PromptPolicy,
    ScopeFrame,
    SessionInstance,
)
from acc.runtime.policy import HERMETIC_RUN_MODE, acc_run_mode
from acc.session import utc_now_iso
from acc.store import load_json, write_json

AUTHORING_OUTPUT_SCHEMA_VERSION = "acc.authoring.output.v1"
AUTHORING_PROMPT_VERSION = "acc.authoring.prompt.v1"
AUTHORING_AGENT_TIMEOUT_SECONDS = 300
AUTHORING_CORE_RULES = (
    f"Return exactly one JSON object matching {AUTHORING_OUTPUT_SCHEMA_VERSION}; "
    "do not return Markdown, prose outside JSON, or multiple JSON objects.",
    "Generate only CanvasAuthoringProposal operations; do not run workflows, write files, "
    "call persistence APIs, or mutate workflows/, callables/, AGENTS.md, or skills.",
    "Use only callable ids present in callable_catalog; never invent callable ids.",
    "If callable_catalog has only one usable agent, reuse that callable with different "
    "invocation-scoped user_prompt values for different responsibilities.",
    "Read context.request_intent as backend-recognized background, but choose the workflow "
    "decomposition yourself.",
    "Use add_control_edge for sequential execution and default main-flow handoff.",
    "Do not create explicit add_data_edge from main to main.",
    "If the user asks to connect one node's main output to another node's main input, "
    "interpret it as sequential main flow and use add_control_edge only.",
    "Use add_data_edge only for named non-main ports, for example "
    "research_report -> source_material.",
    "If you create a workflow container and then add internal nodes to it, emit "
    "add_workflow_container first; later operations may use that node_id as "
    "scope_workflow_id.",
    "Set input_ports and output_ports to null unless you are defining named non-main ports.",
    "For follow-up messages, treat the latest canvas_snapshot as the source of truth; "
    "use prior conversation and previous_proposal only as context for the requested revision.",
    "Every add_existing_callable_node, create_temporary_agent_template, and "
    "update_output_schema operation must include a strict output_schema whose fields match "
    "the node's user_prompt. If the prompt asks for ticker/company_name/industry/sources, "
    "the schema must declare those exact fields; use summary/artifacts only for generic "
    "natural-language summaries.",
    "output_schema must be a strict JSON object schema: type=object, "
    "additionalProperties=false, non-empty properties, and required may reference only "
    "declared properties.",
    "Supported output_schema property types are string, number, integer, boolean, "
    "array<string>, array<object>, and nested strict object. Do not use anyOf, oneOf, "
    "allOf, $ref, patternProperties, or other advanced JSON Schema keywords.",
    "Phase 2 does not persist new resources; new agents must use "
    "create_temporary_agent_template and remain non-runnable until GraphOps persistence.",
    "Persistent agent, tool, or workflow creation must go through GraphOps proposal; "
    "the authoring agent must not write durable resources directly.",
)
AUTHORING_RULES_DIGEST = hashlib.sha256(
    "\n".join(AUTHORING_CORE_RULES).encode("utf-8")
).hexdigest()
AUTHORING_OUTPUT_ALLOWED_KEYS = frozenset(
    {
        "schema_version",
        "assistant_message",
        "proposal_kind",
        "proposal",
        "questions",
        "risk_notes",
        "confidence",
    }
)


def strict_object(
    properties: dict[str, Any],
    *,
    required: list[str] | None = None,
    nullable: bool = False,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": ["object", "null"] if nullable else "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required if required is not None else list(properties),
    }
    return schema


NULLABLE_STRING: dict[str, Any] = {"type": ["string", "null"]}
NULLABLE_BOOLEAN: dict[str, Any] = {"type": ["boolean", "null"]}
POSITION_SCHEMA = strict_object(
    {
        "x": {"type": "number"},
        "y": {"type": "number"},
    }
)
PORT_VIEW_SCHEMA = strict_object(
    {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "direction": {"type": "string", "enum": ["input", "output"]},
        "required": {"type": ["boolean", "null"]},
        "cardinality": NULLABLE_STRING,
        "artifactTypes": {
            "type": ["array", "null"],
            "items": {"type": "string"},
        },
    }
)
PORT_VIEW_ARRAY_SCHEMA: dict[str, Any] = {
    "type": ["array", "null"],
    "items": PORT_VIEW_SCHEMA,
}
PORT_CONTRACT_SCHEMA = strict_object(
    {
        "type": {"type": "string"},
        "required": {"type": "boolean"},
        "cardinality": {"type": "string"},
    }
)
PORT_CONTRACTS_SCHEMA = strict_object({"main": PORT_CONTRACT_SCHEMA})
SIMPLE_INPUT_SCHEMA = strict_object(
    {
        "user_prompt": {"type": "string"},
    },
    nullable=True,
)
NODE_SCHEMA_PROPERTY_REF: dict[str, Any] = {"$ref": "#/$defs/nodeSchemaProperty"}
NODE_SCHEMA_PROPERTIES_MAP: dict[str, Any] = {
    "type": "object",
    "minProperties": 1,
    "additionalProperties": NODE_SCHEMA_PROPERTY_REF,
}
NODE_OUTPUT_SCHEMA_SCHEMA = strict_object(
    {
        "type": {"type": "string", "enum": ["object"]},
        "additionalProperties": {"type": "boolean", "enum": [False]},
        "properties": NODE_SCHEMA_PROPERTIES_MAP,
        "required": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    nullable=True,
)
ARTIFACT_CONTRACT_SCHEMA = strict_object({"output_schema": NODE_OUTPUT_SCHEMA_SCHEMA})
AGENT_DRAFT_SCHEMA = strict_object(
    {
        "id": {"type": "string"},
        "version": {"type": "string"},
        "runtime": {
            "type": "string",
            "enum": ["codex_app_server", "codex_cli", "claude_sdk", "generic_cli"],
        },
        "name": {"type": "string"},
        "description": {"type": "string"},
        "default_prompt": {"type": "string"},
        "input_ports": PORT_CONTRACTS_SCHEMA,
        "output_ports": PORT_CONTRACTS_SCHEMA,
        "artifact_contract": ARTIFACT_CONTRACT_SCHEMA,
        "metadata": strict_object(
            {
                "temporary": {"type": "boolean"},
                "generated_by": {"type": "string"},
            }
        ),
    }
)
DATA_ENDPOINT_SCHEMA = strict_object(
    {
        "node": {"type": "string"},
        "port": {"type": "string"},
    }
)
AUTHORING_TARGET_SCHEMA: dict[str, Any] = {
    "anyOf": [
        strict_object(
            {
                "kind": {"type": "string", "enum": ["task_canvas"]},
                "task_id": {"type": "string"},
            }
        ),
        strict_object(
            {
                "kind": {"type": "string", "enum": ["workflow"]},
                "workflow_id": {"type": "string"},
            }
        ),
        strict_object(
            {
                "kind": {"type": "string", "enum": ["internal_node"]},
                "workflow_id": {"type": "string"},
                "node_id": {"type": "string"},
            }
        ),
        strict_object(
            {
                "kind": {"type": "string", "enum": ["edge"]},
                "edge_id": {"type": "string"},
                "scope_workflow_id": NULLABLE_STRING,
            }
        ),
        strict_object(
            {
                "kind": {"type": "string", "enum": ["port"]},
                "workflow_id": {"type": "string"},
                "port_id": {"type": "string"},
                "direction": {"type": "string", "enum": ["input", "output"]},
            }
        ),
    ]
}
AUTHORING_OPERATION_SCHEMA: dict[str, Any] = {
    "anyOf": [
        strict_object(
            {
                "op": {"type": "string", "enum": ["add_existing_callable_node"]},
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "callable_id": {"type": "string"},
                "callable_kind": {"type": "string", "enum": ["agent_class", "tool_class"]},
                "label": {"type": "string"},
                "position": POSITION_SCHEMA,
                "input": SIMPLE_INPUT_SCHEMA,
                "input_ports": PORT_VIEW_ARRAY_SCHEMA,
                "output_ports": PORT_VIEW_ARRAY_SCHEMA,
                "output_schema": NODE_OUTPUT_SCHEMA_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["add_workflow_container"]},
                "scope_workflow_id": {"type": "null"},
                "node_id": {"type": "string"},
                "label": {"type": "string"},
                "workflow_ref": NULLABLE_STRING,
                "position": POSITION_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["update_invocation_input"]},
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "input": SIMPLE_INPUT_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["update_invocation_label"]},
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "label": {"type": "string"},
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["update_output_schema"]},
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "output_schema": NODE_OUTPUT_SCHEMA_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["set_ports"]},
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "input_ports": PORT_VIEW_ARRAY_SCHEMA,
                "output_ports": PORT_VIEW_ARRAY_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["add_control_edge"]},
                "scope_workflow_id": NULLABLE_STRING,
                "from": {"type": "string"},
                "to": {"type": "string"},
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["add_data_edge"]},
                "scope_workflow_id": NULLABLE_STRING,
                "from": DATA_ENDPOINT_SCHEMA,
                "to": DATA_ENDPOINT_SCHEMA,
                "materialization": {"type": "string", "enum": ["copy", "reference"]},
                "replace_existing": NULLABLE_BOOLEAN,
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["remove_edge"]},
                "scope_workflow_id": NULLABLE_STRING,
                "edge_id": {"type": "string"},
            }
        ),
        strict_object(
            {
                "op": {"type": "string", "enum": ["create_temporary_agent_template"]},
                "scope_workflow_id": NULLABLE_STRING,
                "draft_id": {"type": "string"},
                "node_id": {"type": "string"},
                "label": {"type": "string"},
                "position": POSITION_SCHEMA,
                "agent_draft": AGENT_DRAFT_SCHEMA,
                "input": SIMPLE_INPUT_SCHEMA,
                "output_schema": NODE_OUTPUT_SCHEMA_SCHEMA,
            }
        ),
        strict_object(
            {
                "op": {
                    "type": "string",
                    "enum": ["replace_temporary_template_with_existing_callable"],
                },
                "scope_workflow_id": NULLABLE_STRING,
                "node_id": {"type": "string"},
                "temporary_resource_id": {"type": "string"},
                "callable_id": {"type": "string"},
                "callable_kind": {"type": "string", "enum": ["agent_class", "tool_class"]},
            }
        ),
    ]
}
CANVAS_AUTHORING_PROPOSAL_SCHEMA = strict_object(
    {
        "proposal_id": {"type": "string"},
        "base_task_id": {"type": "string"},
        "base_canvas_hash": {"type": "string"},
        "target": AUTHORING_TARGET_SCHEMA,
        "rationale": {"type": "string"},
        "operations": {
            "type": "array",
            "items": AUTHORING_OPERATION_SCHEMA,
        },
    },
    nullable=True,
)
AUTHORING_OUTPUT_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$defs": {
        "nodeSchemaProperty": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["string", "number", "integer", "boolean", "array", "object"],
                },
                "description": NULLABLE_STRING,
                "items": {
                    "anyOf": [
                        NODE_SCHEMA_PROPERTY_REF,
                        {"type": "null"},
                    ]
                },
                "properties": {
                    "anyOf": [
                        NODE_SCHEMA_PROPERTIES_MAP,
                        {"type": "null"},
                    ]
                },
                "required": {
                    "type": ["array", "null"],
                    "items": {"type": "string"},
                },
                "additionalProperties": {"type": ["boolean", "null"], "enum": [False, None]},
            },
            "required": ["type"],
        }
    },
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "schema_version": {"type": "string", "enum": [AUTHORING_OUTPUT_SCHEMA_VERSION]},
        "assistant_message": {"type": "string"},
        "proposal_kind": {"type": "string", "enum": ["canvas"]},
        "proposal": CANVAS_AUTHORING_PROPOSAL_SCHEMA,
        "questions": {"type": "array", "items": {"type": "string"}},
        "risk_notes": {"type": "array", "items": {"type": "string"}},
        "confidence": {"enum": ["low", "medium", "high"]},
    },
    "required": [
        "schema_version",
        "assistant_message",
        "proposal_kind",
        "proposal",
        "questions",
        "risk_notes",
        "confidence",
    ],
}
ALLOWED_AUTHORING_RUNTIMES = frozenset(
    {"codex_app_server", "codex_cli", "claude_sdk", "generic_cli"}
)
ALLOWED_AUTHORING_OPERATIONS = frozenset(
    {
        "add_existing_callable_node",
        "add_workflow_container",
        "update_invocation_input",
        "update_invocation_label",
        "update_output_schema",
        "set_ports",
        "add_control_edge",
        "add_data_edge",
        "remove_edge",
        "create_temporary_agent_template",
        "replace_temporary_template_with_existing_callable",
    }
)
TEMPORARY_CALLABLE_PREFIX = "tmp_agent_"
AUTHORING_SESSION_ROOT = Path("runs") / "_authoring_sessions"


class AuthoringSessionService:
    def __init__(
        self,
        project_root: Path,
        *,
        callable_registry: CallableRegistry | None = None,
        runner: CallableClassRunner | None = None,
    ) -> None:
        self.project_root = project_root.resolve()
        self.callable_registry = callable_registry or CallableRegistry.from_project_root(
            self.project_root
        )
        self.runner = runner or CallableClassRunner()

    def list_agents(self) -> dict[str, Any]:
        agents = [
            authoring_agent_summary(asset, self.project_root)
            for asset in self.callable_registry.iter_assets()
            if is_authoring_agent(asset)
        ]
        return {"agents": agents}

    def create_session(
        self,
        *,
        agent_id: str | None,
        task_id: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        selection: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        selected_agent = self._select_agent(agent_id)
        session_id = f"authoring_{uuid4().hex[:12]}"
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=False)
        context = self._context_snapshot(
            task_id=task_id,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
            selection=selection,
        )
        state = {
            "session_id": session_id,
            "agent_id": selected_agent.template.id,
            "task_id": task_id,
            "status": "ready",
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "context_snapshot_ref": "context_snapshot.json",
            "last_proposal": None,
            "validation": None,
            "required_actions": [],
        }
        write_json(session_dir / "session.json", state)
        write_json(session_dir / "context_snapshot.json", context)
        return self._session_payload(session_id)

    def get_session(self, session_id: str) -> dict[str, Any]:
        self._require_session(session_id)
        return self._session_payload(session_id)

    async def post_message(
        self,
        session_id: str,
        *,
        message: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        selection: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        session_dir = self._require_session(session_id)
        state = self._load_state(session_id)
        if not message.strip():
            raise AccError("Authoring message is required")

        request_intent = infer_authoring_request_intent(message)
        context = self._context_snapshot(
            task_id=str(canvas_snapshot.get("task_id") or state.get("task_id") or ""),
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
            selection=selection,
            request_intent=request_intent,
        )
        write_json(session_dir / "context_snapshot.json", context)
        self._append_message(
            session_dir,
            {"role": "user", "content": message, "created_at": utc_now_iso()},
        )

        output = await self._run_authoring_agent(
            session_id=session_id,
            state=state,
            message=message,
            context=context,
        )
        proposal = output.get("proposal")
        validation = self.validate_proposal(
            proposal=proposal if isinstance(proposal, dict) else None,
            task_id=context["task_id"],
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
            request_intent=request_intent,
        )
        required_actions = required_actions_for_output(output, validation)
        assistant_message = str(output.get("assistant_message") or "")
        self._append_message(
            session_dir,
            {"role": "assistant", "content": assistant_message, "created_at": utc_now_iso()},
        )
        next_state = {
            **state,
            "status": "proposal_ready"
            if proposal and validation["status"] == "valid"
            else "needs_attention",
            "task_id": context["task_id"],
            "updated_at": utc_now_iso(),
            "last_proposal": proposal,
            "validation": validation,
            "required_actions": required_actions,
        }
        write_json(session_dir / "session.json", next_state)
        write_json(session_dir / "agent_output.json", output)
        write_json(session_dir / "validation.json", validation)
        return {
            "session_id": session_id,
            "message_id": f"msg_{uuid4().hex[:12]}",
            "assistant_message": assistant_message,
            "proposal": proposal,
            "validation": validation,
            "required_actions": required_actions,
            "questions": output.get("questions") or [],
            "risk_notes": output.get("risk_notes") or [],
            "confidence": output.get("confidence") or "low",
        }

    def validate_proposal(
        self,
        *,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        temporary_resources: dict[str, Any] | None = None,
        request_intent: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        if proposal is None:
            return {
                "status": "invalid",
                "errors": [{"code": "proposal_missing", "message": "Proposal is required"}],
                "warnings": [],
            }
        if proposal.get("base_task_id") != task_id:
            errors.append(
                {
                    "code": "stale_task",
                    "message": "Proposal belongs to a different task",
                }
            )
        if proposal.get("base_canvas_hash") != canvas_hash:
            errors.append(
                {
                    "code": "stale_canvas",
                    "message": "Canvas changed after this proposal was generated",
                }
            )
        operations = proposal.get("operations")
        if not isinstance(operations, list) or not operations:
            errors.append(
                {"code": "operations_missing", "message": "Proposal operations are required"}
            )
            operations = []
        errors.extend(
            self._operation_errors(
                operations,
                canvas_snapshot=canvas_snapshot,
                temporary_resources=temporary_resources or {},
            )
        )
        if request_intent and should_enforce_workflow_intent_guard(proposal, operations):
            errors.extend(
                proposal_intent_errors(
                    operations,
                    request_intent=request_intent,
                )
            )
        if any(
            isinstance(operation, dict) and operation.get("op") == "create_temporary_agent_template"
            for operation in operations
        ):
            warnings.append(
                {
                    "code": "temporary_resource_unresolved",
                    "message": (
                        "Temporary agent templates must be persisted or replaced "
                        "before run/save"
                    ),
                }
            )
        return {
            "status": "invalid" if errors else "valid",
            "errors": errors,
            "warnings": warnings,
        }

    def dry_run_proposal(
        self,
        *,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        temporary_resources: dict[str, Any] | None = None,
        request_intent: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        validation = self.validate_proposal(
            proposal=proposal,
            task_id=task_id,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
            temporary_resources=temporary_resources,
            request_intent=request_intent,
        )
        operations = proposal.get("operations") if isinstance(proposal, dict) else []
        operation_counts: dict[str, int] = {}
        if isinstance(operations, list):
            for operation in operations:
                if isinstance(operation, dict):
                    op_name = str(operation.get("op") or "unknown")
                    operation_counts[op_name] = operation_counts.get(op_name, 0) + 1
        return {
            "status": validation["status"],
            "validation": validation,
            "operation_counts": operation_counts,
            "semantic_summary": semantic_summary_for_operations(operation_counts),
            "writes": {"workflows": 0, "callables": 0, "runs": 0},
        }

    def _select_agent(self, agent_id: str | None) -> CallableAsset:
        candidates = [
            asset for asset in self.callable_registry.iter_assets() if is_authoring_agent(asset)
        ]
        if agent_id:
            for asset in candidates:
                if asset.template.id == agent_id:
                    return asset
            raise AccError(f"Authoring agent not found or unsupported: {agent_id}")
        if not candidates:
            raise AccError("No supported authoring agents found")
        return candidates[0]

    def _context_snapshot(
        self,
        *,
        task_id: str,
        canvas_hash: str,
        canvas_snapshot: dict[str, Any],
        selection: dict[str, Any] | None,
        request_intent: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "schema_version": "acc.authoring.context.v1",
            "task_id": task_id or str(canvas_snapshot.get("id") or ""),
            "canvas_hash": canvas_hash,
            "canvas_snapshot": strip_runtime_state(canvas_snapshot),
            "selection": selection or {},
            "request_intent": request_intent or {},
            "callable_catalog": [
                callable_context_summary(asset, self.project_root)
                for asset in self.callable_registry.iter_assets()
            ],
            "workflow_catalog": workflow_catalog(self.project_root),
            "created_at": utc_now_iso(),
        }

    async def _run_authoring_agent(
        self,
        *,
        session_id: str,
        state: dict[str, Any],
        message: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        session_dir = self._session_dir(session_id)
        if acc_run_mode() == HERMETIC_RUN_MODE:
            output = hermetic_authoring_output(message=message, context=context)
            write_json(session_dir / "agent_output.json", output)
            (session_dir / "agent_output_raw.txt").write_text(
                json.dumps(output, ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )
            return output

        agent_id = str(state.get("agent_id") or "")
        asset = self._select_agent(agent_id)
        output = await self._invoke_external_authoring_agent(
            asset,
            session_id,
            message,
            context,
            state,
        )
        return parse_authoring_output(
            self._session_dir(session_id) / "agent_output_raw.txt",
            json.dumps(output, ensure_ascii=False) if isinstance(output, dict) else str(output),
        )

    async def _invoke_external_authoring_agent(
        self,
        asset: CallableAsset,
        session_id: str,
        message: str,
        context: dict[str, Any],
        state: dict[str, Any],
    ) -> dict[str, Any]:
        if not isinstance(asset.template, AgentClassTemplate):
            raise AccError(f"Authoring callable is not an agent: {asset.source_id}")
        session_dir = self._session_dir(session_id)
        run_dir = session_dir / "agent_run"
        workspace_dir = session_dir / "workspace"
        for path in (
            run_dir,
            workspace_dir,
            run_dir / "inbox",
            run_dir / "outbox",
            run_dir / "artifacts",
            run_dir / "behavior",
        ):
            path.mkdir(parents=True, exist_ok=True)
        template = replace(
            asset.template,
            artifact_contract={
                **asset.template.artifact_contract,
                "output_schema": copy.deepcopy(AUTHORING_OUTPUT_SCHEMA),
            },
        )
        runner_asset = replace(asset, template=template)
        node = NodeInvocationSpec(
            id="authoring_request",
            callable_ref=CallableRef(kind="agent_class", id=template.id),
            invocation_policy=InvocationPolicy(
                timeout_seconds=AUTHORING_AGENT_TIMEOUT_SECONDS,
                permission_profile=authoring_permission_profile(),
            ),
            prompt_policy=PromptPolicy(user_prompt=authoring_prompt(message)),
            output_schema=copy.deepcopy(AUTHORING_OUTPUT_SCHEMA),
        )
        scope = ScopeFrame(
            frame_id="authoring_scope",
            invocation_id=session_id,
            parent_frame_id=None,
            call_depth=0,
            workflow_id="authoring_session",
            workspace_root=workspace_dir.resolve(),
            environment_root=run_dir.resolve(),
            inbox_root=(run_dir / "inbox").resolve(),
            outbox_root=(run_dir / "outbox").resolve(),
            artifact_root=(run_dir / "artifacts").resolve(),
            behavior_snapshot_path=(run_dir / "behavior").resolve(),
            ephemeral=True,
        )
        session = SessionInstance(
            session_id=session_id,
            invocation_id=session_id,
            scope_frame_id=scope.frame_id,
            node_id=node.id,
            callable_ref=node.callable_ref,
            callable_kind="agent_class",
            status="running",
            cwd=workspace_dir.resolve(),
            env_keys=(),
            input_path=run_dir / "input.json",
            output_path=run_dir / "output.json",
            artifact_dir=run_dir / "artifacts",
            event_log_path=run_dir / "events.jsonl",
        )
        input_payload = {
            "schema_version": "acc.authoring.request.v1",
            "message": message,
            "context": context,
            "conversation": conversation_context_payload(
                read_messages(session_dir / "messages.jsonl")
            ),
            "previous_proposal": state.get("last_proposal")
            if isinstance(state.get("last_proposal"), dict)
            else None,
            "previous_validation": state.get("validation")
            if isinstance(state.get("validation"), dict)
            else None,
            "policy": {
                "authoring_prompt_version": AUTHORING_PROMPT_VERSION,
                "authoring_rules_digest": AUTHORING_RULES_DIGEST,
                "no_custom_llm_loop": True,
                "no_persistent_writes": True,
                "output_schema": AUTHORING_OUTPUT_SCHEMA_VERSION,
            },
        }
        output = await self.runner.run_agent_class(
            runner_asset,
            input_payload,
            run_dir,
            AgentExecutionContext(
                node=node,
                scope=scope,
                session=session,
                binding_materializations=[],
            ),
        )
        raw = json.dumps(output, ensure_ascii=False)
        (self._session_dir(session_id) / "agent_output_raw.txt").write_text(raw, encoding="utf-8")
        return output

    def _operation_errors(
        self,
        operations: list[Any],
        *,
        canvas_snapshot: dict[str, Any],
        temporary_resources: dict[str, Any],
    ) -> list[dict[str, Any]]:
        errors: list[dict[str, Any]] = []
        callable_keys = {
            (asset_kind(asset), asset.template.id) for asset in self.callable_registry.iter_assets()
        }
        workflows = [
            node
            for node in canvas_snapshot.get("workflows", [])
            if isinstance(node, dict) and node.get("id")
        ]
        root_node_ids = {str(node.get("id")) for node in workflows}
        pending_root_ids = set(root_node_ids)

        def is_executable_workflow_node(node: dict[str, Any]) -> bool:
            if node.get("boundaryKind"):
                return False
            source_kind = node.get("sourceKind")
            return not (source_kind == "workflow" or not source_kind)

        container_scope_ids = {
            str(node.get("id")) for node in workflows if not is_executable_workflow_node(node)
        }
        internal_node_ids_by_scope: dict[str, set[str]] = {}
        for workflow in workflows:
            workflow_id = str(workflow.get("id"))
            internal_nodes = (
                workflow.get("internalNodes")
                if isinstance(workflow.get("internalNodes"), list)
                else []
            )
            internal_node_ids_by_scope[workflow_id] = {
                str(node.get("id"))
                for node in internal_nodes
                if isinstance(node, dict) and node.get("id")
            }
            internal_node_ids_by_scope[workflow_id].add(f"{workflow_id}__workflow_inputs")
            internal_node_ids_by_scope[workflow_id].add(f"{workflow_id}__workflow_outputs")

        def operation_scope_error(scope_workflow_id: Any) -> dict[str, Any] | None:
            if scope_workflow_id is None:
                return None
            if not isinstance(scope_workflow_id, str) or scope_workflow_id not in pending_root_ids:
                return {
                    "code": "authoring_scope_unknown",
                    "message": f"Authoring scope is not present: {scope_workflow_id}",
                }
            if scope_workflow_id not in container_scope_ids:
                return {
                    "code": "authoring_scope_not_container",
                    "message": f"Authoring scope is not a workflow container: {scope_workflow_id}",
                }
            return None

        def node_ids_for_scope(scope_workflow_id: Any) -> set[str]:
            if scope_workflow_id is None:
                return pending_root_ids
            if not isinstance(scope_workflow_id, str):
                return set()
            return internal_node_ids_by_scope.get(scope_workflow_id, set())

        def node_exists_in_scope(scope_workflow_id: Any, node_id: Any) -> bool:
            return isinstance(node_id, str) and node_id in node_ids_for_scope(scope_workflow_id)

        def existing_node_in_scope(scope_workflow_id: Any, node_id: Any) -> dict[str, Any] | None:
            if not isinstance(node_id, str):
                return None
            candidates = workflows if scope_workflow_id is None else []
            if isinstance(scope_workflow_id, str):
                for workflow in workflows:
                    if workflow.get("id") == scope_workflow_id:
                        candidates = (
                            workflow.get("internalNodes")
                            if isinstance(workflow.get("internalNodes"), list)
                            else []
                        )
                        break
            for candidate in candidates:
                if isinstance(candidate, dict) and candidate.get("id") == node_id:
                    return candidate
            return None

        def reserve_node_id(scope_workflow_id: Any, node_id: Any) -> bool:
            if not isinstance(node_id, str) or not node_id:
                errors.append({"code": "node_id_missing", "message": "Operation requires node_id"})
                return False
            ids = node_ids_for_scope(scope_workflow_id)
            if node_id in ids:
                qualified = (
                    f"{scope_workflow_id}.{node_id}"
                    if isinstance(scope_workflow_id, str)
                    else node_id
                )
                errors.append(
                    {
                        "code": "duplicate_node_id",
                        "message": f"Node id already exists in proposal scope: {qualified}",
                    }
                )
                return False
            ids.add(node_id)
            if scope_workflow_id is None:
                pending_root_ids.add(node_id)
            elif isinstance(scope_workflow_id, str):
                internal_node_ids_by_scope[scope_workflow_id] = ids
            return True

        for index, operation in enumerate(operations):
            if not isinstance(operation, dict):
                errors.append(
                    {
                        "code": "operation_invalid",
                        "message": f"Operation {index} must be an object",
                    }
                )
                continue
            op_name = operation.get("op")
            if op_name not in ALLOWED_AUTHORING_OPERATIONS:
                errors.append(
                    {
                        "code": "operation_forbidden",
                        "message": f"Unsupported authoring operation: {op_name}",
                    }
                )
                continue
            scope_workflow_id = operation.get("scope_workflow_id")
            scope_error = operation_scope_error(scope_workflow_id)
            if scope_error:
                errors.append(scope_error)
                continue
            node_id = operation.get("node_id")
            if op_name in {
                "add_existing_callable_node",
                "add_workflow_container",
                "create_temporary_agent_template",
            }:
                reserved = reserve_node_id(scope_workflow_id, node_id)
                if op_name == "add_workflow_container" and reserved and isinstance(node_id, str):
                    container_scope_ids.add(node_id)
                    internal_node_ids_by_scope[node_id] = {
                        f"{node_id}__workflow_inputs",
                        f"{node_id}__workflow_outputs",
                    }
            if op_name == "add_existing_callable_node":
                callable_kind = operation.get("callable_kind")
                callable_id = operation.get("callable_id")
                if (callable_kind, callable_id) not in callable_keys:
                    errors.append(
                        {
                            "code": "unknown_callable",
                            "message": f"Unknown callable: {callable_kind}:{callable_id}",
                        }
                    )
            if op_name == "create_temporary_agent_template":
                draft_id = operation.get("draft_id")
                if not isinstance(draft_id, str) or not draft_id.startswith(
                    TEMPORARY_CALLABLE_PREFIX
                ):
                    errors.append(
                        {
                            "code": "temporary_id_invalid",
                            "message": "Temporary agent draft ids must start with tmp_agent_",
                        }
                    )
                agent_draft = operation.get("agent_draft")
                if not isinstance(agent_draft, dict):
                    errors.append(
                        {
                            "code": "temporary_agent_draft_missing",
                            "message": "Temporary agent template operation requires agent_draft",
                        }
                    )
                else:
                    artifact_contract = agent_draft.get("artifact_contract")
                    if isinstance(artifact_contract, dict):
                        errors.extend(
                            output_schema_operation_errors(
                                artifact_contract.get("output_schema"),
                                f"operation {index}.agent_draft.artifact_contract.output_schema",
                            )
                        )
            errors.extend(
                output_schema_operation_errors(
                    operation.get("output_schema"),
                    f"operation {index}.output_schema",
                )
            )
            schema_prompt = operation_prompt_for_schema_check(
                operation,
                existing_node=existing_node_in_scope(scope_workflow_id, node_id),
            )
            errors.extend(
                output_schema_prompt_alignment_errors(
                    operation.get("output_schema"),
                    schema_prompt,
                    f"operation {index}.output_schema",
                )
            )
            if op_name == "replace_temporary_template_with_existing_callable":
                resource_id = operation.get("temporary_resource_id")
                if resource_id not in temporary_resources:
                    errors.append(
                        {
                            "code": "temporary_resource_unknown",
                            "message": f"Temporary resource is not known: {resource_id}",
                        }
                    )
            if op_name in {
                "update_invocation_input",
                "update_invocation_label",
                "update_output_schema",
                "set_ports",
            } and not node_exists_in_scope(scope_workflow_id, node_id):
                errors.append(
                    {
                        "code": "target_node_unknown",
                        "message": f"Target node is not present in the canvas: {node_id}",
                    }
                )
            if op_name == "add_control_edge":
                source = operation.get("from")
                target = operation.get("to")
                if not node_exists_in_scope(
                    scope_workflow_id, source
                ) or not node_exists_in_scope(scope_workflow_id, target):
                    errors.append(
                        {
                            "code": "edge_endpoint_unknown",
                            "message": "Control edge endpoints must exist before the edge is added",
                        }
                    )
            if op_name == "add_data_edge":
                source = operation.get("from")
                target = operation.get("to")
                scoped_node_ids = node_ids_for_scope(scope_workflow_id)
                if not endpoint_exists(source, scoped_node_ids) or not endpoint_exists(
                    target, scoped_node_ids
                ):
                    errors.append(
                        {
                            "code": "edge_endpoint_unknown",
                            "message": "Data edge endpoints must exist before the edge is added",
                        }
                    )
                elif source.get("port") == "main" and target.get("port") == "main":
                    errors.append(
                        {
                            "code": "main_to_main_data_edge_forbidden",
                            "message": (
                                "Explicit main-to-main data edges are forbidden; use "
                                "add_control_edge for sequential main flow."
                            ),
                            "repair_hint": (
                                "Remove the add_data_edge operation and keep/add "
                                "add_control_edge from source node to target node."
                            ),
                        }
                    )
        return errors

    def _session_dir(self, session_id: str) -> Path:
        validate_session_id(session_id)
        return self.project_root / AUTHORING_SESSION_ROOT / session_id

    def _require_session(self, session_id: str) -> Path:
        session_dir = self._session_dir(session_id)
        if not (session_dir / "session.json").exists():
            raise AccError(f"Authoring session not found: {session_id}")
        return session_dir

    def _load_state(self, session_id: str) -> dict[str, Any]:
        payload = load_json(self._session_dir(session_id) / "session.json")
        if not isinstance(payload, dict):
            raise AccError(f"Authoring session state is invalid: {session_id}")
        return payload

    def _session_payload(self, session_id: str) -> dict[str, Any]:
        session_dir = self._require_session(session_id)
        state = self._load_state(session_id)
        return {
            **state,
            "messages": read_messages(session_dir / "messages.jsonl"),
            "evidence": {
                "session": relative_path(self.project_root, session_dir / "session.json"),
                "context_snapshot": relative_path(
                    self.project_root, session_dir / "context_snapshot.json"
                ),
                "agent_output_raw": relative_path(
                    self.project_root, session_dir / "agent_output_raw.txt"
                )
                if (session_dir / "agent_output_raw.txt").exists()
                else None,
                "validation": relative_path(self.project_root, session_dir / "validation.json")
                if (session_dir / "validation.json").exists()
                else None,
            },
        }

    def _append_message(self, session_dir: Path, payload: dict[str, Any]) -> None:
        with (session_dir / "messages.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def is_authoring_agent(asset: CallableAsset) -> bool:
    template = asset.template
    return (
        isinstance(template, AgentClassTemplate) and template.runtime in ALLOWED_AUTHORING_RUNTIMES
    )


def authoring_agent_summary(asset: CallableAsset, project_root: Path) -> dict[str, Any]:
    template = asset.template
    if not isinstance(template, AgentClassTemplate):
        raise AccError(f"Callable asset is not an AgentClassTemplate: {asset.source_id}")
    return {
        "id": template.id,
        "version": template.version,
        "kind": "agent_class",
        "runtime": template.runtime,
        "backend": asset.backend,
        "source_id": asset.source_id,
        "source_path": relative_path(project_root, asset.source_path)
        if asset.source_path
        else None,
        "name": template.metadata.get("name") or template.id,
        "description": template.metadata.get("description"),
        "default_permissions": permission_payload(authoring_permission_profile()),
    }


def callable_context_summary(asset: CallableAsset, project_root: Path) -> dict[str, Any]:
    template = asset.template
    payload: dict[str, Any] = {
        "id": template.id,
        "version": template.version,
        "kind": asset_kind(asset),
        "backend": asset.backend,
        "source_id": asset.source_id,
        "source_path": relative_path(project_root, asset.source_path)
        if asset.source_path
        else None,
        "name": template.metadata.get("name") or template.id,
        "description": template.metadata.get("description"),
        "input_ports": {key: value.__dict__ for key, value in template.input_ports.items()},
        "output_ports": {key: value.__dict__ for key, value in template.output_ports.items()},
        "artifact_contract": template.artifact_contract,
        "authoring_capable": is_authoring_agent(asset),
    }
    if hasattr(template, "runtime"):
        payload["runtime"] = template.runtime
    if hasattr(template, "runner"):
        payload["runner"] = template.runner
    return payload


def asset_kind(asset: CallableAsset) -> str:
    return "agent_class" if isinstance(asset.template, AgentClassTemplate) else "tool_class"


def authoring_permission_profile() -> PermissionProfile:
    return PermissionProfile(
        workspace_access="read_only",
        network=False,
        shell=False,
        dangerous=False,
        env_policy="acc_whitelist",
        allowed_env=(),
        timeout_seconds=AUTHORING_AGENT_TIMEOUT_SECONDS,
    )


def permission_payload(profile: PermissionProfile) -> dict[str, Any]:
    return {
        "workspace_access": profile.workspace_access,
        "network": profile.network,
        "shell": profile.shell,
        "dangerous": profile.dangerous,
        "env_policy": profile.env_policy,
        "allowed_env": list(profile.allowed_env),
        "timeout_seconds": profile.timeout_seconds,
    }


def parse_authoring_output(raw_path: Path, raw_text: str) -> dict[str, Any]:
    raw_path.write_text(raw_text, encoding="utf-8")
    decoder = json.JSONDecoder()
    try:
        payload, end_index = decoder.raw_decode(raw_text)
    except json.JSONDecodeError as exc:
        raise AccError(f"Authoring agent output is not valid JSON: {exc.msg}") from exc
    if raw_text[end_index:].strip():
        raise AccError("Authoring agent output must contain exactly one JSON object")
    if not isinstance(payload, dict):
        raise AccError("Authoring agent output must be a JSON object")
    validate_authoring_output_payload(payload)
    return payload


def validate_authoring_output_payload(payload: dict[str, Any]) -> None:
    extra_keys = sorted(set(payload) - AUTHORING_OUTPUT_ALLOWED_KEYS)
    if extra_keys:
        raise AccError(
            "Authoring agent output contains unsupported fields: " + ", ".join(extra_keys)
        )
    if payload.get("schema_version") != AUTHORING_OUTPUT_SCHEMA_VERSION:
        raise AccError("Authoring agent output schema_version is invalid")
    if payload.get("proposal_kind") != "canvas":
        raise AccError("Only canvas authoring proposals are supported in Phase 2")
    for key in ("assistant_message", "confidence"):
        if not isinstance(payload.get(key), str):
            raise AccError(f"Authoring agent output {key} must be a string")
    for key in ("questions", "risk_notes"):
        value = payload.get(key)
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise AccError(f"Authoring agent output {key} must be a string array")
    proposal = payload.get("proposal")
    if proposal is not None and not isinstance(proposal, dict):
        raise AccError("Authoring agent output proposal must be an object or null")


def required_actions_for_output(
    output: dict[str, Any],
    validation: dict[str, Any],
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for question in output.get("questions") or []:
        actions.append({"kind": "ask", "prompt": question})
    proposal = output.get("proposal")
    operations = proposal.get("operations") if isinstance(proposal, dict) else []
    if validation.get("status") == "valid" and proposal:
        actions.append({"kind": "confirm_canvas_apply", "reason": "Review and apply proposal"})
    if isinstance(operations, list):
        for operation in operations:
            if (
                isinstance(operation, dict)
                and operation.get("op") == "create_temporary_agent_template"
            ):
                actions.append(
                    {
                        "kind": "approve_resource_persistence",
                        "resource_draft_id": operation.get("draft_id"),
                        "reason": (
                            "Temporary agent templates must be persisted or replaced "
                            "before run/save"
                        ),
                    }
                )
    if validation.get("status") == "invalid":
        actions.append({"kind": "reject_or_revise", "reason": "Proposal validation failed"})
    return actions


def hermetic_authoring_output(message: str, context: dict[str, Any]) -> dict[str, Any]:
    proposal = hermetic_canvas_proposal(message, context)
    return {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": "Hermetic authoring agent generated a canvas proposal.",
        "proposal_kind": "canvas",
        "proposal": proposal,
        "questions": [],
        "risk_notes": [],
        "confidence": "medium",
    }


def hermetic_canvas_proposal(message: str, context: dict[str, Any]) -> dict[str, Any] | None:
    task_id = str(context.get("task_id") or "")
    canvas_hash = str(context.get("canvas_hash") or "")
    canvas = (
        context.get("canvas_snapshot") if isinstance(context.get("canvas_snapshot"), dict) else {}
    )
    existing_ids = {
        str(node.get("id"))
        for node in canvas.get("workflows", [])
        if isinstance(node, dict) and node.get("id")
    }
    target = {"kind": "task_canvas", "task_id": task_id}
    if wants_temporary_agent(message):
        draft_id = unique_id("tmp_agent_authoring", existing_ids)
        return {
            "proposal_id": f"canvas_proposal_{uuid4().hex[:12]}",
            "base_task_id": task_id,
            "base_canvas_hash": canvas_hash,
            "target": target,
            "rationale": "Draft a temporary agent template on the current canvas only.",
            "operations": [
                {
                    "op": "create_temporary_agent_template",
                    "scope_workflow_id": None,
                    "draft_id": draft_id,
                    "node_id": draft_id,
                    "label": "Temporary Agent",
                    "position": next_position(canvas, 0),
                    "agent_draft": {
                        "id": draft_id,
                        "version": "0.1.0",
                        "runtime": "codex_app_server",
                        "name": "Temporary Agent",
                        "description": (
                            "Canvas-local draft generated by the Phase 2 "
                            "authoring service."
                        ),
                        "default_prompt": message,
                        "input_ports": {"main": port_contract_payload(required=False)},
                        "output_ports": {"main": port_contract_payload(required=True)},
                        "artifact_contract": {"output_schema": generic_output_schema(message)},
                        "metadata": {"temporary": True, "generated_by": "authoring_phase_2"},
                    },
                    "input": {"user_prompt": message},
                    "output_schema": generic_output_schema(message),
                }
            ],
        }
    callables = [
        item
        for item in context.get("callable_catalog", [])
        if isinstance(item, dict) and item.get("kind") == "agent_class"
    ][:2]
    if not callables:
        return None
    operations: list[dict[str, Any]] = []
    for index, callable_item in enumerate(callables):
        node_id = unique_id(
            slug_id(str(callable_item.get("name") or callable_item["id"])), existing_ids
        )
        existing_ids.add(node_id)
        operations.append(
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": node_id,
                "callable_id": callable_item["id"],
                "callable_kind": "agent_class",
                "label": callable_item.get("name") or callable_item["id"],
                "position": next_position(canvas, index),
                "input": {
                    "user_prompt": message
                    if index == 0
                    else f"Review and synthesize upstream work for: {message}"
                },
                "input_ports": [port_view_payload("main", "input", required=False)],
                "output_ports": [port_view_payload("main", "output", required=True)],
                "output_schema": generic_output_schema(message),
            }
        )
    if len(operations) >= 2:
        operations.append(
            {
                "op": "add_control_edge",
                "scope_workflow_id": None,
                "from": operations[0]["node_id"],
                "to": operations[1]["node_id"],
            }
        )
    return {
        "proposal_id": f"canvas_proposal_{uuid4().hex[:12]}",
        "base_task_id": task_id,
        "base_canvas_hash": canvas_hash,
        "target": target,
        "rationale": "Create a canvas-local workflow draft from existing callable templates.",
        "operations": operations,
    }


def authoring_system_contract() -> str:
    return "\n".join(
        [
            "You are ACC's backend authoring agent.",
            f"Authoring prompt version: {AUTHORING_PROMPT_VERSION}.",
            f"Authoring rules digest: {AUTHORING_RULES_DIGEST}.",
            "",
            "# ACC Authoring Contract",
            *[f"- {rule}" for rule in AUTHORING_CORE_RULES],
            "",
            "# Additional ACC Authoring References",
            "- docs/workbench_authoring_agent/skills/workbench_canvas_authoring.md",
            "- These references describe ACC rules only; do not rely on provider-specific "
            "AGENTS.md or skills auto-loading.",
        ]
    )


def authoring_prompt(message: str) -> str:
    return "\n".join([authoring_system_contract(), "", "User request:", message])


def wants_temporary_agent(message: str) -> bool:
    lowered = message.lower()
    return (
        "new agent" in lowered
        or "agent template" in lowered
        or "create agent" in lowered
        or "temporary agent" in lowered
    )


def generic_output_schema(message: str) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {
                "type": "string",
                "description": f"Result for: {message[:120]}",
            },
            "artifacts": {
                "type": "array",
                "description": "Artifact paths or references produced by the node.",
                "items": {"type": "string"},
            },
        },
        "required": ["summary"],
    }


FORBIDDEN_NODE_OUTPUT_SCHEMA_KEYS = frozenset(
    {
        "$ref",
        "anyOf",
        "oneOf",
        "allOf",
        "not",
        "patternProperties",
        "dependentSchemas",
        "if",
        "then",
        "else",
    }
)
SUPPORTED_NODE_OUTPUT_PROPERTY_TYPES = frozenset(
    {"string", "number", "integer", "boolean", "array", "object"}
)
PROMPT_FIELD_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ticker", ("ticker", "股票代码", "证券代码")),
    ("company_name", ("company_name", "公司名", "公司名称")),
    ("industry", ("industry", "所属行业", "行业")),
    ("core_business", ("core_business", "核心业务", "主营业务")),
    (
        "initial_research_hypothesis",
        ("initial_research_hypothesis", "初始研究假设", "研究假设"),
    ),
    ("selection_rationale", ("selection_rationale", "选择依据", "选择理由")),
    ("uncertainties", ("uncertainties", "不确定性", "不确定因素")),
    ("sources", ("sources", "来源", "数据源", "参考资料")),
    ("report_title", ("report_title", "报告标题")),
    ("executive_summary", ("executive_summary", "执行摘要", "摘要")),
    ("sections", ("sections", "报告章节", "章节")),
    ("risk_notes", ("risk_notes", "风险提示", "风险说明")),
)


def operation_prompt_for_schema_check(
    operation: dict[str, Any],
    *,
    existing_node: dict[str, Any] | None,
) -> str:
    input_payload = operation.get("input") if isinstance(operation.get("input"), dict) else {}
    prompt = input_payload.get("user_prompt") or input_payload.get("prompt")
    if isinstance(prompt, str):
        return prompt
    if existing_node:
        existing_input = (
            existing_node.get("input") if isinstance(existing_node.get("input"), dict) else {}
        )
        prompt = existing_input.get("user_prompt") or existing_input.get("prompt")
        if isinstance(prompt, str):
            return prompt
    return ""


def output_schema_prompt_alignment_errors(
    value: Any,
    prompt: str,
    path: str,
) -> list[dict[str, Any]]:
    if not prompt or not isinstance(value, dict):
        return []
    properties = value.get("properties")
    if not isinstance(properties, dict):
        return []
    missing = [
        field
        for field, hints in PROMPT_FIELD_HINTS
        if any(hint.lower() in prompt.lower() for hint in hints)
        and field not in properties
    ]
    if not missing:
        return []
    return [
        {
            "code": "output_schema_prompt_mismatch",
            "message": (
                f"{path}: output_schema is missing field(s) requested by user_prompt: "
                + ", ".join(missing)
            ),
            "path": path,
            "repair_hint": (
                "Add the requested field(s) to output_schema.properties and include them "
                "in required when the node must always produce them."
            ),
        }
    ]


def output_schema_operation_errors(value: Any, path: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, dict):
        return [
            {
                "code": "output_schema_invalid",
                "message": f"{path} must be a JSON object schema",
                "path": path,
                "repair_hint": "Provide output_schema as a JSON object.",
            }
        ]
    normalized = normalize_output_schema_for_structured_output(value)
    errors = [
        {
            **error,
            "message": f"{path}: {error.get('message', 'output_schema is invalid')}",
            "path": f"{path}.{error.get('path', '$')}",
        }
        for error in structured_output_schema_errors(normalized)
    ]
    errors.extend(supported_node_output_schema_errors(value, path))
    return errors


def supported_node_output_schema_errors(schema: dict[str, Any], path: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if schema.get("type") != "object":
        errors.append(output_schema_subset_error(path, "output_schema root type must be object"))
    if schema.get("additionalProperties") is not False:
        errors.append(
            output_schema_subset_error(
                path,
                "output_schema root must set additionalProperties=false",
            )
        )
    properties = schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        errors.append(
            output_schema_subset_error(path, "output_schema properties must be non-empty")
        )
        properties = {}
    required = schema.get("required")
    if required is not None:
        if not isinstance(required, list) or not all(isinstance(item, str) for item in required):
            errors.append(
                output_schema_subset_error(path, "output_schema required must be string[]")
            )
        else:
            unknown = sorted(set(required) - set(properties))
            if unknown:
                errors.append(
                    output_schema_subset_error(
                        path,
                        "output_schema required references unknown field(s): "
                        + ", ".join(unknown),
                    )
                )
    for key in schema:
        if key in FORBIDDEN_NODE_OUTPUT_SCHEMA_KEYS:
            errors.append(output_schema_subset_error(f"{path}.{key}", f"{key} is not supported"))
    for field_name, property_schema in properties.items():
        errors.extend(
            supported_node_property_schema_errors(
                property_schema,
                f"{path}.properties.{field_name}",
            )
        )
    return errors


def supported_node_property_schema_errors(value: Any, path: str) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return [output_schema_subset_error(path, "property schema must be an object")]
    errors: list[dict[str, Any]] = []
    for key in value:
        if key in FORBIDDEN_NODE_OUTPUT_SCHEMA_KEYS:
            errors.append(output_schema_subset_error(f"{path}.{key}", f"{key} is not supported"))
    schema_type = value.get("type")
    if schema_type not in SUPPORTED_NODE_OUTPUT_PROPERTY_TYPES:
        errors.append(
            output_schema_subset_error(
                path,
                "property type must be one of: "
                + ", ".join(sorted(SUPPORTED_NODE_OUTPUT_PROPERTY_TYPES)),
            )
        )
        return errors
    if schema_type != "array" and "items" in value:
        errors.append(output_schema_subset_error(f"{path}.items", "items is only valid for arrays"))
    if schema_type == "array":
        items = value.get("items")
        if not isinstance(items, dict):
            errors.append(output_schema_subset_error(f"{path}.items", "array must define items"))
        else:
            item_type = items.get("type")
            if item_type == "object":
                errors.extend(supported_nested_object_schema_errors(items, f"{path}.items"))
            elif item_type != "string":
                errors.append(
                    output_schema_subset_error(
                        f"{path}.items",
                        "array items must be string or strict object",
                    )
                )
    if schema_type == "object":
        errors.extend(supported_nested_object_schema_errors(value, path))
    return errors


def supported_nested_object_schema_errors(value: dict[str, Any], path: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if value.get("additionalProperties") is not False:
        errors.append(output_schema_subset_error(path, "object property must be strict"))
    properties = value.get("properties")
    if not isinstance(properties, dict) or not properties:
        errors.append(output_schema_subset_error(path, "object property must declare properties"))
        properties = {}
    required = value.get("required")
    if required is not None:
        if not isinstance(required, list) or not all(isinstance(item, str) for item in required):
            errors.append(output_schema_subset_error(path, "object required must be string[]"))
        else:
            unknown = sorted(set(required) - set(properties))
            if unknown:
                errors.append(
                    output_schema_subset_error(
                        path,
                        "object required references unknown field(s): " + ", ".join(unknown),
                    )
                )
    for field_name, property_schema in properties.items():
        errors.extend(
            supported_node_property_schema_errors(
                property_schema,
                f"{path}.properties.{field_name}",
            )
        )
    return errors


def output_schema_subset_error(path: str, message: str) -> dict[str, Any]:
    return {
        "code": "output_schema_invalid",
        "message": f"{path}: {message}",
        "path": path,
        "repair_hint": (
            "Use a strict object schema with supported property types only: string, number, "
            "integer, boolean, array<string>, array<object>, or nested strict object."
        ),
    }


WORKFLOW_INTENT_TARGET_KINDS = frozenset({"task_canvas", "workflow"})
WORKFLOW_INTENT_STRUCTURAL_OPS = frozenset(
    {
        "add_existing_callable_node",
        "create_temporary_agent_template",
        "add_workflow_container",
        "add_control_edge",
        "add_data_edge",
    }
)


def should_enforce_workflow_intent_guard(
    proposal: dict[str, Any],
    operations: list[Any],
) -> bool:
    target = proposal.get("target")
    target_kind = target.get("kind") if isinstance(target, dict) else None
    if target_kind not in WORKFLOW_INTENT_TARGET_KINDS:
        return False
    return any(
        isinstance(operation, dict)
        and operation.get("op") in WORKFLOW_INTENT_STRUCTURAL_OPS
        for operation in operations
    )


def infer_authoring_request_intent(message: str) -> dict[str, Any]:
    normalized = normalize_intent_text(message)
    expects_workflow = has_any(
        normalized,
        (
            "workflow",
            "工作流",
            "流程",
            "自动化",
            "节点",
            "canvas",
        ),
    )
    expects_parallel = has_any(
        normalized,
        (
            "并行",
            "同时",
            "几个角度",
            "多个角度",
            "分别",
            "多路",
            "分支",
        ),
    )
    expects_sequence = has_any(
        normalized,
        (
            "先",
            "然后",
            "再",
            "最后",
            "前后顺序",
            "串行",
            "顺序",
        ),
    )
    expects_synthesis = has_any(normalized, ("汇总", "总结", "综合", "synthesis", "summary"))
    expects_review = has_any(normalized, ("审查", "评审", "复核", "检查", "review"))
    wants_more_nodes = has_any(
        normalized,
        (
            "节点数量可以多",
            "节点多一些",
            "多一些节点",
            "5个节点",
            "五个节点",
            "至少5",
            "至少五",
        ),
    )
    expected_min_callable_nodes = 1
    if expects_sequence:
        expected_min_callable_nodes = max(expected_min_callable_nodes, 2)
    if expects_parallel:
        expected_min_callable_nodes = max(expected_min_callable_nodes, 4)
    if expects_parallel and (expects_synthesis or expects_review):
        expected_min_callable_nodes = max(expected_min_callable_nodes, 5)
    if expects_parallel and expects_synthesis and expects_review:
        expected_min_callable_nodes = max(expected_min_callable_nodes, 6)
    if wants_more_nodes:
        expected_min_callable_nodes = max(expected_min_callable_nodes, 5)
    return {
        "schema_version": "acc.authoring.request_intent.v1",
        "expects_workflow": expects_workflow,
        "expects_sequence": expects_sequence,
        "expects_parallel": expects_parallel,
        "expects_synthesis": expects_synthesis,
        "expects_review": expects_review,
        "wants_more_nodes": wants_more_nodes,
        "expected_min_callable_nodes": expected_min_callable_nodes
        if expects_workflow
        else 1,
    }


def proposal_intent_errors(
    operations: list[Any],
    *,
    request_intent: dict[str, Any],
) -> list[dict[str, Any]]:
    if not request_intent.get("expects_workflow"):
        return []
    analysis = analyze_authoring_operations(operations)
    expected_min = int(request_intent.get("expected_min_callable_nodes") or 1)
    errors: list[dict[str, Any]] = []
    if analysis["callable_nodes"] < expected_min:
        errors.append(
            {
                "code": "proposal_under_specified",
                "message": (
                    "The request was recognized as a multi-step workflow, but the proposal "
                    f"contains only {analysis['callable_nodes']} callable node(s); expected "
                    f"at least {expected_min}."
                ),
                "repair_hint": (
                    "Keep the agent-chosen design, but represent each major workflow "
                    "responsibility as a concrete callable node and connect them with "
                    "control edges."
                ),
                "details": {
                    "request_intent": request_intent,
                    "operation_analysis": analysis,
                },
            }
        )
    if (
        request_intent.get("expects_parallel")
        and analysis["callable_nodes"] >= expected_min
        and analysis["branch_points"] == 0
    ):
        errors.append(
            {
                "code": "parallel_structure_missing",
                "message": (
                    "The request was recognized as requiring parallel analysis, but the "
                    "proposal has no control-edge fan-out."
                ),
                "repair_hint": (
                    "Use multiple add_control_edge operations from the same upstream node "
                    "to independent analysis nodes, then connect them to a synthesis or "
                    "review node if needed."
                ),
                "details": {
                    "request_intent": request_intent,
                    "operation_analysis": analysis,
                },
            }
        )
    return errors


def analyze_authoring_operations(operations: list[Any]) -> dict[str, Any]:
    callable_nodes = 0
    workflow_containers = 0
    control_edges = 0
    outgoing: dict[tuple[str | None, str], int] = {}
    incoming: dict[tuple[str | None, str], int] = {}
    labels: list[str] = []
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        op_name = operation.get("op")
        scope = operation.get("scope_workflow_id")
        scope_key = scope if isinstance(scope, str) else None
        if op_name in {"add_existing_callable_node", "create_temporary_agent_template"}:
            callable_nodes += 1
            labels.append(str(operation.get("label") or operation.get("node_id") or ""))
            input_payload = operation.get("input")
            if isinstance(input_payload, dict):
                labels.append(str(input_payload.get("user_prompt") or ""))
        elif op_name == "add_workflow_container":
            workflow_containers += 1
            labels.append(str(operation.get("label") or operation.get("node_id") or ""))
        elif op_name == "add_control_edge":
            source = operation.get("from")
            target = operation.get("to")
            if isinstance(source, str) and isinstance(target, str):
                control_edges += 1
                outgoing[(scope_key, source)] = outgoing.get((scope_key, source), 0) + 1
                incoming[(scope_key, target)] = incoming.get((scope_key, target), 0) + 1
    return {
        "callable_nodes": callable_nodes,
        "workflow_containers": workflow_containers,
        "control_edges": control_edges,
        "branch_points": sum(1 for count in outgoing.values() if count > 1),
        "join_points": sum(1 for count in incoming.values() if count > 1),
        "labels_text": " ".join(part for part in labels if part)[:1000],
    }


def normalize_intent_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def has_any(value: str, needles: tuple[str, ...]) -> bool:
    return any(needle.lower() in value for needle in needles)


def port_view_payload(port_id: str, direction: str, *, required: bool) -> dict[str, Any]:
    return {
        "id": port_id,
        "label": port_id,
        "direction": direction,
        "required": required,
        "cardinality": "one",
        "artifactTypes": None,
    }


def port_contract_payload(*, required: bool) -> dict[str, Any]:
    return {"type": "artifact", "required": required, "cardinality": "one"}


def strip_runtime_state(canvas: dict[str, Any]) -> dict[str, Any]:
    stripped = copy.deepcopy(canvas)
    for workflow in (
        stripped.get("workflows", []) if isinstance(stripped.get("workflows"), list) else []
    ):
        if isinstance(workflow, dict):
            workflow.pop("runtime", None)
            workflow.pop("run", None)
            workflow.pop("output", None)
            workflow.pop("status", None)
    return stripped


def endpoint_exists(endpoint: Any, node_ids: set[str]) -> bool:
    return (
        isinstance(endpoint, dict)
        and isinstance(endpoint.get("node"), str)
        and endpoint["node"] in node_ids
    )


def semantic_summary_for_operations(operation_counts: dict[str, int]) -> str:
    if not operation_counts:
        return "No canvas changes would be applied."
    parts = [f"{count} {name}" for name, count in sorted(operation_counts.items())]
    return "Dry-run would apply: " + ", ".join(parts)


def workflow_catalog(project_root: Path) -> list[dict[str, Any]]:
    workflows_dir = project_root / "workflows"
    if not workflows_dir.exists():
        return []
    result: list[dict[str, Any]] = []
    for path in sorted(workflows_dir.glob("*.accflow.json")):
        try:
            payload = load_json(path)
        except Exception:
            continue
        if isinstance(payload, dict):
            result.append(
                {
                    "workflow_id": str(
                        payload.get("id") or path.name.removesuffix(".accflow.json")
                    ),
                    "file_id": path.name.removesuffix(".accflow.json"),
                    "name": payload.get("name"),
                    "description": payload.get("description"),
                    "version": payload.get("version"),
                    "path": relative_path(project_root, path),
                    "task_count": len(payload.get("nodes", []))
                    if isinstance(payload.get("nodes"), list)
                    else 0,
                    "format": "accflow",
                }
            )
    return result


def read_messages(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    messages: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            messages.append(payload)
    return messages


def conversation_context_payload(
    messages: list[dict[str, Any]],
    *,
    limit: int = 12,
    max_content_chars: int = 4000,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for message in messages[-limit:]:
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant", "system"} or not isinstance(content, str):
            continue
        if len(content) > max_content_chars:
            content = content[:max_content_chars] + "...[truncated]"
        result.append(
            {
                "role": role,
                "content": content,
                "created_at": message.get("created_at")
                if isinstance(message.get("created_at"), str)
                else None,
            }
        )
    return result


def validate_session_id(session_id: str) -> None:
    if not re.fullmatch(r"authoring_[A-Za-z0-9_-]+", session_id):
        raise AccError("Invalid authoring session id")


def relative_path(project_root: Path, path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def next_position(canvas: dict[str, Any], index: int) -> dict[str, int]:
    workflows = canvas.get("workflows") if isinstance(canvas.get("workflows"), list) else []
    xs = [
        int(item.get("position", {}).get("x", 0))
        for item in workflows
        if isinstance(item, dict) and isinstance(item.get("position"), dict)
    ]
    base_x = max(xs) + 420 if xs else 120
    return {"x": base_x + index * 420, "y": 180}


def slug_id(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_]+", "_", value.strip()).strip("_")
    return slug or "authoring_node"


def unique_id(base_id: str, existing_ids: set[str]) -> str:
    candidate = slug_id(base_id)
    if candidate not in existing_ids:
        return candidate
    index = 2
    while f"{candidate}_{index}" in existing_ids:
        index += 1
    return f"{candidate}_{index}"
