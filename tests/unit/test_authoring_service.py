from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.app.authoring import (
    AUTHORING_OUTPUT_SCHEMA,
    AUTHORING_OUTPUT_SCHEMA_VERSION,
    AUTHORING_PROMPT_VERSION,
    AUTHORING_RULES_DIGEST,
    AuthoringSessionService,
    authoring_prompt,
    generic_output_schema,
    hermetic_authoring_output,
    infer_authoring_request_intent,
    parse_authoring_output,
)
from acc.domain import AccError


def create_agent(root: Path, callable_id: str = "author.codex", runtime: str = "codex_cli") -> None:
    agents = root / "callables" / "agents"
    agents.mkdir(parents=True, exist_ok=True)
    (agents / f"{callable_id}.yaml").write_text(
        yaml.safe_dump(
            {
                "id": callable_id,
                "version": "0.1.0",
                "runtime": runtime,
                "metadata": {"name": callable_id},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def canvas() -> dict:
    return {"id": "canvas", "workflows": [], "edges": []}


def two_node_canvas() -> dict:
    return {
        "id": "canvas",
        "workflows": [{"id": "research"}, {"id": "summary"}],
        "edges": [],
    }


def two_step_proposal(operation: dict) -> dict:
    return {
        "proposal_id": "p1",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "test",
        "operations": [operation],
    }


def valid_existing_callable_proposal(
    *,
    proposal_id: str,
    task_id: str = "task_1",
    canvas_hash: str = "hash_1",
    node_id: str = "research",
    callable_id: str = "author.codex",
) -> dict:
    return {
        "proposal_id": proposal_id,
        "base_task_id": task_id,
        "base_canvas_hash": canvas_hash,
        "target": {"kind": "task_canvas", "task_id": task_id},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": node_id,
                "callable_id": callable_id,
                "callable_kind": "agent_class",
            }
        ],
    }


def authoring_output_with_proposal(proposal: dict, message: str = "ok") -> dict:
    return {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": message,
        "proposal_kind": "canvas",
        "proposal": proposal,
        "questions": [],
        "risk_notes": [],
        "confidence": "medium",
    }


class CapturingRunner:
    def __init__(self, outputs: list[dict] | None = None) -> None:
        self.input_payload: dict | None = None
        self.input_payloads: list[dict] = []
        self.execution_contexts: list[Any] = []
        self.outputs = outputs or []

    async def run_agent_class(
        self,
        asset,
        input_payload: dict,
        run_dir: Path,
        execution_context,
    ) -> dict:
        self.input_payload = input_payload
        self.input_payloads.append(input_payload)
        self.execution_contexts.append(execution_context)
        (run_dir / "input.json").write_text(
            json.dumps(input_payload, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        if self.outputs:
            return self.outputs.pop(0)
        return {
            "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
            "assistant_message": "ok",
            "proposal_kind": "canvas",
            "proposal": None,
            "questions": [],
            "risk_notes": [],
            "confidence": "low",
        }


def assert_strict_objects(schema: object, path: str = "$") -> None:
    if isinstance(schema, dict):
        schema_type = schema.get("type")
        has_object_type = schema_type == "object" or (
            isinstance(schema_type, list) and "object" in schema_type
        )
        if has_object_type:
            assert schema.get("additionalProperties") is False, path
        for key, value in schema.items():
            assert_strict_objects(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for index, item in enumerate(schema):
            assert_strict_objects(item, f"{path}[{index}]")


def assert_openai_strict_required(schema: object, path: str = "$") -> None:
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict) and "type" in schema:
            assert set(schema.get("required") or []) == set(properties), path
        for key, value in schema.items():
            if key == "properties" and isinstance(value, dict):
                for property_key, property_schema in value.items():
                    assert_openai_strict_required(
                        property_schema,
                        f"{path}.properties.{property_key}",
                    )
            else:
                assert_openai_strict_required(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for index, item in enumerate(schema):
            assert_openai_strict_required(item, f"{path}[{index}]")


def test_authoring_output_schema_is_strict_and_accepts_canvas_proposal() -> None:
    context = {
        "task_id": "task_1",
        "canvas_hash": "hash_1",
        "canvas_snapshot": canvas(),
        "callable_catalog": [
            {
                "id": "author.codex",
                "kind": "agent_class",
                "name": "Author",
            }
        ],
    }
    output = hermetic_authoring_output("Create a two step workflow", context)

    assert_strict_objects(AUTHORING_OUTPUT_SCHEMA)
    assert_openai_strict_required(AUTHORING_OUTPUT_SCHEMA)
    Draft202012Validator(AUTHORING_OUTPUT_SCHEMA).validate(output)


def test_authoring_output_schema_rejects_items_null_on_string_property() -> None:
    output = hermetic_authoring_output("Create a two step workflow", {
        "task_id": "task_1",
        "canvas_hash": "hash_1",
        "canvas_snapshot": canvas(),
        "callable_catalog": [
            {
                "id": "author.codex",
                "kind": "agent_class",
                "name": "Author",
            }
        ],
    })
    output["proposal"]["operations"][0]["output_schema"]["properties"]["summary"][
        "items"
    ] = None

    with pytest.raises(JsonSchemaValidationError):
        Draft202012Validator(AUTHORING_OUTPUT_SCHEMA).validate(output)


def test_generic_output_schema_does_not_put_items_on_summary() -> None:
    schema = generic_output_schema("test")

    assert "items" not in schema["properties"]["summary"]
    assert "description" in schema["properties"]["summary"]
    assert "description" in schema["properties"]["artifacts"]
    assert schema["properties"]["artifacts"]["items"] == {"type": "string"}


def test_authoring_prompt_injects_acc_workbench_rules() -> None:
    prompt = authoring_prompt("Create a workflow")

    assert AUTHORING_PROMPT_VERSION in prompt
    assert AUTHORING_RULES_DIGEST in prompt
    assert "context.request_intent" in prompt
    assert "Do not create explicit add_data_edge from main to main" in prompt
    assert "Use add_control_edge for sequential execution" in prompt
    assert "Use only callable ids present in callable_catalog" in prompt
    assert "add_workflow_container first" in prompt
    assert "Set input_ports and output_ports to null" in prompt
    assert "output_schema must be strict" in prompt
    assert "never put items on string properties" in prompt
    assert "workflows/" in prompt
    assert "callables/" in prompt


def test_authoring_request_intent_recognizes_complex_parallel_workflow() -> None:
    intent = infer_authoring_request_intent(
        "我想做一个用于技术方案评审的自动化流程。流程需要先整理需求，"
        "然后同时从几个角度做分析，等这些分析都完成后再汇总，最后再做一次审查。"
        "节点数量可以多一些，最好能体现前后顺序和并行分析。"
    )

    assert intent["expects_workflow"] is True
    assert intent["expects_sequence"] is True
    assert intent["expects_parallel"] is True
    assert intent["expects_synthesis"] is True
    assert intent["expects_review"] is True
    assert intent["expected_min_callable_nodes"] == 6


def test_authoring_session_service_hermetic_generates_valid_canvas_proposal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    create_agent(tmp_path, "author.codex", "codex_cli")
    service = AuthoringSessionService(tmp_path)

    session = service.create_session(
        agent_id="author.codex",
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )
    response = asyncio.run(
        service.post_message(
            session["session_id"],
            message="Create a research workflow",
            canvas_hash="hash_1",
            canvas_snapshot=canvas(),
        )
    )

    assert response["validation"]["status"] == "valid"
    assert response["proposal"]["base_canvas_hash"] == "hash_1"
    assert response["proposal"]["operations"][0]["op"] == "add_existing_callable_node"
    evidence_root = tmp_path / "runs" / "_authoring_sessions" / session["session_id"]
    assert (evidence_root / "session.json").exists()
    assert (evidence_root / "context_snapshot.json").exists()
    assert (evidence_root / "agent_output_raw.txt").exists()


def test_authoring_external_request_records_prompt_policy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    create_agent(tmp_path, "author.codex", "codex_cli")
    runner = CapturingRunner()
    service = AuthoringSessionService(tmp_path, runner=runner)  # type: ignore[arg-type]
    session = service.create_session(
        agent_id="author.codex",
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    asyncio.run(
        service.post_message(
            session["session_id"],
            message="Create a workflow",
            canvas_hash="hash_1",
            canvas_snapshot=canvas(),
        )
    )

    evidence_root = tmp_path / "runs" / "_authoring_sessions" / session["session_id"]
    input_payload = json.loads(
        (evidence_root / "agent_run" / "input.json").read_text(encoding="utf-8")
    )
    assert input_payload["policy"]["authoring_prompt_version"] == AUTHORING_PROMPT_VERSION
    assert input_payload["policy"]["authoring_rules_digest"] == AUTHORING_RULES_DIGEST
    assert input_payload["policy"]["output_schema"] == AUTHORING_OUTPUT_SCHEMA_VERSION
    assert runner.execution_contexts[0].node.invocation_policy.timeout_seconds == 300
    assert runner.input_payload == input_payload
    assert input_payload["context"]["request_intent"]["expects_workflow"] is True


def test_authoring_external_request_includes_multi_turn_context(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    create_agent(tmp_path, "author.codex", "codex_cli")
    first_proposal = valid_existing_callable_proposal(proposal_id="p_first")
    second_proposal = valid_existing_callable_proposal(
        proposal_id="p_second",
        canvas_hash="hash_2",
        node_id="summary",
    )
    runner = CapturingRunner(
        outputs=[
            authoring_output_with_proposal(first_proposal, "first proposal"),
            authoring_output_with_proposal(second_proposal, "second proposal"),
        ]
    )
    service = AuthoringSessionService(tmp_path, runner=runner)  # type: ignore[arg-type]
    session = service.create_session(
        agent_id="author.codex",
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    first = asyncio.run(
        service.post_message(
            session["session_id"],
            message="Create a workflow",
            canvas_hash="hash_1",
            canvas_snapshot=canvas(),
        )
    )
    assert first["validation"]["status"] == "valid"
    second = asyncio.run(
        service.post_message(
            session["session_id"],
            message="Add a summary step",
            canvas_hash="hash_2",
            canvas_snapshot={
                "id": "canvas",
                "workflows": [{"id": "research"}],
                "edges": [],
            },
        )
    )

    assert second["validation"]["status"] == "valid"
    second_payload = runner.input_payloads[1]
    assert second_payload["previous_proposal"]["proposal_id"] == "p_first"
    assert second_payload["previous_validation"]["status"] == "valid"
    assert second_payload["context"]["canvas_hash"] == "hash_2"
    assert second_payload["context"]["canvas_snapshot"]["workflows"][0]["id"] == "research"
    roles_and_content = [
        (item["role"], item["content"]) for item in second_payload["conversation"]
    ]
    assert ("user", "Create a workflow") in roles_and_content
    assert ("assistant", "first proposal") in roles_and_content
    assert ("user", "Add a summary step") in roles_and_content


def test_parse_authoring_output_rejects_non_json_and_multiple_objects(tmp_path: Path) -> None:
    with pytest.raises(AccError, match="not valid JSON"):
        parse_authoring_output(tmp_path / "raw.txt", "not json")

    valid = json.dumps(
        {
            "schema_version": "acc.authoring.output.v1",
            "assistant_message": "ok",
            "proposal_kind": "canvas",
            "proposal": None,
            "questions": [],
            "risk_notes": [],
            "confidence": "low",
        }
    )
    with pytest.raises(AccError, match="exactly one JSON object"):
        parse_authoring_output(tmp_path / "raw.txt", f"{valid}\n{valid}")


def test_parse_authoring_output_rejects_schema_and_kind(tmp_path: Path) -> None:
    payload = {
        "schema_version": "wrong",
        "assistant_message": "ok",
        "proposal_kind": "canvas",
        "proposal": None,
        "questions": [],
        "risk_notes": [],
        "confidence": "low",
    }
    with pytest.raises(AccError, match="schema_version"):
        parse_authoring_output(tmp_path / "raw.txt", json.dumps(payload))

    payload["schema_version"] = "acc.authoring.output.v1"
    payload["proposal_kind"] = "graphops_transaction"
    with pytest.raises(AccError, match="canvas"):
        parse_authoring_output(tmp_path / "raw.txt", json.dumps(payload))


def test_parse_authoring_output_rejects_extra_fields(tmp_path: Path) -> None:
    payload = {
        "schema_version": "acc.authoring.output.v1",
        "assistant_message": "ok",
        "proposal_kind": "canvas",
        "proposal": None,
        "questions": [],
        "risk_notes": [],
        "confidence": "low",
        "unexpected": "must be rejected",
    }

    with pytest.raises(AccError, match="unsupported fields"):
        parse_authoring_output(tmp_path / "raw.txt", json.dumps(payload))


def test_authoring_runtime_allowlist_and_read_only_permissions(tmp_path: Path) -> None:
    create_agent(tmp_path, "ok.generic", "generic_cli")
    create_agent(tmp_path, "bad.native", "native_runtime")

    service = AuthoringSessionService(tmp_path)
    agents = service.list_agents()["agents"]

    assert [agent["id"] for agent in agents] == ["ok.generic"]
    assert agents[0]["default_permissions"] == {
        "workspace_access": "read_only",
        "network": False,
        "shell": False,
        "dangerous": False,
        "env_policy": "acc_whitelist",
        "allowed_env": [],
        "timeout_seconds": 300,
    }


def test_authoring_context_uses_real_callable_catalog_not_only_authoring_agents(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "ok.generic", "generic_cli")
    create_agent(tmp_path, "ordinary.native", "native_runtime")

    service = AuthoringSessionService(tmp_path)
    session = service.create_session(
        agent_id="ok.generic",
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    context = json.loads(
        (
            tmp_path
            / "runs"
            / "_authoring_sessions"
            / session["session_id"]
            / "context_snapshot.json"
        ).read_text(encoding="utf-8")
    )

    agents = service.list_agents()["agents"]
    callable_ids = {item["id"] for item in context["callable_catalog"]}
    capability_by_id = {
        item["id"]: item["authoring_capable"] for item in context["callable_catalog"]
    }
    assert [agent["id"] for agent in agents] == ["ok.generic"]
    assert callable_ids == {"ok.generic", "ordinary.native"}
    assert capability_by_id == {"ok.generic": True, "ordinary.native": False}


def test_authoring_validation_gates_stale_unknown_duplicate_and_temporary(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = {
        "proposal_id": "p1",
        "base_task_id": "task_1",
        "base_canvas_hash": "old_hash",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": "existing",
                "callable_id": "missing",
                "callable_kind": "agent_class",
            },
            {
                "op": "create_temporary_agent_template",
                "scope_workflow_id": None,
                "draft_id": "not_tmp",
                "node_id": "temp",
                "agent_draft": {},
            },
        ],
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="new_hash",
        canvas_snapshot={"id": "canvas", "workflows": [{"id": "existing"}]},
    )

    codes = {error["code"] for error in validation["errors"]}
    assert validation["status"] == "invalid"
    assert {
        "stale_canvas",
        "duplicate_node_id",
        "unknown_callable",
        "temporary_id_invalid",
    } <= codes
    assert validation["warnings"][0]["code"] == "temporary_resource_unresolved"


def test_authoring_validation_rejects_under_specified_complex_workflow(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    request_intent = infer_authoring_request_intent(
        "我想做一个用于技术方案评审的自动化流程。流程需要先整理需求，"
        "然后同时从几个角度做分析，分析完成后再汇总，最后再做一次审查。"
        "节点数量可以多一些，最好能体现前后顺序和并行分析。"
    )
    proposal = {
        "proposal_id": "p_under",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "Claims to create a complex workflow.",
        "operations": [
            {
                "op": "add_workflow_container",
                "scope_workflow_id": None,
                "node_id": "workflow_review",
                "label": "技术方案评审 workflow",
                "position": {"x": 80, "y": 80},
            },
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_requirements",
                "callable_id": "known.generic",
                "callable_kind": "agent_class",
                "label": "需求澄清",
                "position": {"x": 120, "y": 120},
            },
        ],
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
        request_intent=request_intent,
    )

    assert validation["status"] == "invalid"
    error = validation["errors"][0]
    assert error["code"] == "proposal_under_specified"
    assert error["details"]["operation_analysis"]["callable_nodes"] == 1
    assert error["details"]["request_intent"]["expected_min_callable_nodes"] == 6


def test_authoring_validation_skips_workflow_intent_guard_for_internal_node_edit(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    request_intent = {
        "schema_version": "acc.authoring.request_intent.v1",
        "expects_workflow": True,
        "expected_min_callable_nodes": 1,
    }
    proposal = {
        "proposal_id": "p_node_edit",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {
            "kind": "internal_node",
            "workflow_id": "workflow_review",
            "node_id": "node_research",
        },
        "rationale": "Adjust selected node output.",
        "operations": [
            {
                "op": "update_output_schema",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_research",
                "output_schema": generic_output_schema("detailed report"),
            }
        ],
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot={
            "id": "canvas",
            "workflows": [
                {
                    "id": "workflow_review",
                    "sourceKind": "workflow",
                    "internalNodes": [{"id": "node_research"}],
                }
            ],
        },
        request_intent=request_intent,
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_skips_workflow_intent_guard_for_internal_node_input_and_schema_edit(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    request_intent = {
        "schema_version": "acc.authoring.request_intent.v1",
        "expects_workflow": True,
        "expected_min_callable_nodes": 1,
    }
    proposal = {
        "proposal_id": "p_node_input_schema_edit",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {
            "kind": "internal_node",
            "workflow_id": "workflow_review",
            "node_id": "node_research",
        },
        "rationale": "Adjust selected node input and output.",
        "operations": [
            {
                "op": "update_invocation_input",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_research",
                "input": {"user_prompt": "Produce a detailed report."},
            },
            {
                "op": "update_output_schema",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_research",
                "output_schema": generic_output_schema("detailed report"),
            },
        ],
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot={
            "id": "canvas",
            "workflows": [
                {
                    "id": "workflow_review",
                    "sourceKind": "workflow",
                    "internalNodes": [{"id": "node_research"}],
                }
            ],
        },
        request_intent=request_intent,
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_skips_workflow_intent_guard_for_root_node_edit(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    request_intent = {
        "schema_version": "acc.authoring.request_intent.v1",
        "expects_workflow": True,
        "expected_min_callable_nodes": 1,
    }
    proposal = {
        "proposal_id": "p_root_node_edit",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "Adjust existing root node output.",
        "operations": [
            {
                "op": "update_output_schema",
                "scope_workflow_id": None,
                "node_id": "research",
                "output_schema": generic_output_schema("detailed report"),
            }
        ],
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot={"id": "canvas", "workflows": [{"id": "research"}]},
        request_intent=request_intent,
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_accepts_complex_parallel_workflow_shape(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    request_intent = infer_authoring_request_intent(
        "先整理需求，然后同时从几个角度分析，再汇总，最后审查，做成 workflow。"
    )
    operations: list[dict[str, Any]] = [
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "requirements",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "architecture",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "risk",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "test",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "synthesis",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": None,
            "node_id": "review",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "requirements",
            "to": "architecture",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "requirements",
            "to": "risk",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "requirements",
            "to": "test",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "architecture",
            "to": "synthesis",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "risk",
            "to": "synthesis",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "test",
            "to": "synthesis",
        },
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "synthesis",
            "to": "review",
        },
    ]
    proposal = {
        "proposal_id": "p_complex",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "Complex workflow.",
        "operations": operations,
    }

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
        request_intent=request_intent,
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_rejects_main_to_main_data_edge(tmp_path: Path) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = two_step_proposal(
        {
            "op": "add_data_edge",
            "scope_workflow_id": None,
            "from": {"node": "research", "port": "main"},
            "to": {"node": "summary", "port": "main"},
            "materialization": "reference",
        }
    )

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=two_node_canvas(),
    )

    assert validation["status"] == "invalid"
    error = validation["errors"][0]
    assert error["code"] == "main_to_main_data_edge_forbidden"
    assert "repair_hint" in error


def test_authoring_validation_allows_control_only_sequential_flow(tmp_path: Path) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = two_step_proposal(
        {
            "op": "add_control_edge",
            "scope_workflow_id": None,
            "from": "research",
            "to": "summary",
        }
    )

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=two_node_canvas(),
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_allows_named_non_main_data_edge(tmp_path: Path) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = two_step_proposal(
        {
            "op": "add_data_edge",
            "scope_workflow_id": None,
            "from": {"node": "research", "port": "research_report"},
            "to": {"node": "summary", "port": "source_material"},
            "materialization": "reference",
        }
    )

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=two_node_canvas(),
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def workflow_container_transaction_proposal() -> dict:
    return {
        "proposal_id": "p_container",
        "base_task_id": "task_1",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_1"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_workflow_container",
                "scope_workflow_id": None,
                "node_id": "workflow_review",
                "label": "Review",
                "position": {"x": 80, "y": 80},
            },
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_research",
                "callable_id": "known.generic",
                "callable_kind": "agent_class",
                "label": "Research",
                "position": {"x": 120, "y": 120},
            },
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_summary",
                "callable_id": "known.generic",
                "callable_kind": "agent_class",
                "label": "Summary",
                "position": {"x": 420, "y": 120},
            },
            {
                "op": "add_control_edge",
                "scope_workflow_id": "workflow_review",
                "from": "node_research",
                "to": "node_summary",
            },
        ],
    }


def test_authoring_validation_allows_ordered_workflow_container_transaction(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)

    validation = service.validate_proposal(
        proposal=workflow_container_transaction_proposal(),
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validation_rejects_unknown_and_forward_workflow_scope(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = workflow_container_transaction_proposal()
    proposal["operations"] = [
        proposal["operations"][1],
        proposal["operations"][0],
    ]

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    assert validation["status"] == "invalid"
    assert validation["errors"][0]["code"] == "authoring_scope_unknown"


def test_authoring_validation_rejects_executable_node_as_workflow_scope(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = two_step_proposal(
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": "agent_node",
            "node_id": "internal",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        }
    )

    validation = service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot={
            "id": "canvas",
            "workflows": [
                {
                    "id": "agent_node",
                    "sourceKind": "agent_session",
                    "callableId": "known.generic",
                }
            ],
        },
    )

    assert validation["status"] == "invalid"
    assert validation["errors"][0]["code"] == "authoring_scope_not_container"


def test_authoring_validation_scopes_internal_node_ids_and_edges(
    tmp_path: Path,
) -> None:
    create_agent(tmp_path, "known.generic", "generic_cli")
    service = AuthoringSessionService(tmp_path)
    proposal = workflow_container_transaction_proposal()
    proposal["operations"] = [
        {
            "op": "add_workflow_container",
            "scope_workflow_id": None,
            "node_id": "workflow_a",
            "label": "A",
            "position": {"x": 80, "y": 80},
        },
        {
            "op": "add_workflow_container",
            "scope_workflow_id": None,
            "node_id": "workflow_b",
            "label": "B",
            "position": {"x": 520, "y": 80},
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": "workflow_a",
            "node_id": "shared",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
        {
            "op": "add_existing_callable_node",
            "scope_workflow_id": "workflow_b",
            "node_id": "shared",
            "callable_id": "known.generic",
            "callable_kind": "agent_class",
        },
    ]

    assert service.validate_proposal(
        proposal=proposal,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    ) == {"status": "valid", "errors": [], "warnings": []}

    duplicate = {
        **proposal,
        "operations": [
            *proposal["operations"],
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_a",
                "node_id": "shared",
                "callable_id": "known.generic",
                "callable_kind": "agent_class",
            },
        ],
    }
    bad_edge = {
        **proposal,
        "operations": [
            *proposal["operations"],
            {
                "op": "add_control_edge",
                "scope_workflow_id": "workflow_a",
                "from": "shared",
                "to": "missing",
            },
        ],
    }

    duplicate_validation = service.validate_proposal(
        proposal=duplicate,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )
    edge_validation = service.validate_proposal(
        proposal=bad_edge,
        task_id="task_1",
        canvas_hash="hash_1",
        canvas_snapshot=canvas(),
    )

    assert duplicate_validation["status"] == "invalid"
    assert duplicate_validation["errors"][0]["code"] == "duplicate_node_id"
    assert edge_validation["status"] == "invalid"
    assert edge_validation["errors"][0]["code"] == "edge_endpoint_unknown"
