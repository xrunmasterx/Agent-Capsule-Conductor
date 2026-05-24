from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request

from acc.server.context import get_project_root, relative_project_path

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("")
def list_workflows(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = project_root / "workflows"
    if not workflows_dir.exists():
        return {"workflows": []}
    workflows = []
    for path in sorted(workflows_dir.glob("*.yaml")):
        payload = load_yaml(path)
        workflow_id = str(payload.get("name") or path.stem)
        workflows.append(
            {
                "workflow_id": workflow_id,
                "file_id": path.stem,
                "name": payload.get("name"),
                "description": payload.get("description"),
                "version": payload.get("version"),
                "path": relative_project_path(project_root, path),
                "task_count": len(payload.get("tasks", []))
                if isinstance(payload.get("tasks"), list)
                else 0,
            }
        )
    return {"workflows": workflows}


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = project_root / "workflows"
    if not workflows_dir.exists():
        raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
    for path in sorted(workflows_dir.glob("*.yaml")):
        payload = load_yaml(path)
        candidate_ids = {path.stem, str(payload.get("name") or "")}
        if workflow_id in candidate_ids:
            return {
                "workflow_id": str(payload.get("name") or path.stem),
                "file_id": path.stem,
                "path": relative_project_path(project_root, path),
                "workflow": payload,
            }
    raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid workflow YAML: {path}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail=f"Workflow YAML must be an object: {path}")
    return payload
