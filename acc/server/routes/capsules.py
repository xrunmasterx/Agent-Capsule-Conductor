from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from acc.capsule_authoring import doctor_capsule
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.runner import CapsuleRunner
from acc.server.context import get_project_root, relative_project_path, resolve_inside_project
from acc.utils import AccError

router = APIRouter(prefix="/capsules", tags=["capsules"])


class CapsuleTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    input_payload: dict[str, Any] | None = Field(default=None, alias="input")
    input_path: str | None = None
    run_dir: str


@router.get("")
def list_capsules(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    registry = CapsuleRegistry(project_root / "capsules")
    capsules = []
    for capsule in registry.discover():
        metadata = capsule.to_metadata()
        metadata["capsule_dir"] = relative_project_path(project_root, capsule.capsule_dir)
        capsules.append(metadata)
    return {"capsules": capsules}


@router.get("/{capsule_id}")
def get_capsule(capsule_id: str, request: Request) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    payload = capsule.to_metadata()
    payload.update(
        {
            "capsule_dir": relative_project_path(get_project_root(request), capsule.capsule_dir),
            "yaml_path": relative_project_path(get_project_root(request), capsule.yaml_path),
            "prompt_template": capsule.spec.prompt.template,
            "input_schema": capsule.spec.schemas.input,
            "output_schema": capsule.spec.schemas.output,
            "artifact_manifest": capsule.spec.artifacts.manifest,
            "permissions": capsule.spec.permissions.model_dump(),
        }
    )
    return payload


@router.post("/{capsule_id}/validate")
def validate_capsule(capsule_id: str, request: Request) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    errors = validate_capsule_files(capsule)
    registry = CapsuleRegistry(get_project_root(request) / "capsules")
    return {
        "capsule_id": capsule.spec.id,
        "status": "valid" if not errors else "invalid",
        "errors": errors,
        "doctor": doctor_capsule(capsule_id, registry),
    }


@router.post("/{capsule_id}/test")
def test_capsule(
    capsule_id: str,
    payload: CapsuleTestRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    registry = CapsuleRegistry(project_root / "capsules")
    try:
        capsule = registry.get(capsule_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    input_payload = payload.input_payload
    if payload.input_path is not None:
        input_path = resolve_inside_project(project_root, payload.input_path)
        if not input_path.exists() or not input_path.is_file():
            raise HTTPException(status_code=404, detail="Input file not found")
        try:
            import json

            loaded = json.loads(input_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid input JSON: {exc}") from exc
        if not isinstance(loaded, dict):
            raise HTTPException(status_code=400, detail="Input must be a JSON object")
        input_payload = loaded
    if input_payload is None:
        raise HTTPException(status_code=400, detail="Provide input or input_path")

    run_dir = resolve_inside_project(project_root, payload.run_dir)
    try:
        return asyncio.run(
            CapsuleRunner(registry=registry).run(capsule.spec.id, input_payload, Path(run_dir))
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def load_capsule_or_404(capsule_id: str, request: Request):
    try:
        return CapsuleRegistry(get_project_root(request) / "capsules").get(capsule_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
