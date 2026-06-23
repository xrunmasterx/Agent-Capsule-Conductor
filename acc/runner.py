from __future__ import annotations

import base64
import hashlib
import os
import platform
import secrets
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from acc import __version__
from acc.audit import write_audit_event
from acc.callable_registry import CallableAsset, CallableRegistry
from acc.callable_runner import permission_profile_for_codex_execution_mode
from acc.constants import CODEX_EXECUTION_MODE_METADATA_KEY, CODEX_EXECUTION_MODES
from acc.control_plane import (
    ArtifactNotFoundError,
    ArtifactPolicyDeniedError,
    SecretLikePathError,
    reject_secret_like_path,
    resolve_registered_artifact_reference,
)
from acc.models import AgentClassTemplate, PermissionProfile, ToolClassTemplate
from acc.run_index import RunSummary, load_run_summary_by_id
from acc.server.run_manager import WorkbenchRunManager
from acc.session import utc_now_iso
from acc.storage import validate_run_id
from acc.storage_refs import make_node_artifact_ref, make_run_artifact_ref
from acc.store import load_json, write_json
from acc.utils import AccError

RUNNER_SCHEMA_VERSION = "acc.runner.v1"
RUNNER_CAPABILITIES_SCHEMA_VERSION = "acc.runner.capabilities.v1"
RUNNER_WORKSPACES_SCHEMA_VERSION = "acc.runner.workspaces.v1"
RUNNER_PAIRING_SCHEMA_VERSION = "acc.runner.pairing.v1"
RUNNER_JOB_SCHEMA_VERSION = "acc.runner.job.v1"
RUNNER_PROJECTION_SCHEMA_VERSION = "acc.runner.run_projection.v1"

DEFAULT_WORKSPACE_ALIAS = "default"
DEFAULT_AVAILABLE_RUNTIMES = ("codex_app_server", "generic_cli")
LOCAL_TOKEN_HEADER = "x-acc-local-token"
PRODUCT_SECURITY_MODES = {"product_local_exe", "paired_cloud_runner"}
PAIRING_STATES = {"unpaired", "paired", "revoked", "local_only"}
PermissionDecisionState = Literal["allowed", "requires_local_approval", "denied"]


