import asyncio
import sys
from pathlib import Path

from acc.adapters.base import AgentRunRequest, build_shared_acc_env
from acc.adapters.generic_cli import GenericCliAdapter
from acc.artifact_store import ArtifactStore
from acc.utils import load_json


def make_request(tmp_path: Path, args: list[str], timeout: float = 5) -> AgentRunRequest:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()
    store.write_input({"message": "hello", "topic": "unit"})
    store.write_prompt("prompt")
    return AgentRunRequest(
        callable_id="test.generic",
        run_dir=store.run_dir,
        workspace_dir=Path.cwd(),
        prompt_path=store.prompt_path,
        input_payload={"message": "hello", "topic": "unit"},
        output_schema_path=tmp_path / "schema.json",
        timeout_seconds=timeout,  # type: ignore[arg-type]
        command=sys.executable,
        args_base=args,
    )


def test_runs_fake_agent_successfully(tmp_path: Path) -> None:
    request = make_request(tmp_path, ["-m", "tests.fixtures.fake_agents", "echo"])

    result = asyncio.run(GenericCliAdapter().run(request))

    assert result.status == "success"
    assert load_json(request.output_json_path)["status"] == "success"
    assert request.stdout_log_path.read_text(encoding="utf-8")
    assert request.stderr_log_path.read_text(encoding="utf-8")


def test_non_zero_exit_returns_failed(tmp_path: Path) -> None:
    request = make_request(tmp_path, ["-c", "import sys; sys.exit(7)"])

    result = asyncio.run(GenericCliAdapter().run(request))

    assert result.status == "failed"
    assert result.exit_code == 7


def test_timeout_returns_timeout(tmp_path: Path) -> None:
    request = make_request(tmp_path, ["-c", "import time; time.sleep(2)"], timeout=0.01)

    result = asyncio.run(GenericCliAdapter().run(request))

    assert result.status == "timeout"


def test_missing_output_json_returns_failed(tmp_path: Path) -> None:
    request = make_request(tmp_path, ["-c", "print('not json')"])

    result = asyncio.run(GenericCliAdapter().run(request))

    assert result.status == "failed"
    assert "did not produce" in (result.error or "")


def test_build_shared_acc_env_includes_optional_runtime_paths(tmp_path: Path) -> None:
    request = AgentRunRequest(
        callable_id="test.generic",
        run_dir=tmp_path / "run",
        workspace_dir=tmp_path,
        prompt_path=tmp_path / "prompt.md",
        input_payload={},
        output_schema_path=tmp_path / "schema.json",
        timeout_seconds=5,
        command="python",
        args_base=[],
        inbox_dir=tmp_path / "inbox",
        outbox_dir=tmp_path / "outbox",
        environment_id="env-1",
        node_id="node-1",
        run_id="run-1",
    )

    env = build_shared_acc_env(request)

    assert env == {
        "ACC_RUN_DIR": str(tmp_path / "run"),
        "ACC_INBOX_DIR": str(tmp_path / "inbox"),
        "ACC_OUTBOX_DIR": str(tmp_path / "outbox"),
        "ACC_ENVIRONMENT_ID": "env-1",
        "ACC_NODE_ID": "node-1",
        "ACC_RUN_ID": "run-1",
    }
