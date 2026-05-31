from __future__ import annotations

from pathlib import Path

from acc.app.interactions import create_interaction, get_interaction, list_interactions


def test_interactions_api_lifecycle(client, project_root, tmp_path) -> None:
    run_dir = project_root / "runs" / "interaction_run"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_summary.json").write_text(
        '{"run_id":"interaction_run","status":"running"}', encoding="utf-8"
    )

    create = client.post(
        "/api/runs/interaction_run/interactions",
        json={
            "kind": "approval",
            "prompt": "Approve deployment?",
            "node_id": "gate1",
            "options": ["approve", "reject"],
        },
    )
    assert create.status_code == 200, create.text
    interaction_id = create.json()["interaction_id"]

    listing = client.get("/api/runs/interaction_run/interactions")
    assert listing.status_code == 200
    assert len(listing.json()["interactions"]) == 1

    detail = client.get(f"/api/runs/interaction_run/interactions/{interaction_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "pending"

    answer = client.post(
        f"/api/runs/interaction_run/interactions/{interaction_id}/answer",
        json={"answer": {"decision": "approve"}},
    )
    assert answer.status_code == 200
    assert answer.json()["status"] == "answered"

    repeat = client.post(
        f"/api/runs/interaction_run/interactions/{interaction_id}/answer",
        json={"answer": {"decision": "approve"}},
    )
    assert repeat.status_code == 200
    assert repeat.json()["status"] == "answered"


def test_interactions_api_404_for_missing_run(client) -> None:
    response = client.get("/api/runs/missing_run/interactions")
    assert response.status_code == 404


def test_interaction_kinds_fixture(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    for kind in ("approval", "ask", "confirm", "suggest"):
        item = create_interaction(run_dir, run_id="run", kind=kind, prompt=f"{kind}?")
        loaded = get_interaction(run_dir, item.interaction_id)
        assert loaded.kind == kind
    assert len(list_interactions(run_dir)) == 4
