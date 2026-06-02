import asyncio
import json
from pathlib import Path
from typing import Any

from acc.adapters.base import AgentRunRequest
from acc.adapters.codex_cli import CodexCliAdapter, build_codex_command
from acc.artifact_store import ArtifactStore


class FakeProcess:
    def __init__(
        self,
        command: tuple[str, ...],
        returncode: int = 0,
        write_output: bool = True,
        delay: float = 0,
        write_output_before_delay: bool = False,
    ) -> None:
        self.command = command
        self.returncode = returncode
        self.write_output = write_output
        self.delay = delay
        self.write_output_before_delay = write_output_before_delay

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        if self.write_output_before_delay:
            self.write_codex_output()
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.write_output and not self.write_output_before_delay:
            self.write_codex_output()
        return b'{"event":"codex"}\n', b"stderr\n"

    def write_codex_output(self) -> None:
        if "-o" not in self.command:
            return
        output_path = Path(self.command[self.command.index("-o") + 1])
        output_path.write_text(
            json.dumps({"status": "success", "summary": "ok"}),
            encoding="utf-8",
        )

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> None:
        return None


class FakePipe:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = list(chunks)

    async def read(self, _size: int) -> bytes:
        if not self.chunks:
            return b""
        return self.chunks.pop(0)


class FakeStdin:
    def __init__(self) -> None:
        self.payload = b""
        self.closed = False

    def write(self, payload: bytes) -> None:
        self.payload += payload

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True


class StreamingFakeProcess:
    def __init__(self, command: tuple[str, ...]) -> None:
        self.command = command
        self.returncode = 0
        self.stdin = FakeStdin()
        self.stdout = FakePipe([b"stdout-a\n", b"stdout-b\n"])
        self.stderr = FakePipe([b"stderr-a\n"])
        self.killed = False

    def write_codex_output(self) -> None:
        if "-o" not in self.command:
            return
        output_path = Path(self.command[self.command.index("-o") + 1])
        output_path.write_text(
            json.dumps({"status": "success", "summary": "ok"}),
            encoding="utf-8",
        )

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self) -> None:
        if not self.killed:
            self.write_codex_output()
        return None


