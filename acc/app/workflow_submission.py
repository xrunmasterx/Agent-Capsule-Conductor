from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.app.workbench_adapter import (
    CompiledWorkbenchWorkflowBundle,
    compile_workbench_workflow_bundle,
    merge_workbench_snapshot_projection,
)
from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
from acc.app.workbench_tasks import WorkbenchTaskService
from acc.app.workflow_refs import WorkflowCatalog, WorkflowRefMode, rewrite_workflow_function_refs
from acc.callable_registry import CallableRegistry
from acc.runner import LocalRunnerService, RunnerCapabilityError
from acc.server.run_manager import WorkbenchRunJob, WorkbenchRunManager
from acc.storage import (
    RunHandle,
    claim_run,
    generate_run_id,
    parse_legacy_run_dir,
    validate_run_id,
)
from acc.storage import (
    resolve_run_dir as storage_run_dir,
)
from acc.utils import AccError


@dataclass(frozen=True)
class PreparedRuntimeGraph:
    workflow_id: str
    graph_dir: Path
    accflow_path: Path
    workflows_dir: Path
    bundle: CompiledWorkbenchWorkflowBundle
    child_name_map: dict[str, str]


@dataclass(frozen=True)
class WorkflowGraphSubmissionRequest:
    graph: dict[str, Any]
    run_id: str | None = None
    run_dir: str | None = None
    binding_path: str | None = None
    binding_ref: str | None = None
    workspace: str | None = None
    workspace_alias: str | None = None
    input_payload: dict[str, Any] | None = None
    task_id: str | None = None


@dataclass(frozen=True)
class RunnerJobSubmissionRequest:
    graph: dict[str, Any]
    job_id: str | None = None
    run_id: str | None = None
    task_id: str | None = None
    workspace_alias: str = "default"
    binding_ref: str | None = None
    input_payload: dict[str, Any] | None = None


class SubmissionError(AccError):
    def __init__(self, detail: Any, *, status_code: int = 400) -> None:
        super().__init__(str(detail))
        self.detail = detail
        self.status_code = status_code


class RunnerSubmissionRejected(SubmissionError):
    def __init__(self, rejection: dict[str, Any], receipt: dict[str, Any]) -> None:
        super().__init__({**rejection, "job": receipt}, status_code=400)
        self.rejection = rejection
        self.receipt = receipt


