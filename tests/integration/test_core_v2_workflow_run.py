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


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_binding(path: Path, workflow_id: str, workspace: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "workflow_id": workflow_id,
                "binding_name": path.stem,
                "state_mode": "stateful",
                "workspace_root": str(workspace),
                "behavior_policy": {"mode": "workspace_native"},
            },
            indent=2,
        ),
        encoding="utf-8",
    )


class FakeCodexProcess:
    def __init__(self, command: tuple[str, ...]) -> None:
        self.command = command
        self.returncode = 0
        self.stdout = FakeCodexStdout()
        self.stderr = FakeCodexStderr(b"")
        self.stdin = FakeCodexStdin(self)

    def handle_rpc(self, line: bytes) -> None:
        payload = json.loads(line.decode("utf-8"))
        method = payload.get("method")
        request_id = payload.get("id")
        if method == "initialize":
            self.stdout.push({"jsonrpc": "2.0", "id": request_id, "result": {}})
        elif method == "thread/start":
            self.stdout.push(
                {"jsonrpc": "2.0", "id": request_id, "result": {"threadId": "thread_fake"}}
            )
        elif method == "thread/resume":
            self.stdout.push(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {"threadId": payload["params"]["threadId"]},
                }
            )
        elif method == "turn/start":
            self.stdout.push({"jsonrpc": "2.0", "id": request_id, "result": {}})
            prompt = json.dumps(payload.get("params") or {}, ensure_ascii=False)
            self.stdout.push_agent_message(codex_output_for_prompt(prompt))
            self.stdout.push(
                {
                    "jsonrpc": "2.0",
                    "method": "turn/completed",
                    "params": {"usage": {"input_tokens": 1, "output_tokens": 1}},
                }
            )
            self.stdout.close()

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        prompt = (input or b"").decode("utf-8", errors="replace")
        return json.dumps(codex_output_for_prompt(prompt)).encode("utf-8"), b""

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> None:
        return None


class FakeCodexStdin:
    def __init__(self, process: FakeCodexProcess) -> None:
        self.process = process

    def write(self, data: bytes) -> None:
        for line in data.splitlines():
            if line.strip():
                self.process.handle_rpc(line)

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        return None


class FakeCodexStdout:
    def __init__(self) -> None:
        self.lines: asyncio.Queue[bytes] = asyncio.Queue()

    def push(self, payload: dict) -> None:
        self.lines.put_nowait(json.dumps(payload).encode("utf-8") + b"\n")

    def push_agent_message(self, payload: dict) -> None:
        self.push(
            {
                "jsonrpc": "2.0",
                "method": "item/completed",
                "params": {
                    "item": {
                        "type": "agentMessage",
                        "text": json.dumps(payload, ensure_ascii=False),
                    }
                },
            }
        )

    def close(self) -> None:
        self.lines.put_nowait(b"")

    async def readline(self) -> bytes:
        return await self.lines.get()


class FakeCodexStderr:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.done = False

    async def read(self, size: int = -1) -> bytes:
        _ = size
        if self.done:
            return b""
        self.done = True
        return self.payload


def codex_output_for_prompt(prompt: str) -> dict:
        if "A_SENTINEL_123" in prompt:
            analysis = "received A_SENTINEL_123 and continued downstream analysis"
            summary = "cleaner consumed upstream sentinel"
        else:
            analysis = "produced A_SENTINEL_123 as upstream sentinel"
            summary = "research produced upstream sentinel"
        return {
            "schema_version": "acc.agent.output.v1",
            "status": "success",
            "summary": summary,
            "report_markdown": analysis,
            "findings": [
                {
                    "id": "F1",
                    "severity": "info",
                    "title": "sentinel",
                    "detail": "A_SENTINEL_123",
                    "recommendation": "Keep propagating the sentinel.",
                    "evidence_ids": ["E1"],
                    "confidence": "high",
                }
            ],
            "evidence": [
                {
                    "id": "E1",
                    "kind": "observation",
                    "ref": "test",
                    "note": "test evidence",
                    "quote": "A_SENTINEL_123",
                }
            ],
            "artifacts": [],
            "quality": {
                "confidence": "high",
                "assumptions": [],
                "uncertainties": [],
                "limitations": [],
            },
            "next_actions": [],
            "outputs": {},
        }


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


