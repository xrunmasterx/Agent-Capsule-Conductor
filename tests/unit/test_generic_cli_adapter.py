import asyncio
import sys
from pathlib import Path

from acc.adapters.base import AgentRunRequest
from acc.adapters.generic_cli import GenericCliAdapter
from acc.artifact_store import ArtifactStore
from acc.utils import load_json


def make_request(tmp_path: Path, args: list[str], timeout: float = 5) -> AgentRunRequest:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()
    store.write_input({"message": "hello", "topic": "unit"})
    store.write_prompt("prompt")
    return AgentRunRequest(
        capsule_id="test.generic",
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
    request = make_request(tmp_path, ["-m", "acc.fake_agents", "echo"])

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