def make_request(tmp_path: Path, timeout: float = 5) -> AgentRunRequest:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()
    store.write_prompt("prompt")
    return AgentRunRequest(
        callable_id="source-reality-check.codex",
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
    captured: dict[str, Any] = {}

    async def fake_create(*args, **kwargs):
        captured["command"] = args
        captured["env"] = kwargs["env"]
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
    assert events[0]["exit_code"] == 0
    assert events[0]["runtime"] == "codex_cli"
    assert events[0]["stderr_bytes"] == 7
    assert events[0]["stdout_bytes"] == 18
    assert events[0]["type"] == "adapter_event"
    assert events[0]["command"] == list(command)
    assert request.stderr_log_path.read_text(encoding="utf-8") == "stderr\n"
    assert Path(captured["env"]["CODEX_HOME"]) == request.run_dir / "codex_home"


def test_codex_streams_stdout_and_stderr_before_process_exit(monkeypatch, tmp_path: Path) -> None:
    async def fake_create(*args, **kwargs):
        return StreamingFakeProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    request = make_request(tmp_path)

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "success"
    assert request.stdout_log_path.read_text(encoding="utf-8") == "stdout-a\nstdout-b\n"
    assert request.stderr_log_path.read_text(encoding="utf-8") == "stderr-a\n"


def test_codex_cancel_marker_kills_streamed_process(monkeypatch, tmp_path: Path) -> None:
    process_holder: dict[str, StreamingFakeProcess] = {}

    async def fake_create(*args, **kwargs):
        process = StreamingFakeProcess(args)
        process_holder["process"] = process
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    base_request = make_request(tmp_path)
    cancel_path = base_request.run_dir / "cancel_requested"
    cancel_path.write_text("cancel", encoding="utf-8")
    request = AgentRunRequest(**{**base_request.__dict__, "cancel_path": cancel_path})

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "cancelled"
    assert process_holder["process"].killed is True
    assert "cancellation requested" in request.stderr_log_path.read_text(encoding="utf-8")


def test_codex_run_uses_isolated_codex_home_seeded_from_user_home(
    monkeypatch, tmp_path: Path
) -> None:
    source_home = tmp_path / "source-codex-home"
    source_home.mkdir()
    (source_home / "auth.json").write_text('{"mode":"test"}', encoding="utf-8")
    (source_home / "config.toml").write_text('model="test"\n', encoding="utf-8")
    monkeypatch.setenv("CODEX_HOME", str(source_home))
    captured: dict[str, dict[str, str]] = {}

    async def fake_create(*args, **kwargs):
        captured["env"] = kwargs["env"]
        return FakeProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    request = make_request(tmp_path)

    result = asyncio.run(CodexCliAdapter().run(request))

    codex_home = Path(captured["env"]["CODEX_HOME"])
    assert result.status == "success"
    assert codex_home == request.run_dir / "codex_home"
    assert (codex_home / "auth.json").read_text(encoding="utf-8") == '{"mode":"test"}'
    assert (codex_home / "config.toml").read_text(encoding="utf-8") == 'model="test"\n'


def test_codex_run_preserves_explicit_codex_home_env(monkeypatch, tmp_path: Path) -> None:
    explicit_home = tmp_path / "explicit-codex-home"
    captured: dict[str, dict[str, str]] = {}

    async def fake_create(*args, **kwargs):
        captured["env"] = kwargs["env"]
        return FakeProcess(args)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    request = AgentRunRequest(
        **{**make_request(tmp_path).__dict__, "env": {"CODEX_HOME": str(explicit_home)}}
    )

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "success"
    assert captured["env"]["CODEX_HOME"] == str(explicit_home)


def test_codex_command_uses_absolute_paths_for_workspace_cwd(tmp_path: Path) -> None:
    request = make_request(tmp_path)
    workspace = tmp_path / "external-workspace"
    workspace.mkdir()
    request = AgentRunRequest(
        **{
            **request.__dict__,
            "workspace_dir": workspace,
            "output_schema_path": Path("callables/example/output_schema.json"),
        }
    )

    command = build_codex_command(request)

    assert Path(command[command.index("--cd") + 1]).is_absolute()
    assert Path(command[command.index("--output-schema") + 1]).is_absolute()
    assert Path(command[command.index("-o") + 1]).is_absolute()


def test_codex_production_command_uses_yolo_search_profile(tmp_path: Path) -> None:
    request = AgentRunRequest(
        **{
            **make_request(tmp_path).__dict__,
            "sandbox": "danger-full-access",
            "allow_dangerous": True,
            "bypass_approvals_and_sandbox": True,
            "enable_search": True,
        }
    )

    command = build_codex_command(request)

    assert command[1] == "--search"
    assert command[2] == "exec"
    assert "--cd" in command
    assert "--dangerously-bypass-approvals-and-sandbox" in command
    assert "--search" in command
    assert command.index("--search") < command.index("exec")
    assert "--json" in command
    assert "--output-schema" in command
    assert "-o" in command
    assert command[-1] == "-"
    assert "--sandbox" not in command


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


def test_codex_timeout_after_output_returns_success(monkeypatch, tmp_path: Path) -> None:
    async def fake_create(*args, **kwargs):
        return FakeProcess(args, delay=2, write_output_before_delay=True)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    request = make_request(tmp_path, timeout=0.01)

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "success"
    assert result.output_json_path == request.output_json_path
    events = [
        json.loads(line)
        for line in request.events_log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert events[-1]["type"] == "timeout"
    assert events[-1]["output_salvaged"] is True


def test_codex_rejects_unapproved_dangerous_sandbox(tmp_path: Path) -> None:
    request = make_request(tmp_path)
    request = AgentRunRequest(
        **{**request.__dict__, "sandbox": "danger-full-access", "allow_dangerous": False}
    )

    result = asyncio.run(CodexCliAdapter().run(request))

    assert result.status == "failed"
    assert "danger-full-access" in (result.error or "")

