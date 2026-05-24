from typer.testing import CliRunner

from acc.cli import app


def test_acc_list_exits_zero() -> None:
    result = CliRunner().invoke(app, ["list"])

    assert result.exit_code == 0
    assert "echo-test.generic" in result.stdout


def test_acc_show_exits_zero() -> None:
    result = CliRunner().invoke(app, ["show", "echo-test.generic"])

    assert result.exit_code == 0
    assert "Echo Test" in result.stdout


def test_acc_validate_echo_exits_zero() -> None:
    result = CliRunner().invoke(app, ["validate", "echo-test.generic"])

    assert result.exit_code == 0
    assert '"status": "valid"' in result.stdout


def test_acc_validate_workflow_editor_exits_zero() -> None:
    result = CliRunner().invoke(app, ["validate", "workflow-editor.codex"])

    assert result.exit_code == 0
    assert '"status": "valid"' in result.stdout


def test_acc_validate_missing_exits_nonzero() -> None:
    result = CliRunner().invoke(app, ["validate", "broken-capsule"])

    assert result.exit_code != 0
    assert "Capsule not found" in result.stderr
