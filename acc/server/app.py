from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from acc.server.routes import (
    agent_sessions,
    artifacts,
    authoring,
    callables,
    debugger,
    decisions,
    graphops,
    health,
    interactions,
    runner,
    runs,
    workbench,
    workflows,
)
from acc.server.security import local_runner_security_middleware


def create_app(project_root: Path | str | None = None) -> FastAPI:
    app = FastAPI(title="Agent Callable Workbench Server", version="0.1.0")
    app.state.project_root = Path(project_root or Path.cwd()).resolve()
    app.middleware("http")(local_runner_security_middleware)
    app.include_router(health.router, prefix="/api")
    app.include_router(agent_sessions.router, prefix="/api")
    app.include_router(authoring.router, prefix="/api")
    app.include_router(callables.router, prefix="/api")
    app.include_router(runs.router, prefix="/api")
    app.include_router(interactions.router, prefix="/api")
    app.include_router(runner.router, prefix="/api")
    app.include_router(artifacts.router, prefix="/api")
    app.include_router(workbench.router, prefix="/api")
    app.include_router(workflows.router, prefix="/api")
    app.include_router(debugger.router, prefix="/api")
    app.include_router(graphops.router, prefix="/api")
    app.include_router(decisions.router, prefix="/api")
    return app


app = create_app()
