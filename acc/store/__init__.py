from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from acc.domain import (
    AccError,
    ArtifactBundle,
    CallableRef,
    DataEdge,
    DataEndpoint,
    EnvironmentBinding,
    EnvironmentFrame,
    FunctionInvocation,
    NodeSpec,
    PortContract,
    ScopeFrame,
    SessionInstance,
    WorkflowCallOutputBinding,
    WorkflowInputBinding,
    WorkflowTemplate,
)
from acc.session import utc_now_iso


def is_clean_workflow_path(path: Path) -> bool:
    """Return True for canonical `.accflow.json` workflow templates."""
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
        parent_invocation_id: str | None = None,
        parent_scope_frame_id: str | None = None,
        call_depth: int = 0,
    ) -> None:
        self.template = template
        self.workflow_path = workflow_path
        self.run_dir = run_dir.resolve()
        self.workspace = workspace
        self.binding = binding
        self.inherited_workspace = inherited_workspace
        self.inherited_ephemeral = inherited_ephemeral
        self.parent_invocation_id = parent_invocation_id
        self.parent_scope_frame_id = parent_scope_frame_id
        self.call_depth = call_depth
        self.event_log = self.run_dir / "workflow_events.jsonl"
        self.workflow_run_id = f"workflow_{self.run_dir.name}"
        self.frame: EnvironmentFrame | None = None
        self.function_invocation: FunctionInvocation | None = None
        self.scope_frame: ScopeFrame | None = None

    def prepare_run_dir(self) -> None:
        prepare_run_dir(self.run_dir)
        self.event_log.write_text("", encoding="utf-8")

    def create_function_invocation(
        self,
        *,
        input_payload: dict[str, Any],
        status: str,
        started_at: str,
        ended_at: str | None = None,
    ) -> FunctionInvocation:
        invocation = FunctionInvocation(
            invocation_id=self.invocation_id,
            workflow_function_id=self.template.id,
            run_id=self.run_dir.name,
            status=status,
            input_payload=input_payload,
            root_scope_frame_id=self.scope_frame_id,
            parent_invocation_id=self.parent_invocation_id,
            started_at=started_at,
            ended_at=ended_at,
        )
        self.function_invocation = invocation
        self.write_function_invocation_manifest(invocation)
        return invocation

    @property
    def invocation_id(self) -> str:
        return f"invocation_{self.run_dir.name}"

    @property
    def scope_frame_id(self) -> str:
        return f"scope_{self.run_dir.name}_root"

    def create_environment_frame(
        self,
        invocation: FunctionInvocation | None = None,
    ) -> EnvironmentFrame:
        frame = create_environment_frame(
            self.template,
            self.run_dir,
            workspace=self.workspace,
            binding=self.binding,
            inherited_workspace=self.inherited_workspace,
            inherited_ephemeral=self.inherited_ephemeral,
            invocation_id=(invocation or self.function_invocation).invocation_id
            if (invocation or self.function_invocation)
            else None,
            scope_frame_id=self.scope_frame_id,
            parent_scope_frame_id=self.parent_scope_frame_id,
            call_depth=self.call_depth,
        )
        self.frame = frame
        self.scope_frame = scope_frame_from_environment_frame(frame)
        self.write_scope_frame_manifest(self.scope_frame)
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

    def write_workflow_input_bundles(
        self,
        workflow_input: dict[str, Any],
    ) -> dict[str, Path]:
        frame = require_frame(self.frame)
        input_root = self.run_dir / "workflow_inputs"
        input_outboxes: dict[str, Path] = {}
        for port_id, value in workflow_input.items():
            if port_id not in self.template.exposed_inputs:
                continue
            port_dir = input_root / port_id
            port_dir.mkdir(parents=True, exist_ok=True)
            write_json(port_dir / "input.json", value)
            artifact = file_record(port_dir / "input.json", port_dir)
            bundle = {
                "bundle_id": f"bundle_{self.template.id}_workflow_input_{port_id}",
                "producer_node_id": f"{self.template.id}__workflow_inputs",
                "producer_session_id": None,
                "artifacts": [artifact],
                "outputs": {port_id: value},
                "created_at": utc_now_iso(),
                "provenance": {
                    "workflow_id": self.template.id,
                    "workflow_port_id": port_id,
                    "boundary": "input",
                },
            }
            write_json(port_dir / "artifact_bundle.json", bundle)
            write_json(
                port_dir / "outbox_manifest.json",
                {
                    "port_id": port_id,
                    "node_id": f"{self.template.id}__workflow_inputs",
                    "direction": "output",
                    "session_id": None,
                    "bundle": bundle,
                    "artifacts": [artifact],
                },
            )
            mirror_dir = frame.inbox_root / "__workflow_inputs" / port_id
            if mirror_dir.exists():
                shutil.rmtree(mirror_dir)
            shutil.copytree(port_dir, mirror_dir)
            input_outboxes[port_id] = port_dir
        return input_outboxes

    def materialize_workflow_input_binding(
        self,
        binding: WorkflowInputBinding,
        node_dir: Path,
        workflow_input_outboxes: dict[str, Path],
    ) -> dict[str, Any] | None:
        source_dir = workflow_input_outboxes.get(binding.source_port)
        if source_dir is None:
            return None
        edge = DataEdge(
            source=DataEndpoint(
                node=f"{self.template.id}__workflow_inputs",
                port=binding.source_port,
            ),
            target=binding.target,
            materialization=binding.materialization,
        )
        return materialize_clean_inbox_edge(
            edge,
            require_frame(self.frame),
            node_dir,
            {edge.source.node: {edge.source.port: source_dir}},
        )

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
            write_json(
                source_dir / "outbox_manifest.json",
                {
                    "port_id": port_id,
                    "node_id": node.id,
                    "direction": "output",
                    "session_id": session_id,
                    "bundle": bundle,
                    "artifacts": artifacts,
                },
            )
            mirror_dir = frame.outbox_root / node.id / port_id
            if mirror_dir.exists():
                shutil.rmtree(mirror_dir)
            shutil.copytree(source_dir, mirror_dir)
        return outboxes

    def publish_workflow_outputs_for_node(
        self,
        node: NodeSpec,
        outboxes: dict[str, Path],
    ) -> dict[str, dict[str, Any]]:
        frame = require_frame(self.frame)
        published: dict[str, dict[str, Any]] = {}
        for binding in self.template.workflow_output_bindings:
            if binding.source.node != node.id:
                continue
            source_dir = outboxes.get(binding.source.port)
            if source_dir is None:
                continue
            output_dir = self.run_dir / "workflow_outputs" / binding.target_port
            if output_dir.exists():
                shutil.rmtree(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            if binding.materialization == "reference":
                write_json(
                    output_dir / "reference_manifest.json",
                    {"source_outbox": str(source_dir.resolve())},
                )
            else:
                for child in source_dir.iterdir():
                    if child.name == "artifact_bundle.json":
                        continue
                    copy_path(child, output_dir / child.name)
            artifacts = [
                file_record(path, output_dir)
                for path in sorted(output_dir.iterdir())
                if path.is_file()
            ]
            manifest = {
                "port_id": binding.target_port,
                "workflow_id": self.template.id,
                "direction": "output",
                "source_node_id": binding.source.node,
                "source_port_id": binding.source.port,
                "source_outbox": str(source_dir.resolve()),
                "workflow_output_dir": str(output_dir.resolve()),
                "materialization": binding.materialization,
                "artifacts": artifacts,
            }
            write_json(output_dir / "workflow_output_manifest.json", manifest)
            mirror_dir = frame.outbox_root / "__workflow_outputs" / binding.target_port
            if mirror_dir.exists():
                shutil.rmtree(mirror_dir)
            shutil.copytree(output_dir, mirror_dir)
            published[binding.target_port] = manifest
        return published

    def apply_workflow_call_output_bindings(
        self,
        node: NodeSpec,
        node_dir: Path,
        child_run_dir: Path,
        bindings: list[WorkflowCallOutputBinding],
    ) -> dict[str, Path]:
        if not bindings:
            return {}
        frame = require_frame(self.frame)
        returned: dict[str, Path] = {}
        for binding in bindings:
            source_dir = child_run_dir / "workflow_outputs" / binding.workflow_output
            if not source_dir.exists():
                if binding.required:
                    raise AccError(
                        "Missing child workflow output "
                        f"{binding.workflow_output!r} for workflow node {node.id}"
                    )
                continue
            target_dir = node_dir / "outbox" / binding.parent_port
            if target_dir.exists():
                shutil.rmtree(target_dir)
            target_dir.mkdir(parents=True, exist_ok=True)
            if binding.materialization == "reference":
                write_json(
                    target_dir / "reference_manifest.json",
                    {"source_workflow_output": str(source_dir.resolve())},
                )
            else:
                for child in source_dir.iterdir():
                    copy_path(child, target_dir / child.name)
            artifacts = [
                file_record(path, target_dir)
                for path in sorted(target_dir.iterdir())
                if path.is_file()
            ]
            bundle = {
                "bundle_id": f"bundle_{node.id}_{binding.parent_port}",
                "producer_node_id": node.id,
                "producer_session_id": None,
                "artifacts": artifacts,
                "provenance": {
                    "workflow_id": self.template.id,
                    "node_kind": node.kind,
                    "node_run_dir": str(node_dir.resolve()),
                    "child_workflow_run_dir": str(child_run_dir.resolve()),
                    "child_workflow_output": binding.workflow_output,
                    "parent_port": binding.parent_port,
                    "boundary": "workflow_call_return",
                },
            }
            write_json(target_dir / "artifact_bundle.json", bundle)
            write_json(
                target_dir / "outbox_manifest.json",
                {
                    "port_id": binding.parent_port,
                    "node_id": node.id,
                    "direction": "output",
                    "session_id": None,
                    "bundle": bundle,
                    "artifacts": artifacts,
                    "source_workflow_output": str(source_dir.resolve()),
                    "child_workflow_output": binding.workflow_output,
                    "materialization": binding.materialization,
                },
            )
            mirror_dir = frame.outbox_root / node.id / binding.parent_port
            if mirror_dir.exists():
                shutil.rmtree(mirror_dir)
            shutil.copytree(target_dir, mirror_dir)
            returned[binding.parent_port] = target_dir
        return returned

    def write_node_manifest(self, node_dir: Path, payload: dict[str, Any]) -> None:
        write_json(node_dir / "node_run_manifest.json", payload)

    def write_session_instance_manifest(
        self,
        *,
        node: NodeSpec,
        node_dir: Path,
        frame: EnvironmentFrame,
        callable_ref: CallableRef,
        status: str,
        started_at: str,
        ended_at: str,
        error: str | None = None,
    ) -> SessionInstance:
        session_id = session_id_from_node_dir(node_dir) or f"session_{self.run_dir.name}_{node.id}"
        instance = SessionInstance(
            session_id=session_id,
            invocation_id=frame.function_invocation_id or self.invocation_id,
            scope_frame_id=frame.scope_frame_id or self.scope_frame_id,
            node_id=node.id,
            callable_ref=callable_ref,
            callable_kind=callable_ref.kind,
            status=status,
            cwd=frame.workspace_root,
            env_keys=("ACC_RUN_DIR", "ACC_NODE_ID"),
            input_path=(node_dir / "input.json").resolve(),
            output_path=(node_dir / "output.json").resolve(),
            artifact_dir=(node_dir / "artifacts").resolve(),
            event_log_path=(node_dir / "events.jsonl").resolve(),
            started_at=started_at,
            ended_at=ended_at,
            error=error,
        )
        write_json(
            node_dir / "session_instance_manifest.json",
            session_instance_payload(instance),
        )
        return instance

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
        if self.function_invocation is not None:
            final_invocation = FunctionInvocation(
                invocation_id=self.function_invocation.invocation_id,
                workflow_function_id=self.function_invocation.workflow_function_id,
                run_id=self.function_invocation.run_id,
                status=str(payload["status"]),
                input_payload=self.function_invocation.input_payload,
                root_scope_frame_id=self.function_invocation.root_scope_frame_id,
                parent_invocation_id=self.function_invocation.parent_invocation_id,
                started_at=started_at,
                ended_at=ended_at,
            )
            self.function_invocation = final_invocation
            self.write_function_invocation_manifest(final_invocation)

    def write_function_invocation_manifest(self, invocation: FunctionInvocation) -> None:
        write_json(
            self.run_dir / "function_invocation_manifest.json",
            {
                "invocation_id": invocation.invocation_id,
                "workflow_function_id": invocation.workflow_function_id,
                "run_id": invocation.run_id,
                "status": invocation.status,
                "input_payload": invocation.input_payload,
                "root_scope_frame_id": invocation.root_scope_frame_id,
                "parent_invocation_id": invocation.parent_invocation_id,
                "started_at": invocation.started_at,
                "ended_at": invocation.ended_at,
            },
        )

    def write_scope_frame_manifest(self, scope_frame: ScopeFrame) -> None:
        write_json(
            self.run_dir / "scope_frame_manifest.json",
            {
                "frame_id": scope_frame.frame_id,
                "invocation_id": scope_frame.invocation_id,
                "parent_frame_id": scope_frame.parent_frame_id,
                "call_depth": scope_frame.call_depth,
                "workflow_id": scope_frame.workflow_id,
                "workspace_root": str(scope_frame.workspace_root),
                "environment_root": str(scope_frame.environment_root),
                "inbox_root": str(scope_frame.inbox_root),
                "outbox_root": str(scope_frame.outbox_root),
                "artifact_root": str(scope_frame.artifact_root),
                "behavior_snapshot_path": str(scope_frame.behavior_snapshot_path),
                "ephemeral": scope_frame.ephemeral,
                "binding_path": str(scope_frame.binding_path) if scope_frame.binding_path else None,
            },
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
    invocation_id: str | None = None,
    scope_frame_id: str | None = None,
    parent_scope_frame_id: str | None = None,
    call_depth: int = 0,
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
        function_invocation_id=invocation_id,
        scope_frame_id=scope_frame_id,
        parent_scope_frame_id=parent_scope_frame_id,
        call_depth=call_depth,
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
            "function_invocation_id": frame.function_invocation_id,
            "scope_frame_id": frame.scope_frame_id,
            "parent_scope_frame_id": frame.parent_scope_frame_id,
            "call_depth": frame.call_depth,
        },
    )
    return frame


