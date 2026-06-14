from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.graphops import GraphOpsService
from acc.server.context import get_project_root, relative_project_path
from acc.store import load_json
from acc.utils import AccError

router = APIRouter(prefix="/graphops", tags=["graphops"])


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


class LegacyGraphOpsPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patch_path: str
    semantic: bool = True
    apply: bool = False
    human_approved: bool = False


@router.get("/examples")
def list_graphops_examples(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    examples_dir = project_root / "examples" / "graphops"
    patches = []
    if examples_dir.exists():
        for path in sorted(examples_dir.glob("*.patch.json")):
            patches.append({"path": relative_project_path(project_root, path), "name": path.name})
    return {"patches": patches}


@router.post("/validate")
def validate_legacy_graphops_patch(
    payload: LegacyGraphOpsPatchRequest,
    request: Request,
) -> dict[str, Any]:
    _load_legacy_patch(payload.patch_path, request)
    return {
        "status": "valid",
        "apply_requires_human_approval": True,
        "apply_status": "not_implemented",
        "dry_run_only": True,
        "semantic": payload.semantic,
    }


@router.post("/dry-run")
def dry_run_legacy_graphops_patch(
    payload: LegacyGraphOpsPatchRequest,
    request: Request,
) -> dict[str, Any]:
    _load_legacy_patch(payload.patch_path, request)
    return {
        "status": "dry_run",
        "mutated": False,
        "apply_status": "not_implemented",
        "semantic": payload.semantic,
    }


@router.post("/apply")
def apply_legacy_graphops_patch(
    payload: LegacyGraphOpsPatchRequest,
    request: Request,
) -> dict[str, Any]:
    _load_legacy_patch(payload.patch_path, request)
    raise HTTPException(status_code=400, detail="GraphOps apply is not implemented in Option A")


@router.post("/proposals")
def create_graphops_proposal(
    payload: GraphOpsProposalCreateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return _service(request).create_proposal(payload.proposal)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals")
def list_graphops_proposals(request: Request) -> dict[str, Any]:
    try:
        return _service(request).list_proposals()
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals/{proposal_id}")
def get_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return _service(request).get_proposal(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/validate")
def validate_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return _service(request).validate(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/dry-run")
def dry_run_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return _service(request).dry_run(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/approve")
def approve_graphops_proposal(
    proposal_id: str,
    payload: GraphOpsProposalApprovalRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return _service(request).approve(proposal_id, payload.model_dump())
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/apply")
def apply_graphops_proposal(proposal_id: str, request: Request) -> dict[str, Any]:
    try:
        return _service(request).apply(proposal_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/{proposal_id}/reject")
def reject_graphops_proposal(
    proposal_id: str,
    payload: GraphOpsProposalRejectRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return _service(request).reject(proposal_id, payload.reason)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _service(request: Request) -> GraphOpsService:
    return GraphOpsService(project_root=get_project_root(request))


def _load_legacy_patch(path_value: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    candidate = (project_root / path_value).resolve()
    examples_root = (project_root / "examples" / "graphops").resolve()
    if not candidate.is_relative_to(examples_root):
        raise HTTPException(status_code=400, detail="GraphOps patch path is outside examples")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"GraphOps patch not found: {path_value}")
    try:
        payload = load_json(candidate)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="GraphOps patch must be an object")
    return payload
