from __future__ import annotations

from acc.graphops import dry_run_supervisor_proposal


def test_dry_run_supervisor_proposal() -> None:
    result = dry_run_supervisor_proposal(
        {
            "proposal_id": "prop1",
            "plan": {
                "plan_id": "plan1",
                "supervisor_node_id": "sup",
                "created_at": "2026-05-29T00:00:00Z",
                "status": "proposed",
                "intents": [
                    {
                        "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                        "input_payload": {},
                        "rationale": "add worker",
                        "correlation_id": "c1",
                        "node_id_suggestion": "worker_1",
                    }
                ],
            },
        },
        target_path="workflows/demo.accflow.json",
    )
    assert result["status"] == "dry_run"
    assert result["operations"]
