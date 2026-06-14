from __future__ import annotations

import json
from pathlib import Path

from acc.app.runtime.workflow_io import node_summary_from_session_manifest


def test_node_summary_run_dir_points_to_node_dir(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run_1"
    node_dir = run_dir / "nodes" / "agent"
    node_dir.mkdir(parents=True)
    (node_dir / "session_instance_manifest.json").write_text(
        json.dumps(
            {
                "session_id": "session_1",
                "status": "success",
                "callable_ref": {"id": "agent.codex"},
            }
        ),
        encoding="utf-8",
    )
    (node_dir / "output.json").write_text(json.dumps({"summary": "ok"}), encoding="utf-8")

    summary = node_summary_from_session_manifest(run_dir, "agent")

    assert summary.run_dir == str(node_dir.resolve())
    assert summary.output_path == str((node_dir / "output.json").resolve())
