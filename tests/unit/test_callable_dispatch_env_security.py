from __future__ import annotations

from pathlib import Path

import pytest

from acc.adapters.generic_cli import GenericCliAdapter
from acc.app import WorkflowAppService

DEMO_GRAPH = Path("examples/workflows/demo_two_node.graph.json")
HOST_SECRET_KEY = "ACC_TEST_HOST_SECRET"


def test_callable_capsule_path_request_env_excludes_host_secrets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_USE_CALLABLE_DISPATCH", "1")
    monkeypatch.setenv(HOST_SECRET_KEY, "leak-me")

    captured_envs: list[dict[str, str]] = []
    original_run = GenericCliAdapter.run

    async def capturing_run(self, request):  # type: ignore[no-untyped-def]
        captured_envs.append(dict(request.env))
        return await original_run(self, request)

    monkeypatch.setattr(GenericCliAdapter, "run", capturing_run, raising=True)

    result = WorkflowAppService().run_sync(DEMO_GRAPH, tmp_path / "secure_run")

    assert result["status"] == "success"
    assert captured_envs, "expected the capsule backend to invoke the generic_cli adapter"

    allowed_keys = {
        "ACC_ENVIRONMENT_WORKSPACE",
        "ACC_BEHAVIOR_PACK_EFFECTIVE",
        "ACC_BEHAVIOR_CONFLICTS",
    }
    for env in captured_envs:
        # The callable dispatch path must not inject arbitrary host environment keys
        # into the request env; only capsule-declared values + ACC_* extra_env survive.
        assert HOST_SECRET_KEY not in env
        assert set(env).issubset(allowed_keys)
