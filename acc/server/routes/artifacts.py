from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from acc.control_plane import (
    ArtifactEncodingError,
    ArtifactNotFoundError,
    ArtifactTooLargeError,
    SecretLikePathError,
    read_artifact_payload,
)
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("/read")
def read_artifact(path: str, request: Request) -> dict[str, Any]:
    try:
        return read_artifact_payload(path, get_project_root(request))
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SecretLikePathError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ArtifactTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ArtifactEncodingError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
