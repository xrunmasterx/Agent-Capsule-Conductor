from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from acc.app import (
    CapsuleAppService,
    WorkflowAppService,
    create_clean_environment_binding,
    load_capsule_input,
)
from acc.capsule_authoring import clone_capsule, doctor_capsule
from acc.conductor_export import export_conductor_yaml
from acc.control_plane import (
    list_capsules_payload,
    list_workflows_payload,
    read_artifact_payload,
    show_capsule_payload,
    show_run_payload,
    show_workflow_payload,
)
from acc.debugger import (
    artifact_diff,
    diff_runs,
    fork_run,
    replay_workflow_events,
    rerun_from_node,
    rerun_single_node,
)
from acc.environment import create_workspace_binding, inspect_environment_run
from acc.graphops import apply_patch_request, dry_run_patch, validate_patch_file
from acc.legacy_graph_importer import (
    accflow_path_from_legacy_graph_path,
    legacy_graph_to_accflow_payload,
)
from acc.port_io import inspect_ports_run
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.run_index import load_or_rebuild_run_index, load_run_summary
from acc.scaffold import scaffold_capsule
from acc.store import is_clean_workflow_path, write_json
from acc.utils import AccError, dump_json, load_json, log_stderr

app = typer.Typer(help="Agent Capsule Conductor CLI.")
session_app = typer.Typer(help="Session commands.")
graphops_app = typer.Typer(help="GraphOps control plane commands.")
runs_app = typer.Typer(help="Run discovery and inspection commands.")
capsule_app = typer.Typer(help="Capsule authoring commands.")
capsules_app = typer.Typer(help="Agent-callable capsule discovery commands.")
workflow_app = typer.Typer(help="Workflow graph commands.")
workflows_app = typer.Typer(help="Agent-callable workflow discovery commands.")
conductor_app = typer.Typer(help="Conductor export commands.")
events_app = typer.Typer(help="Workflow event replay commands.")
artifacts_app = typer.Typer(help="Artifact comparison commands.")
environment_app = typer.Typer(help="Environment inspection commands.")
ports_app = typer.Typer(help="Port inbox/outbox inspection commands.")
template_app = typer.Typer(help="Template bundle export/import commands.")
app.add_typer(session_app, name="session")
app.add_typer(graphops_app, name="graphops")
app.add_typer(runs_app, name="runs")
app.add_typer(capsule_app, name="capsule")
app.add_typer(capsules_app, name="capsules")
app.add_typer(workflow_app, name="workflow")
app.add_typer(workflows_app, name="workflows")
app.add_typer(conductor_app, name="conductor")
app.add_typer(events_app, name="events")
app.add_typer(artifacts_app, name="artifacts")
app.add_typer(environment_app, name="environment")
app.add_typer(ports_app, name="ports")
app.add_typer(template_app, name="template")


@app.callback()
def callback() -> None:
    """Wrap external agents as deterministic workflow capsules."""


