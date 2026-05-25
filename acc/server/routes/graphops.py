from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.graphops import dry_run_patch, semantic_diff_for_patch, validate_patch_file
from acc.server.context import get_project_root, relative_project_path, resolve_inside_project
from acc.utils import AccError

router = APIRouter(prefix="/graphops", tags=["graphops"])


class GraphOpsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patch_path: str
    semantic: bool = False


@router.get("/examples")
def list_graphops_examples(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    root = project_root / "examples" / "graphops"
    if not root.exists():
        return {"patches": []}
    patches = []
    for path in sorted(root.glob("*.json")):
        patches.append(
            {
                "id": path.stem,
                "path": relative_project_path(project_root, path),
                "name": path.name,
            }
        )
    return {"patches": patches}


@router.post("/validate")
def validate_graphops(payload: GraphOpsRequest, request: Request) -> dict[str, Any]:
    patch = load_patch(payload.patch_path, request)
    response: dict[str, Any] = {
        "status": "valid",
        "patch_id": patch["patch_id"],
        "target_type": patch["target_type"],
        "target_path": patch["target_path"],
        "operations": len(patch["operations"]),
        "apply_requires_human_approval": True,
    }
    if payload.semantic:
        response["semantic_diff"] = semantic_diff_for_patch(patch)
    return response


@router.post("/dry-run")
def dry_run_graphops(payload: GraphOpsRequest, request: Request) -> dict[str, Any]:
    patch = load_patch(payload.patch_path, request)
    return {
        **dry_run_patch(patch, semantic=payload.semantic),
        "apply_requires_human_approval": True,
    }


def load_patch(path_value: str, request: Request) -> dict[str, Any]:
    try:
        patch_path = resolve_inside_project(get_project_root(request), path_value)
        return validate_patch_file(Path(patch_path))
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
