from __future__ import annotations

import asyncio
import json
from pathlib import Path

from acc.app.core_v2_runtime import run_core_v2_workflow_path
from acc.domain import CORE_V2_SCHEMA_VERSION


def test_core_v2_explicit_bindings_and_workflow_outputs(tmp_path: Path) -> None:
    workflow_path = tmp_path / "bindings.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "bindings",
                "version": "0.1.0",
                "exposed_inputs": {"topic": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"report": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"topic": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "merge",
                        "callable_ref": {"kind": "tool_class", "id": "merge"},
                        "input_bindings": [
                            {
                                "source": {"node": "produce", "port": "main"},
                                "target_port": "main",
                            }
                        ],
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [{"from": "produce", "to": "merge"}],
                "workflow_input_bindings": [
                    {
                        "source_port": "topic",
                        "target": {"node": "produce", "port": "topic"},
                    }
                ],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "merge", "port": "main"},
                        "target_port": "report",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(
        run_core_v2_workflow_path(
            workflow_path,
            tmp_path / "run",
            input_payload={"topic": {"value": "chips"}},
        )
    )
    workflow_output = json.loads(
        (tmp_path / "run" / "workflow_outputs" / "report" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert workflow_output["merged"]["main"]["input"]["topic"] == {"value": "chips"}
    assert (
        tmp_path
        / "run"
        / "result_store"
        / "__workflow_outputs"
        / "report.json"
    ).exists()
