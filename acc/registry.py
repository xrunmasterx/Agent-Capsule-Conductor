from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from acc.schemas import CapsuleSpec
from acc.utils import AccError, split_lifecycle_command


@dataclass(frozen=True)
class CapsuleDefinition:
    spec: CapsuleSpec
    capsule_dir: Path
    yaml_path: Path
    raw: dict[str, Any]

    @property
    def prompt_template_path(self) -> Path | None:
        if self.spec.prompt is None:
            return None
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
            "kind": self.spec.kind or "agent_session",
            "runtime": self.spec.runtime.type,
            "workspace": self.spec.workspace.mode,
        }


class CapsuleRegistry:
    def __init__(self, capsules_dir: Path | str | None = None) -> None:
        registry_dir = capsules_dir or os.environ.get("ACC_CAPSULES_DIR", "capsules")
        self.capsules_dir = Path(registry_dir)
        self._capsules_cache: list[CapsuleDefinition] | None = None
        self._capsule_by_id: dict[str, CapsuleDefinition] | None = None

    def discover(self) -> list[CapsuleDefinition]:
        if self._capsules_cache is not None:
            return list(self._capsules_cache)
        if not self.capsules_dir.exists():
            return []

        capsules: list[CapsuleDefinition] = []
        seen_paths: dict[str, Path] = {}
        by_id: dict[str, CapsuleDefinition] = {}
        for yaml_path in sorted(self.capsules_dir.glob("*/capsule.yaml")):
            capsule = self.load_path(yaml_path)
            existing = seen_paths.get(capsule.spec.id)
            if existing is not None:
                raise AccError(
                    f"Duplicate capsule id {capsule.spec.id!r}: {existing} and {yaml_path}"
                )
            seen_paths[capsule.spec.id] = yaml_path
            by_id[capsule.spec.id] = capsule
            capsules.append(capsule)
        self._capsules_cache = capsules
        self._capsule_by_id = by_id
        return capsules

    def get(self, capsule_id: str) -> CapsuleDefinition:
        self.discover()
        if self._capsule_by_id is not None and capsule_id in self._capsule_by_id:
            return self._capsule_by_id[capsule_id]
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
        ("input schema", capsule.input_schema_path),
        ("output schema", capsule.output_schema_path),
        ("artifact manifest", capsule.artifact_manifest_path),
    ]
    if capsule.prompt_template_path is not None:
        required_paths.insert(0, ("prompt template", capsule.prompt_template_path))
    elif capsule.spec.kind not in {"agent_workflow", "acc_workflow", "external_workflow"}:
        errors.append("Missing prompt template config")
    for label, path in required_paths:
        if not path.exists():
            errors.append(f"Missing {label}: {path}")
    if capsule.spec.kind == "agent_workflow":
        errors.extend(validate_behavior_pack(capsule))
    if capsule.spec.kind in {"acc_workflow", "external_workflow"}:
        errors.extend(validate_workflow_reference(capsule))
    if capsule.spec.kind in {"agent_workflow", "acc_workflow", "external_workflow"}:
        errors.extend(validate_lifecycle_commands(capsule))
    return errors


def validate_behavior_pack(capsule: CapsuleDefinition) -> list[str]:
    if capsule.spec.behavior_pack is None:
        return ["agent_workflow capsule requires behavior_pack"]
    errors: list[str] = []
    root = capsule.capsule_dir / capsule.spec.behavior_pack.root
    if not root.exists():
        errors.append(f"Missing behavior pack root: {root}")
        return errors
    for item in capsule.spec.behavior_pack.files:
        if not (root / item).exists():
            errors.append(f"Missing behavior pack file: {root / item}")
    return errors


def validate_workflow_reference(capsule: CapsuleDefinition) -> list[str]:
    if capsule.spec.workflow is None:
        return ["Missing workflow config"]
    workflow_path = capsule.capsule_dir / capsule.spec.workflow.path
    if not workflow_path.exists():
        return [f"Missing workflow file: {workflow_path}"]
    if capsule.spec.kind == "acc_workflow" and capsule.spec.workflow.type != "acc_graph":
        return ["acc_workflow capsule requires workflow.type=acc_graph"]
    return []


def validate_lifecycle_commands(capsule: CapsuleDefinition) -> list[str]:
    if capsule.spec.lifecycle is None:
        return []

    errors: list[str] = []
    lifecycle = capsule.spec.lifecycle
    for stage_name in ("setup", "run", "collect", "cleanup"):
        for command in getattr(lifecycle, stage_name):
            try:
                split_lifecycle_command(command)
            except AccError as exc:
                errors.append(f"Invalid lifecycle {stage_name} command: {exc}")
    return errors
