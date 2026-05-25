import asyncio
import json
from pathlib import Path

from acc.adapters.base import AgentRunRequest
from acc.adapters.codex_cli import CodexCliAdapter
from acc.artifact_store import ArtifactStore


class FakeProcess:
    def __init__(
        self,
        command: tuple[str, ...],
        returncode: int = 0,
        write_output: bool = True,
        delay: float = 0,
    ) -> None:
        self.command = command
        self.returncode = returncode
        self.write_output = write_output
        self.delay = delay

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.write_output and "-o" in self.command:
            output_path = Path(self.command[self.command.index("-o") + 1])
            output_path.write_text(
                json.dumps({"status": "success", "summary": "ok"}),
                encoding="utf-8",
            )
        return b'{"event":"codex"}\n', b"stderr\n"

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> None:
        return None


def make_request(tmp_path: Path, timeout: float = 5) -> AgentRunRequest:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()
    store.write_prompt("prompt")
    return AgentRunRequest(
        capsule_id="source-reality-check.codex",
        run_dir=store.run_dir,
        workspace_dir=tmp_path,
        prompt_path=store.prompt_path,
        input_payload={"claim": "x"},
        output_schema_path=tmp_path / "output_schema.json",
        timeout_seconds=timeout,  # type: ignore[arg-type]
        command="codex",
        args_base=["exec"],
    )


def test_codex_command_and_capture(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, tuple[str, ...]] = {}

    async def fake_create(*args, **kwargs):
        captured["command"] = args
        return FakeProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    request = make_request(tmp_path)

    result = asyncio.run(CodexCliAdapter().run(request))

    command = captured["command"]
    assert Path(command[0]).name.lower().startswith("codex")
    assert command[1] == "exec"
    assert "--cd" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert "--json" in command
    assert "--output-schema" in command
    assert "-o" in command
    assert result.status == "success"
    assert request.stdout_log_path.read_text(encoding="utf-8") == '{"event":"codex"}\n'
    events = [
        json.loads(line)
        for line in request.events_log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert events == [
        {
            "exit_code": 0,
            "runtime": "codex_cli",
            "stderr_bytes": 7,
            "stdout_bytes": 18,
            "type": "adapter_event",
        }
    ]
    assert request.stderr_log_path.read_text(encoding="utf-8") == "stderr\n"


def test_codex_nonzero_exit_returns_failed(monkeypatch, tmp_path: Path) -> None:
    async def fake_create(*args, **kwargs):
        return FakeProcess(args, returncode=2, write_output=False)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    result = asyncio.run(CodexCliAdapter().run(make_request(tmp_path)))

    assert result.status == "failed"
    assert result.exit_code == 2


def test_codex_missing_output_returns_failed(monkeypatch, tmp_path: Path) -> None:
    async def fake_create(*args, **kwargs):
        return FakeProcess(args, write_output=False)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    result = asyncio.run(CodexCliAdapter().run(make_request(tmp_path)))

    assert result.status == "failed"
    assert "output.json" in (result.error or "")


def test_codex_timeout_returns_timeout(monkeypatch, tmp_path: Path) -> None:
    async def fake_create(*args, **kwargs):
        return FakeProcess(args, delay=2)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    result = asyncio.run(CodexCliAdapter().run(make_request(tmp_path, timeout=0.01)))

    assert result.status == "timeout"


def test_codex_rejects_unapproved_dangerous_sandbox(tmp_path: Path) -> None:
    request = make_request(tmp_path)
    request = AgentRunRequest(
        **{**request.__dict__, "sandbox": "danger-full-access", "allow_dangerous": False}
    )

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "failed"
    assert "danger-full-access" in (result.error or "")
