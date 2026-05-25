import asyncio
import sys
from pathlib import Path

from acc.registry import CapsuleRegistry
from acc.runner import CapsuleRunner
from acc.utils import AccError, load_json, split_lifecycle_command


def test_agent_workflow_capsule_materializes_snapshot_and_lifecycle_logs(tmp_path: Path) -> None:
    run_dir = tmp_path / "agent_workflow"

    result = asyncio.run(
        CapsuleRunner(registry=CapsuleRegistry()).run(
            "codex-workflow-capsule.example",
            {"topic": "unit workflow"},
            run_dir,
        )
    )

    assert result["status"] == "success"
    template_snapshot = run_dir / "template_snapshot"
    assert (template_snapshot / "capsule.yaml").exists()
    assert (template_snapshot / "input_schema.json").exists()
    assert (template_snapshot / "output_schema.json").exists()
    assert (template_snapshot / "artifact_manifest.yaml").exists()
    assert (template_snapshot / "behavior_pack" / "AGENTS.md").exists()
    assert (run_dir / "lifecycle_logs" / "setup" / "stage.json").exists()
    assert (run_dir / "lifecycle_logs" / "run" / "stage.json").exists()


def test_external_workflow_capsule_records_external_manifest(tmp_path: Path) -> None:
    run_dir = tmp_path / "external_workflow"

    result = asyncio.run(
        CapsuleRunner(registry=CapsuleRegistry()).run(
            "external-workflow-capsule.example",
            {"workflow_input": "unit external"},
            run_dir,
        )
    )

    assert result["status"] == "success"
    manifest = load_json(run_dir / "artifacts" / "external_workflow_manifest.json")
    assert manifest["capsule_id"] == "external-workflow-capsule.example"
    assert manifest["workflow_type"] == "custom"


def test_acc_workflow_capsule_creates_isolated_nested_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "acc_subworkflow"

    result = asyncio.run(
        CapsuleRunner(registry=CapsuleRegistry()).run(
            "acc-subworkflow-capsule.example",
            {"message": "nested from unit test"},
            run_dir,
        )
    )

    assert result["status"] == "success"
    output = load_json(run_dir / "output.json")
    assert output["child_workflow_status"] == "success"
    nested_run_dir = run_dir / "artifacts" / "nested_workflow"
    assert (nested_run_dir / "workflow_summary.json").exists()
    assert (nested_run_dir / "node_runs" / "child_echo" / "output.json").exists()
    manifest = load_json(run_dir / "session_manifest.json")
    assert manifest["template_snapshot_dir"]
    assert manifest["lifecycle_log_dir"]


def test_split_lifecycle_command_preserves_quoted_paths() -> None:
    assert split_lifecycle_command('python "scripts/my script.py" run') == [
        sys.executable,
        "scripts/my script.py",
        "run",
    ]


def test_split_lifecycle_command_rejects_shell_syntax() -> None:
    try:
        split_lifecycle_command("python scripts/fake_agent_workflow.py run && whoami")
    except AccError as exc:
        assert "unsupported shell syntax" in str(exc)
    else:
        raise AssertionError("Expected lifecycle shell syntax to be rejected")
