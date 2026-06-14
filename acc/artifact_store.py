from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from acc.storage import append_text_locked, write_json_atomic, write_text_atomic
from acc.utils import AccError


class ArtifactStore:
    def __init__(self, run_dir: Path | str) -> None:
        self.run_dir = Path(run_dir).resolve()
        self.artifacts_dir = self.run_dir / "artifacts"
        self.template_snapshot_dir = self.run_dir / "template_snapshot"
        self.lifecycle_logs_dir = self.run_dir / "lifecycle_logs"
        self.input_path = self.run_dir / "input.json"
        self.prompt_path = self.run_dir / "resolved_prompt.md"
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
        write_text_atomic(self.stdout_log_path, "")
        write_text_atomic(self.stderr_log_path, "")
        write_text_atomic(self.events_log_path, "")

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
        write_text_atomic(self.prompt_path, rendered_prompt)

    def write_manifest(self, payload: dict[str, Any]) -> None:
        self.write_json(self.session_manifest_path, payload)
        self.write_json(self.run_manifest_path, payload)

    def write_workspace_manifest(self, payload: dict[str, Any]) -> None:
        self.write_json(self.workspace_manifest_path, payload)

    def write_conductor_output(self, payload: dict[str, Any]) -> None:
        self.write_json(self.conductor_output_path, payload)

    def append_event(self, payload: dict[str, Any]) -> None:
        append_text_locked(self.events_log_path, json.dumps(payload, sort_keys=True) + "\n")

    def append_stderr(self, message: str) -> None:
        append_text_locked(self.stderr_log_path, message.rstrip() + "\n")

    @staticmethod
    def write_json(path: Path, payload: Any) -> None:
        write_json_atomic(path, payload)

    @staticmethod
    def _copy_path(source: Path, target: Path) -> None:
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
