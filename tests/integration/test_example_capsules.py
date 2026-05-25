from typer.testing import CliRunner

from acc.cli import app


def test_example_capsules_validate_without_external_agents() -> None:
    runner = CliRunner()

    for capsule_id in [
        "echo-test.generic",
        "fake-agent.generic",
        "source-reality-check.codex",
        "critical-review.claude",
        "workflow-editor.codex",
        "codex-workflow-capsule.example",
        "acc-subworkflow-capsule.example",
        "external-workflow-capsule.example",
        "semiconductor-news-research.codex",
        "semiconductor-investment-analysis.codex",
    ]:
        result = runner.invoke(app, ["validate", capsule_id])
        assert result.exit_code == 0, result.output
