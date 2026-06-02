from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from acc.app import WorkflowAppService
from acc.app.core_v2_runtime import run_core_v2_workflow_path
from acc.domain import CORE_V2_SCHEMA_VERSION


def write_v2(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class FakeCodexProcess:
    def __init__(self, command: tuple[str, ...]) -> None:
        self.command = command
        self.returncode = 0

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        output_path = Path(self.command[self.command.index("-o") + 1])
        prompt = (input or b"").decode("utf-8", errors="replace")
        if "A_SENTINEL_123" in prompt:
            analysis = "received A_SENTINEL_123 and continued downstream analysis"
            summary = "cleaner consumed upstream sentinel"
        else:
            analysis = "produced A_SENTINEL_123 as upstream sentinel"
            summary = "research produced upstream sentinel"
        output_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "summary": summary,
                    "findings": [
                        {
                            "title": "sentinel",
                            "detail": "A_SENTINEL_123",
                            "evidence": ["test evidence"],
                            "sources": [],
                            "confidence": "test",
                        }
                    ],
                    "analysis": analysis,
                    "sources": [],
                    "confidence": "test",
                    "uncertainties": [],
                    "artifacts": [],
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        return b'{"event":"codex"}\n', b""

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> None:
        return None


class FailingCodexProcess:
    def __init__(self, command: tuple[str, ...]) -> None:
        self.command = command
        self.returncode = 2

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        return b"", b"codex failed\n"

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> None:
        return None


def test_core_v2_single_node_success(tmp_path: Path) -> None:
    workflow_path = tmp_path / "single.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "single",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                }
            ],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    assert record.status == "success"
    assert (tmp_path / "run" / "run_record.json").exists()
    assert (tmp_path / "run" / "function_invocation.json").exists()
    assert (tmp_path / "run" / "scope_frame.json").exists()
    assert (tmp_path / "run" / "nodes" / "produce" / "session_instance_manifest.json").exists()


def test_workflow_app_service_routes_core_v2_schema_to_core_runtime(tmp_path: Path) -> None:
    workflow_path = tmp_path / "app_single.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "app_single",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                }
            ],
        },
    )

    service = WorkflowAppService()
    validation = service.validate(workflow_path)
    result = service.run_sync(workflow_path, tmp_path / "app_run")

    assert validation["status"] == "valid"
    assert result["status"] == "success"
    assert (tmp_path / "app_run" / "run_record.json").exists()
    assert not (tmp_path / "app_run" / "workflow_graph.json").exists()
    assert not (tmp_path / "app_run" / "node_runs").exists()


def test_core_v2_nested_workflow_function_call(tmp_path: Path) -> None:
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "exposed_inputs": {"topic": {"direction": "input", "type": "json"}},
            "exposed_outputs": {"report": {"direction": "output", "type": "json"}},
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"inputs": {"topic": {}}, "outputs": {"main": {}}},
                }
            ],
            "workflow_input_bindings": [
                {"source_port": "topic", "target": {"node": "produce", "port": "topic"}}
            ],
            "workflow_output_bindings": [
                {"source": {"node": "produce", "port": "main"}, "target_port": "report"}
            ],
        },
    )
    parent_path = tmp_path / "parent.accflow.json"
    write_v2(
        parent_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "parent",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "subflow",
                    "callable_ref": {
                        "kind": "workflow_function",
                        "id": child_path.name,
                    },
                    "input_bindings": [
                        {"target_port": "topic", "static_value": {"value": "nested"}}
                    ],
                    "ports": {"outputs": {"report": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "input_bindings": [
                        {
                            "source": {"node": "subflow", "port": "report"},
                            "target_port": "main",
                        }
                    ],
                    "ports": {"inputs": {"main": {"type": "json"}}},
                },
            ],
            "control_edges": [{"from": "subflow", "to": "consume"}],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(parent_path, tmp_path / "run"))
    subflow_output = json.loads(
        (tmp_path / "run" / "nodes" / "subflow" / "output.json").read_text(
            encoding="utf-8"
        )
    )
    consume_output = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert subflow_output["child_workflow_id"] == "child"
    assert subflow_output["report"]["input"]["topic"] == {"value": "nested"}
    assert consume_output["input"]["main"]["producer_node_id"] == "produce"
    assert (
        tmp_path
        / "run"
        / "nodes"
        / "subflow"
        / "nested_workflow"
        / "run_record.json"
    ).exists()