class RunnerCapabilityError(AccError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        field: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.field = field
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": str(self)}
        if self.field:
            payload["field"] = self.field
        if self.details:
            payload["details"] = self.details
        return payload


class LocalRunnerService:
    def __init__(self, project_root: Path | str) -> None:
        self.project_root = Path(project_root).resolve()
        self.runner_root = self.project_root / ".acc" / "runner"
        self.jobs_root = self.runner_root / "jobs"

    def health(self) -> dict[str, Any]:
        runner = self.ensure_runner_record()
        return {
            "status": "ok",
            "runner_id": runner["runner_id"],
            "mode": self.pairing()["state"],
        }

    def ensure_runner_record(self) -> dict[str, Any]:
        self.runner_root.mkdir(parents=True, exist_ok=True)
        runner_path = self.runner_root / "runner.json"
        if runner_path.exists():
            runner = _load_object(runner_path)
        else:
            now = utc_now_iso()
            runner = {
                "schema_version": RUNNER_SCHEMA_VERSION,
                "runner_id": f"runner_{uuid4().hex[:16]}",
                "device_name": platform.node() or "local-device",
                "acc_version": __version__,
                "created_at": now,
                "last_seen_at": now,
                "storage_root": ".acc",
                "project_root": str(self.project_root),
                "auth_mode": "local_token",
            }
            write_json(runner_path, runner)
        runner["last_seen_at"] = utc_now_iso()
        write_json(runner_path, runner)
        self._ensure_workspaces_file(runner["runner_id"])
        self._ensure_pairing_file(runner["runner_id"])
        self.capabilities(write=True)
        return runner

    def capabilities(self, *, write: bool = False) -> dict[str, Any]:
        runner = self._runner_record_without_side_effects()
        workspaces = self.workspaces(local_debug=True)
        provider_status = self.provider_status()
        capabilities = {
            "schema_version": RUNNER_CAPABILITIES_SCHEMA_VERSION,
            "runner_id": runner["runner_id"],
            "os": platform.system().lower() or os.name,
            "acc_version": __version__,
            "available_runtimes": [
                runtime for runtime, status in provider_status.items() if status == "available"
            ],
            "provider_status": provider_status,
            "max_active_runs": configured_max_active_runs(),
            "max_queued_runs": configured_max_queued_runs(),
            "supports_graphops_apply": True,
            "supports_artifact_preview": True,
            "permission_policy": runner_permission_policy(),
            "workspace_aliases": [
                alias["alias"] for alias in workspaces["aliases"] if alias.get("allowed") is True
            ],
        }
        if write:
            write_json(self.runner_root / "capabilities.json", capabilities)
        return capabilities

    def provider_status(self) -> dict[str, str]:
        status = {runtime: "available" for runtime in DEFAULT_AVAILABLE_RUNTIMES}
        status["codex_cli"] = "available" if _command_exists("codex") else "unavailable"
        status["claude_sdk"] = (
            "available"
            if os.getenv("ACC_CLAUDE_SDK_AVAILABLE", "").strip() == "1"
            else "unavailable"
        )
        extra = os.getenv("ACC_AVAILABLE_RUNTIMES", "")
        for runtime in [item.strip() for item in extra.split(",") if item.strip()]:
            status[runtime] = "available"
        return status

    def pairing(self) -> dict[str, Any]:
        runner = self.ensure_runner_record()
        path = self.runner_root / "pairing.json"
        if not path.exists():
            self._ensure_pairing_file(runner["runner_id"])
        payload = _load_object(path)
        state = str(payload.get("state") or "unpaired")
        if state not in PAIRING_STATES:
            payload["state"] = "unpaired"
        return payload

    def workspaces(self, *, local_debug: bool = False) -> dict[str, Any]:
        runner = self._runner_record_without_side_effects()
        path = self.runner_root / "workspaces.json"
        if not path.exists():
            self._ensure_workspaces_file(runner["runner_id"])
        payload = _load_object(path)
        aliases = payload.get("aliases") if isinstance(payload.get("aliases"), list) else []
        projected = []
        for alias in aliases:
            if not isinstance(alias, dict):
                continue
            item = {
                "alias": str(alias.get("alias") or ""),
                "display_name": str(alias.get("display_name") or alias.get("alias") or ""),
                "allowed": bool(alias.get("allowed", True)),
                "created_at": alias.get("created_at"),
            }
            if local_debug:
                item["debug_path"] = str(alias.get("local_path") or "")
            projected.append(item)
        return {
            "schema_version": RUNNER_WORKSPACES_SCHEMA_VERSION,
            "runner_id": runner["runner_id"],
            "aliases": projected,
        }

    def add_workspace(
        self,
        alias: str,
        local_path: str,
        display_name: str | None = None,
    ) -> dict[str, Any]:
        alias = validate_alias(alias)
        runner = self.ensure_runner_record()
        path = Path(local_path).expanduser().resolve()
        if not path.exists() or not path.is_dir():
            raise RunnerCapabilityError(
                "workspace_unbound",
                f"Workspace directory not found: {path}",
                field="local_path",
            )
        payload = self._workspace_payload()
        aliases = [item for item in payload["aliases"] if item.get("alias") != alias]
        aliases.append(
            {
                "alias": alias,
                "display_name": display_name or alias,
                "local_path": str(path),
                "allowed": True,
                "created_at": utc_now_iso(),
            }
        )
        payload["aliases"] = sorted(aliases, key=lambda item: str(item.get("alias") or ""))
        write_json(self.runner_root / "workspaces.json", payload)
        write_audit_event(
            self.project_root,
            "workspace.binding_mutation",
            {
                "runner_id": runner["runner_id"],
                "alias": alias,
                "action": "add_or_replace",
            },
        )
        self.capabilities(write=True)
        return self.workspaces(local_debug=False)

    def resolve_workspace_alias(self, alias: str | None) -> Path:
        alias = validate_alias(alias or DEFAULT_WORKSPACE_ALIAS)
        for item in self._workspace_payload()["aliases"]:
            if item.get("alias") != alias:
                continue
            if item.get("allowed") is not True:
                raise RunnerCapabilityError(
                    "permission_denied",
                    f"Workspace alias is disabled: {alias}",
                    field="workspace_alias",
                )
            path = Path(str(item.get("local_path") or "")).expanduser().resolve()
            if not path.exists() or not path.is_dir():
                raise RunnerCapabilityError(
                    "workspace_unbound",
                    f"Workspace alias is not bound to an existing directory: {alias}",
                    field="workspace_alias",
                )
            return path
        raise RunnerCapabilityError(
            "workspace_unbound",
            f"Unknown workspace alias: {alias}",
            field="workspace_alias",
        )

    def resolve_binding_ref(self, binding_ref: str | None) -> Path | None:
        if not binding_ref:
            return None
        value = binding_ref.removeprefix("binding:")
        candidate = (self.project_root / "bindings" / value).resolve()
        bindings_root = (self.project_root / "bindings").resolve()
        if not candidate.is_relative_to(bindings_root):
            raise RunnerCapabilityError(
                "permission_denied",
                "binding_ref escapes the runner binding root",
                field="binding_ref",
            )
        if not candidate.exists() or not candidate.is_file():
            raise RunnerCapabilityError(
                "workspace_unbound",
                f"Binding not found: {binding_ref}",
                field="binding_ref",
            )
        return candidate

    def validate_job_before_evidence(
        self,
        *,
        graph: dict[str, Any],
        workspace_alias: str | None,
        binding_ref: str | None = None,
        raw_workspace: str | None = None,
        manager: WorkbenchRunManager | None = None,
    ) -> dict[str, Any]:
        workspace = self.resolve_workspace_alias(workspace_alias)
        if raw_workspace:
            workspace = Path(raw_workspace).expanduser().resolve()
            if not workspace.exists() or not workspace.is_dir():
                raise RunnerCapabilityError(
                    "workspace_unbound",
                    f"Workspace directory not found: {workspace}",
                    field="workspace",
                )
        binding_path = self.resolve_binding_ref(binding_ref)
        self._validate_provider_and_permission_requirements(graph)
        if manager is not None and not manager.has_capacity():
            raise RunnerCapabilityError(
                "queue_full",
                "Local runner queue is full",
                details=manager.capacity_payload(),
            )
        return {
            "workspace": workspace,
            "binding_path": binding_path,
            "workspace_alias": workspace_alias or DEFAULT_WORKSPACE_ALIAS,
            "binding_ref": binding_ref,
        }

    def new_job_id(self) -> str:
        return f"job_{uuid4().hex[:16]}"

    def write_job_receipt(
        self,
        *,
        job_id: str,
        status: str,
        workspace_alias: str,
        run_id: str | None = None,
        task_id: str | None = None,
        workflow_id: str | None = None,
        rejection: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        validate_job_id(job_id)
        if run_id:
            validate_run_id(run_id)
        runner = self.ensure_runner_record()
        payload = {
            "schema_version": RUNNER_JOB_SCHEMA_VERSION,
            "job_id": job_id,
            "runner_id": runner["runner_id"],
            "workspace_alias": workspace_alias,
            "workflow_id": workflow_id,
            "task_id": task_id,
            "run_id": run_id,
            "status": status,
            "rejection": rejection,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        self.jobs_root.mkdir(parents=True, exist_ok=True)
        write_json(self.jobs_root / f"{job_id}.json", payload)
        return self.project_job(payload)

    def get_job(self, job_id: str) -> dict[str, Any]:
        validate_job_id(job_id)
        return self.project_job(_load_object(self.jobs_root / f"{job_id}.json"))

    def update_job_status(self, job_id: str, status: str) -> dict[str, Any]:
        validate_job_id(job_id)
        path = self.jobs_root / f"{job_id}.json"
        payload = _load_object(path)
        payload["status"] = status
        payload["updated_at"] = utc_now_iso()
        write_json(path, payload)
        return self.project_job(payload)

    def project_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": RUNNER_JOB_SCHEMA_VERSION,
            "runner_id": payload.get("runner_id"),
            "workspace_alias": payload.get("workspace_alias"),
            "job_id": payload.get("job_id"),
            "run_id": payload.get("run_id"),
            "task_id": payload.get("task_id"),
            "workflow_id": payload.get("workflow_id"),
            "status": payload.get("status"),
            "rejection": payload.get("rejection"),
            "stream_url": (
                f"/api/runner/runs/{payload['run_id']}/stream" if payload.get("run_id") else None
            ),
        }

    def run_projection(self, run_id: str, *, local_debug: bool = False) -> dict[str, Any]:
        validate_run_id(run_id)
        runner = self.ensure_runner_record()
        summary = load_run_summary_by_id(run_id, self.project_root / "runs")
        payload = {
            "schema_version": RUNNER_PROJECTION_SCHEMA_VERSION,
            "runner_id": runner["runner_id"],
            "workspace_alias": DEFAULT_WORKSPACE_ALIAS,
            "run_id": summary.run_id,
            "workflow_id": summary.workflow_id,
            "status": summary.status,
            "started_at": summary.started_at,
            "ended_at": summary.ended_at,
            "stream_url": f"/api/runner/runs/{run_id}/stream",
            "artifact_ref": make_run_artifact_ref(run_id, ".") if summary.artifact_dir else None,
            "legacy_artifact_ref": f"run:{run_id}:artifacts" if summary.artifact_dir else None,
            "nodes": [
                self._project_node(summary, node, local_debug=local_debug)
                for node in summary.nodes
            ],
        }
        if local_debug:
            payload["debug_path"] = summary.run_dir
        return payload

    def artifact_preview(self, artifact_id: str) -> dict[str, Any]:
        decoded = decode_artifact_id(artifact_id)
        try:
            path = resolve_registered_artifact_reference(self.project_root, decoded)
            reject_secret_like_path(path)
        except ArtifactNotFoundError as exc:
            raise RunnerCapabilityError("artifact_not_found", str(exc)) from exc
        except (ArtifactPolicyDeniedError, SecretLikePathError, AccError) as exc:
            raise RunnerCapabilityError("artifact_policy_denied", str(exc)) from exc
        if not path.exists() or not path.is_file():
            raise RunnerCapabilityError("artifact_not_found", f"Artifact not found: {artifact_id}")
        runner = self.ensure_runner_record()
        write_audit_event(
            self.project_root,
            "artifact.preview",
            {
                "runner_id": runner["runner_id"],
                "artifact_ref": decoded,
                "name": path.name,
                "size_bytes": path.stat().st_size,
            },
        )
        return {
            "artifact_id": artifact_id,
            "artifact_ref": decoded,
            "name": path.name,
            "size_bytes": path.stat().st_size,
        }

    def local_token(self) -> str | None:
        env_token = os.getenv("ACC_LOCAL_RUNNER_TOKEN")
        if env_token:
            return env_token
        pairing_path = self.runner_root / "pairing.json"
        if not pairing_path.exists():
            return None
        pairing = _load_object(pairing_path)
        token = pairing.get("local_token")
        return token if isinstance(token, str) and token else None

    def local_token_hash(self) -> str | None:
        env_token = os.getenv("ACC_LOCAL_RUNNER_TOKEN")
        if env_token:
            return _hash_token(env_token)
        pairing_path = self.runner_root / "pairing.json"
        if not pairing_path.exists():
            return None
        pairing = _load_object(pairing_path)
        token_hash = pairing.get("local_token_hash")
        return token_hash if isinstance(token_hash, str) and token_hash else None

    def _project_node(
        self,
        summary: RunSummary,
        node: Any,
        *,
        local_debug: bool,
    ) -> dict[str, Any]:
        payload = {
            "node_id": node.node_id,
            "callable_id": node.callable_id,
            "session_id": node.session_id,
            "status": node.status,
            "summary": node.summary,
            "artifact_ref": (
                make_node_artifact_ref(summary.run_id, node.node_id, ".")
                if node.artifact_dir
                else None
            ),
            "legacy_artifact_ref": (
                f"run:{summary.run_id}:node:{node.node_id}:artifacts"
                if node.artifact_dir
                else None
            ),
            "event_ref": f"run:{summary.run_id}:node:{node.node_id}:events",
            "stdout_ref": f"run:{summary.run_id}:node:{node.node_id}:stdout",
            "stderr_ref": f"run:{summary.run_id}:node:{node.node_id}:stderr",
        }
        if local_debug:
            payload["debug_path"] = node.run_dir
            payload["debug_artifact_path"] = node.artifact_dir
        return payload

    def _validate_provider_and_permission_requirements(self, graph: dict[str, Any]) -> None:
        registry = CallableRegistry.from_project_root(self.project_root)
        provider_status = self.provider_status()
        for requirement in callable_requirements(graph, registry):
            runtime = requirement["runtime"]
            if provider_status.get(runtime) != "available":
                raise RunnerCapabilityError(
                    "unsupported_provider",
                    f"Runtime provider is unavailable: {runtime}",
                    field="graph",
                    details=public_requirement_details(requirement),
                )
            permission = requirement.get("permission_profile")
            decision = permission_decision(permission)
            if decision["state"] != "allowed":
                write_audit_event(
                    self.project_root,
                    "permission.denied",
                    {
                        "callable_id": requirement.get("callable_id"),
                        "node_id": requirement.get("node_id"),
                        "decision": decision,
                    },
                )
                code = (
                    "permission_requires_local_approval"
                    if decision["state"] == "requires_local_approval"
                    else "permission_denied"
                )
                raise RunnerCapabilityError(
                    code,
                    f"Callable permission is not approved: {requirement['callable_id']}",
                    field="graph",
                    details={**public_requirement_details(requirement), "decision": decision},
                )

    def _workspace_payload(self) -> dict[str, Any]:
        self.ensure_runner_record()
        path = self.runner_root / "workspaces.json"
        payload = _load_object(path)
        aliases = payload.get("aliases")
        if not isinstance(aliases, list):
            raise AccError("Runner workspaces.json aliases must be a list")
        return payload

    def _runner_record_without_side_effects(self) -> dict[str, Any]:
        path = self.runner_root / "runner.json"
        if not path.exists():
            return self.ensure_runner_record()
        return _load_object(path)

    def _ensure_workspaces_file(self, runner_id: str) -> None:
        path = self.runner_root / "workspaces.json"
        if path.exists():
            return
        write_json(
            path,
            {
                "schema_version": RUNNER_WORKSPACES_SCHEMA_VERSION,
                "runner_id": runner_id,
                "aliases": [
                    {
                        "alias": DEFAULT_WORKSPACE_ALIAS,
                        "display_name": "Default workspace",
                        "local_path": str(self.project_root),
                        "allowed": True,
                        "created_at": utc_now_iso(),
                    }
                ],
            },
        )

    def _ensure_pairing_file(self, runner_id: str) -> None:
        path = self.runner_root / "pairing.json"
        if path.exists():
            return
        bootstrap_token = os.getenv("ACC_LOCAL_RUNNER_TOKEN") or secrets.token_urlsafe(32)
        write_json(
            path,
            {
                "schema_version": RUNNER_PAIRING_SCHEMA_VERSION,
                "runner_id": runner_id,
                "state": "unpaired",
                "pairing_endpoint": None,
                "last_seen": utc_now_iso(),
                "token_rotation": {"status": "stable", "rotated_at": None},
                "local_token_hash": _hash_token(bootstrap_token),
            },
        )


def callable_requirements(
    graph: dict[str, Any],
    registry: CallableRegistry,
) -> list[dict[str, Any]]:
    requirements: list[dict[str, Any]] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        ref = node.get("callable_ref")
        if not isinstance(ref, dict):
            continue
        kind = str(ref.get("kind") or "")
        callable_id = str(ref.get("id") or "")
        if kind == "workflow_function" or not callable_id:
            continue
        try:
            asset = registry.resolve_class_id(callable_id)
        except AccError:
            continue
        requirements.append(requirement_from_asset(asset, node=node))
    return requirements


def requirement_from_asset(asset: CallableAsset, *, node: dict[str, Any]) -> dict[str, Any]:
    template = asset.template
    if isinstance(template, AgentClassTemplate):
        runtime = template.runtime
        permission = effective_requirement_permission(template.default_permissions, node)
    elif isinstance(template, ToolClassTemplate):
        runtime = template.runner
        permission = effective_requirement_permission(template.default_permissions, node)
    else:
        runtime = "unknown"
        permission = None
    return {
        "node_id": str(node.get("id") or ""),
        "callable_id": template.id,
        "runtime": runtime,
        "permission_profile": permission,
    }


def effective_requirement_permission(
    default_permissions: PermissionProfile,
    node: dict[str, Any],
) -> PermissionProfile:
    profile = node_permission_profile(node) or default_permissions
    codex_mode = codex_execution_mode_from_node(node)
    if codex_mode is not None:
        return permission_profile_for_codex_execution_mode(codex_mode, profile)
    return profile


def node_permission_profile(node: dict[str, Any]) -> PermissionProfile | None:
    for key in ("invocation_policy", "overrides", "runtime_policy"):
        container = node.get(key)
        if not isinstance(container, dict):
            continue
        profile = permission_profile_from_mapping(container.get("permission_profile"))
        if profile is not None:
            return profile
    return None


def permission_profile_from_mapping(value: Any) -> PermissionProfile | None:
    if not isinstance(value, dict):
        return None
    allowed_env = value.get("allowed_env")
    return PermissionProfile(
        workspace_access=str(value.get("workspace_access") or "read_only"),
        network=bool(value.get("network", False)),
        shell=bool(value.get("shell", False)),
        dangerous=bool(value.get("dangerous", False)),
        env_policy=str(value.get("env_policy") or "acc_whitelist"),
        allowed_env=[str(item) for item in allowed_env] if isinstance(allowed_env, list) else [],
        timeout_seconds=(
            int(value["timeout_seconds"])
            if isinstance(value.get("timeout_seconds"), int)
            else None
        ),
    )


def codex_execution_mode_from_node(node: dict[str, Any]) -> str | None:
    metadata = node.get("metadata")
    values = [
        node.get("codexExecutionMode"),
        node.get("codex_execution_mode"),
        metadata.get(CODEX_EXECUTION_MODE_METADATA_KEY) if isinstance(metadata, dict) else None,
    ]
    for value in values:
        if isinstance(value, str) and value in CODEX_EXECUTION_MODES:
            return value
    return None


def public_requirement_details(requirement: dict[str, Any]) -> dict[str, Any]:
    details = dict(requirement)
    permission = details.get("permission_profile")
    if isinstance(permission, PermissionProfile):
        details["permission_profile"] = asdict(permission)
    return details


def permission_decision(permission: Any) -> dict[str, Any]:
    if not isinstance(permission, PermissionProfile):
        return {"state": "allowed", "reasons": []}
    reasons = permission_reasons(permission)
    if not reasons:
        return {"state": "allowed", "reasons": []}
    mode = security_mode()
    if mode in PRODUCT_SECURITY_MODES:
        if permission.dangerous:
            return {"state": "denied", "reasons": reasons}
        return {"state": "requires_local_approval", "reasons": reasons}
    return {"state": "allowed", "reasons": reasons, "mode": mode}


def runner_permission_policy() -> dict[str, str]:
    if security_mode() in PRODUCT_SECURITY_MODES:
        return {
            "network": "ask",
            "shell": "ask",
            "dangerous": "deny_by_default",
            "workspace_write": "ask",
        }
    return {
        "network": "allow",
        "shell": "allow",
        "dangerous": "allow",
        "workspace_write": "allow",
    }


def permission_reasons(permission: PermissionProfile) -> list[str]:
    reasons: list[str] = []
    if permission.dangerous:
        reasons.append("dangerous")
    if permission.shell:
        reasons.append("shell")
    if permission.network:
        reasons.append("network")
    if permission.workspace_access == "writes_workspace":
        reasons.append("writes_workspace")
    return reasons


def configured_max_active_runs() -> int:
    return _positive_int_env("ACC_WORKBENCH_MAX_ACTIVE_RUNS", 3)


def configured_max_queued_runs() -> int:
    return _positive_int_env("ACC_WORKBENCH_MAX_QUEUED_RUNS", 100)


def local_token_required() -> bool:
    explicit = os.getenv("ACC_LOCAL_RUNNER_REQUIRE_TOKEN", "").strip().lower()
    if explicit in {"1", "true", "yes"}:
        return True
    if explicit in {"0", "false", "no"} and security_mode() not in PRODUCT_SECURITY_MODES:
        return False
    return security_mode() in PRODUCT_SECURITY_MODES or bool(os.getenv("ACC_LOCAL_RUNNER_TOKEN"))


def security_mode() -> str:
    configured = os.getenv("ACC_SECURITY_MODE", "").strip().lower()
    if configured:
        return configured
    if os.getenv("ACC_RUN_MODE", "").strip().lower() in {"hermetic", "test"}:
        return "test"
    return "dev_local"


def validate_local_token(project_root: Path, token: str | None) -> bool:
    if not token:
        return False
    service = LocalRunnerService(project_root)
    expected = service.local_token()
    if expected and secrets.compare_digest(expected, token):
        return True
    expected_hash = service.local_token_hash()
    return bool(expected_hash and secrets.compare_digest(expected_hash, _hash_token(token)))


def validate_alias(value: str) -> str:
    if not value or not value.replace("_", "-").replace(".", "-").isalnum():
        raise RunnerCapabilityError(
            "invalid_workspace_alias",
            f"Invalid workspace alias: {value}",
            field="workspace_alias",
        )
    return value


def validate_job_id(value: str) -> None:
    suffix = value.removeprefix("job_")
    if not value.startswith("job_") or not suffix.replace("-", "").replace("_", "").isalnum():
        raise AccError(f"Invalid job_id: {value}")


def artifact_id_for_project_path(relative_path: str) -> str:
    raw = relative_path.encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_artifact_id(artifact_id: str) -> str:
    padding = "=" * (-len(artifact_id) % 4)
    try:
        return base64.urlsafe_b64decode((artifact_id + padding).encode("ascii")).decode("utf-8")
    except Exception as exc:
        raise RunnerCapabilityError("invalid_artifact_id", "Invalid artifact_id") from exc


def _positive_int_env(name: str, fallback: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return fallback
    try:
        return max(1, int(raw))
    except ValueError:
        return fallback


def _load_object(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"JSON payload must be an object: {path}")
    return payload


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _command_exists(command: str) -> bool:
    from shutil import which

    return which(command) is not None