def test_core_v2_noop_workflow_success(tmp_path: Path) -> None:
    workflow_path = tmp_path / "noop.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "noop",
            "version": "0.1.0",
            "nodes": [],
            "control_edges": [],
            "data_edges": [],
            "exposed_inputs": {"main": {"direction": "input", "required": False}},
            "exposed_outputs": {"main": {"direction": "output", "required": False}},
            "workflow_input_bindings": [],
            "workflow_output_bindings": [],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "noop_run"))

    summary = json.loads((tmp_path / "noop_run" / "run_summary.json").read_text(encoding="utf-8"))
    run_plan = json.loads((tmp_path / "noop_run" / "run_plan.json").read_text(encoding="utf-8"))
    events = (tmp_path / "noop_run" / "events.jsonl").read_text(encoding="utf-8")
    assert record.status == "success"
    assert summary["status"] == "success"
    assert run_plan["step_count"] == 0
    assert "workflow_completed" in events
    assert not (tmp_path / "noop_run" / "workflow_outputs" / "main" / "output.json").exists()


def test_workflow_run_uses_workspace_binding_for_root_scope(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    binding_path = tmp_path / "root.binding.local.json"
    write_binding(binding_path, "bound_root", workspace)
    workflow_path = tmp_path / "bound_root.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "bound_root",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        binding_path=binding_path,
    )

    scope = read_json(tmp_path / "run" / "scope_frame.json")
    output = read_json(tmp_path / "run" / "nodes" / "produce" / "output.json")
    assert result["status"] == "success"
    assert Path(scope["workspace_root"]) == workspace.resolve()
    assert Path(scope["binding_path"]) == binding_path.resolve()
    assert scope["ephemeral"] is False
    assert output["cwd"] == str(workspace.resolve())


def test_workflow_run_uses_explicit_workspace_for_root_scope(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    workflow_path = tmp_path / "workspace_root.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "workspace_root",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        workflow_path,
        tmp_path / "run",
        workspace=workspace,
    )

    scope = read_json(tmp_path / "run" / "scope_frame.json")
    assert result["status"] == "success"
    assert Path(scope["workspace_root"]) == workspace.resolve()
    assert scope["binding_path"] is None
    assert scope["ephemeral"] is False


def test_workflow_run_defaults_to_ephemeral_run_workspace(tmp_path: Path) -> None:
    workflow_path = tmp_path / "ephemeral_root.accflow.json"
    run_dir = tmp_path / "run"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "ephemeral_root",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(workflow_path, run_dir)

    scope = read_json(run_dir / "scope_frame.json")
    assert result["status"] == "success"
    assert Path(scope["workspace_root"]) == run_dir.resolve()
    assert scope["binding_path"] is None
    assert scope["ephemeral"] is True


def test_workflow_run_rejects_workspace_and_binding_together(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    binding_path = tmp_path / "root.binding.local.json"
    write_binding(binding_path, "reject_both", workspace)
    workflow_path = tmp_path / "reject_both.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "reject_both",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
            ],
        },
    )

    with pytest.raises(Exception, match="Provide workspace or binding_path, not both"):
        WorkflowAppService(project_root=tmp_path).run_sync(
            workflow_path,
            tmp_path / "run",
            workspace=workspace,
            binding_path=binding_path,
        )


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


def test_nested_workflow_inherits_bound_parent_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    binding_path = tmp_path / "parent.binding.local.json"
    write_binding(binding_path, "parent", workspace)
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
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
                    "callable_ref": {"kind": "workflow_function", "id": child_path.name},
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        parent_path,
        tmp_path / "run",
        binding_path=binding_path,
    )

    child_run_dir = tmp_path / "run" / "nodes" / "subflow" / "nested_workflow"
    root_scope = read_json(tmp_path / "run" / "scope_frame.json")
    child_scope = read_json(child_run_dir / "scope_frame.json")
    child_output = read_json(child_run_dir / "nodes" / "produce" / "output.json")
    assert result["status"] == "success"
    assert Path(root_scope["workspace_root"]) == workspace.resolve()
    assert Path(child_scope["workspace_root"]) == workspace.resolve()
    assert Path(child_scope["binding_path"]) == binding_path.resolve()
    assert child_scope["ephemeral"] is False
    assert child_scope["parent_frame_id"] == root_scope["frame_id"]
    assert child_scope["call_depth"] == 1
    assert child_output["cwd"] == str(workspace.resolve())


