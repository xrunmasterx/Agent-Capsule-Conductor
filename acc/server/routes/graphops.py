from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.app.graphops_v3 import GraphOpsProposalService
from acc.graphops import (
    apply_patch_request,
    dry_run_patch,
    graphops_governance_payload,
    semantic_diff_for_patch,
    validate_patch_file,
)
from acc.server.context import get_project_root, relative_project_path, resolve_inside_project
from acc.utils import AccError

router = APIRouter(prefix="/graphops", tags=["graphops"])


class GraphOpsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patch_path: str
    semantic: bool = False


class GraphOpsApplyRequest(GraphOpsRequest):
    apply: bool = False
    human_approved: bool = False


class GraphOpsProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal: dict[str, Any]


class GraphOpsProposalApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal_id: str
    target_paths: list[str]
    base_hashes: dict[str, str]
    dry_run_digest: str
    approver: str = "human"


class GraphOpsProposalRejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = None


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


@router.post("/proposals")
def create_graphops_proposal(
    payload: GraphOpsProposalCreateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).create_proposal(payload.proposal)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals")
def list_graphops_proposals(request: Request) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).list_proposals()
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals/{proposal_id}")
def get_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).get_proposal(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/validate")
def validate_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).validate(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/dry-run")
def dry_run_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).dry_run(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/approve")
def approve_graphops_proposal(
    proposal_id: str,
    payload: GraphOpsProposalApprovalRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).approve(proposal_id, payload.model_dump())
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/apply")
def apply_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).apply(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/reject")
def reject_graphops_proposal(
    proposal_id: str,
    payload: GraphOpsProposalRejectRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return graphops_v3_service(request).reject(proposal_id, payload.reason)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/validate")
def validate_graphops(payload: GraphOpsRequest, request: Request) -> dict[str, Any]:
    patch = load_patch(payload.patch_path, request)
    response: dict[str, Any] = {
        "status": "valid",
        "patch_id": patch["patch_id"],
        "target_type": patch["target_type"],
        "target_path": patch["target_path"],
        "operations": len(patch["operations"]),
        **graphops_governance_payload(),
    }
    if payload.semantic:
        response["semantic_diff"] = semantic_diff_for_patch(patch)
    return response


@router.post("/dry-run")
def dry_run_graphops(payload: GraphOpsRequest, request: Request) -> dict[str, Any]:
    patch = load_patch(payload.patch_path, request)
    return {
        **dry_run_patch(patch, semantic=payload.semantic),
    }


@router.post("/apply")
def apply_graphops(payload: GraphOpsApplyRequest, request: Request) -> dict[str, Any]:
    try:
        patch_path = resolve_inside_project(get_project_root(request), payload.patch_path)
        return apply_patch_request(
            Path(patch_path),
            dry_run=False,
            apply=payload.apply,
            human_approved=payload.human_approved,
            semantic=payload.semantic,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def load_patch(path_value: str, request: Request) -> dict[str, Any]:
    try:
        patch_path = resolve_inside_project(get_project_root(request), path_value)
        return validate_patch_file(Path(patch_path))
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def graphops_v3_service(request: Request) -> GraphOpsProposalService:
    return GraphOpsProposalService(project_root=get_project_root(request))
