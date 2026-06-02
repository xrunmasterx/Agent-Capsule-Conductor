from typer.testing import CliRunner

from acc.cli import app


def test_acc_list_legacy_surface_is_not_registered() -> None:
    result = CliRunner().invoke(app, ["list"])

    assert result.exit_code == 2
    assert "No such command" in result.stderr


def test_acc_show_legacy_surface_is_not_registered() -> None:
    result = CliRunner().invoke(app, ["show", "echo-test.generic"])

    assert result.exit_code == 2
    assert "No such command" in result.stderr


def test_acc_validate_legacy_surface_is_not_registered() -> None:
    result = CliRunner().invoke(app, ["validate", "echo-test.generic"])

    assert result.exit_code == 2
    assert "No such command" in result.stderr


def test_acc_callable_list_exits_zero() -> None:
    result = CliRunner().invoke(app, ["callable", "list", "--json"])

    assert result.exit_code == 0
    assert '"callables"' in result.stdout
