from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from acc.app.workbench_adapter import compile_workbench_workflow_bundle
from acc.callable_registry import CallableRegistry
from acc.control_plane import agent_payload_to_yaml, reject_secret_like_path, validate_callable_id
from acc.models import AccError, AgentClassTemplate
from acc.engine import parse_workflow_function_template
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.graphops import contains_policy_value, contains_value, validate_relative_path
from acc.session import utc_now_iso
from acc.store import load_json, write_json

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


class GraphOpsProposalService:
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
            "approver": str(approval.get("approver") or "human"),
            "target_paths": sorted(expected_paths),
            "base_hashes": expected_hashes,
            "dry_run_digest": dry_run["dry_run_digest"],
            "approved_at": utc_now_iso(),
        }
        self._write_evidence(proposal_id, "approval.json", approved)
        self._set_status(proposal_id, "approved")
        return approved

    def apply(self, proposal_id: str) -> dict[str, Any]:
        envelope = self._load_envelope(proposal_id)
        if envelope["status"] != "approved":
            raise AccError("GraphOps proposal must be approved before apply")
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
                    relative_project_path(self.project_root, path) for path in created_paths
                ],
                "approval": self._read_evidence(proposal_id, "approval.json"),
                "targets": apply_target_manifests(
                    self.project_root,
                    envelope["proposal"],
                    materialized,
                    created_paths,
                ),
                "semantic_diff": semantic_diff_for_materialized(materialized),
                "applied_at": utc_now_iso(),
            }
            self._write_evidence(proposal_id, "apply_manifest.json", manifest)
            self._set_status(proposal_id, "applied")
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
                        relative_project_path(self.project_root, path)
                        for path in created_paths
                    ],
                    "failed_at": utc_now_iso(),
                },
            )
            self._set_status(proposal_id, "apply_failed")
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


def validate_transaction(project_root: Path, proposal: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(proposal, dict):
        return [
            {"code": "transaction_invalid", "message": "GraphOps transaction must be an object"}
        ]
    errors.extend(unexpected_keys("transaction", proposal, TRANSACTION_KEYS))
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
            errors.extend(unexpected_keys("source", source, SOURCE_KEYS))
            if not source.get("kind") or not source.get("id"):
                errors.append(
                    {"code": "source_invalid", "message": "GraphOps source requires kind and id"}
                )
    base = proposal.get("base")
    if not isinstance(base, dict):
        errors.append({"code": "base_invalid", "message": "GraphOps base must be an object"})
    else:
        errors.extend(unexpected_keys("base", base, BASE_KEYS))
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
        errors.extend(validate_target(project_root, proposal, target, seen_paths))
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
        errors.extend(validate_materialized_transaction(project_root, proposal))
    return errors


def validate_target(
    project_root: Path,
    proposal: dict[str, Any],
    target: dict[str, Any],
    seen_paths: set[str],
) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    target_type = str(target.get("target_type") or "")
    operation = str(target.get("operation") or "")
    target_path = str(target.get("target_path") or "")
    errors.extend(unexpected_keys("target", target, TARGET_KEYS))
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
    if contains_value(target, "danger-full-access"):
        errors.append(
            {"code": "permission_forbidden", "message": "danger-full-access is forbidden"}
        )
    for key in ("network", "write_files", "dangerous"):
        if contains_policy_value(target, key, True):
            errors.append(
                {"code": "permission_forbidden", "message": f"{key}=true is forbidden"}
            )
    path_error = validate_relative_path(target_path)
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


def validate_materialized_transaction(
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
    write_callable_overlay(project_root, callable_targets, staging_dir)
    registry = overlay_callable_registry(project_root, staging_dir)
    workflow_ids = known_workflow_ids(project_root) | {
        str(target.get("template", {}).get("id") or Path(str(target["target_path"])).stem)
        for target in proposal["targets"]
        if target.get("target_type") == "workflow"
    }
    for target in proposal["targets"]:
        rel_path = str(target["target_path"])
        target_type = str(target["target_type"])
        template = copy.deepcopy(target["template"])
        if target_type == "agent_class":
            content = render_agent_yaml(rel_path, template)
            targets[rel_path] = {"kind": target_type, "content": content, "payload": template}
        elif target_type == "tool_class":
            content = render_tool_yaml(rel_path, template)
            targets[rel_path] = {"kind": target_type, "content": content, "payload": template}
        elif target_type == "workflow":
            bundle = compile_workbench_workflow_bundle(
                template,
                source_path=project_root / rel_path,
                callable_registry=registry,
            )
            validate_workflow_refs(bundle.root, registry=registry, workflow_ids=workflow_ids)
            content = json.dumps(bundle.root, ensure_ascii=False, indent=2, sort_keys=True)
            targets[rel_path] = {"kind": target_type, "content": content, "payload": bundle.root}
        else:
            raise AccError(f"Unsupported GraphOps target_type: {target_type}")
    return {"targets": targets}


def write_callable_overlay(
    project_root: Path,
    targets: list[dict[str, Any]],
    staging_dir: Path,
) -> None:
    _ = project_root
    for target in targets:
        target_type = str(target["target_type"])
        target_path = str(target["target_path"])
        content = (
            render_agent_yaml(target_path, copy.deepcopy(target["template"]))
            if target_type == "agent_class"
            else render_tool_yaml(target_path, copy.deepcopy(target["template"]))
        )
        overlay_path = staging_dir / target_path
        overlay_path.parent.mkdir(parents=True, exist_ok=True)
        overlay_path.write_text(content, encoding="utf-8")


def overlay_callable_registry(project_root: Path, staging_dir: Path) -> CallableRegistry:
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


def render_agent_yaml(target_path: str, template: dict[str, Any]) -> str:
    callable_id = str(template.get("id") or Path(target_path).name.removesuffix(".yaml"))
    validate_callable_id(callable_id)
    if Path(target_path).name != f"{callable_id}.yaml":
        raise AccError("Agent callable id must match target file name")
    payload = {**template, "id": callable_id}
    return yaml.safe_dump(agent_payload_to_yaml(payload), sort_keys=False, allow_unicode=True)


def render_tool_yaml(target_path: str, template: dict[str, Any]) -> str:
    callable_id = str(template.get("id") or Path(target_path).name.removesuffix(".yaml"))
    validate_callable_id(callable_id)
    if Path(target_path).name != f"{callable_id}.yaml":
        raise AccError("Tool callable id must match target file name")
    runner = str(template.get("runner") or "")
    if not runner:
        raise AccError("Tool callable requires runner")
    payload = {
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
    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)


def validate_workflow_refs(
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


def apply_target_manifests(
    project_root: Path,
    proposal: dict[str, Any],
    materialized: dict[str, Any],
    created_paths: list[Path],
) -> list[dict[str, Any]]:
    created_by_rel_path = {
        relative_project_path(project_root, path): path for path in created_paths
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
                "created_hash": digest_text(content),
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


def known_workflow_ids(project_root: Path) -> set[str]:
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


def validate_proposal_id(value: str) -> str:
    if not value or not GRAPHOPS_SAFE_ID_RE.fullmatch(value):
        raise AccError("GraphOps proposal_id must match ^[A-Za-z0-9_.-]+$")
    return value


def unexpected_keys(scope: str, payload: dict[str, Any], allowed: set[str]) -> list[dict[str, str]]:
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


def digest_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def relative_project_path(project_root: Path, path: Path) -> str:
    return str(path.resolve().relative_to(project_root.resolve())).replace("\\", "/")
