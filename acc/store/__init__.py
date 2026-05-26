from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from acc.domain import (
    AccError,
    ArtifactBundle,
    DataEdge,
    EnvironmentBinding,
    EnvironmentFrame,
    NodeSpec,
    PortContract,
    WorkflowTemplate,
)
from acc.session import utc_now_iso


def is_clean_workflow_path(path: Path) -> bool:
    return path.suffixes[-2:] == [".accflow", ".json"] or path.name.endswith(".accflow.json")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AccError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AccError(f"Invalid JSON in {path}: {exc}") from exc
def load_clean_environment_binding(path: Path) -> EnvironmentBinding:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"EnvironmentBinding must be a JSON object: {path}")
    workflow_id = require_string(payload, "workflow_id", "EnvironmentBinding")
    raw_workspace = require_string(payload, "workspace_root", "EnvironmentBinding")
    workspace_root = Path(raw_workspace).expanduser().resolve()
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace_root}")
    behavior_policy = payload.get("behavior_policy") or {"mode": "workspace_native"}
    if not isinstance(behavior_policy, dict):
        raise AccError("EnvironmentBinding behavior_policy must be an object")
    return EnvironmentBinding(
        workflow_id=workflow_id,
        binding_name=str(payload.get("binding_name") or path.stem),
        workspace_root=workspace_root,
        behavior_policy=behavior_policy,
        binding_path=path,
    )


