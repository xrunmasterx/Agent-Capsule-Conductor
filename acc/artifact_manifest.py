from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from acc.utils import AccError

ArtifactDisplay = Literal["primary", "secondary", "optional", "hidden"]
ArtifactViewer = Literal["markdown", "json", "text", "log", "patch", "diff", "none"]


class ArtifactManifestEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    path: str
    type: str
    schema_path: str | None = Field(default=None, alias="schema")
    display: ArtifactDisplay = "secondary"
    viewer: ArtifactViewer = "text"
    description: str = ""

    @field_validator("path")
    @classmethod
    def reject_path_escape(cls, value: str) -> str:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"Artifact path escapes artifact directory: {value}")
        return value


class ArtifactManifestV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = "2.0"
    required: list[ArtifactManifestEntry] = Field(default_factory=list)
    optional: list[ArtifactManifestEntry] = Field(default_factory=list)


def load_artifact_manifest_v2(manifest_path: Path) -> ArtifactManifestV2:
    try:
        raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise AccError(f"Invalid artifact manifest {manifest_path}: {exc}") from exc
    except FileNotFoundError as exc:
        raise AccError(f"Artifact manifest not found: {manifest_path}") from exc

    if not isinstance(raw, dict):
        raise AccError(f"Artifact manifest must be an object: {manifest_path}")

    payload = {
        "version": str(raw.get("version") or "2.0"),
        "required": normalize_entries(raw.get("required", []), required=True),
        "optional": normalize_entries(raw.get("optional", []), required=False),
    }
    try:
        return ArtifactManifestV2.model_validate(payload)
    except ValidationError as exc:
        raise AccError(f"Invalid artifact manifest {manifest_path}: {exc}") from exc


def normalize_entries(value: Any, required: bool) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise AccError("Artifact manifest entries must be lists")

    entries: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, str):
            entries.append(default_entry(item, required))
            continue
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            entry = {**default_entry(item["path"], required), **item}
            entry.setdefault("name", item["path"])
            entry.setdefault("type", infer_type(item["path"]))
            entries.append(entry)
            continue
        raise AccError("Artifact manifest entry must be a string or object with path")
    return entries


def default_entry(path: str, required: bool) -> dict[str, Any]:
    return {
        "name": path,
        "path": path,
        "type": infer_type(path),
        "display": "primary" if required else "optional",
        "viewer": infer_viewer(path),
    }


def infer_type(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix == ".md":
        return "markdown"
    if suffix == ".json":
        return "json"
    if suffix in {".patch", ".diff"}:
        return "patch"
    if suffix in {".log", ".jsonl"}:
        return "log"
    return "text"


def infer_viewer(path: str) -> ArtifactViewer:
    inferred = infer_type(path)
    if inferred in {"markdown", "json", "patch", "log"}:
        return inferred  # type: ignore[return-value]
    return "text"
