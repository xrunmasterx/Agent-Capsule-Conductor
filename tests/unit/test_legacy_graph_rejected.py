from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.app.core_v2_loader import load_workflow_function_template, reject_legacy_graph_path
from acc.utils import AccError


def test_core_v2_loader_rejects_graph_json_path(tmp_path: Path) -> None:
    path = tmp_path / "old.graph.json"
    path.write_text(json.dumps({"nodes": []}), encoding="utf-8")

    with pytest.raises(AccError, match="migrate graph"):
        load_workflow_function_template(path)


def test_legacy_graph_rejection_hint_names_migration_command(tmp_path: Path) -> None:
    path = tmp_path / "old.graph.json"

    with pytest.raises(AccError) as exc_info:
        reject_legacy_graph_path(path)

    message = str(exc_info.value)
    assert ".graph.json is not runnable" in message
    assert "acc migrate graph" in message

