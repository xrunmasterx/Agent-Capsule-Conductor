import asyncio
from pathlib import Path

from acc.adapters.base import AgentRunRequest
from acc.adapters.claude_sdk import ClaudeSdkAdapter
from acc.artifact_store import ArtifactStore
from acc.utils import load_json


def make_request(tmp_path: Path) -> AgentRunRequest:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()
    store.write_prompt("prompt")
    return AgentRunRequest(
        callable_id="critical-review.claude",
        run_dir=store.run_dir,
        workspace_dir=tmp_path,
        prompt_path=store.prompt_path,
        input_payload={"material": "x"},
        output_schema_path=tmp_path / "output_schema.json",
        timeout_seconds=5,
        command=None,
        args_base=[],
    )


def test_unavailable_package_returns_unavailable(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("importlib.util.find_spec", lambda name: None)

    result = asyncio.run(ClaudeSdkAdapter().run(make_request(tmp_path)))

    assert result.status == "unavailable"
    assert "unavailable" in (result.error or "")


def test_fake_sdk_message_stream_is_captured(tmp_path: Path) -> None:
    async def stream(request):
        yield {"event": "message", "text": "hello"}
        yield {"output": {"status": "success", "summary": "ok"}}

    request = make_request(tmp_path)
    result = asyncio.run(ClaudeSdkAdapter(stream).run(request))

    assert result.status == "success"
    assert "message" in request.events_log_path.read_text(encoding="utf-8")
    assert load_json(request.output_json_path)["summary"] == "ok"
