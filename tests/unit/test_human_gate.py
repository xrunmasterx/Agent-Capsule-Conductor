from __future__ import annotations

from pathlib import Path

import pytest

from acc.app.human_gate import idempotent_answer_payload, validate_approval_answer
from acc.app.interactions import answer_interaction, create_human_gate_interaction
from acc.models import AccError


def test_validate_approval_answer_accepts_only_declared_options(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    interaction = create_human_gate_interaction(
        run_dir,
        run_id="run",
        node_id="gate",
        prompt="approve?",
    )

    assert validate_approval_answer(interaction, {"decision": "approve"}) == "approve"
    assert validate_approval_answer(interaction, {"choice": "reject"}) == "reject"
    with pytest.raises(AccError, match="choose approve or reject"):
        validate_approval_answer(interaction, {"decision": "maybe"})


def test_idempotent_answer_rejects_different_duplicate_answer(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    interaction = create_human_gate_interaction(
        run_dir,
        run_id="run",
        node_id="gate",
        prompt="approve?",
    )
    answer_interaction(run_dir, interaction.interaction_id, {"decision": "approve"})

    same = idempotent_answer_payload(
        run_dir,
        interaction.interaction_id,
        {"decision": "approve"},
    )

    assert same is not None
    assert same["idempotent"] is True
    with pytest.raises(AccError, match="different answer"):
        idempotent_answer_payload(
            run_dir,
            interaction.interaction_id,
            {"decision": "reject"},
        )
