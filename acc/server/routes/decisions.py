from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from acc.app.decisions import decision_inbox_payload
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("")
def get_decisions(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    include_graphops: bool = True,
    include_events: bool = True,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    try:
        return decision_inbox_payload(
            project_root,
            limit=limit,
            include_graphops=include_graphops,
            include_events=include_events,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