def scope_frame_from_environment_frame(frame: EnvironmentFrame) -> ScopeFrame:
    return ScopeFrame(
        frame_id=frame.scope_frame_id or f"scope_{frame.run_id}_root",
        invocation_id=frame.function_invocation_id or f"invocation_{frame.run_id}",
        parent_frame_id=frame.parent_scope_frame_id,
        call_depth=frame.call_depth,
        workflow_id=frame.workflow_id,
        workspace_root=frame.workspace_root,
        environment_root=frame.environment_root,
        inbox_root=frame.inbox_root,
        outbox_root=frame.outbox_root,
        artifact_root=frame.artifact_root,
        behavior_snapshot_path=frame.behavior_snapshot_path,
        ephemeral=frame.ephemeral,
        binding_path=frame.binding_path,
    )


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
            if source.is_dir():
                target = outbox_dir / f"{source.name}.reference.json"
                write_json(
                    target,
                    {
                        "type": "directory_reference",
                        "source": str(source.resolve()),
                    },
                )
            else:
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
    markers = {
        "workflow_run_manifest.json",
        "workflow_summary.json",
        "workflow_run.json",
        "run_summary.json",
    }
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
    from acc.events import sanitize_event_payload

    event = {
        "type": event_type,
        "timestamp": utc_now_iso(),
        "workflow_run_id": workflow_run_id,
        "status": status,
        "payload": sanitize_event_payload(payload or {}),
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
    from acc.events import sanitize_event_payload

    log_ref = str((path.parent / "stdout.log").resolve()) if path.parent.exists() else None
    event = {
        "type": event_type,
        "timestamp": utc_now_iso(),
        "node_id": node.id,
        "status": status,
        "payload": sanitize_event_payload(payload or {}, log_ref=log_ref),
    }
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def session_id_from_node_dir(node_dir: Path) -> str | None:
    conductor_output_path = node_dir / "conductor_output.json"
    if conductor_output_path.exists():
        conductor_output = load_json(conductor_output_path)
        if isinstance(conductor_output, dict) and isinstance(
            conductor_output.get("session_id"),
            str,
        ):
            return conductor_output["session_id"]
    session_manifest_path = node_dir / "session_manifest.json"
    if session_manifest_path.exists():
        session_manifest = load_json(session_manifest_path)
        if isinstance(session_manifest, dict) and isinstance(
            session_manifest.get("session_id"),
            str,
        ):
            return session_manifest["session_id"]
    return None


def session_instance_payload(instance: SessionInstance) -> dict[str, Any]:
    return {
        "session_id": instance.session_id,
        "invocation_id": instance.invocation_id,
        "scope_frame_id": instance.scope_frame_id,
        "node_id": instance.node_id,
        "callable_ref": {
            "kind": instance.callable_ref.kind,
            "id": instance.callable_ref.id,
            "version": instance.callable_ref.version,
        },
        "callable_kind": instance.callable_kind,
        "status": instance.status,
        "cwd": str(instance.cwd),
        "env_keys": list(instance.env_keys),
        "input_path": str(instance.input_path),
        "output_path": str(instance.output_path),
        "artifact_dir": str(instance.artifact_dir),
        "event_log_path": str(instance.event_log_path),
        "started_at": instance.started_at,
        "ended_at": instance.ended_at,
        "error": instance.error,
    }


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value
