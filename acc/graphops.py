"""Unified GraphOps API.

Provides ``GraphOpsService`` as the single entry-point for creating,
validating, dry-running, approving, applying, and rejecting GraphOps
proposals.  Internal operation handlers are registered in
``_OPERATION_HANDLERS`` and dispatched by ``materialize_transaction``.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from acc.app.workbench_adapter import compile_workbench_workflow_bundle
from acc.audit import write_audit_event
from acc.callable_registry import CallableRegistry
from acc.control_plane import agent_payload_to_yaml, reject_secret_like_path, validate_callable_id
from acc.engine import parse_workflow_function_template
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.models import AccError, AgentClassTemplate
from acc.session import utc_now_iso
from acc.store import load_json, write_json

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GRAPHOPS_TRANSACTION_SCHEMA_VERSION = "acc.graphops.transaction.v1"
GRAPHOPS_PROPOSAL_ROOT = Path("runs") / "_graphops_proposals"
GRAPHOPS_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")

CREATE_OPERATIONS = {
    "create_agent_class",
    "create_tool_class",
    "create_workflow",
}
CREATE_OPERATION_BY_TARGET_TYPE = {
    "agent_class": "create_agent_class",
    "tool_class": "create_tool_class",
    "workflow": "create_workflow",
}
TRANSACTION_KEYS = {
    "schema_version",
    "proposal_id",
    "author",
    "source",
    "base",
    "rationale",
    "targets",
}
SOURCE_KEYS = {"kind", "id"}
BASE_KEYS = {"content_hashes"}
TARGET_KEYS = {"target_type", "target_path", "operation", "template"}
TERMINAL_STATUSES = {
    "applied",
    "rejected",
    "cancelled",
    "validation_failed",
    "dry_run_failed",
    "stale_base",
    "apply_failed",
}

# ---------------------------------------------------------------------------
# Private utility helpers (formerly public in old graphops.py)
# ---------------------------------------------------------------------------


def _validate_relative_path(value: str) -> str | None:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        return f"GraphOps path escapes repository: {value}"
    return None


def _contains_value(value: Any, needle: str) -> bool:
    if isinstance(value, str):
        return value == needle
    if isinstance(value, dict):
        return any(_contains_value(child, needle) for child in value.values())
    if isinstance(value, list):
        return any(_contains_value(child, needle) for child in value)
    return False


def _contains_policy_value(value: Any, key: str, expected: Any) -> bool:
    if isinstance(value, dict):
        if value.get(key) == expected:
            return True
        return any(_contains_policy_value(child, key, expected) for child in value.values())
    if isinstance(value, list):
        return any(_contains_policy_value(child, key, expected) for child in value)
    return False


# ---------------------------------------------------------------------------
# Materialization context type (plain dict)
# ---------------------------------------------------------------------------

# MaterializationContext keys:
#   project_root: Path
#   staging_dir: Path
#   registry: CallableRegistry
#   workflow_ids: set[str]

# OperationHandler signature:
#   (rel_path: str, template: dict, ctx: dict) -> dict with keys kind, content, payload
OperationHandler = Callable[..., dict[str, Any]]

# ---------------------------------------------------------------------------
# Operation handlers
# ---------------------------------------------------------------------------


def _handle_create_agent_class(
    rel_path: str,
    template: dict[str, Any],
    ctx: dict[str, Any],
) -> dict[str, Any]:
    _ = ctx
    callable_id = str(template.get("id") or Path(rel_path).name.removesuffix(".yaml"))
    validate_callable_id(callable_id)
    if Path(rel_path).name != f"{callable_id}.yaml":
        raise AccError("Agent callable id must match target file name")
    payload = {**template, "id": callable_id}
    content = yaml.safe_dump(agent_payload_to_yaml(payload), sort_keys=False, allow_unicode=True)
    return {"kind": "agent_class", "content": content, "payload": template}


def _handle_create_tool_class(
    rel_path: str,
    template: dict[str, Any],
    ctx: dict[str, Any],
) -> dict[str, Any]:
    _ = ctx
    callable_id = str(template.get("id") or Path(rel_path).name.removesuffix(".yaml"))
    validate_callable_id(callable_id)
    if Path(rel_path).name != f"{callable_id}.yaml":
        raise AccError("Tool callable id must match target file name")
    runner = str(template.get("runner") or "")
    if not runner:
        raise AccError("Tool callable requires runner")
    payload: dict[str, Any] = {
        "id": callable_id,
        "version": str(template.get("version") or "0.1.0"),
        "runner": runner,
    }
    for key in (
        "default_permissions",
        "input_ports",
        "output_ports",
        "artifact_contract",
        "metadata",
    ):
        if key in template:
            payload[key] = template[key]
    content = yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
    return {"kind": "tool_class", "content": content, "payload": payload}


def _handle_create_workflow(
    rel_path: str,
    template: dict[str, Any],
    ctx: dict[str, Any],
) -> dict[str, Any]:
    project_root: Path = ctx["project_root"]
    registry: CallableRegistry = ctx["registry"]
    workflow_ids: set[str] = ctx["workflow_ids"]

    bundle = compile_workbench_workflow_bundle(
        template,
        source_path=project_root / rel_path,
        callable_registry=registry,
    )
    _validate_workflow_refs(bundle.root, registry=registry, workflow_ids=workflow_ids)
    content = json.dumps(bundle.root, ensure_ascii=False, indent=2, sort_keys=True)
    return {"kind": "workflow", "content": content, "payload": bundle.root}


# Handler registry
_OPERATION_HANDLERS: dict[str, OperationHandler] = {
    "create_agent_class": _handle_create_agent_class,
    "create_tool_class": _handle_create_tool_class,
    "create_workflow": _handle_create_workflow,
}

# ---------------------------------------------------------------------------
# GraphOpsService
# ---------------------------------------------------------------------------


class GraphOpsService:
    """Unified GraphOps proposal service.

    Replaces the former ``GraphOpsProposalService`` from
    ``acc.app.graphops_v3`` and the legacy patch API from the old
    ``acc.graphops``.
    """

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.root = self.project_root / GRAPHOPS_PROPOSAL_ROOT

    def create_proposal(self, proposal: dict[str, Any]) -> dict[str, Any]:
        proposal_id = validate_proposal_id(str(proposal.get("proposal_id") or ""))
        errors = validate_transaction(self.project_root, proposal)
        if errors:
            raise AccError(format_validation_errors(errors))
        proposal_dir = self._proposal_dir(proposal_id)
        if proposal_dir.exists():
            raise AccError(f"GraphOps proposal already exists: {proposal_id}")
        proposal_dir.mkdir(parents=True)
        envelope = {
            "proposal_id": proposal_id,
            "status": "drafted",
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "proposal": copy.deepcopy(proposal),
        }
        write_json(proposal_dir / "proposal.json", envelope)
        return self.get_proposal(proposal_id)

    def list_proposals(self) -> dict[str, Any]:
        proposals = []
        if self.root.exists():
            for path in sorted(self.root.glob("*/proposal.json")):
                try:
                    proposals.append(load_json(path))
                except AccError:
                    continue
        return {"proposals": proposals}

    def get_proposal(self, proposal_id: str) -> dict[str, Any]:
        proposal_dir = self._proposal_dir(validate_proposal_id(proposal_id))
        envelope_path = proposal_dir / "proposal.json"
        if not envelope_path.exists():
            raise AccError(f"GraphOps proposal not found: {proposal_id}")
        payload = load_json(envelope_path)
        for key, filename in (
            ("validation", "validation.json"),
            ("dry_run", "dry_run.json"),
            ("approval", "approval.json"),
            ("apply_manifest", "apply_manifest.json"),
            ("apply_error", "apply_error.json"),
            ("stale_base", "stale_base.json"),
            ("semantic_diff", "semantic_diff.json"),
        ):
            evidence_path = proposal_dir / filename
            if evidence_path.exists():
                payload[key] = load_json(evidence_path)
        return payload

    def validate(self, proposal_id: str) -> dict[str, Any]:
        envelope = self._load_envelope(proposal_id)
        errors = validate_transaction(self.project_root, envelope["proposal"])
        status = "valid" if not errors else "invalid"
        validation = {
            "status": status,
            "errors": errors,
            "warnings": [],
            "validated_at": utc_now_iso(),
        }
        self._write_evidence(proposal_id, "validation.json", validation)
        self._set_status(proposal_id, "validated" if status == "valid" else "validation_failed")
        return validation

    def dry_run(self, proposal_id: str) -> dict[str, Any]:
        validation = self.validate(proposal_id)
        if validation["status"] != "valid":
            raise AccError("GraphOps proposal validation failed")
        envelope = self._load_envelope(proposal_id)
        proposal = envelope["proposal"]
        staging_dir = self._proposal_dir(proposal_id) / "dry_run_staging"
        shutil.rmtree(staging_dir, ignore_errors=True)
        staging_dir.mkdir(parents=True)
        try:
            materialized = materialize_transaction(self.project_root, proposal, staging_dir)
            semantic_diff = semantic_diff_for_materialized(materialized)
            dry_run = {
                "status": "dry_run_ready",
                "proposal_id": proposal_id,
                "mutated": False,
                "target_paths": sorted(materialized["targets"]),
                "semantic_diff": semantic_diff,
                "dry_run_digest": digest_payload(
                    {"proposal": proposal, "semantic_diff": semantic_diff}
                ),
                "created_at": utc_now_iso(),
            }
            self._write_evidence(proposal_id, "semantic_diff.json", semantic_diff)
            self._write_evidence(proposal_id, "dry_run.json", dry_run)
            self._set_status(proposal_id, "awaiting_human_approval")
            return dry_run
        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)

    def approve(self, proposal_id: str, approval: dict[str, Any]) -> dict[str, Any]:
        envelope = self._load_envelope(proposal_id)
        if envelope["status"] in TERMINAL_STATUSES:
            raise AccError(f"Cannot approve terminal proposal: {envelope['status']}")
        if envelope["status"] != "awaiting_human_approval":
            raise AccError("GraphOps proposal must pass dry-run before approval")
        if approval.get("proposal_id") != proposal_id:
            raise AccError("Approval proposal_id does not match")
        dry_run = self._read_evidence(proposal_id, "dry_run.json")
        expected_paths = set(dry_run.get("target_paths") or [])
        if set(approval.get("target_paths") or []) != expected_paths:
            raise AccError("Approval target_paths do not match dry-run")
        if approval.get("dry_run_digest") != dry_run.get("dry_run_digest"):
            raise AccError("Approval dry_run_digest does not match latest dry-run")
        expected_hashes = base_hashes_for_targets(envelope["proposal"])
        if approval.get("base_hashes") != expected_hashes:
            raise AccError("Approval base_hashes do not match proposal")
        approved = {
            "status": "approved",
            "proposal_id": proposal_id,
            "approval_nonce": f"approval_{uuid4().hex[:16]}",
            "runner_id": local_runner_id(self.project_root),
            "workspace_binding_fingerprint": workspace_binding_fingerprint(self.project_root),
            "approver": str(approval.get("approver") or "human"),
            "target_paths": sorted(expected_paths),
            "base_hashes": expected_hashes,
            "dry_run_digest": dry_run["dry_run_digest"],
            "approved_at": utc_now_iso(),
        }
        self._write_evidence(proposal_id, "approval.json", approved)
        self._set_status(proposal_id, "approved")
        write_audit_event(
            self.project_root,
            "graphops.approve",
            {
                "proposal_id": proposal_id,
                "runner_id": approved["runner_id"],
                "target_paths": approved["target_paths"],
                "dry_run_digest": approved["dry_run_digest"],
            },
        )
        return approved

    def apply(self, proposal_id: str) -> dict[str, Any]:
        envelope = self._load_envelope(proposal_id)
        if envelope["status"] != "approved":
            raise AccError("GraphOps proposal must be approved before apply")
        approval = self._read_evidence(proposal_id, "approval.json")
        self._validate_apply_approval(proposal_id, envelope["proposal"], approval)
        stale_errors = stale_base_errors(self.project_root, envelope["proposal"])
        if stale_errors:
            self._write_evidence(
                proposal_id,
                "stale_base.json",
                {
                    "status": "stale_base",
                    "proposal_id": proposal_id,
                    "errors": stale_errors,
                    "detected_at": utc_now_iso(),
                },
            )
            self._set_status(proposal_id, "stale_base")
            raise AccError(stale_errors[0]["message"])
        staging_dir = self._proposal_dir(proposal_id) / "apply_staging"
        shutil.rmtree(staging_dir, ignore_errors=True)
        staging_dir.mkdir(parents=True)
        created_paths: list[Path] = []
        pending_writes: list[tuple[Path, Path]] = []
        self._set_status(proposal_id, "applying")
        try:
            materialized = materialize_transaction(
                self.project_root,
                envelope["proposal"],
                staging_dir,
            )
            before_audit = before_apply_audit(self.project_root, envelope["proposal"])
            for rel_path, target in materialized["targets"].items():
                destination = (self.project_root / rel_path).resolve()
                if destination.exists():
                    raise AccError(f"GraphOps target already exists: {rel_path}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                temp_path = destination.with_name(f"{destination.name}.{uuid4().hex}.tmp")
                temp_path.write_text(target["content"], encoding="utf-8")
                pending_writes.append((temp_path, destination))
            for temp_path, destination in pending_writes:
                temp_path.replace(destination)
                created_paths.append(destination)
            manifest = {
                "status": "applied",
                "proposal_id": proposal_id,
                "created_files": [
                    _relative_project_path(self.project_root, path) for path in created_paths
                ],
                "approval": approval,
                "targets": _apply_target_manifests(
                    self.project_root,
                    envelope["proposal"],
                    materialized,
                    created_paths,
                ),
                "audit": {
                    "before": before_audit,
                    "after": after_apply_audit(self.project_root, envelope["proposal"]),
                },
                "semantic_diff": semantic_diff_for_materialized(materialized),
                "applied_at": utc_now_iso(),
            }
            self._write_evidence(proposal_id, "apply_manifest.json", manifest)
            self._set_status(proposal_id, "applied")
            write_audit_event(
                self.project_root,
                "graphops.apply",
                {
                    "proposal_id": proposal_id,
                    "runner_id": approval.get("runner_id"),
                    "target_paths": approval.get("target_paths"),
                    "status": "applied",
                },
            )
            return manifest
        except Exception as exc:
            for temp_path, _destination in pending_writes:
                temp_path.unlink(missing_ok=True)
            for created_path in created_paths:
                created_path.unlink(missing_ok=True)
            self._write_evidence(
                proposal_id,
                "apply_error.json",
                {
                    "status": "apply_failed",
                    "proposal_id": proposal_id,
                    "error": str(exc),
                    "created_files_removed": [
                        _relative_project_path(self.project_root, path)
                        for path in created_paths
                    ],
                    "failed_at": utc_now_iso(),
                },
            )
            self._set_status(proposal_id, "apply_failed")
            write_audit_event(
                self.project_root,
                "graphops.apply",
                {"proposal_id": proposal_id, "status": "apply_failed", "error": str(exc)},
            )
            raise AccError(str(exc)) from exc
        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)

    def reject(self, proposal_id: str, reason: str | None = None) -> dict[str, Any]:
        envelope = self._load_envelope(proposal_id)
        if envelope["status"] in {"applied", "rejected", "cancelled"}:
            raise AccError(f"Cannot reject terminal proposal: {envelope['status']}")
        rejection = {
            "status": "rejected",
            "proposal_id": proposal_id,
            "reason": reason or "",
            "rejected_at": utc_now_iso(),
        }
        self._write_evidence(proposal_id, "rejection.json", rejection)
        self._set_status(proposal_id, "rejected")
        return rejection

    # -- internal helpers ---------------------------------------------------

    def _proposal_dir(self, proposal_id: str) -> Path:
        return (self.root / proposal_id).resolve()

    def _load_envelope(self, proposal_id: str) -> dict[str, Any]:
        return self.get_proposal(proposal_id)

    def _write_evidence(self, proposal_id: str, filename: str, payload: dict[str, Any]) -> None:
        proposal_dir = self._proposal_dir(validate_proposal_id(proposal_id))
        proposal_dir.mkdir(parents=True, exist_ok=True)
        write_json(proposal_dir / filename, payload)

    def _read_evidence(self, proposal_id: str, filename: str) -> dict[str, Any]:
        path = self._proposal_dir(validate_proposal_id(proposal_id)) / filename
        if not path.exists():
            raise AccError(f"GraphOps proposal evidence missing: {filename}")
        return load_json(path)

    def _set_status(self, proposal_id: str, status: str) -> None:
        path = self._proposal_dir(validate_proposal_id(proposal_id)) / "proposal.json"
        envelope = load_json(path)
        envelope["status"] = status
        envelope["updated_at"] = utc_now_iso()
        write_json(path, envelope)

    def _validate_apply_approval(
        self,
        proposal_id: str,
        proposal: dict[str, Any],
        approval: dict[str, Any],
    ) -> None:
        if approval.get("proposal_id") != proposal_id:
            raise AccError("Approval proposal_id does not match")
        if not approval.get("approval_nonce"):
            raise AccError("GraphOps approval nonce is missing")
        if approval.get("runner_id") != local_runner_id(self.project_root):
            raise AccError("GraphOps approval runner_id does not match local runner")
        if approval.get("workspace_binding_fingerprint") != workspace_binding_fingerprint(
            self.project_root
        ):
            raise AccError("GraphOps approval workspace binding fingerprint is stale")
        dry_run = self._read_evidence(proposal_id, "dry_run.json")
        if approval.get("dry_run_digest") != dry_run.get("dry_run_digest"):
            raise AccError("GraphOps approval dry_run_digest does not match latest dry-run")
        if approval.get("base_hashes") != base_hashes_for_targets(proposal):
            raise AccError("GraphOps approval base_hashes do not match proposal")


# ---------------------------------------------------------------------------
# Transaction validation
# ---------------------------------------------------------------------------


def validate_transaction(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(proposal, dict):
        return [
            {"code": "transaction_invalid", "message": "GraphOps transaction must be an object"}
        ]
    errors.extend(_unexpected_keys("transaction", proposal, TRANSACTION_KEYS))
    if proposal.get("schema_version") != GRAPHOPS_TRANSACTION_SCHEMA_VERSION:
        errors.append(
            {
                "code": "schema_version_invalid",
                "message": "GraphOps transaction schema_version is invalid",
            }
        )
    try:
        validate_proposal_id(str(proposal.get("proposal_id") or ""))
    except AccError as exc:
        errors.append({"code": "proposal_id_invalid", "message": str(exc)})
    source = proposal.get("source")
    if source is not None:
        if not isinstance(source, dict):
            errors.append(
                {"code": "source_invalid", "message": "GraphOps source must be an object"}
            )
        else:
            errors.extend(_unexpected_keys("source", source, SOURCE_KEYS))
            if not source.get("kind") or not source.get("id"):
                errors.append(
                    {"code": "source_invalid", "message": "GraphOps source requires kind and id"}
                )
    base = proposal.get("base")
    if not isinstance(base, dict):
        errors.append({"code": "base_invalid", "message": "GraphOps base must be an object"})
    else:
        errors.extend(_unexpected_keys("base", base, BASE_KEYS))
    targets = proposal.get("targets")
    if not isinstance(targets, list) or not targets:
        errors.append(
            {
                "code": "targets_missing",
                "message": "GraphOps transaction targets are required",
            }
        )
        return errors
    seen_paths: set[str] = set()
    for target in targets:
        if not isinstance(target, dict):
            errors.append(
                {"code": "target_invalid", "message": "GraphOps target must be an object"}
            )
            continue
        errors.extend(_validate_target(project_root, proposal, target, seen_paths))
    if isinstance(base, dict):
        base_hashes = base.get("content_hashes")
        if isinstance(base_hashes, dict):
            target_paths = {
                str(target.get("target_path") or "")
                for target in targets
                if isinstance(target, dict)
            }
            for path in sorted(set(base_hashes) - target_paths):
                errors.append(
                    {
                        "code": "base_hash_extra",
                        "message": f"GraphOps base hash is not declared as a target: {path}",
                    }
                )
    if not errors:
        errors.extend(_validate_materialized_transaction(project_root, proposal))
    return errors


def _validate_target(
    project_root: Path,
    proposal: dict[str, Any],
    target: dict[str, Any],
    seen_paths: set[str],
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    target_type = str(target.get("target_type") or "")
    operation = str(target.get("operation") or "")
    target_path = str(target.get("target_path") or "")
    errors.extend(_unexpected_keys("target", target, TARGET_KEYS))
    if operation not in CREATE_OPERATIONS:
        errors.append(
            {
                "code": "operation_forbidden",
                "message": f"Unsupported GraphOps v3 operation: {operation}",
            }
        )
    expected_operation = CREATE_OPERATION_BY_TARGET_TYPE.get(target_type)
    if expected_operation is None:
        errors.append(
            {
                "code": "target_type_invalid",
                "message": f"Unsupported GraphOps target_type: {target_type}",
            }
        )
    elif operation != expected_operation:
        errors.append(
            {
                "code": "operation_target_mismatch",
                "message": f"{target_type} targets require operation {expected_operation}",
            }
        )
    if target_path in seen_paths:
        errors.append(
            {"code": "duplicate_target", "message": f"Duplicate target path: {target_path}"}
        )
    seen_paths.add(target_path)
    if _contains_value(target, "danger-full-access"):
        errors.append(
            {"code": "permission_forbidden", "message": "danger-full-access is forbidden"}
        )
    for key in ("network", "write_files", "dangerous"):
        if _contains_policy_value(target, key, True):
            errors.append(
                {"code": "permission_forbidden", "message": f"{key}=true is forbidden"}
            )
    path_error = _validate_relative_path(target_path)
    if path_error is not None:
        errors.append({"code": "path_escape", "message": path_error})
        resolved = None
    else:
        try:
            resolved = resolve_target_path(project_root, target_type, target_path)
            reject_secret_like_path(resolved)
        except AccError as exc:
            errors.append({"code": "target_path_invalid", "message": str(exc)})
            resolved = None
    if resolved is not None and resolved.exists():
        errors.append(
            {
                "code": "stale_base",
                "message": f"GraphOps create target already exists: {target_path}",
            }
        )
    base_hashes = proposal.get("base", {}).get("content_hashes", {})
    if not isinstance(base_hashes, dict) or base_hashes.get(target_path) != "absent":
        errors.append(
            {
                "code": "base_hash_invalid",
                "message": f"GraphOps create target base hash must be absent: {target_path}",
            }
        )
    template = target.get("template")
    if not isinstance(template, dict):
        errors.append(
            {
                "code": "template_invalid",
                "message": "GraphOps target template must be an object",
            }
        )
    return errors


def _validate_materialized_transaction(
    project_root: Path,
    proposal: dict[str, Any],
) -> list[dict[str, str]]:
    staging_dir = project_root / GRAPHOPS_PROPOSAL_ROOT / ".validation" / uuid4().hex
    staging_dir.mkdir(parents=True, exist_ok=True)
    try:
        materialize_transaction(project_root, proposal, staging_dir)
    except AccError as exc:
        return [{"code": "semantic_invalid", "message": str(exc)}]
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)
    return []


# ---------------------------------------------------------------------------
# Materialization
# ---------------------------------------------------------------------------


def materialize_transaction(
    project_root: Path,
    proposal: dict[str, Any],
    staging_dir: Path,
) -> dict[str, Any]:
    targets: dict[str, dict[str, Any]] = {}
    callable_targets = [
        target
        for target in proposal["targets"]
        if target.get("target_type") in {"agent_class", "tool_class"}
    ]
    _write_callable_overlay(project_root, callable_targets, staging_dir)
    registry = _overlay_callable_registry(project_root, staging_dir)
    workflow_ids = _known_workflow_ids(project_root) | {
        str(target.get("template", {}).get("id") or Path(str(target["target_path"])).stem)
        for target in proposal["targets"]
        if target.get("target_type") == "workflow"
    }
    ctx: dict[str, Any] = {
        "project_root": project_root,
        "staging_dir": staging_dir,
        "registry": registry,
        "workflow_ids": workflow_ids,
    }
    for target in proposal["targets"]:
        rel_path = str(target["target_path"])
        operation = str(target["operation"])
        template = copy.deepcopy(target["template"])
        handler = _OPERATION_HANDLERS.get(operation)
        if handler is None:
            raise AccError(f"Unsupported GraphOps operation: {operation}")
        targets[rel_path] = handler(rel_path, template, ctx)
    return {"targets": targets}


# ---------------------------------------------------------------------------
# Internal helpers for materialization
# ---------------------------------------------------------------------------


def _write_callable_overlay(
    project_root: Path,
    targets: list[dict[str, Any]],
    staging_dir: Path,
) -> None:
    _ = project_root
    for target in targets:
        target_type = str(target["target_type"])
        target_path = str(target["target_path"])
        template = copy.deepcopy(target["template"])
        handler = _OPERATION_HANDLERS.get(
            CREATE_OPERATION_BY_TARGET_TYPE.get(target_type, "")
        )
        if handler is None:
            continue
        result = handler(target_path, template, {})
        overlay_path = staging_dir / target_path
        overlay_path.parent.mkdir(parents=True, exist_ok=True)
        overlay_path.write_text(result["content"], encoding="utf-8")


def _overlay_callable_registry(project_root: Path, staging_dir: Path) -> CallableRegistry:
    existing = {
        (
            "agent_class" if isinstance(asset.template, AgentClassTemplate) else "tool_class",
            asset.template.id,
        ): asset
        for asset in CallableRegistry.from_project_root(project_root).iter_assets()
    }
    overlay = {
        (
            "agent_class" if isinstance(asset.template, AgentClassTemplate) else "tool_class",
            asset.template.id,
        ): asset
        for asset in CallableRegistry.from_project_root(staging_dir).iter_assets()
    }
    existing.update(overlay)
    return CallableRegistry(existing)


def _validate_workflow_refs(
    payload: dict[str, Any],
    *,
    registry: CallableRegistry,
    workflow_ids: set[str],
) -> None:
    template = parse_workflow_function_template(payload)
    issues = [
        issue
        for issue in collect_callable_validation_issues(
            template,
            known_callable_refs=registry.ref_keys(),
            known_workflow_ids=workflow_ids,
        )
        if issue.severity == "error"
    ]
    if issues:
        details = "; ".join(f"{issue.code}: {issue.message}" for issue in issues)
        raise AccError(details)


def _known_workflow_ids(project_root: Path) -> set[str]:
    ids: set[str] = set()
    workflows_dir = project_root / "workflows"
    if not workflows_dir.exists():
        return ids
    for path in workflows_dir.glob("*.accflow.json"):
        try:
            payload = load_json(path)
        except AccError:
            continue
        ids.add(path.name)
        ids.add(path.name.removesuffix(".accflow.json"))
        if isinstance(payload, dict) and payload.get("id"):
            ids.add(str(payload["id"]))
    return ids


# ---------------------------------------------------------------------------
# Semantic diff
# ---------------------------------------------------------------------------


def semantic_diff_for_materialized(materialized: dict[str, Any]) -> dict[str, Any]:
    created_files = sorted(materialized["targets"])
    created_callable_ids: list[str] = []
    created_workflow_ids: list[str] = []
    workflow_node_refs: dict[str, list[dict[str, str]]] = {}
    for rel_path, target in materialized["targets"].items():
        payload = target["payload"]
        if target["kind"] in {"agent_class", "tool_class"}:
            created_callable_ids.append(str(payload.get("id") or Path(rel_path).stem))
        if target["kind"] == "workflow":
            workflow_id = str(
                payload.get("id") or Path(rel_path).name.removesuffix(".accflow.json")
            )
            created_workflow_ids.append(workflow_id)
            workflow_node_refs[workflow_id] = [
                {
                    "node_id": str(node.get("id") or ""),
                    "kind": str((node.get("callable_ref") or {}).get("kind") or ""),
                    "id": str((node.get("callable_ref") or {}).get("id") or ""),
                }
                for node in payload.get("nodes", [])
                if isinstance(node, dict)
            ]
    return {
        "status": "valid",
        "created_files": created_files,
        "created_callable_ids": sorted(created_callable_ids),
        "created_workflow_ids": sorted(created_workflow_ids),
        "workflow_node_refs": workflow_node_refs,
        "warnings": [],
        "validation_errors": [],
    }


# ---------------------------------------------------------------------------
# Miscellaneous helpers
# ---------------------------------------------------------------------------


def _apply_target_manifests(
    project_root: Path,
    proposal: dict[str, Any],
    materialized: dict[str, Any],
    created_paths: list[Path],
) -> list[dict[str, Any]]:
    created_by_rel_path = {
        _relative_project_path(project_root, path): path for path in created_paths
    }
    targets_by_path = {
        str(target["target_path"]): target
        for target in proposal.get("targets", [])
        if isinstance(target, dict)
    }
    manifests: list[dict[str, Any]] = []
    for rel_path, target in materialized["targets"].items():
        created_path = created_by_rel_path.get(rel_path)
        content = str(target["content"])
        declared_target = targets_by_path.get(rel_path, {})
        manifests.append(
            {
                "target_path": rel_path,
                "target_type": str(declared_target.get("target_type") or target["kind"]),
                "operation": str(declared_target.get("operation") or ""),
                "base_hash": "absent",
                "created_hash": _digest_text(content),
                "bytes": len(content.encode("utf-8")),
                "written": created_path is not None and created_path.exists(),
            }
        )
    return manifests


def resolve_target_path(project_root: Path, target_type: str, target_path: str) -> Path:
    path = (project_root / target_path).resolve()
    if target_type == "agent_class":
        root = (project_root / "callables" / "agents").resolve()
        if path.suffix != ".yaml" or not path.is_relative_to(root):
            raise AccError("Agent class target must be callables/agents/*.yaml")
        return path
    if target_type == "tool_class":
        root = (project_root / "callables" / "tools").resolve()
        if path.suffix != ".yaml" or not path.is_relative_to(root):
            raise AccError("Tool class target must be callables/tools/*.yaml")
        return path
    if target_type == "workflow":
        root = (project_root / "workflows").resolve()
        if not target_path.endswith(".accflow.json") or not path.is_relative_to(root):
            raise AccError("Workflow target must be workflows/*.accflow.json")
        return path
    raise AccError(f"Unsupported GraphOps target_type: {target_type}")


def stale_base_errors(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, str]]:
    errors = []
    for target in proposal["targets"]:
        rel_path = str(target["target_path"])
        path = resolve_target_path(project_root, str(target["target_type"]), rel_path)
        if path.exists():
            errors.append(
                {
                    "code": "stale_base",
                    "message": f"GraphOps create target already exists: {rel_path}",
                }
            )
    return errors


def base_hashes_for_targets(proposal: dict[str, Any]) -> dict[str, str]:
    return {
        str(target["target_path"]): "absent"
        for target in proposal.get("targets", [])
        if isinstance(target, dict)
    }


def before_apply_audit(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, Any]]:
    return apply_audit_for_targets(project_root, proposal)


def after_apply_audit(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, Any]]:
    return apply_audit_for_targets(project_root, proposal)


def apply_audit_for_targets(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for target in proposal.get("targets", []):
        if not isinstance(target, dict):
            continue
        rel_path = str(target.get("target_path") or "")
        path = project_root / rel_path
        rows.append(
            {
                "target_path": rel_path,
                "exists": path.exists(),
                "digest": digest_file(path) if path.exists() and path.is_file() else "absent",
            }
        )
    return rows


def local_runner_id(project_root: Path) -> str:
    from acc.runner import LocalRunnerService

    return str(LocalRunnerService(project_root).ensure_runner_record()["runner_id"])


def workspace_binding_fingerprint(project_root: Path) -> str:
    path = project_root / ".acc" / "runner" / "workspaces.json"
    if not path.exists():
        return digest_payload({"workspaces": "absent"})
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return digest_payload({"workspaces": "invalid"})
    aliases = []
    for item in payload.get("aliases", []) if isinstance(payload, dict) else []:
        if not isinstance(item, dict):
            continue
        aliases.append(
            {
                "alias": item.get("alias"),
                "allowed": item.get("allowed"),
                "local_path_digest": _digest_text(str(item.get("local_path") or "")),
            }
        )
    return digest_payload({"aliases": sorted(aliases, key=lambda row: str(row.get("alias")))})


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def validate_proposal_id(value: str) -> str:
    if not value or not GRAPHOPS_SAFE_ID_RE.fullmatch(value):
        raise AccError("GraphOps proposal_id must match ^[A-Za-z0-9_.-]+$")
    return value


def _unexpected_keys(
    scope: str,
    payload: dict[str, Any],
    allowed: set[str],
) -> list[dict[str, str]]:
    return [
        {
            "code": "unexpected_field",
            "message": f"Unexpected GraphOps {scope} field: {key}",
        }
        for key in sorted(set(payload) - allowed)
    ]


def format_validation_errors(errors: list[dict[str, str]]) -> str:
    details = "; ".join(f"{error['code']}: {error['message']}" for error in errors)
    return f"GraphOps proposal invalid: {details}"


def digest_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _digest_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _relative_project_path(project_root: Path, path: Path) -> str:
    return str(path.resolve().relative_to(project_root.resolve())).replace("\\", "/")