class WorkflowSubmissionService:
    """Route-neutral workflow submission use case."""

    def __init__(
        self,
        project_root: Path | str,
        run_manager: WorkbenchRunManager,
        *,
        local_runner_service: LocalRunnerService | None = None,
        workflow_service_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.project_root = Path(project_root).resolve()
        self.run_manager = run_manager
        self.local_runner_service = local_runner_service or LocalRunnerService(self.project_root)
        self.workflow_service_factory = (
            workflow_service_factory or self._default_workflow_service_factory
        )

    async def submit_workflow_graph(
        self,
        request: WorkflowGraphSubmissionRequest,
    ) -> dict[str, Any]:
        run_id = select_run_id(request.run_id, request.run_dir)
        run_dir = storage_run_dir(self.project_root, run_id)
        prepared = compile_runtime_graph(
            request.graph,
            run_dir,
            project_root=self.project_root,
            task_id=request.task_id,
        )
        resolved = resolve_runner_environment_before_evidence(
            self.project_root,
            request,
            self.local_runner_service,
            graph=request.graph,
            manager=self.run_manager,
        )
        handle = claim_selected_run(
            self.project_root,
            run_id,
            workflow_id=prepared.workflow_id,
            task_id=request.task_id,
        )
        graph_path = write_prepared_runtime_graph(prepared, handle.run_dir, self.project_root)
        try:
            return await self.run_manager.submit(
                WorkbenchRunJob(
                    graph_path=graph_path,
                    run_dir=handle.run_dir,
                    workflow_id=prepared.workflow_id,
                    task_id=request.task_id,
                    workspace=resolved["workspace"],
                    binding_path=resolved["binding_path"],
                    input_payload=request.input_payload,
                    service_factory=self.workflow_service_factory,
                )
            )
        except AccError as exc:
            raise SubmissionError(str(exc), status_code=400) from exc

    async def submit_runner_job(
        self,
        request: RunnerJobSubmissionRequest,
    ) -> dict[str, Any]:
        job_id = request.job_id or self.local_runner_service.new_job_id()
        workflow_id = str(request.graph.get("id") or "")
        try:
            preflight_runtime_graph(
                request.graph,
                project_root=self.project_root,
                task_id=request.task_id,
            )
            resolved = self.local_runner_service.validate_job_before_evidence(
                graph=request.graph,
                workspace_alias=request.workspace_alias,
                binding_ref=request.binding_ref,
                manager=self.run_manager,
            )
            handle = claim_run(
                self.project_root,
                run_id=request.run_id,
                workflow_id=workflow_id,
                task_id=request.task_id,
            )
            graph_path = prepare_runtime_graph(
                request.graph,
                handle.run_dir,
                project_root=self.project_root,
                task_id=request.task_id,
            )
            submit_result = await self.run_manager.submit(
                WorkbenchRunJob(
                    graph_path=graph_path,
                    run_dir=handle.run_dir,
                    workflow_id=workflow_id,
                    task_id=request.task_id,
                    workspace=None if resolved["binding_path"] else resolved["workspace"],
                    binding_path=resolved["binding_path"],
                    input_payload=request.input_payload,
                    service_factory=self.workflow_service_factory,
                )
            )
            remember_workbench_task_run(self.project_root, request.task_id, handle.run_id)
            return self.local_runner_service.write_job_receipt(
                job_id=job_id,
                status=str(submit_result.get("status") or "queued"),
                workspace_alias=request.workspace_alias,
                run_id=handle.run_id,
                task_id=request.task_id,
                workflow_id=workflow_id,
            )
        except RunnerCapabilityError as exc:
            rejection = exc.to_payload()
            receipt = self.local_runner_service.write_job_receipt(
                job_id=job_id,
                status="rejected",
                workspace_alias=request.workspace_alias,
                task_id=request.task_id,
                workflow_id=workflow_id,
                rejection=rejection,
            )
            raise RunnerSubmissionRejected(rejection, receipt) from exc
        except AccError as exc:
            raise SubmissionError(str(exc), status_code=400) from exc

    def _default_workflow_service_factory(self) -> Any:
        from acc.app import WorkflowAppService

        return WorkflowAppService(project_root=self.project_root)


def select_run_id(run_id: str | None, run_dir: str | None) -> str:
    if run_id and run_dir:
        raise SubmissionError("Provide run_id or run_dir, not both", status_code=400)
    try:
        if run_dir:
            return parse_legacy_run_dir(run_dir)
        return validate_run_id(run_id or generate_run_id())
    except AccError as exc:
        raise SubmissionError(str(exc), status_code=400) from exc


def claim_selected_run(
    project_root: Path,
    run_id: str,
    *,
    workflow_id: str | None = None,
    task_id: str | None = None,
) -> RunHandle:
    try:
        return claim_run(project_root, run_id=run_id, workflow_id=workflow_id, task_id=task_id)
    except AccError as exc:
        status_code = 409 if str(exc).startswith("Run already exists:") else 400
        raise SubmissionError(str(exc), status_code=status_code) from exc


def prepare_runtime_graph(
    graph_payload: dict[str, Any],
    run_dir: Path,
    *,
    project_root: Path,
    task_id: str | None = None,
) -> Path:
    prepared = compile_runtime_graph(
        graph_payload,
        run_dir,
        project_root=project_root,
        task_id=task_id,
    )
    return write_prepared_runtime_graph(prepared, run_dir, project_root)


def compile_runtime_graph(
    graph_payload: dict[str, Any],
    run_dir: Path,
    *,
    project_root: Path,
    task_id: str | None = None,
) -> PreparedRuntimeGraph:
    graph = graph_with_latest_workbench_node_modes(graph_payload, project_root, task_id)
    workflow_id = str(graph.get("id") or "")
    if not workflow_id:
        raise SubmissionError("Workflow graph id is required", status_code=400)
    graph_dir = runtime_workflow_spec_dir(project_root, run_dir)
    accflow_path = graph_dir / "root.accflow.json"
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    bundle = graph_bundle_for_accflow_save(
        graph,
        source_path=accflow_path,
        callable_registry=CallableRegistry.from_project_root(project_root),
        main_data_edge_policy="preserve_explicit",
    )
    bundle, child_name_map = runtime_named_workflow_bundle(bundle)
    try:
        bundle = resolve_bundle_workflow_refs(
            bundle,
            project_root=project_root,
            workflows_dir=workflows_dir,
            accflow_path=accflow_path,
            mode="runtime",
        )
    except AccError as exc:
        raise SubmissionError(str(exc), status_code=400) from exc
    return PreparedRuntimeGraph(
        workflow_id=workflow_id,
        graph_dir=graph_dir,
        accflow_path=accflow_path,
        workflows_dir=workflows_dir,
        bundle=bundle,
        child_name_map=child_name_map,
    )


def write_prepared_runtime_graph(
    prepared: PreparedRuntimeGraph,
    run_dir: Path,
    project_root: Path,
) -> Path:
    write_bundle_to_directory(
        prepared.bundle,
        accflow_path=prepared.accflow_path,
        project_root=project_root,
        workflows_dir=prepared.workflows_dir,
    )
    write_runtime_spec_manifest(
        prepared.graph_dir,
        project_root=project_root,
        run_dir=run_dir,
        workflow_id=prepared.workflow_id,
        root_path=prepared.accflow_path,
        child_name_map=prepared.child_name_map,
        child_names=sorted(prepared.bundle.children),
    )
    return prepared.accflow_path


def preflight_runtime_graph(
    graph_payload: dict[str, Any],
    *,
    project_root: Path,
    task_id: str | None = None,
) -> None:
    graph = graph_with_latest_workbench_node_modes(graph_payload, project_root, task_id)
    workflow_id = str(graph.get("id") or "")
    if not workflow_id:
        raise SubmissionError("Workflow graph id is required", status_code=400)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    source_path = (
        project_root / "runs" / "_workflow_function_specs" / "_preflight" / "root.accflow.json"
    )
    bundle = graph_bundle_for_accflow_save(
        graph,
        source_path=source_path,
        callable_registry=CallableRegistry.from_project_root(project_root),
        main_data_edge_policy="preserve_explicit",
    )
    bundle, _child_name_map = runtime_named_workflow_bundle(bundle)
    try:
        resolve_bundle_workflow_refs(
            bundle,
            project_root=project_root,
            workflows_dir=workflows_dir,
            accflow_path=source_path,
            mode="runtime",
        )
    except AccError as exc:
        raise SubmissionError(str(exc), status_code=400) from exc


def runtime_workflow_spec_dir(project_root: Path, run_dir: Path) -> Path:
    run_key = relative_project_path(project_root, run_dir)
    return project_root / "runs" / "_workflow_function_specs" / f"run-{stable_short_hash(run_key)}"


def stable_short_hash(value: str, *, length: int = 12) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def runtime_named_workflow_bundle(
    bundle: CompiledWorkbenchWorkflowBundle,
) -> tuple[CompiledWorkbenchWorkflowBundle, dict[str, str]]:
    child_name_map = {
        child_name: f"child-{index:04d}.accflow.json"
        for index, child_name in enumerate(sorted(bundle.children), start=1)
    }
    if not child_name_map:
        return bundle, {}
    children = {
        child_name_map[child_name]: rewrite_workflow_ref_names(child_payload, child_name_map)
        for child_name, child_payload in bundle.children.items()
    }
    root = rewrite_workflow_ref_names(bundle.root, child_name_map)
    return (
        CompiledWorkbenchWorkflowBundle(
            root=root,
            children=children,
            validation_preview=bundle.validation_preview,
            ref_resolution_preview=bundle.ref_resolution_preview,
            normalization=bundle.normalization,
        ),
        child_name_map,
    )


def rewrite_workflow_ref_names(payload: dict[str, Any], name_map: dict[str, str]) -> dict[str, Any]:
    rewritten = json.loads(json.dumps(payload))
    for node in rewritten.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        ref = node.get("callable_ref")
        if isinstance(ref, dict) and ref.get("kind") == "workflow_function":
            ref_id = str(ref.get("id") or "")
            if ref_id in name_map:
                ref["id"] = name_map[ref_id]
        workflow_ref = node.get("workflow_ref")
        if isinstance(workflow_ref, str) and workflow_ref in name_map:
            node["workflow_ref"] = name_map[workflow_ref]
    metadata = rewritten.get("metadata")
    if isinstance(metadata, dict):
        child_path = metadata.get("compiled_child_path")
        if isinstance(child_path, str) and child_path in name_map:
            metadata["compiled_child_path"] = name_map[child_path]
    return rewritten


def write_runtime_spec_manifest(
    graph_dir: Path,
    *,
    project_root: Path,
    run_dir: Path,
    workflow_id: str,
    root_path: Path,
    child_name_map: dict[str, str],
    child_names: list[str],
) -> None:
    reverse_child_name_map = {new: old for old, new in child_name_map.items()}
    manifest = {
        "schema_version": "acc.runtime.workflow_specs.v1",
        "run_dir": relative_project_path(project_root, run_dir),
        "workflow_id": workflow_id,
        "root": root_path.name,
        "children": [
            {
                "path": child_name,
                "original_path": reverse_child_name_map.get(child_name, child_name),
            }
            for child_name in child_names
        ],
    }
    write_accflow_json(graph_dir / "runtime_specs.json", manifest)


def graph_with_latest_workbench_node_modes(
    graph_payload: dict[str, Any],
    project_root: Path,
    task_id: str | None,
) -> dict[str, Any]:
    if not task_id:
        return graph_payload
    try:
        snapshot = WorkbenchCanvasSnapshotService(project_root).get(task_id)
    except AccError:
        return graph_payload
    canvas_snapshot = snapshot.get("canvas_snapshot")
    if not isinstance(canvas_snapshot, dict):
        return graph_payload
    return merge_workbench_snapshot_projection(graph_payload, canvas_snapshot)


def graph_bundle_for_accflow_save(
    graph: dict[str, Any],
    *,
    source_path: Path,
    callable_registry: CallableRegistry | None = None,
    force_main_data_edge_migration: bool = False,
    main_data_edge_policy: str = "migrate_legacy",
) -> CompiledWorkbenchWorkflowBundle:
    try:
        return compile_workbench_workflow_bundle(
            graph,
            source_path=source_path,
            callable_registry=callable_registry,
            force_main_data_edge_migration=force_main_data_edge_migration,
            main_data_edge_policy=main_data_edge_policy,  # type: ignore[arg-type]
        )
    except AccError as exc:
        raise SubmissionError(str(exc), status_code=400) from exc


def write_bundle_to_directory(
    bundle: CompiledWorkbenchWorkflowBundle,
    *,
    accflow_path: Path,
    project_root: Path,
    workflows_dir: Path | None = None,
) -> dict[str, Any]:
    accflow_path.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = accflow_path.parent / f".bundle-{uuid4().hex[:12]}"
    staging_dir.mkdir(parents=True)
    staging_root = staging_dir / accflow_path.name
    try:
        write_accflow_json(staging_root, bundle.root)
        for child_name, child_payload in bundle.children.items():
            child_path = workflow_storage_path(staging_dir, child_name)
            write_accflow_json(child_path, child_payload)
        base_workflows_dir = workflows_dir or accflow_path.parent
        staged_overlay = {staging_root: bundle.root}
        staged_overlay.update(
            {
                staging_dir / child_name: child_payload
                for child_name, child_payload in bundle.children.items()
            }
        )
        workflow_catalog = WorkflowCatalog(
            project_root=project_root,
            workflows_dir=base_workflows_dir,
            overlay_payloads=staged_overlay,
        )
        validation = validate_workflow_save_path(
            project_root,
            staging_root,
            workflows_dir=staging_dir,
            workflow_catalog=workflow_catalog,
        )
        for child_name in bundle.children:
            replace_workflow_file(staging_dir / child_name, accflow_path.parent / child_name)
        replace_workflow_file(staging_root, accflow_path)
        return validation
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def validate_workflow_save_path(
    project_root: Path,
    temp_path: Path,
    *,
    workflows_dir: Path | None = None,
    workflow_catalog: WorkflowCatalog | None = None,
) -> dict[str, Any]:
    from acc.app import WorkflowAppService

    service = WorkflowAppService(project_root=project_root)
    resolved_dir = workflows_dir or temp_path.parent
    try:
        try:
            validation = service.validate(
                temp_path,
                workflows_dir=resolved_dir,
                workflow_catalog=workflow_catalog,
            )
        except TypeError:
            validation = service.validate(temp_path)
    except (AccError, JsonSchemaValidationError) as exc:
        temp_path.unlink(missing_ok=True)
        raise SubmissionError(str(exc), status_code=400) from exc
    if validation.get("status") == "invalid":
        temp_path.unlink(missing_ok=True)
        raise SubmissionError(
            {"message": "Workflow validation failed", "validation": validation},
            status_code=400,
        )
    return validation


def resolve_bundle_workflow_refs(
    bundle: CompiledWorkbenchWorkflowBundle,
    *,
    project_root: Path,
    workflows_dir: Path,
    accflow_path: Path,
    mode: WorkflowRefMode,
) -> CompiledWorkbenchWorkflowBundle:
    overlay_payloads = {accflow_path: bundle.root}
    overlay_payloads.update(
        {accflow_path.parent / child_name: child for child_name, child in bundle.children.items()}
    )
    catalog = WorkflowCatalog(
        project_root=project_root,
        workflows_dir=workflows_dir,
        overlay_payloads=overlay_payloads,
    )
    root, resolutions = rewrite_workflow_function_refs(
        bundle.root,
        catalog=catalog,
        template_source_path=accflow_path,
        mode=mode,
    )
    children: dict[str, dict[str, Any]] = {}
    for child_name, child_payload in bundle.children.items():
        child_path = accflow_path.parent / child_name
        rewritten_child, child_resolutions = rewrite_workflow_function_refs(
            child_payload,
            catalog=catalog,
            template_source_path=child_path,
            mode=mode,
        )
        children[child_name] = rewritten_child
        resolutions.extend(child_resolutions)
    return CompiledWorkbenchWorkflowBundle(
        root=root,
        children=children,
        validation_preview={
            **bundle.validation_preview,
            "ref_resolution_count": len(resolutions),
        },
        ref_resolution_preview=resolutions,
        normalization=bundle.normalization,
    )


def resolve_runner_environment_before_evidence(
    project_root: Path,
    request: WorkflowGraphSubmissionRequest,
    local_runner_service: LocalRunnerService,
    *,
    graph: dict[str, Any] | None = None,
    manager: WorkbenchRunManager | None = None,
) -> dict[str, Path | None]:
    if request.binding_ref:
        try:
            resolved = local_runner_service.validate_job_before_evidence(
                graph=graph or {"nodes": []},
                workspace_alias=request.workspace_alias,
                binding_ref=request.binding_ref,
                raw_workspace=request.workspace,
                manager=manager,
            )
            return {
                "workspace": None if resolved["binding_path"] else resolved["workspace"],
                "binding_path": resolved["binding_path"],
            }
        except RunnerCapabilityError as exc:
            raise SubmissionError(exc.to_payload(), status_code=400) from exc
    if request.workspace_alias:
        try:
            resolved = local_runner_service.validate_job_before_evidence(
                graph=graph or {"nodes": []},
                workspace_alias=request.workspace_alias,
                raw_workspace=request.workspace,
                manager=manager,
            )
            return {"workspace": resolved["workspace"], "binding_path": None}
        except RunnerCapabilityError as exc:
            raise SubmissionError(exc.to_payload(), status_code=400) from exc
    if graph is not None:
        try:
            local_runner_service.validate_job_before_evidence(
                graph=graph,
                workspace_alias=None,
                raw_workspace=request.workspace,
                manager=manager,
            )
        except RunnerCapabilityError as exc:
            raise SubmissionError(exc.to_payload(), status_code=400) from exc
    workspace, binding_path = resolve_run_environment(project_root, request)
    return {"workspace": workspace, "binding_path": binding_path}


def resolve_run_environment(
    project_root: Path,
    request: WorkflowGraphSubmissionRequest,
) -> tuple[Path | None, Path | None]:
    if request.workspace and (request.binding_path or request.binding_ref):
        raise SubmissionError("Provide workspace or binding, not both", status_code=400)
    if request.binding_path and request.binding_ref:
        raise SubmissionError("Provide binding_path or binding_ref, not both", status_code=400)
    workspace = None
    binding_path = None
    if request.workspace:
        workspace = Path(request.workspace).expanduser().resolve()
        if not workspace.exists() or not workspace.is_dir():
            raise SubmissionError(f"Workspace directory not found: {workspace}", status_code=400)
    if request.binding_path:
        binding_path = resolve_binding_path(project_root, request.binding_path)
    return workspace, binding_path


def resolve_binding_path(project_root: Path, path_value: str) -> Path:
    candidate = (project_root / path_value).resolve()
    bindings_root = (project_root / "bindings").resolve()
    if not candidate.is_relative_to(bindings_root):
        raise SubmissionError("Binding path is outside bindings directory", status_code=400)
    if not candidate.exists() or not candidate.is_file():
        raise SubmissionError("Binding file not found", status_code=404)
    return candidate


def workflow_storage_path(workflows_dir: Path, path_value: str) -> Path:
    if not path_value.endswith(".accflow.json"):
        raise SubmissionError("Workflow path must end with .accflow.json", status_code=400)
    candidate = (workflows_dir / path_value).resolve()
    if not candidate.is_relative_to(workflows_dir.resolve()):
        raise SubmissionError("Workflow path is outside workflows directory", status_code=400)
    return candidate


def write_accflow_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def replace_workflow_file(temp_path: Path, target_path: Path) -> None:
    try:
        temp_path.replace(target_path)
        return
    except PermissionError:
        if target_path.exists():
            os.chmod(target_path, 0o666)
            target_path.unlink()
        temp_path.replace(target_path)


def remember_workbench_task_run(project_root: Path, task_id: str | None, run_id: str) -> None:
    if not task_id:
        return
    try:
        WorkbenchTaskService(project_root).update(
            task_id,
            {
                "active_run_id": None,
                "latest_run_id": run_id,
            },
        )
    except AccError:
        return


def configured_project_dir(project_root: Path, env_name: str, default_value: str) -> Path:
    return resolve_inside_project(project_root, os.environ.get(env_name, default_value))


def resolve_inside_project(project_root: Path, value: str | Path) -> Path:
    raw_path = Path(value)
    candidate = raw_path if raw_path.is_absolute() else project_root / raw_path
    resolved = candidate.resolve()
    if not is_relative_to(resolved, project_root):
        raise SubmissionError("Path is outside project root", status_code=400)
    return resolved


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def relative_project_path(project_root: Path, path: Path) -> str:
    root = project_root.resolve()
    candidate = path if path.is_absolute() else root / path
    try:
        relative = candidate.resolve().relative_to(root)
    except ValueError:
        try:
            relative = candidate.relative_to(root)
        except ValueError as exc:
            raise SubmissionError("Path is outside project root", status_code=400) from exc
    return str(relative).replace("\\", "/")
