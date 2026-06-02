"""Top-level pytest configuration shared by all test packages.

Phase 2 e2e tests under ``tests/e2e/`` exercise WorkflowAppService against
real disk artifacts but rely on in-process fake Core v2 callable refs. No
subprocess is spawned and no external agent is required.

Pytest markers used across the suite:

- ``e2e``: end-to-end Phase 2 acceptance criterion tests
- ``T_AC<n>``: per-AC marker (e.g. ``T_AC1``) for slicing the matrix
- ``unit`` / ``integration``: legacy markers already in use under
  ``tests/unit`` and ``tests/integration``.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest


def pytest_configure(config: pytest.Config) -> None:
    """Register custom markers so ``pytest --strict-markers`` stays clean."""
    config.addinivalue_line("markers", "e2e: end-to-end acceptance test")
    config.addinivalue_line("markers", "unit: unit-level test")
    config.addinivalue_line("markers", "integration: integration test")
    config.addinivalue_line("markers", "migration: migration and byte-equivalence tests")
    for ac_index in range(1, 19):
        config.addinivalue_line(
            "markers",
            f"T_AC{ac_index}: workflow message-routing acceptance criterion",
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _hermetic_acc_run_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")


@pytest.fixture()
def fake_executor() -> Callable[..., Any]:
    """Return the in-process fake executor used by Phase 2 e2e tests.

    Phase 2 e2e tests do NOT spawn agent subprocesses. They rely on the
    Core v2 fake callable execution path to write deterministic
    ``output.json`` files and small artifacts directly.

    The fixture is a thin wrapper exposing that executor as the
    ``node_executor=`` keyword that ``WorkflowAppService.run`` /
    ``run_workflow_template_instance`` accept. Tests that just want
    the default in-process behavior can omit ``node_executor=`` and
    let ``run_clean_node`` pick the bound executor on its own — this
    fixture is exposed primarily so individual tests can wrap the
    executor (e.g. for assertions) without re-implementing the
    fake.
    """

    from acc.runtime import execute_clean_node

    async def _fake_node_executor(node, workflow_path, run_dir, node_dir, frame):
        return await execute_clean_node(node, workflow_path, run_dir, node_dir, frame)

    return _fake_node_executor


@pytest.fixture()
def read_node_artifacts() -> Callable[[Path, str], dict[str, Any]]:
    """Return a helper that loads a node's persisted artifacts.

    Returns a callable ``read_node_artifacts(run_dir, node_id)`` that
    yields a dict with ``input``, ``output``, ``runtime`` (or None if
    missing), and ``resolved_prompt`` (str or None) — the four files
    every Phase 2 e2e test inspects.
    """

    def _read(run_dir: Path, node_id: str) -> dict[str, Any]:
        node_dir = run_dir / "nodes" / node_id
        input_path = node_dir / "input.json"
        output_path = node_dir / "output.json"
        runtime_path = node_dir / "runtime.json"
        prompt_path = node_dir / "resolved_prompt.md"
        return {
            "node_dir": node_dir,
            "input": json.loads(input_path.read_text(encoding="utf-8"))
            if input_path.exists()
            else None,
            "output": json.loads(output_path.read_text(encoding="utf-8"))
            if output_path.exists()
            else None,
            "runtime": json.loads(runtime_path.read_text(encoding="utf-8"))
            if runtime_path.exists()
            else None,
            "resolved_prompt": prompt_path.read_text(encoding="utf-8")
            if prompt_path.exists()
            else None,
        }

    return _read