def test_core_v2_nested_workflow_inherits_callable_registry(tmp_path: Path) -> None:
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
input_ports:
  main:
    type: artifact
output_ports:
  main:
    type: artifact
""".strip(),
        encoding="utf-8",
    )
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "research",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                }
            ],
        },
    )
    parent_path = tmp_path / "parent.accflow.json"
    write_v2(
        parent_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "parent",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "subflow",
                    "callable_ref": {
                        "kind": "workflow_function",
                        "id": child_path.name,
                    },
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(parent_path, tmp_path / "run")

    assert result["status"] == "success"


def test_core_v2_production_codex_agents_pass_data_edge_to_downstream(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")
    captured: list[tuple[str, ...]] = []

    async def fake_create(*args, **kwargs):
        captured.append(args)
        return FakeCodexProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
default_prompt: Use structured market methodology.
input_ports:
  main:
    type: artifact
  evidence:
    type: artifact
output_ports:
  main:
    type: artifact
""".strip(),
        encoding="utf-8",
    )
    workflow_path = tmp_path / "codex_chain.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "codex_chain",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "research",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                    "prompt_policy": {"user_prompt": "Research current market news."},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "cleaner",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                    "prompt_policy": {"user_prompt": "Clean upstream evidence."},
                    "ports": {
                        "inputs": {"evidence": {"type": "json"}},
                        "outputs": {"main": {"type": "json"}},
                    },
                },
            ],
            "control_edges": [{"from": "research", "to": "cleaner"}],
            "data_edges": [
                {
                    "source": {"node": "research", "port": "main"},
                    "target": {"node": "cleaner", "port": "evidence"},
                    "materialization": "copy",
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        workspace=tmp_path,
    )
    cleaner_input = json.loads(
        (tmp_path / "run" / "nodes" / "cleaner" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    cleaner_output = json.loads(
        (tmp_path / "run" / "nodes" / "cleaner" / "output.json").read_text(encoding="utf-8")
    )
    cleaner_bindings = json.loads(
        (tmp_path / "run" / "nodes" / "cleaner" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    cleaner_runtime = json.loads(
        (tmp_path / "run" / "nodes" / "cleaner" / "runtime.json").read_text(encoding="utf-8")
    )
    research_schema = json.loads(
        (tmp_path / "run" / "nodes" / "research" / "output_schema.json").read_text(
            encoding="utf-8"
        )
    )

    assert result["status"] == "success"
    assert len(captured) == 2
    assert all("--dangerously-bypass-approvals-and-sandbox" not in command for command in captured)
    assert all("--search" not in command for command in captured)
    assert cleaner_input["evidence"]["findings"][0]["detail"] == "A_SENTINEL_123"
    assert "A_SENTINEL_123" in cleaner_output["analysis"]
    assert cleaner_bindings["bindings"][0]["binding_kind"] == "data_edge"
    assert cleaner_bindings["bindings"][0]["source_node"] == "research"
    assert cleaner_bindings["bindings"][0]["target_port"] == "evidence"
    assert cleaner_runtime["execution_mode"] == "production"
    assert cleaner_runtime["adapter"] == "codex_cli"
    assert cleaner_runtime["permissions_effective"]["network"] is False
    assert cleaner_runtime["permissions_effective"]["dangerous"] is False
    assert research_schema["additionalProperties"] is False
    assert "anyOf" not in research_schema
    assert research_schema["properties"]["findings"]["items"]["additionalProperties"] is False


def test_core_v2_production_requires_external_agent_gate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")

    async def fail_if_spawned(*args, **kwargs):
        raise AssertionError("external process should not be spawned")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_if_spawned)
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
output_ports:
  main:
    type: artifact
""".strip(),
        encoding="utf-8",
    )
    workflow_path = tmp_path / "requires_gate.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "requires_gate",
            "version": "0.1.0",
            "nodes": [
                {"id": "research", "callable_ref": {"kind": "agent_class", "id": "stock.codex"}}
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        workspace=tmp_path,
    )
    stderr = (tmp_path / "run" / "nodes" / "research" / "stderr.log").read_text(
        encoding="utf-8"
    )

    assert result["status"] == "failed"
    assert "ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1" in stderr


def test_core_v2_production_codex_permissions_map_to_command(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")
    captured: list[tuple[str, ...]] = []

    async def fake_create(*args, **kwargs):
        captured.append(args)
        return FakeCodexProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
default_permissions:
  network: true
  dangerous: true
output_ports:
  main:
    type: artifact
""".strip(),
        encoding="utf-8",
    )
    workflow_path = tmp_path / "codex_permissions.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "codex_permissions",
            "version": "0.1.0",
            "nodes": [
                {"id": "research", "callable_ref": {"kind": "agent_class", "id": "stock.codex"}}
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        workspace=tmp_path,
    )
    runtime = json.loads(
        (tmp_path / "run" / "nodes" / "research" / "runtime.json").read_text(
            encoding="utf-8"
        )
    )

    assert result["status"] == "success"
    assert "--search" in captured[0]
    assert "--dangerously-bypass-approvals-and-sandbox" in captured[0]
    assert "--sandbox" not in captured[0]
    assert runtime["permissions_effective"]["network"] is True
    assert runtime["permissions_effective"]["dangerous"] is True


def test_runtime_alias_is_not_valid_callable_ref(tmp_path: Path) -> None:
    workflow_path = tmp_path / "alias.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "alias",
            "version": "0.1.0",
            "nodes": [
                {"id": "bad", "callable_ref": {"kind": "agent_class", "id": "codex_cli"}}
            ],
        },
    )

    report = WorkflowAppService(project_root=tmp_path).validate(workflow_path)

    assert report["status"] == "invalid"
    assert any("codex_cli" in issue["message"] for issue in report["errors"])


def test_core_v2_parallel_codex_failures_wait_for_terminal_node_summaries(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    async def fake_create(*args, **kwargs):
        return FailingCodexProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "stock.codex.yaml").write_text(
        """
id: stock.codex
version: 0.1.0
runtime: codex_cli
output_ports:
  main:
    type: artifact
""".strip(),
        encoding="utf-8",
    )
    workflow_path = tmp_path / "parallel_fail.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "parallel_fail",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "research_a",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                },
                {
                    "id": "research_b",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                },
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        workspace=tmp_path,
    )
    summary = json.loads((tmp_path / "run" / "run_summary.json").read_text(encoding="utf-8"))
    research_a_stderr = (tmp_path / "run" / "nodes" / "research_a" / "stderr.log").read_text(
        encoding="utf-8"
    )

    assert result["status"] == "failed"
    assert {node["status"] for node in summary["nodes"]} == {"failed"}
    assert set(summary["failed_nodes"]) == {"research_a", "research_b"}
    assert "codex failed" in research_a_stderr
    assert "ACC runtime error" in research_a_stderr


def test_core_v2_multi_node_dag_success(tmp_path: Path) -> None:
    workflow_path = tmp_path / "dag.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "dag",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "ports": {"inputs": {"main": {"type": "json"}}},
                    "input_bindings": [
                        {
                            "source": {"node": "produce", "port": "main"},
                            "target_port": "main",
                        }
                    ],
                },
            ],
            "control_edges": [{"from": "produce", "to": "consume"}],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    consume_output = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert consume_output["input"]["main"]["producer_node_id"] == "produce"
