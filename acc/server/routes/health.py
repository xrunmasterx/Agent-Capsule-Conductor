from __future__ import annotations

from fastapi import APIRouter

from acc import __version__
from acc.runtime.policy import acc_run_mode, external_agent_execution_enabled

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/version")
def version() -> dict[str, str]:
    return {"version": __version__}


@router.get("/runtime/config")
def runtime_config() -> dict[str, object]:
    mode = acc_run_mode()
    external_enabled = external_agent_execution_enabled()
    return {
        "run_mode": mode,
        "external_agent_execution_enabled": external_enabled,
        "real_external_agents_enabled": mode == "production" and external_enabled,
    }
