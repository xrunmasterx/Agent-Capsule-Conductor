from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.app.workflow_refs import WorkflowCatalog, rewrite_workflow_function_refs
from acc.utils import AccError


def write_workflow(path: Path, workflow_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": workflow_id,
                "version": "0.1.0",
                "nodes": [],
                "control_edges": [],
                "data_edges": [],
            }
        ),
        encoding="utf-8",
    )


def test_workflow_catalog_resolves_common_ref_shapes(tmp_path: Path) -> None:
    child = tmp_path / "workflows" / "child.accflow.json"
    write_workflow(child, "child_logic")
    catalog = WorkflowCatalog(project_root=tmp_path, workflows_dir=child.parent)
    template = tmp_path / "workflows" / "parent.accflow.json"

    refs = [
        "child.accflow.json",
        "workflows/child.accflow.json",
        str(child.resolve()),
        "child_logic",
    ]

    resolved = [
        catalog.resolve(ref, template_source_path=template, mode="persistent") for ref in refs
    ]

    assert {item.resolved_path for item in resolved} == {child.resolve()}
    assert {item.canonical_ref for item in resolved} == {"child.accflow.json"}


def test_workflow_catalog_rejects_ambiguous_bare_workflow_id(tmp_path: Path) -> None:
    workflows_dir = tmp_path / "workflows"
    write_workflow(workflows_dir / "a.accflow.json", "same_id")
    write_workflow(workflows_dir / "b.accflow.json", "same_id")
    catalog = WorkflowCatalog(project_root=tmp_path, workflows_dir=workflows_dir)

    with pytest.raises(AccError, match="ambiguous_workflow_function_ref"):
        catalog.resolve(
            "same_id",
            template_source_path=workflows_dir / "parent.accflow.json",
            mode="persistent",
        )


def test_workflow_catalog_rejects_missing_workflow_ref(tmp_path: Path) -> None:
    catalog = WorkflowCatalog(project_root=tmp_path, workflows_dir=tmp_path / "workflows")

    with pytest.raises(AccError, match="missing_workflow_function_ref"):
        catalog.resolve(
            "missing.accflow.json",
            template_source_path=tmp_path / "workflows" / "parent.accflow.json",
            mode="persistent",
        )


def test_workflow_ref_rewrite_does_not_depend_on_process_cwd(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_root = tmp_path / "project"
    child = project_root / "workflows" / "child.accflow.json"
    write_workflow(child, "child_logic")
    monkeypatch.chdir(tmp_path)
    catalog = WorkflowCatalog(project_root=project_root, workflows_dir=child.parent)
    payload = {
        "schema_version": "acc.core.v2",
        "id": "parent",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "child_call",
                "callable_ref": {
                    "kind": "workflow_function",
                    "id": "workflows/child.accflow.json",
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    rewritten, resolutions = rewrite_workflow_function_refs(
        payload,
        catalog=catalog,
        template_source_path=project_root / "workflows" / "parent.accflow.json",
        mode="persistent",
    )

    assert rewritten["nodes"][0]["callable_ref"]["id"] == "child.accflow.json"
    assert resolutions[0]["resolved_path"] == str(child.resolve())
