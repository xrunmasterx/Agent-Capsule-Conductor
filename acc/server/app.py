from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from acc.server.routes import (
    artifacts,
    authoring,
    callables,
    debugger,
    decisions,
    graphops,
    health,
    interactions,
    runs,
    workbench,
    workflows,
)


def create_app(project_root: Path | str | None = None) -> FastAPI:
    app = FastAPI(title="Agent Callable Workbench Server", version="0.1.0")
    app.state.project_root = Path(project_root or Path.cwd()).resolve()
    app.include_router(health.router, prefix="/api")
    app.include_router(authoring.router, prefix="/api")
    app.include_router(callables.router, prefix="/api")
    app.include_router(runs.router, prefix="/api")
    app.include_router(interactions.router, prefix="/api")
    app.include_router(artifacts.router, prefix="/api")
    app.include_router(workbench.router, prefix="/api")
    app.include_router(workflows.router, prefix="/api")
    app.include_router(debugger.router, prefix="/api")
    app.include_router(graphops.router, prefix="/api")
    app.include_router(decisions.router, prefix="/api")
    return app


app = create_app()
