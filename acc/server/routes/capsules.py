from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from acc.capsule_authoring import doctor_capsule
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.runner import CapsuleRunner
from acc.scaffold import scaffold_capsule
from acc.server.context import (
    configured_project_dir,
    get_project_root,
    relative_project_path,
    resolve_inside_project,
)
from acc.utils import AccError

router = APIRouter(prefix="/capsules", tags=["capsules"])


class CapsuleTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    input_payload: dict[str, Any] | None = Field(default=None, alias="input")
    input_path: str | None = None
    run_dir: str


class CapsuleScaffoldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blueprint: dict[str, Any] | None = None
    blueprint_path: str | None = None
    id: str | None = None
    runtime: str = "generic_cli"
    template: str = "simple"
    force: bool = False


class CapsuleFileWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str


ALLOWED_CAPSULE_FILES = {
    "capsule.yaml",
    "prompt_template.md",
    "input_schema.json",
    "output_schema.json",
    "artifact_manifest.yaml",
    "examples/input.json",
}


@router.get("")
def list_capsules(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    registry = CapsuleRegistry(capsules_dir(project_root))
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
    prompt_template = None if capsule.spec.prompt is None else capsule.spec.prompt.template
    behavior_pack = (
        None if capsule.spec.behavior_pack is None else capsule.spec.behavior_pack.model_dump()
    )
    workflow = None if capsule.spec.workflow is None else capsule.spec.workflow.model_dump()
    lifecycle = None if capsule.spec.lifecycle is None else capsule.spec.lifecycle.model_dump()
    payload.update(
        {
            "capsule_dir": relative_project_path(get_project_root(request), capsule.capsule_dir),
            "yaml_path": relative_project_path(get_project_root(request), capsule.yaml_path),
            "prompt_template": prompt_template,
            "input_schema": capsule.spec.schemas.input,
            "output_schema": capsule.spec.schemas.output,
            "artifact_manifest": capsule.spec.artifacts.manifest,
            "permissions": capsule.spec.permissions.model_dump(),
            "behavior_pack": behavior_pack,
            "workflow": workflow,
            "lifecycle": lifecycle,
        }
    )
    return payload


@router.post("/scaffold")
def scaffold_capsule_endpoint(
    payload: CapsuleScaffoldRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    target_capsules_dir = capsules_dir(project_root)
    blueprint_path: Path | None = None
    blueprint_payload = payload.blueprint if payload.blueprint is not None else None
    if payload.blueprint_path is not None:
        if blueprint_payload is not None:
            raise HTTPException(
                status_code=400,
                detail="Provide blueprint or blueprint_path, not both",
            )
        blueprint_path = resolve_inside_project(project_root, payload.blueprint_path)
    try:
        return scaffold_capsule(
            blueprint_path=blueprint_path,
            blueprint_payload=blueprint_payload,
            capsule_id=payload.id,
            runtime=payload.runtime,
            template=payload.template,
            capsules_dir=target_capsules_dir,
            force=payload.force,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{capsule_id}/validate")
def validate_capsule(capsule_id: str, request: Request) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    errors = validate_capsule_files(capsule)
    registry = CapsuleRegistry(capsules_dir(get_project_root(request)))
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
    registry = CapsuleRegistry(capsules_dir(project_root))
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


@router.delete("/{capsule_id}")
def delete_capsule(
    capsule_id: str,
    request: Request,
    force: bool = Query(False),
) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    project_root = get_project_root(request)
    references = find_capsule_references(project_root, capsule_id)
    if references and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Capsule is referenced by workflow files",
                "capsule_id": capsule_id,
                "references": references,
            },
        )
    root = capsules_dir(project_root).resolve()
    target = capsule.capsule_dir.resolve()
    if not target.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Capsule directory is outside capsules root")
    shutil.rmtree(target)
    return {
        "status": "deleted",
        "capsule_id": capsule_id,
        "capsule_dir": relative_project_path(project_root, target),
        "references": references,
    }


@router.get("/{capsule_id}/files/{file_path:path}")
def read_capsule_file(capsule_id: str, file_path: str, request: Request) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    target = allowed_capsule_file(capsule.capsule_dir, file_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Capsule file not found")
    return {
        "capsule_id": capsule_id,
        "file": file_path,
        "path": relative_project_path(get_project_root(request), target),
        "content": target.read_text(encoding="utf-8"),
    }


@router.put("/{capsule_id}/files/{file_path:path}")
def write_capsule_file(
    capsule_id: str,
    file_path: str,
    payload: CapsuleFileWriteRequest,
    request: Request,
) -> dict[str, Any]:
    capsule = load_capsule_or_404(capsule_id, request)
    target = allowed_capsule_file(capsule.capsule_dir, file_path)
    validate_edit_content(file_path, payload.content)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_suffix(target.suffix + ".tmp")
    temp_path.write_text(payload.content, encoding="utf-8")
    temp_path.replace(target)
    registry = CapsuleRegistry(capsules_dir(get_project_root(request)))
    doctor = doctor_capsule(capsule_id, registry)
    return {
        "status": "saved",
        "capsule_id": capsule_id,
        "file": file_path,
        "path": relative_project_path(get_project_root(request), target),
        "doctor": doctor,
    }


def load_capsule_or_404(capsule_id: str, request: Request):
    try:
        project_root = get_project_root(request)
        return CapsuleRegistry(capsules_dir(project_root)).get(capsule_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def capsules_dir(project_root: Path) -> Path:
    return configured_project_dir(project_root, "ACC_CAPSULES_DIR", "capsules")


def workflows_dir(project_root: Path) -> Path:
    return configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")


def find_capsule_references(project_root: Path, capsule_id: str) -> list[dict[str, Any]]:
    root = workflows_dir(project_root)
    if not root.exists():
        return []

    references: list[dict[str, Any]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        rel_path = relative_project_path(project_root, path)
        if path.suffix == ".json":
            references.extend(find_json_workflow_references(path, rel_path, capsule_id))
        elif path.suffix in {".yaml", ".yml"}:
            references.extend(find_yaml_workflow_references(path, rel_path, capsule_id))
    return references


def find_json_workflow_references(
    path: Path,
    rel_path: str,
    capsule_id: str,
) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict):
        return []

    references: list[dict[str, Any]] = []
    for node in payload.get("nodes", []):
        if isinstance(node, dict) and node.get("capsule_id") == capsule_id:
            references.append(
                {
                    "path": rel_path,
                    "kind": "workflow_graph",
                    "node_id": node.get("id"),
                }
            )
    return references


def find_yaml_workflow_references(
    path: Path,
    rel_path: str,
    capsule_id: str,
) -> list[dict[str, Any]]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return []
    if not isinstance(payload, dict):
        return []

    references: list[dict[str, Any]] = []
    for task in payload.get("tasks", []):
        if not isinstance(task, dict):
            continue
        if task.get("capsule_id") == capsule_id or command_mentions_capsule(
            task.get("command"),
            capsule_id,
        ):
            references.append(
                {
                    "path": rel_path,
                    "kind": "workflow_yaml",
                    "task": task.get("name"),
                }
            )
    return references


def command_mentions_capsule(command: Any, capsule_id: str) -> bool:
    if isinstance(command, str):
        return command == capsule_id
    if isinstance(command, list):
        return capsule_id in [str(item) for item in command]
    return False


def allowed_capsule_file(capsule_dir: Path, file_path: str) -> Path:
    normalized = file_path.replace("\\", "/")
    if normalized not in ALLOWED_CAPSULE_FILES:
        raise HTTPException(status_code=400, detail=f"Capsule file is not editable: {file_path}")
    target = (capsule_dir / normalized).resolve()
    if not target.is_relative_to(capsule_dir.resolve()):
        raise HTTPException(status_code=400, detail="Path is outside capsule directory")
    return target


def validate_edit_content(file_path: str, content: str) -> None:
    try:
        if file_path.endswith(".json"):
            json.loads(content)
        elif file_path.endswith(".yaml"):
            yaml.safe_load(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{file_path} is invalid JSON: {exc}") from exc
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"{file_path} is invalid YAML: {exc}") from exc
