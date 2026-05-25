from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import yaml

from acc.registry import CapsuleDefinition
from acc.utils import AccError


class ArtifactStore:
    def __init__(self, run_dir: Path | str) -> None:
        self.run_dir = Path(run_dir).resolve()
        self.artifacts_dir = self.run_dir / "artifacts"
        self.template_snapshot_dir = self.run_dir / "template_snapshot"
        self.lifecycle_logs_dir = self.run_dir / "lifecycle_logs"
        self.input_path = self.run_dir / "input.json"
        self.prompt_path = self.run_dir / "resolved_prompt.md"
        self.capsule_snapshot_path = self.run_dir / "capsule.yaml.snapshot"
        self.session_manifest_path = self.run_dir / "session_manifest.json"
        self.run_manifest_path = self.run_dir / "run_manifest.json"
        self.stdout_log_path = self.run_dir / "stdout.log"
        self.stderr_log_path = self.run_dir / "stderr.log"
        self.events_log_path = self.run_dir / "events.jsonl"
        self.output_path = self.run_dir / "output.json"
        self.conductor_output_path = self.run_dir / "conductor_output.json"
        self.workspace_manifest_path = self.run_dir / "workspace_manifest.json"

    def prepare(self) -> None:
        if self.run_dir.exists():
            self._reset_existing_run_dir()
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.template_snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.lifecycle_logs_dir.mkdir(parents=True, exist_ok=True)
        self.stdout_log_path.write_text("", encoding="utf-8")
        self.stderr_log_path.write_text("", encoding="utf-8")
        self.events_log_path.write_text("", encoding="utf-8")

    def _reset_existing_run_dir(self) -> None:
        children = list(self.run_dir.iterdir())
        if not children:
            return
        if not (
            (self.run_dir / "session_manifest.json").exists()
            or (self.run_dir / "run_manifest.json").exists()
            or (self.run_dir / "conductor_output.json").exists()
        ):
            raise AccError(f"Refusing to reuse non-ACC run directory: {self.run_dir}")
        for child in children:
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

    def write_input(self, payload: dict[str, Any]) -> None:
        self.write_json(self.input_path, payload)

    def write_prompt(self, rendered_prompt: str) -> None:
        self.prompt_path.write_text(rendered_prompt, encoding="utf-8")

    def write_capsule_snapshot(self, capsule: CapsuleDefinition) -> None:
        self.capsule_snapshot_path.write_text(
            yaml.safe_dump(capsule.raw, sort_keys=False),
            encoding="utf-8",
        )

    def materialize_template_snapshot(self, capsule: CapsuleDefinition) -> None:
        self._copy_path(capsule.yaml_path, self.template_snapshot_dir / "capsule.yaml")
        self._copy_path(capsule.input_schema_path, self.template_snapshot_dir / "input_schema.json")
        self._copy_path(
            capsule.output_schema_path,
            self.template_snapshot_dir / "output_schema.json",
        )
        self._copy_path(
            capsule.artifact_manifest_path,
            self.template_snapshot_dir / "artifact_manifest.yaml",
        )
        if capsule.prompt_template_path is not None and capsule.prompt_template_path.exists():
            self._copy_path(
                capsule.prompt_template_path,
                self.template_snapshot_dir / capsule.prompt_template_path.name,
            )
        if capsule.spec.behavior_pack is not None:
            source_root = capsule.capsule_dir / capsule.spec.behavior_pack.root
            if source_root.exists():
                self._copy_path(source_root, self.template_snapshot_dir / "behavior_pack")
        if capsule.spec.workflow is not None:
            workflow_path = capsule.capsule_dir / capsule.spec.workflow.path
            if workflow_path.exists():
                self._copy_path(workflow_path, self.template_snapshot_dir / workflow_path.name)

        extra_assets = (
            "AGENTS.md",
            "CLAUDE.md",
            "GEMINI.md",
            "scripts",
            "hooks",
            "prompts",
            "skills",
            "config",
        )
        for name in extra_assets:
            source = capsule.capsule_dir / name
            if source.exists():
                self._copy_path(source, self.template_snapshot_dir / name)

    def write_manifest(self, payload: dict[str, Any]) -> None:
        self.write_json(self.session_manifest_path, payload)
        self.write_json(self.run_manifest_path, payload)

    def write_workspace_manifest(self, payload: dict[str, Any]) -> None:
        self.write_json(self.workspace_manifest_path, payload)

    def write_conductor_output(self, payload: dict[str, Any]) -> None:
        self.write_json(self.conductor_output_path, payload)

    def append_event(self, payload: dict[str, Any]) -> None:
        with self.events_log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(payload, sort_keys=True) + "\n")

    def append_stderr(self, message: str) -> None:
        with self.stderr_log_path.open("a", encoding="utf-8") as file:
            file.write(message.rstrip() + "\n")

    @staticmethod
    def write_json(path: Path, payload: Any) -> None:
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    @staticmethod
    def _copy_path(source: Path, target: Path) -> None:
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
