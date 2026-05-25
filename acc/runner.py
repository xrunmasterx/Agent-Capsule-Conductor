from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from acc.adapters.base import AgentAdapter, AgentRunRequest, AgentRunResult
from acc.adapters.claude_sdk import ClaudeSdkAdapter
from acc.adapters.codex_cli import CodexCliAdapter
from acc.adapters.generic_cli import GenericCliAdapter, maybe_write_json_stdout
from acc.artifact_store import ArtifactStore
from acc.events import SessionEventEmitter
from acc.prompting import render_prompt
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.run_index import (
    classify_error,
    update_project_run_index,
    write_node_summary,
    write_run_summary,
)
from acc.session import SessionManifest, new_session_id, utc_now_iso
from acc.utils import AccError, load_json, split_lifecycle_command
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
        event_emitter = SessionEventEmitter(store.events_log_path, session_id=session_id)
        event_emitter.emit(
            "session_started",
            status="created",
            payload={"capsule_id": capsule_id, "run_dir": str(store.run_dir)},
        )
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
            event_emitter.emit(
                "input_written",
                status="created",
                payload={"path": str(store.input_path)},
            )
            store.write_capsule_snapshot(capsule)
            store.materialize_template_snapshot(capsule)
            manifest = self._update_manifest(
                store,
                manifest,
                input_path=str(store.input_path.resolve()),
                template_snapshot_dir=str(store.template_snapshot_dir.resolve()),
                lifecycle_log_dir=str(store.lifecycle_logs_dir.resolve()),
                capsule_kind=capsule.spec.kind or "agent_session",
                status="created",
            )

            validate_payload(input_payload, capsule.input_schema_path)
            if capsule.spec.kind in {"agent_workflow", "acc_workflow", "external_workflow"}:
                conductor_output = await self._run_workflow_capsule(
                    capsule,
                    input_payload,
                    store,
                    session_id,
                    manifest,
                    event_emitter,
                )
                return conductor_output

            prompt_template_path = capsule.prompt_template_path
            if prompt_template_path is None:
                raise AccError(f"Capsule {capsule_id} has no prompt template")
            rendered_prompt = render_prompt(prompt_template_path, input_payload)
            store.write_prompt(rendered_prompt)
            event_emitter.emit(
                "prompt_rendered",
                status="created",
                payload={"path": str(store.prompt_path)},
            )
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
            event_emitter.emit(
                "workspace_prepared",
                status="running",
                payload={"mode": workspace.mode, "path": str(workspace.path)},
            )
            manifest = self._update_manifest(
                store,
                manifest,
                workspace_dir=str(workspace.path.resolve()),
                status="running",
            )

            adapter = self.adapters[capsule.spec.runtime.type]
            event_emitter.emit(
                "adapter_started",
                status="running",
                payload={"runtime": capsule.spec.runtime.type},
            )
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
            completion_event = (
                "session_completed"
                if conductor_output["status"] == "success"
                else "session_failed"
            )
            event_emitter.emit(
                completion_event,
                status=conductor_output["status"],
                payload={
                    "summary": conductor_output.get("summary"),
                    "error": conductor_output.get("error"),
                },
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
            event_emitter.emit("session_failed", status=status, payload={"error": str(exc)})
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
            event_emitter.emit("session_failed", status=status, payload={"error": str(exc)})
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
                SessionEventEmitter(store.events_log_path, session_id=session_id).emit(
                    "output_validated",
                    status="running",
                    payload={"path": str(result.output_json_path)},
                )
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
                    SessionEventEmitter(store.events_log_path, session_id=session_id).emit(
                        "artifact_validated",
                        status="running",
                        payload={"artifact_dir": str(store.artifacts_dir)},
                    )
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

    async def _run_workflow_capsule(
        self,
        capsule,
        input_payload: dict[str, Any],
        store: ArtifactStore,
        session_id: str,
        manifest: dict[str, Any],
        event_emitter: SessionEventEmitter,
    ) -> dict[str, Any]:
        workspace_dir = self._prepare_workflow_capsule_workspace(store)
        manifest = self._update_manifest(
            store,
            manifest,
            workspace_dir=str(workspace_dir.resolve()),
            status="running",
        )
        env = self._workflow_capsule_env(capsule, store, workspace_dir)
        event_emitter.emit(
            "workflow_capsule_started",
            status="running",
            payload={
                "kind": capsule.spec.kind,
                "workspace_dir": str(workspace_dir.resolve()),
            },
        )
        lifecycle = capsule.spec.lifecycle
        setup_commands = list(lifecycle.setup) if lifecycle is not None else []
        collect_commands = list(lifecycle.collect) if lifecycle is not None else []
        cleanup_commands = list(lifecycle.cleanup) if lifecycle is not None else []

        result: AgentRunResult
        cleanup_error: str | None = None
        try:
            setup_error = await self._run_lifecycle_stage(
                capsule,
                stage_name="setup",
                commands=setup_commands,
                workspace_dir=workspace_dir,
                store=store,
                env=env,
                event_emitter=event_emitter,
            )
            if setup_error is not None:
                result = self._failed_workflow_result(
                    store,
                    "Workflow capsule setup failed",
                    setup_error,
                )
            else:
                result = await self._run_workflow_capsule_main(
                    capsule,
                    input_payload,
                    store,
                    workspace_dir,
                    env,
                    event_emitter,
                )
                if result.status == "success":
                    collect_error = await self._run_lifecycle_stage(
                        capsule,
                        stage_name="collect",
                        commands=collect_commands,
                        workspace_dir=workspace_dir,
                        store=store,
                        env=env,
                        event_emitter=event_emitter,
                    )
                    if collect_error is not None:
                        result = self._failed_workflow_result(
                            store,
                            "Workflow capsule collect failed",
                            collect_error,
                        )
                    else:
                        self._sync_workflow_workspace_outputs(workspace_dir, store)
                        if capsule.spec.kind == "external_workflow":
                            self._write_external_workflow_manifest(capsule, store, workspace_dir)
                        result = self._result_from_output(store, "Workflow capsule completed")
        finally:
            cleanup_error = await self._run_lifecycle_stage(
                capsule,
                stage_name="cleanup",
                commands=cleanup_commands,
                workspace_dir=workspace_dir,
                store=store,
                env=env,
                event_emitter=event_emitter,
                best_effort=True,
            )

        if cleanup_error is not None:
            store.append_stderr(cleanup_error)

        conductor_output = self._finalize_result(
            store,
            session_id,
            capsule.spec.id,
            capsule,
            result,
            manifest,
        )
        completion_event = (
            "session_completed" if conductor_output["status"] == "success" else "session_failed"
        )
        payload = {
            "summary": conductor_output.get("summary"),
            "error": conductor_output.get("error"),
        }
        if cleanup_error is not None:
            payload["cleanup_error"] = cleanup_error
        event_emitter.emit(completion_event, status=conductor_output["status"], payload=payload)
        return conductor_output

    async def _run_workflow_capsule_main(
        self,
        capsule,
        input_payload: dict[str, Any],
        store: ArtifactStore,
        workspace_dir: Path,
        env: dict[str, str],
        event_emitter: SessionEventEmitter,
    ) -> AgentRunResult:
        run_commands = list((capsule.spec.lifecycle or {}).run if capsule.spec.lifecycle else [])
        if run_commands:
            run_error = await self._run_lifecycle_stage(
                capsule,
                stage_name="run",
                commands=run_commands,
                workspace_dir=workspace_dir,
                store=store,
                env=env,
                event_emitter=event_emitter,
            )
            if run_error is not None:
                return self._failed_workflow_result(store, "Workflow capsule run failed", run_error)
            self._sync_workflow_workspace_outputs(workspace_dir, store)
            if capsule.spec.kind == "external_workflow":
                self._write_external_workflow_manifest(capsule, store, workspace_dir)
            return self._result_from_output(store, "Workflow capsule completed")

        if capsule.spec.kind == "acc_workflow":
            return await self._run_nested_acc_workflow_capsule(
                capsule,
                input_payload,
                store,
                workspace_dir,
                event_emitter,
            )

        return await self._run_workflow_capsule_with_adapter(
            capsule,
            input_payload,
            store,
            workspace_dir,
            env,
            event_emitter,
        )

    async def _run_nested_acc_workflow_capsule(
        self,
        capsule,
        input_payload: dict[str, Any],
        store: ArtifactStore,
        workspace_dir: Path,
        event_emitter: SessionEventEmitter,
    ) -> AgentRunResult:
        if capsule.spec.workflow is None:
            raise AccError(f"Capsule {capsule.spec.id} has no workflow config")
        from acc.workflow_runner import run_workflow_graph

        workflow_path = workspace_dir / Path(capsule.spec.workflow.path).name
        nested_run_dir = store.artifacts_dir / "nested_workflow"
        event_emitter.emit(
            "nested_workflow_started",
            status="running",
            payload={"workflow_path": str(workflow_path), "run_dir": str(nested_run_dir)},
        )
        nested_result = await run_workflow_graph(
            workflow_path,
            nested_run_dir,
            self.registry,
            input_payload=input_payload,
        )
        status = "success" if nested_result.get("status") == "success" else "failed"
        workflow_summary_path = nested_run_dir / "workflow_summary.json"
        output_payload = {
            "status": status,
            "summary": f"Nested workflow {nested_result.get('workflow_id')} {status}",
            "child_workflow_id": nested_result.get("workflow_id"),
            "child_workflow_status": nested_result.get("status"),
            "child_workflow_run_dir": str(nested_run_dir.resolve()),
            "child_workflow_summary_path": str(workflow_summary_path.resolve()),
            "child_errors": nested_result.get("errors", []),
        }
        store.write_json(store.output_path, output_payload)
        store.write_json(store.artifacts_dir / "output.json", output_payload)
        if workflow_summary_path.exists():
            shutil.copy2(
                workflow_summary_path,
                store.artifacts_dir / "workflow_summary.json",
            )
        (store.artifacts_dir / "nested_summary.md").write_text(
            f"# Nested Workflow\n\nStatus: {status}\n",
            encoding="utf-8",
        )
        event_emitter.emit(
            "nested_workflow_completed",
            status=status,
            payload={
                "workflow_id": nested_result.get("workflow_id"),
                "workflow_status": nested_result.get("status"),
            },
        )
        if status == "success":
            return self._result_from_output(store, "Nested workflow completed")
        return AgentRunResult(
            status="failed",
            summary=str(output_payload["summary"]),
            output_json_path=None,
            event_log_path=store.events_log_path,
            artifacts_dir=store.artifacts_dir,
            exit_code=1,
            error="; ".join(str(error) for error in nested_result.get("errors", [])),
        )

    async def _run_workflow_capsule_with_adapter(
        self,
        capsule,
        input_payload: dict[str, Any],
        store: ArtifactStore,
        workspace_dir: Path,
        env: dict[str, str],
        event_emitter: SessionEventEmitter,
    ) -> AgentRunResult:
        if not store.prompt_path.exists():
            store.write_prompt("")
        adapter = self.adapters[capsule.spec.runtime.type]
        event_emitter.emit(
            "adapter_started",
            status="running",
            payload={"runtime": capsule.spec.runtime.type},
        )
        result = await adapter.run(
            AgentRunRequest(
                capsule_id=capsule.spec.id,
                run_dir=store.run_dir,
                workspace_dir=workspace_dir,
                prompt_path=store.prompt_path,
                input_payload=input_payload,
                output_schema_path=capsule.output_schema_path,
                timeout_seconds=capsule.spec.permissions.timeout_seconds,
                command=capsule.spec.runtime.command,
                args_base=capsule.spec.runtime.args_base,
                env=env,
                sandbox=capsule.spec.permissions.sandbox,
                allow_dangerous=capsule.spec.permissions.allow_dangerous,
                session_id="workflow_capsule",
            )
        )
        self._sync_workflow_workspace_outputs(workspace_dir, store)
        if result.status == "success" and capsule.spec.kind == "external_workflow":
            self._write_external_workflow_manifest(capsule, store, workspace_dir)
        return result

    async def _run_lifecycle_stage(
        self,
        capsule,
        *,
        stage_name: str,
        commands: list[str],
        workspace_dir: Path,
        store: ArtifactStore,
        env: dict[str, str],
        event_emitter: SessionEventEmitter,
        best_effort: bool = False,
    ) -> str | None:
        stage_log_dir = store.lifecycle_logs_dir / stage_name
        stage_log_dir.mkdir(parents=True, exist_ok=True)
        stage_record: dict[str, Any] = {
            "stage": stage_name,
            "status": "skipped" if not commands else "success",
            "best_effort": best_effort,
            "commands": [],
        }
        if not commands:
            store.write_json(stage_log_dir / "stage.json", stage_record)
            return None

        event_emitter.emit(
            "lifecycle_stage_started",
            status="running",
            payload={"stage": stage_name, "commands": commands},
        )
        for index, command in enumerate(commands, start=1):
            stdout_path = stage_log_dir / f"{index:02d}.stdout.log"
            stderr_path = stage_log_dir / f"{index:02d}.stderr.log"
            argv = split_lifecycle_command(command)
            process = await asyncio.create_subprocess_exec(
                argv[0],
                *argv[1:],
                cwd=workspace_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**env, "ACC_LIFECYCLE_STAGE": stage_name},
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=capsule.spec.permissions.timeout_seconds,
                )
            except TimeoutError:
                process.kill()
                await process.wait()
                stdout = b""
                stderr = b""
                error = f"Lifecycle {stage_name} command timed out: {command}"
                stdout_path.write_bytes(stdout)
                stderr_path.write_text(error + "\n", encoding="utf-8")
                stage_record["status"] = "failed"
                stage_record["commands"].append(
                    {
                        "command": command,
                        "status": "timeout",
                        "stdout_path": str(stdout_path.resolve()),
                        "stderr_path": str(stderr_path.resolve()),
                    }
                )
                store.write_json(stage_log_dir / "stage.json", stage_record)
                event_emitter.emit(
                    "lifecycle_stage_failed",
                    status="timeout",
                    payload={"stage": stage_name, "command": command, "error": error},
                )
                return None if best_effort else error

            stdout_path.write_bytes(stdout)
            stderr_path.write_bytes(stderr)
            maybe_write_json_stdout(stdout, store.output_path)
            self._sync_workflow_workspace_outputs(workspace_dir, store)

            command_record = {
                "command": command,
                "status": "success" if process.returncode == 0 else "failed",
                "exit_code": process.returncode,
                "stdout_path": str(stdout_path.resolve()),
                "stderr_path": str(stderr_path.resolve()),
            }
            stage_record["commands"].append(command_record)
            if process.returncode != 0:
                error = (
                    stderr.decode(errors="replace").strip()
                    or stdout.decode(errors="replace").strip()
                    or f"Lifecycle {stage_name} command failed: {command}"
                )
                stage_record["status"] = "failed"
                store.write_json(stage_log_dir / "stage.json", stage_record)
                event_emitter.emit(
                    "lifecycle_stage_failed",
                    status="failed",
                    payload={"stage": stage_name, "command": command, "error": error},
                )
                return None if best_effort else error

        store.write_json(stage_log_dir / "stage.json", stage_record)
        event_emitter.emit(
            "lifecycle_stage_completed",
            status="success",
            payload={"stage": stage_name},
        )
        return None

    def _prepare_workflow_capsule_workspace(self, store: ArtifactStore) -> Path:
        workspace_dir = store.run_dir / "workflow_workspace"
        shutil.copytree(store.template_snapshot_dir, workspace_dir, dirs_exist_ok=True)
        return workspace_dir

    def _workflow_capsule_env(
        self,
        capsule,
        store: ArtifactStore,
        workspace_dir: Path,
    ) -> dict[str, str]:
        env = os.environ.copy()
        env.update(capsule.spec.runtime.env)
        env.update(
            {
                "ACC_INPUT_PATH": str(store.input_path.resolve()),
                "ACC_RUN_DIR": str(store.run_dir.resolve()),
                "ACC_OUTPUT_JSON": str(store.output_path.resolve()),
                "ACC_OUTPUT_SCHEMA_PATH": str(capsule.output_schema_path.resolve()),
                "ACC_ARTIFACT_DIR": str(store.artifacts_dir.resolve()),
                "ACC_EVENTS_JSONL": str(store.events_log_path.resolve()),
                "ACC_TEMPLATE_SNAPSHOT_DIR": str(store.template_snapshot_dir.resolve()),
                "ACC_WORKSPACE_DIR": str(workspace_dir.resolve()),
                "ACC_LIFECYCLE_LOG_DIR": str(store.lifecycle_logs_dir.resolve()),
            }
        )
        if capsule.spec.behavior_pack is not None:
            env["ACC_BEHAVIOR_PACK_DIR"] = str((workspace_dir / "behavior_pack").resolve())
        if capsule.spec.workflow is not None:
            env["ACC_WORKFLOW_PATH"] = str(
                (workspace_dir / Path(capsule.spec.workflow.path).name).resolve()
            )
        return env

    def _sync_workflow_workspace_outputs(self, workspace_dir: Path, store: ArtifactStore) -> None:
        workspace_output = workspace_dir / "output.json"
        if not store.output_path.exists() and workspace_output.exists():
            shutil.copy2(workspace_output, store.output_path)

        workspace_artifacts = workspace_dir / "artifacts"
        if not workspace_artifacts.exists():
            return
        for child in workspace_artifacts.iterdir():
            target = store.artifacts_dir / child.name
            if child.is_dir():
                shutil.copytree(child, target, dirs_exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, target)

    def _result_from_output(self, store: ArtifactStore, summary: str) -> AgentRunResult:
        if not store.output_path.exists():
            return self._failed_workflow_result(
                store,
                summary,
                "Workflow capsule did not produce output.json",
            )
        payload = load_json(store.output_path)
        resolved_summary = summary
        if isinstance(payload, dict) and isinstance(payload.get("summary"), str):
            resolved_summary = payload["summary"]
        return AgentRunResult(
            status="success",
            summary=resolved_summary,
            output_json_path=store.output_path,
            event_log_path=store.events_log_path,
            artifacts_dir=store.artifacts_dir,
            exit_code=0,
        )

    def _failed_workflow_result(
        self,
        store: ArtifactStore,
        summary: str,
        error: str,
    ) -> AgentRunResult:
        store.append_stderr(error)
        return AgentRunResult(
            status="failed",
            summary=summary,
            output_json_path=None,
            event_log_path=store.events_log_path,
            artifacts_dir=store.artifacts_dir,
            exit_code=1,
            error=error,
        )

    def _write_external_workflow_manifest(
        self,
        capsule,
        store: ArtifactStore,
        workspace_dir: Path,
    ) -> None:
        workflow_path = (
            workspace_dir / Path(capsule.spec.workflow.path).name
            if capsule.spec.workflow is not None
            else None
        )
        manifest = {
            "capsule_id": capsule.spec.id,
            "workflow_type": capsule.spec.workflow.type if capsule.spec.workflow else None,
            "workflow_path": str(workflow_path.resolve()) if workflow_path else None,
            "command": capsule.spec.runtime.command,
            "args_base": capsule.spec.runtime.args_base,
            "output_path": str(store.output_path.resolve()) if store.output_path.exists() else None,
            "artifact_dir": str(store.artifacts_dir.resolve()),
        }
        store.write_json(store.artifacts_dir / "external_workflow_manifest.json", manifest)

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
