from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from acc.schemas import CapsuleSpec
from acc.utils import AccError


@dataclass(frozen=True)
class CapsuleDefinition:
    spec: CapsuleSpec
    capsule_dir: Path
    yaml_path: Path
    raw: dict[str, Any]

    @property
    def prompt_template_path(self) -> Path:
        return self.capsule_dir / self.spec.prompt.template

    @property
    def input_schema_path(self) -> Path:
        return self.capsule_dir / self.spec.schemas.input

    @property
    def output_schema_path(self) -> Path:
        return self.capsule_dir / self.spec.schemas.output

    @property
    def artifact_manifest_path(self) -> Path:
        return self.capsule_dir / self.spec.artifacts.manifest

    def to_metadata(self) -> dict[str, Any]:
        return {
            "id": self.spec.id,
            "version": self.spec.version,
            "name": self.spec.name,
            "description": self.spec.description,
            "runtime": self.spec.runtime.type,
            "workspace": self.spec.workspace.mode,
        }


class CapsuleRegistry:
    def __init__(self, capsules_dir: Path | str = "capsules") -> None:
        self.capsules_dir = Path(capsules_dir)

    def discover(self) -> list[CapsuleDefinition]:
        if not self.capsules_dir.exists():
            return []

        capsules: list[CapsuleDefinition] = []
        seen: dict[str, Path] = {}
        for yaml_path in sorted(self.capsules_dir.glob("*/capsule.yaml")):
            capsule = self.load_path(yaml_path)
            existing = seen.get(capsule.spec.id)
            if existing is not None:
                raise AccError(
                    f"Duplicate capsule id {capsule.spec.id!r}: {existing} and {yaml_path}"
                )
            seen[capsule.spec.id] = yaml_path
            capsules.append(capsule)
        return capsules

    def get(self, capsule_id: str) -> CapsuleDefinition:
        for capsule in self.discover():
            if capsule.spec.id == capsule_id:
                return capsule
        raise AccError(f"Capsule not found: {capsule_id}")

    def load_path(self, yaml_path: Path) -> CapsuleDefinition:
        try:
            raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            raise AccError(f"Invalid YAML in {yaml_path}: {exc}") from exc
        except FileNotFoundError as exc:
            raise AccError(f"Capsule file not found: {yaml_path}") from exc

        if not isinstance(raw, dict):
            raise AccError(f"Capsule YAML must be an object: {yaml_path}")

        try:
            spec = CapsuleSpec.model_validate(raw)
        except ValidationError as exc:
            raise AccError(f"Invalid capsule spec in {yaml_path}: {exc}") from exc

        return CapsuleDefinition(
            spec=spec,
            capsule_dir=yaml_path.parent,
            yaml_path=yaml_path,
            raw=raw,
        )


def validate_capsule_files(capsule: CapsuleDefinition) -> list[str]:
    errors: list[str] = []
    required_paths = [
        ("prompt template", capsule.prompt_template_path),
        ("input schema", capsule.input_schema_path),
        ("output schema", capsule.output_schema_path),
        ("artifact manifest", capsule.artifact_manifest_path),
    ]
    for label, path in required_paths:
        if not path.exists():
            errors.append(f"Missing {label}: {path}")
    return errors