class FileSystemWorkflowStore:
    def __init__(
        self,
        *,
        template: WorkflowTemplate,
        workflow_path: Path,
        run_dir: Path,
        workspace: Path | None = None,
        binding: EnvironmentBinding | None = None,
        inherited_workspace: Path | None = None,
        inherited_ephemeral: bool = False,
    ) -> None:
        self.template = template
        self.workflow_path = workflow_path
        self.run_dir = run_dir.resolve()
        self.workspace = workspace
        self.binding = binding
        self.inherited_workspace = inherited_workspace
        self.inherited_ephemeral = inherited_ephemeral
        self.event_log = self.run_dir / "workflow_events.jsonl"
        self.workflow_run_id = f"workflow_{self.run_dir.name}"
        self.frame: EnvironmentFrame | None = None

    def prepare_run_dir(self) -> None:
        prepare_run_dir(self.run_dir)
        self.event_log.write_text("", encoding="utf-8")

    def create_environment_frame(self) -> EnvironmentFrame:
        frame = create_environment_frame(
            self.template,
            self.run_dir,
            workspace=self.workspace,
            binding=self.binding,
            inherited_workspace=self.inherited_workspace,
            inherited_ephemeral=self.inherited_ephemeral,
        )
        self.frame = frame
        return frame

    def create_node_attempt(self, node_id: str) -> Path:
        node_dir = self.run_dir / "nodes" / node_id
        for path in (node_dir / "inbox", node_dir / "outbox", node_dir / "artifacts"):
            path.mkdir(parents=True, exist_ok=True)
        (node_dir / "events.jsonl").write_text("", encoding="utf-8")
        return node_dir

    def cleanup_node_attempt(self, node_dir: Path) -> None:
        prepare_node_attempt_dir(node_dir)

    def write_workflow_event(
        self,
        event_type: str,
        *,
        status: str,
        node_id: str | None = None,
        level: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        emit_event(
            self.event_log,
            event_type,
            self.workflow_run_id,
            status=status,
            node_id=node_id,
            level=level,
            payload=payload,
        )

    def write_node_event(
        self,
        node_id: str,
        event_type: str,
        *,
        status: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        node = self.template.nodes[node_id]
        emit_node_event(
            self.run_dir / "nodes" / node_id / "events.jsonl",
            event_type,
            node,
            status=status,
            payload=payload,
        )

    def materialize_data_edge(
        self,
        edge: DataEdge,
        node_dir: Path,
        source_outboxes: dict[str, dict[str, Path]],
    ) -> dict[str, Any]:
        frame = require_frame(self.frame)
        return materialize_clean_inbox_edge(edge, frame, node_dir, source_outboxes)

    def write_artifact_bundle(
        self,
        node: NodeSpec,
        node_dir: Path,
        output: dict[str, Any],
    ) -> dict[str, Path]:
        outboxes = write_clean_outboxes(self.template, node, node_dir, output)
        frame = require_frame(self.frame)
        session_id = ""
        conductor_output_path = node_dir / "conductor_output.json"
        if conductor_output_path.exists():
            conductor_output = load_json(conductor_output_path)
            if isinstance(conductor_output, dict):
                session_id = str(conductor_output.get("session_id") or "")
        for port_id, source_dir in outboxes.items():
            artifacts = [
                file_record(path, source_dir)
                for path in sorted(source_dir.iterdir())
                if path.is_file()
                and path.name not in {"artifact_bundle.json", "outbox_manifest.json"}
            ]
            bundle = {
                "bundle_id": f"bundle_{node.id}_{port_id}",
                "producer_node_id": node.id,
                "producer_session_id": session_id,
                "artifacts": artifacts,
            }
            write_json(source_dir / "outbox_manifest.json", {
                "port_id": port_id,
                "node_id": node.id,
                "direction": "output",
                "session_id": session_id,
                "bundle": bundle,
                "artifacts": artifacts,
            })
            mirror_dir = frame.outbox_root / node.id / port_id
            if mirror_dir.exists():
                shutil.rmtree(mirror_dir)
            shutil.copytree(source_dir, mirror_dir)
        return outboxes

    def write_node_manifest(self, node_dir: Path, payload: dict[str, Any]) -> None:
        write_json(node_dir / "node_run_manifest.json", payload)

    def write_workflow_manifests(
        self,
        frame: EnvironmentFrame,
        payload: dict[str, Any],
        started_at: str,
        ended_at: str,
    ) -> None:
        write_workflow_manifests(
            self.run_dir,
            self.workflow_path,
            self.template,
            frame,
            payload,
            self.event_log,
            started_at,
            ended_at,
        )


def require_frame(frame: EnvironmentFrame | None) -> EnvironmentFrame:
    if frame is None:
        raise AccError("Environment frame has not been created")
    return frame


def create_environment_frame(
    template: WorkflowTemplate,
    run_dir: Path,
    *,
    workspace: Path | None,
    binding: EnvironmentBinding | None,
    inherited_workspace: Path | None,
    inherited_ephemeral: bool,
) -> EnvironmentFrame:
    environment_root = run_dir / "environments" / "root_env"
    if workspace is not None:
        workspace_root = workspace.expanduser().resolve()
        ephemeral = False
        binding_path = None
    elif binding is not None:
        workspace_root = binding.workspace_root
        ephemeral = False
        binding_path = binding.binding_path
    elif inherited_workspace is not None:
        workspace_root = inherited_workspace.resolve()
        ephemeral = inherited_ephemeral
        binding_path = None
    else:
        workspace_root = (environment_root / "workspace").resolve()
        workspace_root.mkdir(parents=True, exist_ok=True)
        ephemeral = True
        binding_path = None
    if not workspace_root.exists() or not workspace_root.is_dir():
        raise AccError(f"Workspace directory not found: {workspace_root}")
    frame = EnvironmentFrame(
        environment_id="root_env",
        run_id=run_dir.name,
        workflow_id=template.id,
        workspace_root=workspace_root,
        environment_root=environment_root.resolve(),
        inbox_root=(environment_root / ".acc" / "inbox").resolve(),
        outbox_root=(environment_root / ".acc" / "outbox").resolve(),
        artifact_root=(environment_root / ".acc" / "artifacts").resolve(),
        behavior_snapshot_path=(
            environment_root / ".acc" / "behavior_pack_snapshot.json"
        ).resolve(),
        ephemeral=ephemeral,
        binding_path=binding_path,
    )
    for path in (frame.inbox_root, frame.outbox_root, frame.artifact_root):
        path.mkdir(parents=True, exist_ok=True)
    write_behavior_snapshot(frame)
    write_json(
        frame.environment_root / "environment_manifest.json",
        {
            "environment_id": frame.environment_id,
            "run_id": frame.run_id,
            "workflow_id": frame.workflow_id,
            "state_mode": "stateless" if frame.ephemeral else "stateful",
            "workspace_root": str(frame.workspace_root),
            "environment_root": str(frame.environment_root),
            "inbox_root": str(frame.inbox_root),
            "outbox_root": str(frame.outbox_root),
            "artifact_root": str(frame.artifact_root),
            "snapshot_root": str((frame.environment_root / ".acc" / "snapshots").resolve()),
            "behavior_snapshot_path": str(frame.behavior_snapshot_path),
            "ephemeral": frame.ephemeral,
            "binding_path": str(frame.binding_path.resolve()) if frame.binding_path else None,
        },
    )
    return frame


def write_behavior_snapshot(frame: EnvironmentFrame) -> None:
    behavior_files = []
    for name in ("AGENTS.md", "CLAUDE.md", "GEMINI.md"):
        path = frame.workspace_root / name
        if path.exists() and path.is_file():
            behavior_files.append({"path": name, "sha256": sha256(path)})
    write_json(
        frame.behavior_snapshot_path,
        {
            "mode": "workspace_native",
            "workspace_root": str(frame.workspace_root),
            "files": behavior_files,
            "created_at": utc_now_iso(),
        },
    )


def prepare_node_attempt_dir(node_dir: Path) -> None:
    output_path = node_dir / "output.json"
    if output_path.exists():
        output_path.unlink()
    for child_name in ("artifacts", "outbox"):
        child = node_dir / child_name
        if child.exists():
            shutil.rmtree(child)
        child.mkdir(parents=True, exist_ok=True)


def write_clean_outboxes(
    template: WorkflowTemplate,
    node: NodeSpec,
    node_dir: Path,
    output: dict[str, Any],
) -> dict[str, Path]:
    ports = node.output_ports or {"main": PortContract(id="main", direction="output")}
    outboxes: dict[str, Path] = {}
    for port_id in ports:
        outbox_dir = node_dir / "outbox" / port_id
        outbox_dir.mkdir(parents=True, exist_ok=True)
        copied_files = []
        for source in [node_dir / "output.json", *(node_dir / "artifacts").iterdir()]:
            if not source.exists():
                continue
            target = outbox_dir / source.name
            copy_path(source, target)
            if target.is_file():
                copied_files.append(file_record(target, outbox_dir))
        bundle = ArtifactBundle(
            bundle_id=f"bundle_{node.id}_{port_id}",
            node_id=node.id,
            run_id=node_dir.parent.parent.name,
            outputs={port_id: output},
            files=copied_files,
            created_at=utc_now_iso(),
            provenance={
                "workflow_id": template.id,
                "node_kind": node.kind,
                "node_run_dir": str(node_dir.resolve()),
            },
        )
        bundle_payload = {
            "bundle_id": bundle.bundle_id,
            "node_id": bundle.node_id,
            "run_id": bundle.run_id,
            "outputs": bundle.outputs,
            "files": bundle.files,
            "created_at": bundle.created_at,
            "provenance": bundle.provenance,
        }
        write_json(outbox_dir / "artifact_bundle.json", bundle_payload)
        write_json(node_dir / "artifact_bundle.json", bundle_payload)
        outboxes[port_id] = outbox_dir
    return outboxes


def materialize_clean_inbox_edge(
    edge: DataEdge,
    frame: EnvironmentFrame,
    node_dir: Path,
    source_outboxes: dict[str, dict[str, Path]],
) -> dict[str, Any]:
    source_dir = source_outboxes.get(edge.source.node, {}).get(edge.source.port)
    if source_dir is None:
        raise AccError(f"Missing source outbox {edge.source.node}.{edge.source.port}")
    source_manifest_path = source_dir / "outbox_manifest.json"
    source_manifest = load_json(source_manifest_path) if source_manifest_path.exists() else {}
    source_ref = f"{edge.source.node}_{edge.source.port}"
    target_dir = node_dir / "inbox" / edge.target.port / source_ref
    safe_child_path(target_dir, node_dir / "inbox")
    target_dir.mkdir(parents=True, exist_ok=True)
    if edge.materialization == "reference":
        write_json(
            target_dir / "reference_manifest.json",
            {"source_outbox": str(source_dir.resolve())},
        )
    else:
        for child in source_dir.iterdir():
            if child.name == "artifact_bundle.json":
                continue
            copy_path(child, target_dir / child.name)
    manifest = {
        "port_id": edge.target.port,
        "node_id": edge.target.node,
        "direction": "input",
        "source_refs": [source_ref],
        "source_node_id": edge.source.node,
        "source_port_id": edge.source.port,
        "source_session_id": source_manifest.get("session_id")
        if isinstance(source_manifest, dict)
        else None,
        "target_node_id": edge.target.node,
        "target_port_id": edge.target.port,
        "source_outbox": str(source_dir.resolve()),
        "target_inbox": str(target_dir.resolve()),
        "materialization": edge.materialization,
    }
    write_json(target_dir / "inbox_manifest.json", manifest)
    mirror_dir = frame.inbox_root / edge.target.node / edge.target.port / source_ref
    if mirror_dir.exists():
        shutil.rmtree(mirror_dir)
    shutil.copytree(target_dir, mirror_dir)
    return manifest


def write_workflow_manifests(
    run_dir: Path,
    workflow_path: Path,
    template: WorkflowTemplate,
    frame: EnvironmentFrame,
    payload: dict[str, Any],
    event_log: Path,
    started_at: str,
    ended_at: str,
) -> None:
    manifest = {
        "workflow_run_id": f"workflow_{run_dir.name}",
        "workflow_id": template.id,
        "workflow_template_path": str(workflow_path.resolve()),
        "status": payload["status"],
        "run_dir": str(run_dir.resolve()),
        "event_log_path": str(event_log.resolve()),
        "environment_manifest": str(
            (frame.environment_root / "environment_manifest.json").resolve()
        ),
        "workspace_root": str(frame.workspace_root),
        "ephemeral_workspace": frame.ephemeral,
        "node_count": len(template.nodes),
        "started_at": started_at,
        "ended_at": ended_at,
    }
    write_json(run_dir / "workflow_run_manifest.json", manifest)
    write_json(run_dir / "workflow_summary.json", payload)
    write_json(run_dir / "workflow_run.json", payload)


def prepare_run_dir(run_dir: Path) -> None:
    if not run_dir.exists():
        run_dir.mkdir(parents=True, exist_ok=True)
        return
    children = list(run_dir.iterdir())
    if not children:
        return
    markers = {"workflow_run_manifest.json", "workflow_summary.json", "workflow_run.json"}
    if not any((run_dir / marker).exists() for marker in markers):
        raise AccError(f"Refusing to reuse non-ACC workflow run directory: {run_dir}")
    for child in children:
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    run_dir.mkdir(parents=True, exist_ok=True)


def safe_child_path(path: Path, root: Path) -> None:
    resolved = path.resolve()
    resolved_root = root.resolve()
    if not (resolved == resolved_root or resolved.is_relative_to(resolved_root)):
        raise AccError(f"Path escapes allowed root: {path}")


def copy_path(source: Path, target: Path) -> None:
    safe_child_path(target, target.parent)
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        shutil.copy2(source, target)


def file_record(path: Path, root: Path) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(root)),
        "size_bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit_event(
    path: Path,
    event_type: str,
    workflow_run_id: str,
    *,
    status: str,
    node_id: str | None = None,
    level: int | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    event = {
        "type": event_type,
        "timestamp": utc_now_iso(),
        "workflow_run_id": workflow_run_id,
        "status": status,
        "payload": payload or {},
    }
    if node_id is not None:
        event["node_id"] = node_id
    if level is not None:
        event["level"] = level
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def emit_node_event(
    path: Path,
    event_type: str,
    node: NodeSpec,
    *,
    status: str,
    payload: dict[str, Any] | None = None,
) -> None:
    event = {
        "type": event_type,
        "timestamp": utc_now_iso(),
        "node_id": node.id,
        "status": status,
        "payload": payload or {},
    }
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value
