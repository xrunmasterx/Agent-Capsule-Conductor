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


def test_graphops_dry_run_does_not_mutate_target() -> None:
    target_path = Path("examples/workflows/demo_level_parallel.graph.json")
    before = target_path.read_text(encoding="utf-8")

    result = CliRunner().invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json", "--dry-run"],
    )

    after = target_path.read_text(encoding="utf-8")
    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "dry_run"
    assert payload["target_path"] == "examples/workflows/demo_level_parallel.graph.json"
    assert payload["operations"]
    assert before == after


def test_graphops_apply_without_human_approval_fails() -> None:
    result = CliRunner().invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json"],
    )

    assert result.exit_code != 0
    assert "requires --apply --human-approved" in result.stderr
