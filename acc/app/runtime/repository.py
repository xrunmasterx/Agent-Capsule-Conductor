from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.models import (
    ArtifactBundle,
    FailureRecord,
    FunctionInvocation,
    RunRecord,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.runtime.io import (
    append_event,
    append_runtime_error_to_stderr_log,
    artifact_bundle_payload,
    failure_record_payload,
    function_invocation_payload,
    run_record_payload,
    scope_frame_payload,
    session_instance_payload,
)
from acc.serialization import workflow_function_template_to_dict
from acc.storage import prepare_runtime_run_dir, write_text_atomic
from acc.store import write_json


class RunRepository:
    def __init__(self, run_dir: Path, *, project_root: Path | None) -> None:
        self.run_dir = run_dir
        self.project_root = project_root
        self.event_log_path = run_dir / "events.jsonl"

    def prepare(self, scope: ScopeFrame) -> None:
        prepare_runtime_run_dir(self.run_dir, project_root=self.project_root)
        for path in (
            self.run_dir,
            scope.inbox_root,
            scope.outbox_root,
            scope.artifact_root,
            scope.behavior_snapshot_path,
            self.run_dir / "failures",
        ):
            path.mkdir(parents=True, exist_ok=True)
        write_text_atomic(self.event_log_path, "")

    def write_invocation(self, invocation: FunctionInvocation) -> Path:
        path = self.run_dir / "function_invocation.json"
        write_json(path, function_invocation_payload(invocation))
        return path

    def write_scope(self, scope: ScopeFrame) -> Path:
        path = self.run_dir / "scope_frame.json"
        write_json(path, scope_frame_payload(scope))
        return path

    def write_template_snapshot(self, template: WorkflowFunctionTemplate) -> Path:
        path = self.run_dir / "behavior_snapshot" / "workflow_function_template.json"
        write_json(path, workflow_function_template_to_dict(template))
        return path

    def write_run_record(self, run_record: RunRecord) -> None:
        write_json(self.run_dir / "run_record.json", run_record_payload(run_record))

    def write_run_summary(
        self,
        template: WorkflowFunctionTemplate,
        run_id: str,
        status: str,
        *,
        started_at: str | None = None,
        ended_at: str | None = None,
    ) -> None:
        from acc.app.runtime.workflow_io import write_core_v2_run_summary

        write_core_v2_run_summary(
            self.run_dir,
            template,
            run_id,
            status,
            started_at=started_at,
            ended_at=ended_at,
        )

    def append_event(
        self,
        run_id: str,
        event_type: str,
        *,
        node_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        append_event(self.event_log_path, run_id, event_type, node_id=node_id, payload=payload)

    def write_workflow_outputs(
        self,
        template: WorkflowFunctionTemplate,
        run_id: str,
        result_store: FilesystemResultStore,
        outputs: dict[tuple[str, str], Any],
    ) -> None:
        from acc.app.runtime.workflow_io import write_workflow_outputs

        write_workflow_outputs(template, run_id, self.run_dir, result_store, outputs)


class NodeExecutionRecorder:
    def __init__(
        self,
        *,
        scope: ScopeFrame,
        event_log_path: Path,
        invocation: FunctionInvocation,
    ) -> None:
        self.scope = scope
        self.event_log_path = event_log_path
        self.invocation = invocation

    def node_dir(self, node_id: str) -> Path:
        return self.scope.environment_root / "nodes" / node_id

    def prepare_node_dir(self, node_id: str) -> Path:
        node_dir = self.node_dir(node_id)
        for path in (node_dir, node_dir / "artifacts"):
            path.mkdir(parents=True, exist_ok=True)
        write_text_atomic(node_dir / "events.jsonl", "")
        for log_name in ("stdout.log", "stderr.log", "stdout.txt", "stderr.txt"):
            write_text_atomic(node_dir / log_name, "")
        return node_dir

    def write_session(self, node_id: str, session: SessionInstance) -> None:
        write_json(
            self.node_dir(node_id) / "session_instance_manifest.json",
            session_instance_payload(session),
        )

    def write_payloads(
        self,
        node_id: str,
        *,
        agent_payload: dict[str, Any],
        runtime_payload: dict[str, Any],
    ) -> None:
        node_dir = self.node_dir(node_id)
        write_json(node_dir / "agent_payload.json", agent_payload)
        write_json(node_dir / "input.json", agent_payload)
        write_json(node_dir / "runtime_payload.json", runtime_payload)
        write_json(node_dir / "runtime.json", runtime_payload)

    def write_binding_manifest(
        self,
        node_id: str,
        *,
        inputs: list[str],
        bindings: list[dict[str, Any]],
    ) -> Path:
        path = self.node_dir(node_id) / "binding_manifest.json"
        write_json(
            path,
            {
                "schema_version": "acc.binding_manifest.v2",
                "inputs": inputs,
                "bindings": bindings,
            },
        )
        return path

    def append_event(
        self,
        event_type: str,
        *,
        node_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        append_event(
            self.event_log_path,
            self.invocation.run_id,
            event_type,
            node_id=node_id,
            payload=payload,
        )

    def write_output(self, node_id: str, output: dict[str, Any]) -> None:
        node_dir = self.node_dir(node_id)
        write_json(node_dir / "output.json", output)
        write_json(node_dir / "artifacts" / "payload.json", output)

    def write_artifact_bundle(self, node_id: str, bundle: ArtifactBundle) -> Path:
        path = self.node_dir(node_id) / "artifact_bundle.json"
        write_json(path, artifact_bundle_payload(bundle))
        return path

    def write_failure(self, node_id: str, failure: FailureRecord, error: str) -> None:
        write_json(
            self.scope.environment_root / "failures" / f"{failure.failure_id}.json",
            failure_record_payload(failure),
        )
        node_dir = self.node_dir(node_id)
        write_text_atomic(node_dir / "stderr.txt", error)
        append_runtime_error_to_stderr_log(node_dir / "stderr.log", error)
