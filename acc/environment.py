from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso
from acc.store import write_json
from acc.utils import AccError, load_json

BEHAVIOR_PATHS = (
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".cursor",
    ".claude/skills",
    "skills",
    "hooks",
)


@dataclass(frozen=True)
class WorkspaceBinding:
    workflow_id: str
    state_mode: str
    workspace_root: Path
    binding_path: Path | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "state_mode": self.state_mode,
            "workspace_root": str(self.workspace_root),
            "created_at": utc_now_iso(),
        }


@dataclass(frozen=True)
class EnvironmentFrame:
    environment_id: str
    workflow_id: str
    state_mode: str
    workspace_root: Path
    environment_root: Path
    inbox_root: Path
    outbox_root: Path
    artifact_root: Path
    snapshot_root: Path
    binding_path: Path | None = None

    @property
    def manifest_path(self) -> Path:
        return self.environment_root / "environment_manifest.json"


@dataclass(frozen=True)
class WorkflowExecutionContext:
    workflow_run_id: str
    environment: EnvironmentFrame
    node_id: str
    cwd: Path
    inbox_dir: Path
    outbox_dir: Path
    behavior_snapshot_dir: Path
    extra_env: dict[str, str] = field(default_factory=dict)


def create_workspace_binding(workflow_path: Path, workspace: Path, out: Path) -> dict[str, Any]:
    graph = load_json(workflow_path)
    if not isinstance(graph, dict):
        raise AccError(f"Workflow graph must be an object: {workflow_path}")
    workspace_root = workspace.expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace}")
    binding = WorkspaceBinding(
        workflow_id=str(graph.get("id") or workflow_path.stem),
        state_mode="stateful",
        workspace_root=workspace_root,
        binding_path=out,
    )
    payload = binding.to_json()
    write_json(out, payload)
    return {**payload, "binding_path": str(out.resolve())}


def load_workspace_binding(path: Path) -> WorkspaceBinding:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"Workspace binding must be an object: {path}")
    workflow_id = payload.get("workflow_id")
    state_mode = payload.get("state_mode")
    workspace_root = payload.get("workspace_root")
    if not isinstance(workflow_id, str) or not workflow_id:
        raise AccError("Workspace binding is missing workflow_id")
    if state_mode != "stateful":
        raise AccError("Workspace binding state_mode must be stateful")
    if not isinstance(workspace_root, str) or not workspace_root:
        raise AccError("Workspace binding is missing workspace_root")
    resolved_workspace = Path(workspace_root).expanduser().resolve()
    if not resolved_workspace.exists() or not resolved_workspace.is_dir():
        raise AccError(f"Workspace directory not found: {resolved_workspace}")
    return WorkspaceBinding(
        workflow_id=workflow_id,
        state_mode="stateful",
        workspace_root=resolved_workspace,
        binding_path=path,
    )


def create_environment_frame(
    graph: dict[str, Any],
    run_dir: Path,
    *,
    workspace: Path | None = None,
    binding: WorkspaceBinding | None = None,
) -> EnvironmentFrame:
    workflow_id = str(graph["id"])
    environment_root = run_dir / "environments" / "root_env"
    acc_root = environment_root / ".acc"
    if workspace is not None:
        workspace_root = workspace.expanduser().resolve()
        binding_path = None
        state_mode = "stateful"
    elif binding is not None:
        if binding.workflow_id != workflow_id:
            raise AccError(
                f"Binding workflow_id {binding.workflow_id!r} does not match {workflow_id!r}"
            )
        workspace_root = binding.workspace_root
        binding_path = binding.binding_path
        state_mode = "stateful"
    else:
        workspace_root = environment_root / "workspace"
        binding_path = None
        state_mode = "stateless"

    if state_mode == "stateful":
        if not workspace_root.exists() or not workspace_root.is_dir():
            raise AccError(f"Workspace directory not found: {workspace_root}")
    else:
        workspace_root.mkdir(parents=True, exist_ok=True)

    frame = EnvironmentFrame(
        environment_id="root_env",
        workflow_id=workflow_id,
        state_mode=state_mode,
        workspace_root=workspace_root.resolve(),
        environment_root=environment_root.resolve(),
        inbox_root=(acc_root / "inbox").resolve(),
        outbox_root=(acc_root / "outbox").resolve(),
        artifact_root=(acc_root / "artifacts").resolve(),
        snapshot_root=(acc_root / "snapshots").resolve(),
        binding_path=binding_path,
    )
    for path in (frame.inbox_root, frame.outbox_root, frame.artifact_root, frame.snapshot_root):
        path.mkdir(parents=True, exist_ok=True)
    write_environment_manifest(frame, graph)
    return frame


def write_environment_manifest(frame: EnvironmentFrame, graph: dict[str, Any]) -> None:
    payload = {
        "environment_id": frame.environment_id,
        "workflow_id": frame.workflow_id,
        "state_mode": frame.state_mode,
        "workspace_root": str(frame.workspace_root),
        "environment_root": str(frame.environment_root),
        "inbox_root": str(frame.inbox_root),
        "outbox_root": str(frame.outbox_root),
        "artifact_root": str(frame.artifact_root),
        "snapshot_root": str(frame.snapshot_root),
        "binding_path": str(frame.binding_path.resolve()) if frame.binding_path else None,
        "workspace_policy": graph.get("workspace_policy") or {},
        "behavior_pack_policy": graph.get("behavior_pack_policy") or {"mode": "workspace_native"},
    }
    write_json(frame.manifest_path, payload)


