from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from acc.run_index import NodeRunSummary, load_or_rebuild_run_index, load_run_summary_by_id
from acc.server.context import (
    get_project_root,
    is_relative_to,
    reject_secret_like_path,
    relative_project_path,
)
from acc.utils import AccError

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("")
def list_runs(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    index = load_or_rebuild_run_index(project_root / "runs")
    return index.model_dump()


@router.get("/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    return load_run_or_404(run_id, request).model_dump()


@router.get("/{run_id}/nodes/{node_id}")
def get_node(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    node = find_node_or_404(run_id, node_id, request)
    payload = node.model_dump()
    payload["artifacts_url"] = f"/api/runs/{run_id}/nodes/{node_id}/artifacts"
    return payload


@router.get("/{run_id}/nodes/{node_id}/artifacts")
def list_node_artifacts(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    node = find_node_or_404(run_id, node_id, request)
    if not node.artifact_dir:
        return {"run_id": run_id, "node_id": node_id, "artifacts": []}
    artifact_dir = Path(node.artifact_dir).resolve()
    if not is_relative_to(artifact_dir, project_root):
        raise HTTPException(status_code=400, detail="Artifact directory is outside project root")
    if not artifact_dir.exists() or not artifact_dir.is_dir():
        return {"run_id": run_id, "node_id": node_id, "artifacts": []}
    artifacts = []
    for path in sorted(item for item in artifact_dir.rglob("*") if item.is_file()):
        try:
            reject_secret_like_path(path)
        except HTTPException:
            continue
        rel_path = relative_project_path(project_root, path)
        artifacts.append(
            {
                "name": path.name,
                "path": rel_path,
                "read_url": f"/api/artifacts/read?path={rel_path}",
                "size_bytes": path.stat().st_size,
            }
        )
    return {"run_id": run_id, "node_id": node_id, "artifacts": artifacts}


def load_run_or_404(run_id: str, request: Request):
    try:
        return load_run_summary_by_id(run_id, get_project_root(request) / "runs")
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def find_node_or_404(run_id: str, node_id: str, request: Request) -> NodeRunSummary:
    summary = load_run_or_404(run_id, request)
    for node in summary.nodes:
        if node.node_id == node_id:
            return node
    raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

