from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.app.authoring import AuthoringSessionService
from acc.graphops import GraphOpsService
from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
from acc.control_plane import (
    list_callables_payload,
    list_workflows_payload,
    read_artifact_payload,
    show_callable_payload,
    show_run_payload,
    show_workflow_payload,
    validate_callable_id,
)
from acc.mcp_server.audit import new_request_id, write_mcp_audit
from acc.mcp_server.schemas import McpToolResult, tool_result
from acc.utils import AccError


class AccMcpTools:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()

    def acc_list_callables(self) -> McpToolResult:
        return self._recorded("acc_list_callables", lambda _request_id: tool_result(
            status="valid",
            summary="Callable catalog loaded.",
            data=list_callables_payload(self.project_root),
        ))

    def acc_show_callable(self, callable_id: str) -> McpToolResult:
        return self._recorded("acc_show_callable", lambda _request_id: tool_result(
            status="valid",
            summary=f"Callable loaded: {callable_id}",
            data=show_callable_payload(callable_id, self.project_root),
        ))

    def acc_list_workflows(self) -> McpToolResult:
        return self._recorded("acc_list_workflows", lambda _request_id: tool_result(
            status="valid",
            summary="Workflow catalog loaded.",
            data=list_workflows_payload(project_root=self.project_root),
        ))

    def acc_show_workflow(self, workflow_ref: str) -> McpToolResult:
        return self._recorded("acc_show_workflow", lambda _request_id: tool_result(
            status="valid",
            summary=f"Workflow loaded: {workflow_ref}",
            data=show_workflow_payload(workflow_ref, project_root=self.project_root),
        ))

    def acc_get_canvas_snapshot(self, task_id: str) -> McpToolResult:
        return self._recorded(
            "acc_get_canvas_snapshot",
            lambda _request_id: self._canvas_snapshot_result(task_id),
            task_id=task_id,
        )

    def acc_get_run_summary(self, run_id: str) -> McpToolResult:
        return self._recorded("acc_get_run_summary", lambda _request_id: tool_result(
            status="valid",
            summary=f"Run summary loaded: {run_id}",
            run_id=run_id,
            data=show_run_payload(run_id, self.project_root / "runs"),
        ), run_id=run_id)

    def acc_get_run_events(self, run_id: str, limit: int = 200) -> McpToolResult:
        return self._recorded(
            "acc_get_run_events",
            lambda _request_id: self._run_events_result(run_id, limit),
            run_id=run_id,
        )

    def acc_read_artifact(self, artifact_ref: str) -> McpToolResult:
        return self._recorded("acc_read_artifact", lambda _request_id: tool_result(
            status="valid",
            summary=f"Artifact loaded: {artifact_ref}",
            data=read_artifact_payload(artifact_ref, self.project_root),
        ))

    def acc_create_authoring_session(
        self,
        task_id: str,
        agent_id: str | None = None,
        canvas_hash: str | None = None,
        canvas_snapshot: dict[str, Any] | None = None,
    ) -> McpToolResult:
        return self._recorded(
            "acc_create_authoring_session",
            lambda _request_id: self._create_authoring_session(
                agent_id=agent_id,
                task_id=task_id,
                canvas_hash=canvas_hash,
                canvas_snapshot=canvas_snapshot,
            ),
            task_id=task_id,
        )

    async def acc_send_authoring_message(
        self,
        session_id: str,
        message: str,
        task_id: str | None = None,
        canvas_hash: str | None = None,
        canvas_snapshot: dict[str, Any] | None = None,
        selection: dict[str, Any] | None = None,
    ) -> McpToolResult:
        request_id = new_request_id()
        try:
            snapshot = self._resolve_snapshot(
                task_id=task_id,
                canvas_hash=canvas_hash,
                canvas_snapshot=canvas_snapshot,
            )
            response = await AuthoringSessionService(self.project_root).post_message(
                session_id,
                message=message,
                canvas_hash=str(snapshot["canvas_hash"]),
                canvas_snapshot=snapshot["canvas_snapshot"],
                selection=selection or snapshot.get("selection") or {},
            )
            response_status = (
                "valid"
                if response.get("validation", {}).get("status") == "valid"
                else "invalid"
            )
            result = tool_result(
                status=response_status,
                summary=response.get("assistant_message") or "Authoring message processed.",
                proposal_id=response.get("proposal", {}).get("proposal_id")
                if isinstance(response.get("proposal"), dict)
                else None,
                data=response,
            )
            self._audit_result(
                "acc_send_authoring_message",
                request_id,
                result,
                session_id=session_id,
                task_id=str(snapshot.get("task_id") or ""),
            )
            return result
        except Exception as exc:
            result = invalid_result(exc)
            self._audit_result(
                "acc_send_authoring_message",
                request_id,
                result,
                session_id=session_id,
                task_id=task_id,
            )
            return result

    def acc_validate_canvas_proposal(
        self,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str | None = None,
        canvas_snapshot: dict[str, Any] | None = None,
        temporary_resources: dict[str, Any] | None = None,
    ) -> McpToolResult:
        return self._recorded(
            "acc_validate_canvas_proposal",
            lambda _request_id: self._validate_canvas_proposal(
                proposal=proposal,
                task_id=task_id,
                canvas_hash=canvas_hash,
                canvas_snapshot=canvas_snapshot,
                temporary_resources=temporary_resources,
            ),
            task_id=task_id,
            proposal_id=proposal.get("proposal_id") if isinstance(proposal, dict) else None,
        )

    def acc_dry_run_canvas_proposal(
        self,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str | None = None,
        canvas_snapshot: dict[str, Any] | None = None,
        temporary_resources: dict[str, Any] | None = None,
    ) -> McpToolResult:
        return self._recorded(
            "acc_dry_run_canvas_proposal",
            lambda _request_id: self._dry_run_canvas_proposal(
                proposal=proposal,
                task_id=task_id,
                canvas_hash=canvas_hash,
                canvas_snapshot=canvas_snapshot,
                temporary_resources=temporary_resources,
            ),
            task_id=task_id,
            proposal_id=proposal.get("proposal_id") if isinstance(proposal, dict) else None,
        )

    def acc_create_graphops_proposal(self, proposal: dict[str, Any]) -> McpToolResult:
        return self._recorded(
            "acc_create_graphops_proposal",
            lambda request_id: self._create_graphops_proposal(proposal, request_id),
            proposal_id=proposal.get("proposal_id") if isinstance(proposal, dict) else None,
            target_paths=target_paths_for_proposal(proposal),
        )

    def acc_validate_graphops_proposal(self, proposal_id: str) -> McpToolResult:
        return self._recorded(
            "acc_validate_graphops_proposal",
            lambda _request_id: self._validate_graphops_proposal(proposal_id),
            proposal_id=proposal_id,
        )

    def acc_dry_run_graphops_proposal(self, proposal_id: str) -> McpToolResult:
        return self._recorded(
            "acc_dry_run_graphops_proposal",
            lambda _request_id: self._dry_run_graphops_proposal(proposal_id),
            proposal_id=proposal_id,
        )

    def acc_list_temporary_resources(self, task_id: str) -> McpToolResult:
        return self._recorded(
            "acc_list_temporary_resources",
            lambda _request_id: self._temporary_resources_result(task_id),
            task_id=task_id,
        )

    def acc_promote_temporary_resource_dry_run(
        self,
        task_id: str,
        temporary_resource_id: str,
        persistent_callable_id: str | None = None,
    ) -> McpToolResult:
        return self._recorded(
            "acc_promote_temporary_resource_dry_run",
            lambda request_id: self._promote_temporary_resource_dry_run(
                task_id=task_id,
                temporary_resource_id=temporary_resource_id,
                persistent_callable_id=persistent_callable_id,
                request_id=request_id,
            ),
            task_id=task_id,
        )

    def _canvas_snapshot_result(self, task_id: str) -> McpToolResult:
        snapshot = WorkbenchCanvasSnapshotService(self.project_root).get(task_id)
        return tool_result(
            status="valid",
            summary=f"Canvas snapshot loaded: {task_id}",
            data=snapshot,
        )

    def _run_events_result(self, run_id: str, limit: int) -> McpToolResult:
        validate_path_component(run_id, "run_id")
        safe_limit = max(1, min(1000, int(limit)))
        run_dir = (self.project_root / "runs" / run_id).resolve()
        runs_root = (self.project_root / "runs").resolve()
        if not run_dir.is_relative_to(runs_root) or not run_dir.exists():
            raise AccError(f"Run not found: {run_id}")
        events_path = run_dir / "events.jsonl"
        return tool_result(
            status="valid",
            summary=f"Run events loaded: {run_id}",
            run_id=run_id,
            data={
                "run_id": run_id,
                "event_log": relative_project_path(self.project_root, events_path),
                "events": read_jsonl_tolerant(events_path, limit=safe_limit),
            },
        )

    def _create_authoring_session(
        self,
        *,
        agent_id: str | None,
        task_id: str,
        canvas_hash: str | None,
        canvas_snapshot: dict[str, Any] | None,
    ) -> McpToolResult:
        snapshot = self._resolve_snapshot(
            task_id=task_id,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
        )
        selection = snapshot.get("selection") if isinstance(snapshot.get("selection"), dict) else {}
        response = AuthoringSessionService(self.project_root).create_session(
            agent_id=agent_id,
            task_id=task_id,
            canvas_hash=str(snapshot["canvas_hash"]),
            canvas_snapshot=snapshot["canvas_snapshot"],
            selection=selection,
        )
        return tool_result(
            status="valid",
            summary=f"Authoring session created: {response['session_id']}",
            data=response,
        )

    def _validate_canvas_proposal(
        self,
        *,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str | None,
        canvas_snapshot: dict[str, Any] | None,
        temporary_resources: dict[str, Any] | None,
    ) -> McpToolResult:
        snapshot = self._resolve_snapshot(
            task_id=task_id,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
        )
        validation = AuthoringSessionService(self.project_root).validate_proposal(
            proposal=proposal,
            task_id=task_id,
            canvas_hash=str(snapshot["canvas_hash"]),
            canvas_snapshot=snapshot["canvas_snapshot"],
            temporary_resources=temporary_resources
            if temporary_resources is not None
            else snapshot.get("temporary_resources")
            if isinstance(snapshot.get("temporary_resources"), dict)
            else {},
        )
        return tool_result(
            status="valid" if validation.get("status") == "valid" else "invalid",
            summary="Canvas proposal validation complete.",
            errors=validation.get("errors") or [],
            warnings=validation.get("warnings") or [],
            proposal_id=proposal.get("proposal_id") if isinstance(proposal, dict) else None,
            data={"validation": validation},
        )

    def _dry_run_canvas_proposal(
        self,
        *,
        proposal: dict[str, Any] | None,
        task_id: str,
        canvas_hash: str | None,
        canvas_snapshot: dict[str, Any] | None,
        temporary_resources: dict[str, Any] | None,
    ) -> McpToolResult:
        snapshot = self._resolve_snapshot(
            task_id=task_id,
            canvas_hash=canvas_hash,
            canvas_snapshot=canvas_snapshot,
        )
        dry_run = AuthoringSessionService(self.project_root).dry_run_proposal(
            proposal=proposal,
            task_id=task_id,
            canvas_hash=str(snapshot["canvas_hash"]),
            canvas_snapshot=snapshot["canvas_snapshot"],
            temporary_resources=temporary_resources
            if temporary_resources is not None
            else snapshot.get("temporary_resources")
            if isinstance(snapshot.get("temporary_resources"), dict)
            else {},
        )
        return tool_result(
            status="dry_run" if dry_run.get("status") == "valid" else "invalid",
            summary="Canvas proposal dry-run complete.",
            errors=dry_run.get("validation", {}).get("errors", []),
            warnings=dry_run.get("validation", {}).get("warnings", []),
            proposal_id=proposal.get("proposal_id") if isinstance(proposal, dict) else None,
            data=dry_run,
        )

    def _create_graphops_proposal(
        self,
        proposal: dict[str, Any],
        request_id: str,
    ) -> McpToolResult:
        next_proposal = copy.deepcopy(proposal)
        if not isinstance(next_proposal.get("source"), dict):
            next_proposal["source"] = {"kind": "mcp_tool", "id": request_id}
        response = GraphOpsService(self.project_root).create_proposal(next_proposal)
        return tool_result(
            status="valid",
            summary=f"GraphOps proposal created: {response['proposal_id']}",
            proposal_id=response["proposal_id"],
            links=evidence_links(response),
            data=response,
        )

    def _validate_graphops_proposal(self, proposal_id: str) -> McpToolResult:
        validation = GraphOpsService(self.project_root).validate(proposal_id)
        return tool_result(
            status="valid" if validation.get("status") == "valid" else "invalid",
            summary=f"GraphOps proposal validation complete: {proposal_id}",
            errors=validation.get("errors") or [],
            warnings=validation.get("warnings") or [],
            proposal_id=proposal_id,
            data={"validation": validation},
        )

    def _dry_run_graphops_proposal(self, proposal_id: str) -> McpToolResult:
        dry_run = GraphOpsService(self.project_root).dry_run(proposal_id)
        return tool_result(
            status="dry_run",
            summary=f"GraphOps proposal dry-run ready: {proposal_id}",
            proposal_id=proposal_id,
            data=dry_run,
        )

    def _temporary_resources_result(self, task_id: str) -> McpToolResult:
        snapshot = WorkbenchCanvasSnapshotService(self.project_root).get(task_id)
        resources = snapshot.get("temporary_resources")
        return tool_result(
            status="valid",
            summary=f"Temporary resources loaded: {task_id}",
            data={
                "task_id": task_id,
                "temporary_resources": resources if isinstance(resources, dict) else {},
            },
        )

    def _promote_temporary_resource_dry_run(
        self,
        *,
        task_id: str,
        temporary_resource_id: str,
        persistent_callable_id: str | None,
        request_id: str,
    ) -> McpToolResult:
        snapshot = WorkbenchCanvasSnapshotService(self.project_root).get(task_id)
        resources = snapshot.get("temporary_resources")
        if not isinstance(resources, dict):
            raise AccError("Snapshot does not contain temporary resources")
        draft = resources.get(temporary_resource_id)
        if not isinstance(draft, dict):
            raise AccError(f"Temporary resource not found: {temporary_resource_id}")
        proposal = graphops_transaction_for_temporary_agent(
            draft,
            request_id=request_id,
            persistent_callable_id=persistent_callable_id,
        )
        service = GraphOpsService(self.project_root)
        service.create_proposal(proposal)
        validation = service.validate(proposal["proposal_id"])
        dry_run = service.dry_run(proposal["proposal_id"])
        return tool_result(
            status="dry_run",
            summary=f"Temporary resource promotion dry-run ready: {temporary_resource_id}",
            proposal_id=proposal["proposal_id"],
            warnings=validation.get("warnings") or [],
            data={"proposal": proposal, "validation": validation, "dry_run": dry_run},
        )

    def _resolve_snapshot(
        self,
        *,
        task_id: str | None,
        canvas_hash: str | None,
        canvas_snapshot: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if canvas_snapshot is not None:
            if not task_id or not canvas_hash:
                raise AccError("task_id and canvas_hash are required with canvas_snapshot")
            return {
                "task_id": task_id,
                "canvas_hash": canvas_hash,
                "canvas_snapshot": canvas_snapshot,
                "selection": {},
                "temporary_resources": {},
            }
        if not task_id:
            raise AccError("task_id is required when canvas_snapshot is omitted")
        snapshot = WorkbenchCanvasSnapshotService(self.project_root).get(task_id)
        if canvas_hash and snapshot.get("canvas_hash") != canvas_hash:
            raise AccError("Canvas snapshot hash is stale")
        return snapshot

    def _recorded(
        self,
        tool_name: str,
        callback: Any,
        *,
        proposal_id: str | None = None,
        run_id: str | None = None,
        task_id: str | None = None,
        target_paths: list[str] | None = None,
    ) -> McpToolResult:
        request_id = new_request_id()
        try:
            result = callback(request_id)
        except Exception as exc:
            result = invalid_result(exc)
        self._audit_result(
            tool_name,
            request_id,
            result,
            proposal_id=proposal_id or result.get("proposal_id"),
            run_id=run_id or result.get("run_id"),
            task_id=task_id,
            target_paths=target_paths,
        )
        return result

    def _audit_result(
        self,
        tool_name: str,
        request_id: str,
        result: McpToolResult,
        *,
        proposal_id: str | None = None,
        session_id: str | None = None,
        run_id: str | None = None,
        task_id: str | None = None,
        target_paths: list[str] | None = None,
    ) -> None:
        write_mcp_audit(
            self.project_root,
            request_id=request_id,
            tool_name=tool_name,
            status=str(result["status"]),
            proposal_id=proposal_id,
            session_id=session_id,
            run_id=run_id,
            task_id=task_id,
            target_paths=target_paths,
            errors=result.get("errors") or [],
        )


def invalid_result(exc: Exception) -> McpToolResult:
    return tool_result(
        status="invalid",
        summary=str(exc),
        errors=[{"code": exc.__class__.__name__, "message": str(exc)}],
    )


def graphops_transaction_for_temporary_agent(
    draft: dict[str, Any],
    *,
    request_id: str,
    persistent_callable_id: str | None,
) -> dict[str, Any]:
    agent_draft = draft.get("agent_draft")
    if not isinstance(agent_draft, dict):
        raise AccError("Temporary resource agent_draft is required")
    callable_id = persistent_callable_id or persistent_callable_id_for_draft(draft)
    validate_callable_id(callable_id)
    target_path = f"callables/agents/{callable_id}.yaml"
    proposal_id = f"graphops_tx_mcp_tmp_agent_{uuid4().hex[:12]}"
    return {
        "schema_version": "acc.graphops.transaction.v1",
        "proposal_id": proposal_id,
        "author": "mcp_agent",
        "source": {"kind": "mcp_tool", "id": request_id},
        "base": {"content_hashes": {target_path: "absent"}},
        "rationale": f"Persist temporary agent template {draft.get('draft_id') or callable_id}.",
        "targets": [
            {
                "target_type": "agent_class",
                "target_path": target_path,
                "operation": "create_agent_class",
                "template": {**agent_draft, "id": callable_id},
            }
        ],
    }


def persistent_callable_id_for_draft(draft: dict[str, Any]) -> str:
    agent_draft = draft.get("agent_draft") if isinstance(draft.get("agent_draft"), dict) else {}
    requested_id = str(agent_draft.get("id") or "").strip()
    if not requested_id:
        requested_id = str(draft.get("draft_id") or "").replace("tmp_agent_", "agent_", 1)
    safe_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", requested_id).strip("-")
    fallback = str(draft.get("draft_id") or "agent").replace("tmp_agent_", "agent", 1)
    return safe_id or fallback


def target_paths_for_proposal(proposal: dict[str, Any]) -> list[str]:
    targets = proposal.get("targets") if isinstance(proposal, dict) else None
    if not isinstance(targets, list):
        return []
    return [
        str(target.get("target_path") or "")
        for target in targets
        if isinstance(target, dict) and target.get("target_path")
    ]


def evidence_links(payload: dict[str, Any]) -> list[dict[str, str]]:
    proposal_id = str(payload.get("proposal_id") or "")
    if not proposal_id:
        return []
    return [
        {
            "label": "GraphOps proposal evidence",
            "path": f"runs/_graphops_proposals/{proposal_id}/proposal.json",
        }
    ]


def validate_path_component(value: str, label: str) -> None:
    if value in {"", ".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise AccError(f"Invalid {label}: {value}")


def relative_project_path(project_root: Path, path: Path) -> str:
    return str(path.resolve().relative_to(project_root.resolve())).replace("\\", "/")


def read_jsonl_tolerant(path: Path, limit: int = 200) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            payload = {"type": "raw_log", "line": line_number, "payload": {"text": line}}
        if isinstance(payload, dict):
            events.append(payload)
    return events[-limit:]