def test_nested_workflow_new_ephemeral_uses_child_run_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    binding_path = tmp_path / "parent.binding.local.json"
    write_binding(binding_path, "parent", workspace)
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
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
                    "callable_ref": {"kind": "workflow_function", "id": child_path.name},
                    "environment_policy": "new_ephemeral",
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        parent_path,
        tmp_path / "run",
        binding_path=binding_path,
    )

    child_run_dir = tmp_path / "run" / "nodes" / "subflow" / "nested_workflow"
    child_scope = read_json(child_run_dir / "scope_frame.json")
    assert result["status"] == "success"
    assert Path(child_scope["workspace_root"]) == child_run_dir.resolve()
    assert child_scope["binding_path"] is None
    assert child_scope["ephemeral"] is True


@pytest.mark.parametrize("environment_policy", ["forbidden", "binding_required"])
def test_nested_workflow_rejects_unsupported_environment_policy(
    tmp_path: Path,
    environment_policy: str,
) -> None:
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "nodes": [
                {"id": "produce", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}}
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
                    "callable_ref": {"kind": "workflow_function", "id": child_path.name},
                    "environment_policy": environment_policy,
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(parent_path, tmp_path / "run")

    assert result["status"] == "failed"
    stderr = (tmp_path / "run" / "nodes" / "subflow" / "stderr.log").read_text(
        encoding="utf-8"
    )
    assert environment_policy in stderr


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


def test_nested_codex_agent_command_uses_inherited_bound_workspace(
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
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    binding_path = tmp_path / "parent.binding.local.json"
    write_binding(binding_path, "parent", workspace)
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
                {"id": "research", "callable_ref": {"kind": "agent_class", "id": "stock.codex"}}
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
                    "callable_ref": {"kind": "workflow_function", "id": child_path.name},
                }
            ],
        },
    )

    result = WorkflowAppService(project_root=tmp_path).run_sync(
        parent_path,
        tmp_path / "run",
        binding_path=binding_path,
    )

    child_runtime = read_json(
        tmp_path
        / "run"
        / "nodes"
        / "subflow"
        / "nested_workflow"
        / "nodes"
        / "research"
        / "runtime.json"
    )
    command = list(captured[0])
    assert result["status"] == "success"
    assert command[1:] == ["app-server", "--listen", "stdio://"]
    assert child_runtime["workspace_dir"] == str(workspace.resolve())
    assert child_runtime["command_argv_redacted"] == [
        "codex",
        "app-server",
        "--listen",
        "stdio://",
    ]


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
    assert "A_SENTINEL_123" in cleaner_output["report_markdown"]
    assert cleaner_bindings["bindings"][0]["binding_kind"] == "data_edge"
    assert cleaner_bindings["bindings"][0]["source_node"] == "research"
    assert cleaner_bindings["bindings"][0]["target_port"] == "evidence"
    assert cleaner_runtime["execution_mode"] == "production"
    assert cleaner_runtime["adapter"] == "codex_app_server"
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
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "0")

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
    assert captured[0][1:] == ("app-server", "--listen", "stdio://")
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


def test_control_edge_forwards_main_output_by_default(tmp_path: Path) -> None:
    workflow_path = tmp_path / "control_forwards_main.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "control_forwards_main",
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
    bindings = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert consume_output["input"]["main"]["producer_node_id"] == "produce"
    assert bindings["bindings"][0]["binding_kind"] == "control_main_default"


def test_multiple_control_edges_aggregate_main_outputs(tmp_path: Path) -> None:
    workflow_path = tmp_path / "control_aggregates_main.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "control_aggregates_main",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "left",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "right",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "ports": {"inputs": {"main": {"type": "json"}}},
                },
            ],
            "control_edges": [
                {"from": "left", "to": "consume"},
                {"from": "right", "to": "consume"},
            ],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    agent_payload = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    bindings = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )

    aggregate = agent_payload["main"]
    assert record.status == "success"
    assert aggregate["schema_version"] == "acc.control_main.aggregate.v1"
    assert aggregate["kind"] == "control_main_aggregate"
    assert aggregate["order"] == ["left", "right"]
    assert aggregate["sources"]["left"]["producer_node_id"] == "left"
    assert aggregate["sources"]["right"]["producer_node_id"] == "right"
    assert [binding["binding_kind"] for binding in bindings["bindings"]] == [
        "control_main_default",
        "control_main_default",
        "control_main_aggregate",
    ]
    assert bindings["bindings"][2]["aggregate_order"] == ["left", "right"]


