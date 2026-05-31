from __future__ import annotations

from fastapi import APIRouter

from acc import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/version")
def version() -> dict[str, str]:
    return {"version": __version__}
