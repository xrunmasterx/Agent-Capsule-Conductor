from __future__ import annotations

import os
from pathlib import Path

from fastapi import Request
from starlette.responses import JSONResponse, Response

from acc.audit import write_audit_event
from acc.runner import LOCAL_TOKEN_HEADER, local_token_required, validate_local_token


async def local_runner_security_middleware(request: Request, call_next) -> Response:
    if not local_token_required():
        return await call_next(request)
    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins():
        project_root = Path(getattr(request.app.state, "project_root", Path.cwd()))
        write_audit_event(
            project_root,
            "permission.denied",
            {"reason": "origin_denied", "origin": origin, "path": request.url.path},
        )
        return JSONResponse(
            status_code=403,
            content={
                "detail": {
                    "code": "origin_denied",
                    "message": f"Origin is not allowed: {origin}",
                }
            },
        )
    if requires_local_auth(request):
        project_root = getattr(request.app.state, "project_root", Path.cwd())
        token = request.headers.get(LOCAL_TOKEN_HEADER) or bearer_token(
            request.headers.get("authorization")
        )
        if not validate_local_token(Path(project_root), token):
            write_audit_event(
                Path(project_root),
                "permission.denied",
                {"reason": "auth_missing", "path": request.url.path, "method": request.method},
            )
            return JSONResponse(
                status_code=401,
                content={
                    "detail": {
                        "code": "auth_missing",
                        "message": "Local runner token is required",
                    }
                },
            )
    return await call_next(request)


def allowed_origins() -> set[str]:
    defaults = {
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "tauri://localhost",
        "app://acc",
    }
    configured = {
        origin.strip()
        for origin in os.getenv("ACC_LOCAL_RUNNER_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    }
    return defaults | configured


def requires_local_auth(request: Request) -> bool:
    path = request.url.path
    method = request.method.upper()
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        return True
    if path.startswith("/api/artifacts/read"):
        return True
    if path.startswith("/api/runner/artifacts/"):
        return True
    if path.endswith("/stream"):
        return True
    return "/binding/select-directory" in path or "/binding/open-folder" in path


def bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    prefix = "Bearer "
    if value.startswith(prefix):
        return value[len(prefix) :]
    return None
