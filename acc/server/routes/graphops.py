from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.graphops import GraphOpsService
from acc.server.context import get_project_root
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
