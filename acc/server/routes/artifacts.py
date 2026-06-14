from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from acc.audit import write_audit_event
from acc.control_plane import (
    ArtifactEncodingError,
    ArtifactNotFoundError,
    ArtifactPolicyDeniedError,
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
        project_root = get_project_root(request)
        payload = read_artifact_payload(path, project_root)
        write_audit_event(
            project_root,
            "artifact.read",
            {
                "artifact_ref": path,
                "type": payload.get("type"),
                "size_bytes": payload.get("size_bytes"),
            },
        )
        return payload
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ArtifactPolicyDeniedError, SecretLikePathError) as exc:
        raise HTTPException(
            status_code=403,
            detail={"code": "artifact_policy_denied", "message": str(exc)},
        ) from exc
    except ArtifactTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ArtifactEncodingError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