@app.command("list")
def list_capsules(
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    registry = CapsuleRegistry(capsules_dir)
    try:
        capsules = [capsule.to_metadata() for capsule in registry.discover()]
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc

    if json_output:
        typer.echo(dump_json(capsules))
        return

    for capsule in capsules:
        typer.echo(f"{capsule['id']}\t{capsule['runtime']}\t{capsule['name']}")


@app.command()
def show(
    capsule_id: str,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    registry = CapsuleRegistry(capsules_dir)
    try:
        capsule = registry.get(capsule_id)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(capsule.to_metadata()))


@capsules_app.command("list")
def capsules_list(
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = list_capsules_payload(capsules_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@capsules_app.command("show")
def capsules_show(
    capsule_id: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = show_capsule_payload(capsule_id, capsules_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@app.command()
def validate(
    capsule_id: str,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    registry = CapsuleRegistry(capsules_dir)
    try:
        capsule = registry.get(capsule_id)
        errors = validate_capsule_files(capsule)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc

    if errors:
        for error in errors:
            log_stderr(error)
        raise typer.Exit(1)

    typer.echo(
        json.dumps(
            {"status": "valid", "capsule_id": capsule.spec.id},
            ensure_ascii=False,
            sort_keys=True,
        )
    )


@app.command("run")
def run(
    capsule_or_command: Annotated[str, typer.Argument(help="Capsule id or diff subcommand.")],
    run_a: Annotated[str | None, typer.Argument(help="First run path for diff mode.")] = None,
    run_b: Annotated[str | None, typer.Argument(help="Second run path for diff mode.")] = None,
    input_path: Annotated[Path | None, typer.Option("--input", help="Input JSON path.")] = None,
    run_dir: Annotated[Path, typer.Option("--run-dir", help="Run directory.")] = Path("runs/run"),
    input_json: Annotated[
        str | None,
        typer.Option("--input-json", help="Input JSON object."),
    ] = None,
    emit_conductor_json: Annotated[
        bool,
        typer.Option("--emit-conductor-json", help="Print exactly one Conductor JSON object."),
    ] = False,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    if capsule_or_command == "diff":
        if not run_a or not run_b:
            log_stderr("run diff requires two run paths")
            raise typer.Exit(2)
        try:
            payload = diff_runs(Path(run_a), Path(run_b))
        except AccError as exc:
            log_stderr(str(exc))
            raise typer.Exit(1) from exc
        typer.echo(dump_json(payload) if json_output else dump_json(payload))
        return

    try:
        payload = load_capsule_input(input_path, input_json)
        conductor_output = CapsuleAppService(
            registry=CapsuleRegistry(capsules_dir)
        ).run_capsule_sync(capsule_or_command, payload, run_dir)
    except (AccError, json.JSONDecodeError) as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc

    typer.echo(json.dumps(conductor_output, ensure_ascii=False, sort_keys=True))
    if conductor_output["status"] != "success":
        raise typer.Exit(1)
    if not emit_conductor_json:
        return


@app.command()
def inspect(
    run_dir: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        summary = inspect_session(run_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    if not json_output:
        typer.echo(dump_json(summary))
        return
    typer.echo(dump_json(summary))


@session_app.command("inspect")
def session_inspect(run_dir: Path) -> None:
    try:
        summary = inspect_session(run_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(summary))


@graphops_app.command("validate-patch")
def graphops_validate_patch(
    patch_path: Path,
    semantic: Annotated[
        bool,
        typer.Option("--semantic", help="Run semantic validation after dry-run materialization."),
    ] = False,
) -> None:
    try:
        patch = validate_patch_file(patch_path)
        semantic_diff = None
        if semantic:
            from acc.graphops import semantic_diff_for_patch

            semantic_diff = semantic_diff_for_patch(patch)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    payload = {
        "status": "valid",
        "patch_id": patch["patch_id"],
        "target_path": patch["target_path"],
        "operations": len(patch["operations"]),
    }
    if semantic_diff is not None:
        payload["semantic_diff"] = semantic_diff
        if semantic_diff["status"] == "invalid":
            typer.echo(dump_json(payload))
            raise typer.Exit(1)
    typer.echo(json.dumps(payload, sort_keys=True))


@graphops_app.command("validate")
def graphops_validate(
    patch_path: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    semantic: Annotated[
        bool,
        typer.Option("--semantic", help="Run semantic validation after dry-run materialization."),
    ] = False,
) -> None:
    try:
        patch = validate_patch_file(patch_path)
        payload = {
            "status": "valid",
            "patch_id": patch["patch_id"],
            "target_type": patch["target_type"],
            "target_path": patch["target_path"],
            "operations": len(patch["operations"]),
        }
        if semantic:
            from acc.graphops import semantic_diff_for_patch

            payload["semantic_diff"] = semantic_diff_for_patch(patch)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    if semantic and payload["semantic_diff"]["status"] == "invalid":
        typer.echo(dump_json(payload) if json_output else dump_json(payload))
        raise typer.Exit(1)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@graphops_app.command("dry-run")
def graphops_dry_run(
    patch_path: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    semantic: Annotated[
        bool,
        typer.Option("--semantic", help="Run semantic validation after dry-run materialization."),
    ] = False,
) -> None:
    try:
        payload = dry_run_patch(validate_patch_file(patch_path), semantic=semantic)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@graphops_app.command("apply-patch")
def graphops_apply_patch(
    patch_path: Path,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Preview without mutation.")] = False,
    apply: Annotated[bool, typer.Option("--apply", help="Perform a real apply.")] = False,
    human_approved: Annotated[
        bool,
        typer.Option("--human-approved", help="Confirm human approval for real apply."),
    ] = False,
    semantic: Annotated[
        bool,
        typer.Option("--semantic", help="Run semantic validation after dry-run materialization."),
    ] = False,
) -> None:
    try:
        result = apply_patch_request(
            patch_path,
            dry_run=dry_run,
            apply=apply,
            human_approved=human_approved,
            semantic=semantic,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


@app.command("batch-run")
def batch_run_command(
    spec: Annotated[Path, typer.Option("--spec", help="Batch spec JSON path.")],
    run_dir: Annotated[Path, typer.Option("--run-dir", help="Batch run directory.")],
    max_concurrency: Annotated[int, typer.Option("--max-concurrency", help="Task concurrency.")],
    emit_conductor_json: Annotated[
        bool,
        typer.Option("--emit-conductor-json", help="Print exactly one Conductor JSON object."),
    ] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        conductor_output = CapsuleAppService(registry=CapsuleRegistry(capsules_dir)).run_batch_sync(
            spec, run_dir, max_concurrency
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(json.dumps(conductor_output, ensure_ascii=False, sort_keys=True))
    if conductor_output["status"] != "success":
        raise typer.Exit(1)
    if not emit_conductor_json:
        return


@app.command("server")
def server_command(
    host: Annotated[str, typer.Option("--host", help="Server bind host.")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", help="Server bind port.")] = 8765,
) -> None:
    try:
        import uvicorn

        from acc.server.app import create_app
    except ImportError as exc:
        log_stderr(f"Server dependencies are not installed: {exc}")
        raise typer.Exit(1) from exc

    uvicorn.run(create_app(), host=host, port=port)


@runs_app.command("list")
def runs_list(
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    index = load_or_rebuild_run_index()
    if json_output:
        typer.echo(dump_json(index.model_dump()))
        return
    for run in index.runs:
        failed = ",".join(run.failed_nodes)
        typer.echo(
            "\t".join(
                [
                    run.run_id,
                    run.status,
                    run.started_at or "",
                    run.output_path or "",
                    run.artifact_dir or "",
                    failed,
                ]
            )
        )


@runs_app.command("show")
def runs_show(
    run_ref: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = show_run_payload(run_ref)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    if json_output:
        typer.echo(dump_json(payload))
        return
    typer.echo(dump_json(payload))


@capsule_app.command("test")
def capsule_test(
    capsule_id: str,
    input_path: Annotated[Path, typer.Option("--input", help="Input JSON path.")],
    run_dir: Annotated[Path, typer.Option("--run-dir", help="Run directory.")],
    emit_conductor_json: Annotated[
        bool,
        typer.Option("--emit-conductor-json", help="Print exactly one Conductor JSON object."),
    ] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = load_json(input_path)
        if not isinstance(payload, dict):
            raise AccError(f"Input JSON must be an object: {input_path}")
        conductor_output = CapsuleAppService(
            registry=CapsuleRegistry(capsules_dir)
        ).run_capsule_sync(capsule_id, payload, run_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(json.dumps(conductor_output, ensure_ascii=False, sort_keys=True))
    if conductor_output["status"] != "success":
        raise typer.Exit(1)
    if not emit_conductor_json:
        return


@capsule_app.command("clone")
def capsule_clone(
    source_id: str,
    new_id: str,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        result = clone_capsule(source_id, new_id, registry=CapsuleRegistry(capsules_dir))
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


@capsule_app.command("doctor")
def capsule_doctor(
    capsule_id: str,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    result = doctor_capsule(capsule_id, registry=CapsuleRegistry(capsules_dir))
    typer.echo(dump_json(result))
    if result["status"] != "valid":
        raise typer.Exit(1)


@capsule_app.command("scaffold")
def capsule_scaffold(
    blueprint: Annotated[
        Path | None,
        typer.Option("--blueprint", help="Capsule blueprint JSON path."),
    ] = None,
    capsule_id: Annotated[
        str | None,
        typer.Option("--id", help="Capsule id for template scaffolding."),
    ] = None,
    runtime: Annotated[str, typer.Option("--runtime", help="Runtime type.")] = "generic_cli",
    template: Annotated[str, typer.Option("--template", help="Scaffold template.")] = "simple",
    force: Annotated[bool, typer.Option("--force", help="Overwrite an existing capsule.")] = False,
    capsules_dir: Annotated[
        Path,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = Path("capsules"),
) -> None:
    try:
        result = scaffold_capsule(
            blueprint_path=blueprint,
            capsule_id=capsule_id,
            runtime=runtime,
            template=template,
            capsules_dir=capsules_dir,
            force=force,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


@workflow_app.command("validate")
def workflow_validate(
    graph_path: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Preview execution plan without creating a run."),
    ] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        result = WorkflowAppService(registry=CapsuleRegistry(capsules_dir)).validate(
            graph_path,
            dry_run=dry_run,
            workflows_dir=graph_path.parent,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    if result.get("status") == "invalid":
        log_stderr(json.dumps(result, ensure_ascii=False, indent=2))
        raise typer.Exit(1)
    if not is_clean_workflow_path(graph_path):
        result = {
            **result,
            "import_hint": (
                f"Legacy .graph.json is import-only; convert with "
                f"`acc workflow import-graph {graph_path}`"
            ),
        }
    typer.echo(dump_json(result))


@workflow_app.command("import-graph")
def workflow_import_graph(
    graph_path: Path,
    out: Annotated[
        Path | None,
        typer.Option("-o", "--out", help="Output .accflow.json path."),
    ] = None,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    if not graph_path.name.endswith(".graph.json"):
        log_stderr("Input path must end with .graph.json")
        raise typer.Exit(1)
    output_path = out or accflow_path_from_legacy_graph_path(graph_path)
    try:
        payload = legacy_graph_to_accflow_payload(graph_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(output_path, payload)
        validation = WorkflowAppService(registry=CapsuleRegistry(capsules_dir)).validate(
            output_path
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    result = {
        "status": "imported",
        "source_path": str(graph_path.resolve()),
        "output_path": str(output_path.resolve()),
        "workflow_id": payload.get("id"),
        "validation": validation,
    }
    typer.echo(dump_json(result))


@workflow_app.command("bind")
def workflow_bind(
    graph_path: Path,
    workspace: Annotated[Path, typer.Option("--workspace", help="Workspace directory.")],
    out: Annotated[Path, typer.Option("--out", help="Local binding JSON path.")],
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        if is_clean_workflow_path(graph_path):
            result = create_clean_environment_binding(graph_path, workspace, out)
        else:
            result = create_workspace_binding(graph_path, workspace, out)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


@workflow_app.command("run")
def workflow_run(
    graph_path: Path,
    run_dir: Annotated[Path, typer.Option("--run-dir", help="Workflow run directory.")],
    emit_json: Annotated[
        bool,
        typer.Option("--emit-json", help="Print exactly one workflow JSON object."),
    ] = False,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
    workspace: Annotated[
        Path | None,
        typer.Option("--workspace", help="Workspace directory for a stateful environment."),
    ] = None,
    binding: Annotated[
        Path | None,
        typer.Option("--binding", help="Local workspace binding JSON path."),
    ] = None,
) -> None:
    try:
        result = WorkflowAppService(registry=CapsuleRegistry(capsules_dir)).run_sync(
            graph_path,
            run_dir,
            workspace=workspace,
            binding_path=binding,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))
    if result["status"] != "success":
        raise typer.Exit(1)
    if not emit_json:
        return


@environment_app.command("inspect")
def environment_inspect(
    run_dir: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    payload = inspect_environment_run(run_dir)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@ports_app.command("inspect")
def ports_inspect(
    run_dir: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    payload = inspect_ports_run(run_dir)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@workflows_app.command("list")
def workflows_list(
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    workflows_dir: Annotated[
        Path | None,
        typer.Option("--workflows-dir", help="Workflow directory."),
    ] = None,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = list_workflows_payload(workflows_dir=workflows_dir, capsules_dir=capsules_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@workflows_app.command("show")
def workflows_show(
    workflow_ref: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    workflows_dir: Annotated[
        Path | None,
        typer.Option("--workflows-dir", help="Workflow directory."),
    ] = None,
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = show_workflow_payload(
            workflow_ref,
            workflows_dir=workflows_dir,
            capsules_dir=capsules_dir,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@workflow_app.command("events")
def workflow_events(
    run_dir: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    payload = WorkflowAppService().events(run_dir)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@workflow_app.command("inspect")
def workflow_inspect(
    run_dir: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    payload = WorkflowAppService().inspect(run_dir)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@workflow_app.command("rerun-node")
def workflow_rerun_node(
    run_dir: Path,
    node_id: str,
    out: Annotated[Path, typer.Option("--out", help="New run directory for the rerun.")],
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = rerun_single_node(
            run_dir,
            node_id,
            out,
            registry=CapsuleRegistry(capsules_dir),
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload))
    if payload["status"] != "success":
        raise typer.Exit(1)


@workflow_app.command("rerun-from")
def workflow_rerun_from(
    run_dir: Path,
    node_id: str,
    out: Annotated[Path, typer.Option("--out", help="New run directory for the rerun.")],
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = rerun_from_node(
            run_dir,
            node_id,
            out,
            registry=CapsuleRegistry(capsules_dir),
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload))
    if payload["status"] != "success":
        raise typer.Exit(1)


@workflow_app.command("fork")
def workflow_fork(
    run_dir: Path,
    from_node: Annotated[str, typer.Option("--from-node", help="Node to fork from.")],
    input_path: Annotated[Path, typer.Option("--input", help="Fork override JSON path.")],
    out: Annotated[Path, typer.Option("--out", help="New run directory for the fork.")],
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = fork_run(
            run_dir,
            from_node,
            input_path,
            out,
            registry=CapsuleRegistry(capsules_dir),
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload))
    if payload["status"] != "success":
        raise typer.Exit(1)


@events_app.command("replay")
def events_replay(
    run_dir: Path,
    node: Annotated[str | None, typer.Option("--node", help="Replay one node only.")] = None,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = replay_workflow_events(run_dir, node)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@artifacts_app.command("diff")
def artifacts_diff(
    artifact_a: Path,
    artifact_b: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    payload = artifact_diff(artifact_a, artifact_b)
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@artifacts_app.command("get")
def artifacts_get(
    artifact_ref: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = read_artifact_payload(artifact_ref)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@conductor_app.command("export")
def conductor_export(
    graph_path: Path,
    out: Annotated[Path, typer.Option("--out", help="Output Conductor YAML path.")],
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        result = export_conductor_yaml(graph_path, out, registry=CapsuleRegistry(capsules_dir))
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


def main() -> None:
    app()


def inspect_session(run_dir: Path) -> dict:
    conductor_path = run_dir / "conductor_output.json"
    manifest_path = run_dir / "session_manifest.json"
    run_manifest_path = run_dir / "run_manifest.json"
    artifacts_dir = run_dir / "artifacts"
    conductor_output = load_json(conductor_path) if conductor_path.exists() else None
    session_manifest = load_json(manifest_path) if manifest_path.exists() else None
    run_manifest = load_json(run_manifest_path) if run_manifest_path.exists() else None
    run_summary = load_run_summary(run_dir)
    artifacts = (
        sorted(path.name for path in artifacts_dir.glob("*")) if artifacts_dir.exists() else []
    )
    status = (
        (run_summary.status if run_summary is not None else None)
        or (conductor_output or {}).get("status")
        or (session_manifest or {}).get("status")
    )
    output_path = (run_summary.output_path if run_summary is not None else None) or (
        conductor_output or {}
    ).get("output_path")
    return {
        "run_dir": str(run_dir.resolve()),
        "status": status,
        "output_path": output_path,
        "artifacts": artifacts,
        "artifact_dir": str(artifacts_dir.resolve()),
        "stderr": str((run_dir / "stderr.log").resolve()),
        "event_log": str((run_dir / "events.jsonl").resolve()),
        "events": str((run_dir / "events.jsonl").resolve()),
        "run_summary": run_summary.model_dump() if run_summary is not None else None,
        "conductor_output": load_json(conductor_path) if conductor_path.exists() else None,
        "session_manifest": session_manifest,
        "run_manifest": run_manifest,
    }


@template_app.command("export")
def template_export(
    output: Annotated[Path, typer.Option("-o", "--output", help="Output bundle zip path.")],
    class_id: Annotated[str | None, typer.Option("--class", help="Agent class id.")] = None,
    workflow_id: Annotated[str | None, typer.Option("--workflow", help="Workflow id.")] = None,
    project_root: Annotated[Path, typer.Option("--project-root", help="Project root.")] = Path("."),
) -> None:
    from acc.app.template_bundle import export_template_bundle

    try:
        manifest = export_template_bundle(
            project_root=project_root.resolve(),
            output_path=output,
            class_id=class_id,
            workflow_id=workflow_id,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json({"status": "exported", "manifest": manifest}))


@template_app.command("import")
def template_import(
    bundle: Path,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Validate without writing.")] = False,
    fork_id: Annotated[str | None, typer.Option("--fork-id", help="Fork target id.")] = None,
    replace: Annotated[bool, typer.Option("--replace", help="Replace existing templates.")] = False,
    human_approved: Annotated[
        bool,
        typer.Option("--human-approved", help="Required with --replace."),
    ] = False,
    project_root: Annotated[Path, typer.Option("--project-root", help="Project root.")] = Path("."),
) -> None:
    from acc.app.template_bundle import import_template_bundle

    try:
        result = import_template_bundle(
            project_root=project_root.resolve(),
            bundle_path=bundle,
            dry_run=dry_run,
            fork_id=fork_id,
            replace=replace,
            human_approved=human_approved,
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


if __name__ == "__main__":
    main()
