from __future__ import annotations

from pathlib import Path


def test_runtime_dispatch_modules_do_not_call_graphops_apply() -> None:
    for path in (
        Path("acc/app/core_v2_runtime.py"),
        Path("acc/app/runtime/orchestrator.py"),
        Path("acc/app/supervisor.py"),
        Path("acc/app/handoff.py"),
    ):
        text = path.read_text(encoding="utf-8")
        assert "apply_patch_request" not in text


def test_graphops_library_does_not_write_run_scoped_decisions() -> None:
    text = Path("acc/graphops.py").read_text(encoding="utf-8")

    assert "append_decision_record" not in text
    assert "decisions.jsonl" not in text
