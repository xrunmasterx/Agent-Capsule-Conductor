from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.adapters.base import AgentAdapter, AgentRunRequest, AgentRunResult
from acc.adapters.claude_sdk import ClaudeSdkAdapter
from acc.adapters.codex_cli import CodexCliAdapter
from acc.adapters.generic_cli import GenericCliAdapter
from acc.artifact_store import ArtifactStore
from acc.prompting import render_prompt
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.run_index import (
    classify_error,
    update_project_run_index,
    write_node_summary,
    write_run_summary,
)
from acc.session import SessionManifest, new_session_id, utc_now_iso
from acc.utils import AccError, load_json
from acc.validation import validate_artifacts, validate_json_file, validate_payload
from acc.workspace import WorkspaceManager


class CapsuleRunner:
    def __init__(
        self,
        registry: CapsuleRegistry | None = None,
        workspace_manager: WorkspaceManager | None = None,
        adapters: dict[str, AgentAdapter] | None = None,
    ) -> None:
        self.registry = registry or CapsuleRegistry()
        self.workspace_manager = workspace_manager or WorkspaceManager()
        self.adapters = adapters or {
            "generic_cli": GenericCliAdapter(),
            "codex_cli": CodexCliAdapter(),
            "claude_sdk": ClaudeSdkAdapter(),
        }

    async def run(
        self,
        capsule_id: str,
        input_payload: dict[str, Any],
        run_dir: Path,
    ) -> dict[str, Any]:
        store = ArtifactStore(run_dir)
        store.prepare()
        session_id = new_session_id()
        manifest = self._base_manifest(store, session_id, capsule_id, "unknown")
        store.write_manifest(manifest)
        capsule = None
        try:
            capsule = self.registry.get(capsule_id)
            manifest = self._update_manifest(
                store,
                manifest,
                capsule_version=capsule.spec.version,
                status="created",
            )
            file_errors = validate_capsule_files(capsule)
            if file_errors:
                raise AccError("; ".join(file_errors))

            store.write_input(input_payload)
            store.write_capsule_snapshot(capsule)
            manifest = self._update_manifest(
                store,
                manifest,
                input_path=str(store.input_path.resolve()),
                status="created",
            )

            validate_payload(input_payload, capsule.input_schema_path)
            rendered_prompt = render_prompt(capsule.prompt_template_path, input_payload)
            store.write_prompt(rendered_prompt)
            manifest = self._update_manifest(
                store,
                manifest,
                prompt_path=str(store.prompt_path.resolve()),
                status="created",
            )

            workspace = self.workspace_manager.prepare(
                capsule.spec.workspace,
                input_payload,
                store.run_dir,
            )
            store.write_workspace_manifest(
                {
                    "mode": workspace.mode,
                    "path": str(workspace.path),
                    "command": workspace.command,
                }
            )
            manifest = self._update_manifest(
                store,
                manifest,
                workspace_dir=str(workspace.path.resolve()),
                status="running",
            )

            adapter = self.adapters[capsule.spec.runtime.type]
            result = await adapter.run(
                AgentRunRequest(
                    capsule_id=capsule_id,
                    run_dir=store.run_dir,
                    workspace_dir=workspace.path,
                    prompt_path=store.prompt_path,
                    input_payload=input_payload,
                    output_schema_path=capsule.output_schema_path,
                    timeout_seconds=capsule.spec.permissions.timeout_seconds,
                    command=capsule.spec.runtime.command,
                    args_base=capsule.spec.runtime.args_base,
                    env=capsule.spec.runtime.env,
                    sandbox=capsule.spec.permissions.sandbox,
                    allow_dangerous=capsule.spec.permissions.allow_dangerous,
                    session_id=session_id,
                )
            )
            conductor_output = self._finalize_result(
                store,
                session_id,
                capsule_id,
                capsule,
                result,
                manifest,
            )
            return conductor_output
        except AccError as exc:
            store.append_stderr(str(exc))
            status = classify_error("failed", str(exc))
            conductor_output = conductor_failure(store, status, str(exc), session_id)
            manifest = self._update_manifest(
                store,
                manifest,
                status=status,
                error=str(exc),
            )
            store.write_conductor_output(conductor_output)
            self._write_summaries(store, manifest, conductor_output, status, str(exc))
            return conductor_output
        except Exception as exc:  # noqa: BLE001 - preserve failure contract at CLI boundary.
            store.append_stderr(str(exc))
            status = classify_error("failed", str(exc))
            conductor_output = conductor_failure(store, status, str(exc), session_id)
            manifest = self._update_manifest(
                store,
                manifest,
                status=status,
                error=str(exc),
            )
            store.write_conductor_output(conductor_output)
            self._write_summaries(store, manifest, conductor_output, status, str(exc))
            return conductor_output

    def _finalize_result(
        self,
        store: ArtifactStore,
        session_id: str,
        capsule_id: str,
        capsule,
        result: AgentRunResult,
        manifest: dict[str, Any],
    ) -> dict[str, Any]:
        status = result.status
        error = result.error
        summary = result.summary
        output_path: Path | None = None
        error_class: str | None = None

        if result.status == "success" and result.output_json_path is not None:
            try:
                validate_json_file(result.output_json_path, capsule.output_schema_path)
                artifact_errors = validate_artifacts(
                    store.artifacts_dir,
                    capsule.artifact_manifest_path,
                )
                if artifact_errors:
                    status = "artifact_error"
                    error_class = "artifact_error"
                    error = "; ".join(artifact_errors)
                    summary = "Artifact validation failed"
                else:
                    output_path = result.output_json_path
                    summary = load_json(output_path).get("summary", result.summary)
            except AccError as exc:
                status = "schema_error"
                error_class = "schema_error"
                error = str(exc)
                summary = "Output schema validation failed"
        elif result.status != "success":
            error_class = classify_error(result.status, error or summary)
            status = error_class

        conductor_output = {
            "status": status,
            "summary": summary,
            "session_id": session_id,
            "output_path": str(output_path.resolve()) if output_path else None,
            "artifact_dir": str(store.artifacts_dir.resolve()),
            "event_log": str(store.events_log_path.resolve()),
            "session_manifest": str(store.session_manifest_path.resolve()),
        }
        if error:
            conductor_output["error"] = error

        manifest = self._update_manifest(
            store,
            manifest,
            capsule_id=capsule_id,
            capsule_version=capsule.spec.version,
            status=status,
            output_path=conductor_output["output_path"],
            artifact_dir=conductor_output["artifact_dir"],
            event_log_path=conductor_output["event_log"],
            error=error,
        )
        store.write_conductor_output(conductor_output)
        self._write_summaries(store, manifest, conductor_output, error_class, error)
        return conductor_output

    def _base_manifest(
        self,
        store: ArtifactStore,
        session_id: str,
        capsule_id: str,
        capsule_version: str,
    ) -> dict[str, Any]:
        now = utc_now_iso()
        return SessionManifest(
            session_id=session_id,
            capsule_id=capsule_id,
            capsule_version=capsule_version,
            status="created",
            created_at=now,
            updated_at=now,
            run_dir=str(store.run_dir.resolve()),
            artifact_dir=str(store.artifacts_dir.resolve()),
            event_log_path=str(store.events_log_path.resolve()),
            conductor_output_path=str(store.conductor_output_path.resolve()),
        ).model_dump()

    def _update_manifest(
        self,
        store: ArtifactStore,
        manifest: dict[str, Any],
        **updates: Any,
    ) -> dict[str, Any]:
        updated = {**manifest, **updates, "updated_at": utc_now_iso()}
        store.write_manifest(SessionManifest.model_validate(updated).model_dump())
        return updated

    def _write_summaries(
        self,
        store: ArtifactStore,
        manifest: dict[str, Any],
        conductor_output: dict[str, Any],
        error_class: str | None = None,
        error_message: str | None = None,
    ) -> None:
        node_summary = write_node_summary(
            store.run_dir,
            manifest,
            conductor_output,
            error_class,
            error_message,
        )
        write_run_summary(store.run_dir, node_summary)
        update_project_run_index(store.run_dir)


def conductor_failure(
    store: ArtifactStore,
    status: str,
    error: str,
    session_id: str,
) -> dict[str, Any]:
    return {
        "status": status,
        "summary": "Capsule failed",
        "error": error,
        "session_id": session_id,
        "output_path": None,
        "artifact_dir": str(store.artifacts_dir.resolve()),
        "event_log": str(store.events_log_path.resolve()),
        "session_manifest": str(store.session_manifest_path.resolve()),
    }


def load_input(input_path: Path | None, input_json: str | None) -> dict[str, Any]:
    if input_path is None and input_json is None:
        raise AccError("Either --input or --input-json is required")
    if input_path is not None and input_json is not None:
        raise AccError("Use only one of --input or --input-json")
    payload = load_json(input_path) if input_path is not None else json.loads(input_json or "{}")
    if not isinstance(payload, dict):
        raise AccError("Input must be a JSON object")
    return payload
