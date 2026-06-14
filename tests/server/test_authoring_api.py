from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def canvas() -> dict:
    return {"id": "canvas", "workflows": [], "edges": []}


def test_authoring_agents_endpoint_lists_supported_agents(client: TestClient) -> None:
    response = client.get("/api/authoring/agents")

    assert response.status_code == 200, response.text
    agents = response.json()["agents"]
    assert agents[0]["id"] == "echo-test.generic"
    assert agents[0]["runtime"] == "generic_cli"
    assert agents[0]["default_permissions"]["workspace_access"] == "read_only"


def test_authoring_session_message_returns_proposal_and_evidence(
    client: TestClient,
    project_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert created.status_code == 200, created.text
    session_id = created.json()["session_id"]
    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": "Create a workflow",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["validation"]["status"] == "valid"
    assert payload["proposal"]["operations"][0]["op"] == "add_existing_callable_node"
    session_dir = project_root / ".acc" / "sessions" / "authoring" / session_id
    assert (session_dir / "session.json").exists()
    assert (session_dir / "agent_output_raw.txt").exists()
    assert not (project_root / "runs" / "_authoring_sessions" / session_id).exists()


def test_authoring_temporary_resource_requires_approval_without_persistence(
    client: TestClient,
    project_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )
    session_id = created.json()["session_id"]

    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": "create a new agent template for reporting",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    actions = response.json()["required_actions"]
    assert any(action["kind"] == "approve_resource_persistence" for action in actions)
    assert not (project_root / "callables" / "agents" / "tmp_agent_authoring.yaml").exists()


def test_authoring_validate_and_dry_run_do_not_write_resources(
    client: TestClient,
    project_root: Path,
) -> None:
    proposal = {
        "proposal_id": "p1",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": "echo",
                "callable_id": "echo-test.generic",
                "callable_kind": "agent_class",
            }
        ],
    }
    request = {
        "proposal": proposal,
        "task_id": "task_canvas",
        "canvas_hash": "hash_1",
        "canvas_snapshot": canvas(),
    }

    validation = client.post("/api/authoring/proposals/validate", json=request)
    dry_run = client.post("/api/authoring/proposals/dry-run", json=request)

    assert validation.status_code == 200, validation.text
    assert validation.json()["status"] == "valid"
    assert dry_run.status_code == 200, dry_run.text
    assert dry_run.json()["writes"] == {"workflows": 0, "callables": 0, "runs": 0}
    assert list((project_root / "workflows").glob("*.accflow.json")) == []


def test_authoring_validate_accepts_ordered_workflow_container_scope(
    client: TestClient,
) -> None:
    proposal = {
        "proposal_id": "p_container",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
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
                "callable_id": "echo-test.generic",
                "callable_kind": "agent_class",
                "label": "Research",
                "position": {"x": 120, "y": 120},
            },
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_review",
                "node_id": "node_summary",
                "callable_id": "echo-test.generic",
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

    response = client.post(
        "/api/authoring/proposals/validate",
        json={
            "proposal": proposal,
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_validate_rejects_unknown_workflow_scope(client: TestClient) -> None:
    proposal = {
        "proposal_id": "p_bad_scope",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": "workflow_missing",
                "node_id": "node_research",
                "callable_id": "echo-test.generic",
                "callable_kind": "agent_class",
            }
        ],
    }

    response = client.post(
        "/api/authoring/proposals/validate",
        json={
            "proposal": proposal,
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["errors"][0]["code"] == "authoring_scope_unknown"


def test_authoring_validate_rejects_main_to_main_data_edge(client: TestClient) -> None:
    proposal = {
        "proposal_id": "p1",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_data_edge",
                "scope_workflow_id": None,
                "from": {"node": "research", "port": "main"},
                "to": {"node": "summary", "port": "main"},
                "materialization": "reference",
            }
        ],
    }

    response = client.post(
        "/api/authoring/proposals/validate",
        json={
            "proposal": proposal,
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": {
                "id": "canvas",
                "workflows": [{"id": "research"}, {"id": "summary"}],
                "edges": [],
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["errors"][0]["code"] == "main_to_main_data_edge_forbidden"
    assert "repair_hint" in payload["errors"][0]


def test_authoring_validate_rejects_unfixable_output_schema(client: TestClient) -> None:
    proposal = {
        "proposal_id": "p1",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": "research",
                "callable_id": "echo-test.generic",
                "callable_kind": "agent_class",
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "array",
                            "items": "bad",
                        }
                    },
                    "required": ["summary"],
                    "additionalProperties": False,
                },
            }
        ],
    }

    response = client.post(
        "/api/authoring/proposals/validate",
        json={
            "proposal": proposal,
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["errors"][0]["code"] == "output_schema_invalid"
    assert "repair_hint" in payload["errors"][0]


def test_authoring_validate_rejects_items_on_string_output_schema(client: TestClient) -> None:
    proposal = {
        "proposal_id": "p1",
        "base_task_id": "task_canvas",
        "base_canvas_hash": "hash_1",
        "target": {"kind": "task_canvas", "task_id": "task_canvas"},
        "rationale": "test",
        "operations": [
            {
                "op": "add_existing_callable_node",
                "scope_workflow_id": None,
                "node_id": "research",
                "callable_id": "echo-test.generic",
                "callable_kind": "agent_class",
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "items": None,
                        }
                    },
                    "required": ["summary"],
                    "additionalProperties": False,
                },
            }
        ],
    }

    response = client.post(
        "/api/authoring/proposals/validate",
        json={
            "proposal": proposal,
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["errors"][0]["code"] == "output_schema_invalid"


def test_authoring_message_can_return_main_to_main_repair_hint(
    client: TestClient,
    monkeypatch,
) -> None:
    from acc.app import authoring

    def invalid_output(message: str, context: dict) -> dict:
        return {
            "schema_version": "acc.authoring.output.v1",
            "assistant_message": "invalid proposal",
            "proposal_kind": "canvas",
            "proposal": {
                "proposal_id": "p1",
                "base_task_id": context["task_id"],
                "base_canvas_hash": context["canvas_hash"],
                "target": {"kind": "task_canvas", "task_id": context["task_id"]},
                "rationale": message,
                "operations": [
                    {
                        "op": "add_data_edge",
                        "scope_workflow_id": None,
                        "from": {"node": "research", "port": "main"},
                        "to": {"node": "summary", "port": "main"},
                        "materialization": "reference",
                    }
                ],
            },
            "questions": [],
            "risk_notes": [],
            "confidence": "low",
        }

    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    monkeypatch.setattr(authoring, "hermetic_authoring_output", invalid_output)
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )
    session_id = created.json()["session_id"]

    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": "Create a workflow",
            "canvas_hash": "hash_1",
            "canvas_snapshot": {
                "id": "canvas",
                "workflows": [{"id": "research"}, {"id": "summary"}],
                "edges": [],
            },
        },
    )

    assert response.status_code == 200, response.text
    validation = response.json()["validation"]
    assert validation["status"] == "invalid"
    assert validation["errors"][0]["code"] == "main_to_main_data_edge_forbidden"
    assert "repair_hint" in validation["errors"][0]


