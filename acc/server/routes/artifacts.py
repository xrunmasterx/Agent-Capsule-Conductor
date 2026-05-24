from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from acc.server.context import get_project_root, read_safe_text_file

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("/read")
def read_artifact(path: str, request: Request) -> dict[str, Any]:
    return read_safe_text_file(get_project_root(request), path)