def node_cwd(environment: EnvironmentFrame, node: dict[str, Any]) -> Path:
    policy = str(node.get("cwd_policy") or "inherit_environment")
    if policy == "inherit_environment":
        return environment.workspace_root
    if policy == "relative_subdir":
        relative = node.get("relative_cwd") or node.get("cwd_subdir")
        if not isinstance(relative, str) or not relative:
            raise AccError(f"Node {node['id']} relative_cwd is required")
        candidate = (environment.workspace_root / relative).resolve()
        if not candidate.is_relative_to(environment.workspace_root):
            raise AccError(f"Node {node['id']} cwd escapes environment workspace")
        if not candidate.exists() or not candidate.is_dir():
            raise AccError(f"Node {node['id']} cwd does not exist: {candidate}")
        return candidate
    raise AccError(f"Unsupported cwd_policy for node {node['id']}: {policy}")


def snapshot_behavior_pack(
    graph_path: Path,
    graph: dict[str, Any],
    workspace_root: Path,
    target_root: Path,
) -> dict[str, Any]:
    policy = dict(graph.get("behavior_pack_policy") or {"mode": "workspace_native"})
    mode = str(policy.get("mode") or "workspace_native")
    if mode not in {"workspace_native", "template_overlay", "hybrid"}:
        raise AccError(f"Unsupported behavior_pack_policy mode: {mode}")
    if mode == "hybrid" and policy.get("precedence") not in {
        "template_over_workspace",
        "workspace_over_template",
    }:
        raise AccError("hybrid behavior_pack_policy requires explicit precedence")

    effective_root = target_root / "behavior_pack_effective"
    conflicts: list[dict[str, Any]] = []
    sources: list[dict[str, str]] = []
    effective_root.mkdir(parents=True, exist_ok=True)

    overlay_root = None
    if "overlay_path" in policy:
        overlay_root = (graph_path.parent / str(policy["overlay_path"])).resolve()

    workspace_files = collect_behavior_files(workspace_root)
    overlay_files = collect_behavior_files(overlay_root) if overlay_root else {}
    all_keys = sorted(set(workspace_files) | set(overlay_files))
    for key in all_keys:
        workspace_source = workspace_files.get(key)
        overlay_source = overlay_files.get(key)
        if workspace_source is not None and overlay_source is not None:
            conflicts.append(
                {
                    "path": key,
                    "workspace_path": str(workspace_source),
                    "template_path": str(overlay_source),
                    "precedence": policy.get("precedence"),
                }
            )
        source = choose_behavior_source(mode, policy, workspace_source, overlay_source)
        if source is None:
            continue
        target = effective_root / key
        copy_behavior_path(source, target)
        sources.append({"path": key, "source": str(source)})

    conflict_path = target_root / "behavior_conflicts.json"
    write_json(conflict_path, {"conflicts": conflicts})
    manifest = {
        "mode": mode,
        "precedence": policy.get("precedence"),
        "effective_root": str(effective_root.resolve()),
        "conflict_report": str(conflict_path.resolve()),
        "sources": sources,
    }
    write_json(target_root / "behavior_pack_manifest.json", manifest)
    return manifest


def collect_behavior_files(root: Path | None) -> dict[str, Path]:
    if root is None or not root.exists():
        return {}
    result: dict[str, Path] = {}
    for relative in BEHAVIOR_PATHS:
        source = root / relative
        if not source.exists():
            continue
        if source.is_dir():
            for child in source.rglob("*"):
                if child.is_file():
                    result[str(child.relative_to(root))] = child
        elif source.is_file():
            result[relative] = source
    return result


def choose_behavior_source(
    mode: str,
    policy: dict[str, Any],
    workspace_source: Path | None,
    overlay_source: Path | None,
) -> Path | None:
    if mode == "workspace_native":
        return workspace_source
    if mode == "template_overlay":
        return overlay_source
    if policy.get("precedence") == "template_over_workspace":
        return overlay_source or workspace_source
    return workspace_source or overlay_source


def copy_behavior_path(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        shutil.copy2(source, target)


def file_artifact(path: Path, root: Path) -> dict[str, Any]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "name": path.name,
        "type": infer_artifact_type(path),
        "path": str(path.relative_to(root)),
        "sha256": digest,
        "size_bytes": path.stat().st_size,
    }


def infer_artifact_type(path: Path) -> str:
    if path.is_dir():
        return "directory"
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "json"
    if suffix == ".md":
        return "markdown"
    if suffix in {".log", ".jsonl"}:
        return "log"
    return "file"


def inspect_environment_run(run_dir: Path) -> dict[str, Any]:
    environments_root = run_dir / "environments"
    environments = []
    if environments_root.exists():
        for manifest_path in sorted(environments_root.glob("*/environment_manifest.json")):
            environments.append(load_json(manifest_path))
    return {"run_dir": str(run_dir.resolve()), "environments": environments}