def test_authoring_message_rejects_under_specified_complex_workflow(
    client: TestClient,
    monkeypatch,
) -> None:
    from acc.app import authoring

    def under_specified_output(message: str, context: dict) -> dict:
        return {
            "schema_version": "acc.authoring.output.v1",
            "assistant_message": "claims complex workflow",
            "proposal_kind": "canvas",
            "proposal": {
                "proposal_id": "p_under",
                "base_task_id": context["task_id"],
                "base_canvas_hash": context["canvas_hash"],
                "target": {"kind": "task_canvas", "task_id": context["task_id"]},
                "rationale": message,
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
                        "node_id": "requirements",
                        "callable_id": "echo-test.generic",
                        "callable_kind": "agent_class",
                        "label": "需求整理",
                        "position": {"x": 120, "y": 120},
                    },
                ],
            },
            "questions": [],
            "risk_notes": [],
            "confidence": "medium",
        }

    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    monkeypatch.setattr(authoring, "hermetic_authoring_output", under_specified_output)
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )
    session_id = created.json()["session_id"]

    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": (
                "我想做一个用于技术方案评审的自动化流程。流程需要先整理需求，"
                "然后同时从几个角度做分析，分析完成后再汇总，最后再做一次审查。"
                "节点数量可以多一些，最好能体现前后顺序和并行分析。"
            ),
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 200, response.text
    validation = response.json()["validation"]
    assert validation["status"] == "invalid"
    assert validation["errors"][0]["code"] == "proposal_under_specified"
    assert validation["errors"][0]["details"]["request_intent"][
        "expected_min_callable_nodes"
    ] == 6


def test_authoring_message_allows_selected_internal_node_output_schema_edit(
    client: TestClient,
    monkeypatch,
) -> None:
    from acc.app import authoring

    canvas_snapshot = {
        "id": "canvas",
        "workflows": [
            {
                "id": "workflow_review",
                "sourceKind": "workflow",
                "internalNodes": [{"id": "node_research"}],
            }
        ],
        "edges": [],
    }

    def selected_node_edit_output(message: str, context: dict) -> dict:
        return {
            "schema_version": "acc.authoring.output.v1",
            "assistant_message": "updated selected node output schema",
            "proposal_kind": "canvas",
            "proposal": {
                "proposal_id": "p_selected_node_edit",
                "base_task_id": context["task_id"],
                "base_canvas_hash": context["canvas_hash"],
                "target": {
                    "kind": "internal_node",
                    "workflow_id": "workflow_review",
                    "node_id": "node_research",
                },
                "rationale": message,
                "operations": [
                    {
                        "op": "update_output_schema",
                        "scope_workflow_id": "workflow_review",
                        "node_id": "node_research",
                        "output_schema": authoring.generic_output_schema("detailed report"),
                    }
                ],
            },
            "questions": [],
            "risk_notes": [],
            "confidence": "medium",
        }

    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")
    monkeypatch.setattr(authoring, "hermetic_authoring_output", selected_node_edit_output)
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas_snapshot,
            "selection": {
                "type": "internal",
                "workflowId": "workflow_review",
                "nodeId": "node_research",
            },
        },
    )
    session_id = created.json()["session_id"]

    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": "修改这个 workflow 节点的输出，我希望输出详细的报告",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas_snapshot,
            "selection": {
                "type": "internal",
                "workflowId": "workflow_review",
                "nodeId": "node_research",
            },
        },
    )

    assert response.status_code == 200, response.text
    validation = response.json()["validation"]
    assert validation == {"status": "valid", "errors": [], "warnings": []}


def test_authoring_message_reports_disabled_external_execution(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_DISABLE_EXTERNAL_AGENT_EXECUTION", "1")
    created = client.post(
        "/api/authoring/sessions",
        json={
            "agent_id": "echo-test.generic",
            "task_id": "task_canvas",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )
    session_id = created.json()["session_id"]

    response = client.post(
        f"/api/authoring/sessions/{session_id}/messages",
        json={
            "message": "Create a workflow",
            "canvas_hash": "hash_1",
            "canvas_snapshot": canvas(),
        },
    )

    assert response.status_code == 400
    assert "External agent execution is disabled" in response.text
