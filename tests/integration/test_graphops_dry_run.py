import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_graphops_validate_patch_exits_zero() -> None:
    result = CliRunner().invoke(
        app,
        ["graphops", "validate-patch", "examples/graphops/add-review-node.patch.json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "valid"
    assert payload["operations"] == 3
    assert payload["apply_status"] == "not_implemented"
    assert payload["dry_run_only"] is True


def test_graphops_dry_run_does_not_mutate_target() -> None:
    target_path = Path("examples/workflows/control_plane_demo.accflow.json")
    before = target_path.read_text(encoding="utf-8")

    result = CliRunner().invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json", "--dry-run"],
    )

    after = target_path.read_text(encoding="utf-8")
    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "dry_run"
    assert payload["target_path"] == "examples/workflows/control_plane_demo.accflow.json"
    assert payload["apply_status"] == "not_implemented"
    assert payload["operations"]
    assert before == after


def test_graphops_apply_without_human_approval_fails() -> None:
    result = CliRunner().invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json"],
    )

    assert result.exit_code != 0
    assert "apply is unavailable in Option A" in result.stderr


def test_graphops_apply_with_human_approval_fails_as_not_implemented() -> None:
    result = CliRunner().invoke(
        app,
        [
            "graphops",
            "apply-patch",
            "examples/graphops/add-review-node.patch.json",
            "--apply",
            "--human-approved",
        ],
    )

    assert result.exit_code != 0
    assert "not implemented in Option A" in result.stderr