def test_multiple_control_edges_do_not_override_explicit_main(tmp_path: Path) -> None:
    workflow_path = tmp_path / "control_main_explicit_priority.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "control_main_explicit_priority",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "left",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "right",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "overrides": {"static_input": {"main": {"explicit": True}}},
                    "ports": {"inputs": {"main": {"type": "json"}}},
                },
            ],
            "control_edges": [
                {"from": "left", "to": "consume"},
                {"from": "right", "to": "consume"},
            ],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    agent_payload = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    bindings = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert agent_payload["main"] == {"explicit": True}
    assert [binding["binding_kind"] for binding in bindings["bindings"]] == ["static_input"]


def test_control_edge_can_disable_main_output_forwarding(tmp_path: Path) -> None:
    workflow_path = tmp_path / "control_only.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "control_only",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "control": {"forward_main_output_on_control": False},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "ports": {"inputs": {"main": {"type": "json"}}},
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
    bindings = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert "main" not in consume_output["input"]
    assert bindings["bindings"] == []


def test_non_main_data_edge_uses_outputs_container_port_value(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    class RiskTableCodexProcess:
        def __init__(self, command: tuple[str, ...]) -> None:
            self.command = command
            self.returncode = 0
            self.stdout = FakeCodexStdout()
            self.stderr = FakeCodexStderr(b"")
            self.stdin = FakeCodexStdin(self)

        def handle_rpc(self, line: bytes) -> None:
            payload = json.loads(line.decode("utf-8"))
            method = payload.get("method")
            request_id = payload.get("id")
            if method == "initialize":
                self.stdout.push({"jsonrpc": "2.0", "id": request_id, "result": {}})
            elif method == "thread/start":
                self.stdout.push(
                    {"jsonrpc": "2.0", "id": request_id, "result": {"threadId": "thread_fake"}}
                )
            elif method == "turn/start":
                self.stdout.push({"jsonrpc": "2.0", "id": request_id, "result": {}})
                self.stdout.push_agent_message(
                    {"outputs": {"risk_table": [{"risk": "structured"}]}}
                )
                self.stdout.push({"jsonrpc": "2.0", "method": "turn/completed", "params": {}})
                self.stdout.close()

        def kill(self) -> None:
            self.returncode = -9

        async def wait(self) -> None:
            return None

    async def fake_create(*args: str, **kwargs: object) -> RiskTableCodexProcess:
        _ = kwargs
        return RiskTableCodexProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
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
  risk_table:
    type: json
artifact_contract:
  output_schema:
    type: object
    properties:
      outputs:
        type: object
        properties:
          risk_table:
            type: array
""".strip(),
        encoding="utf-8",
    )
    workflow_path = tmp_path / "non_main_port.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "non_main_port",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "agent_class", "id": "stock.codex"},
                    "prompt_policy": {"user_prompt": "Produce risk table"},
                    "ports": {
                        "outputs": {
                            "main": {"type": "artifact"},
                            "risk_table": {"type": "json"},
                        }
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "outputs": {
                                "type": "object",
                                "properties": {"risk_table": {"type": "array"}},
                            }
                        },
                    },
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "ports": {"inputs": {"risk_table": {"type": "json"}}},
                },
            ],
            "control_edges": [{"from": "produce", "to": "consume"}],
            "data_edges": [
                {
                    "source": {"node": "produce", "port": "risk_table"},
                    "target": {"node": "consume", "port": "risk_table"},
                    "materialization": "copy",
                }
            ],
        },
    )

    record = asyncio.run(
        run_core_v2_workflow_path(
            workflow_path,
            tmp_path / "run",
            callable_registry=WorkflowAppService(project_root=tmp_path).callable_registry,
        )
    )
    consume_output = json.loads(
        (tmp_path / "run" / "nodes" / "consume" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert consume_output["input"]["risk_table"] == [{"risk": "structured"}]
