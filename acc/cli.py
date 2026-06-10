from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

from acc.app import (
    WorkflowAppService,
    create_clean_environment_binding,
    load_cli_input,
)
from acc.app.core_v2_loader import LEGACY_GRAPH_SUFFIX
from acc.app.workbench_adapter import compile_workbench_workflow_bundle
from acc.callable_registry import CallableRegistry
from acc.control_plane import (
    list_callables_payload,
    list_workflows_payload,
    read_artifact_payload,
    show_callable_payload,
    show_run_payload,
    show_workflow_payload,
)
from acc.debugger import (
    artifact_diff,
    diff_runs,
    replay_workflow_events,
)
from acc.environment import create_workspace_binding, inspect_environment_run
from acc.migration.graph_importer import (
    accflow_path_from_legacy_graph_path,
    legacy_graph_to_accflow_payload,
)
from acc.port_io import inspect_ports_run
from acc.run_index import load_or_rebuild_run_index, load_run_summary
from acc.store import is_clean_workflow_path, write_json
from acc.utils import AccError, dump_json, load_json, log_stderr

app = typer.Typer(help="Agent Callable Conductor CLI.")
session_app = typer.Typer(help="Session commands.")
graphops_app = typer.Typer(help="GraphOps control plane commands.")
runs_app = typer.Typer(help="Run discovery and inspection commands.")
callable_app = typer.Typer(help="Core v2 callable class commands.")
callables_app = typer.Typer(help="Core v2 callable class discovery commands.")
workflow_app = typer.Typer(help="Workflow graph commands.")
workflows_app = typer.Typer(help="Agent-callable workflow discovery commands.")
migrate_app = typer.Typer(help="Migration commands.")
conductor_app = typer.Typer(help="Conductor export commands.")
events_app = typer.Typer(help="Workflow event replay commands.")
artifacts_app = typer.Typer(help="Artifact comparison commands.")
environment_app = typer.Typer(help="Environment inspection commands.")
ports_app = typer.Typer(help="Port inbox/outbox inspection commands.")
template_app = typer.Typer(help="Template bundle export/import commands.")
mcp_app = typer.Typer(help="MCP stdio server commands.")
app.add_typer(session_app, name="session")
app.add_typer(graphops_app, name="graphops")
app.add_typer(runs_app, name="runs")
app.add_typer(callable_app, name="callable")
app.add_typer(callables_app, name="callables")
app.add_typer(workflow_app, name="workflow")
app.add_typer(workflows_app, name="workflows")
app.add_typer(migrate_app, name="migrate")
app.add_typer(conductor_app, name="conductor")
app.add_typer(events_app, name="events")
app.add_typer(artifacts_app, name="artifacts")
app.add_typer(environment_app, name="environment")
app.add_typer(ports_app, name="ports")
app.add_typer(template_app, name="template")
app.add_typer(mcp_app, name="mcp")


@app.callback()
def callback() -> None:
    """Wrap external agents and tools as deterministic callable workflows."""


@callable_app.command("list")
@callables_app.command("list")
def callable_list(
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = list_callables_payload()
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    if json_output:
        typer.echo(dump_json(payload))
        return
    for item in payload["callables"]:
        typer.echo(f"{item['id']}\t{item['kind']}\t{item['version']}")


@callable_app.command("show")
@callables_app.command("show")
def callable_show(
    callable_id: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = show_callable_payload(callable_id)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(payload) if json_output else dump_json(payload))


@app.command("run")
def run(
    legacy_ref_or_command: Annotated[
        str,
        typer.Argument(help="Legacy runtime ref or diff subcommand."),
    ],
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
) -> None:
    if legacy_ref_or_command == "diff":
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
        _ = load_cli_input(input_path, input_json)
        _ = run_dir, legacy_ref_or_command
        raise AccError(
            "`acc run <legacy-ref>` no longer executes legacy runtime assets. "
            "Use `acc workflow run <workflow.accflow.json>`."
        )
    except (AccError, json.JSONDecodeError) as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    finally:
        _ = emit_conductor_json


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


@mcp_app.command("serve")
def mcp_serve(
    project_root: Annotated[
        Path,
        typer.Option("--project-root", help="ACC project root for MCP tools."),
    ] = Path("."),
) -> None:
    try:
        from acc.mcp_server import run_stdio_server
    except ImportError as exc:
        log_stderr(f"MCP dependencies are not installed: {exc}")
        raise typer.Exit(1) from exc
    run_stdio_server(project_root.resolve())


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


@workflow_app.command("validate")
def workflow_validate(
    graph_path: Path,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Preview execution plan without creating a run."),
    ] = False,
) -> None:
    try:
        result = WorkflowAppService().validate(
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
                f"Legacy {LEGACY_GRAPH_SUFFIX} is import-only; convert with "
                f"`acc workflow import-graph {graph_path}`"
            ),
        }
    typer.echo(dump_json(result))


@workflow_app.command("normalize")
def workflow_normalize(
    graph_path: Path,
    write: Annotated[
        bool,
        typer.Option("--write", help="Write normalized workflow files."),
    ] = False,
    force: Annotated[
        bool,
        typer.Option("--force", help="Allow mixed fan-out main forwarding migration."),
    ] = False,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        payload = load_json(graph_path)
        if not isinstance(payload, dict):
            raise AccError(f"Workflow JSON must be an object: {graph_path}")
        bundle = compile_workbench_workflow_bundle(
            payload,
            source_path=graph_path,
            callable_registry=CallableRegistry.from_project_root(Path(".").resolve()),
            force_main_data_edge_migration=force,
            allow_normalization_conflicts=not write,
        )
        result: dict[str, Any] = {
            "status": "preview",
            "path": str(graph_path.resolve()),
            "workflow_id": bundle.root.get("id"),
            "normalization": bundle.normalization,
        }
        if write:
            if bundle.normalization.get("conflicts") and not force:
                raise AccError(
                    "Workflow normalization has conflicts; rerun with --force after review"
                )
            write_json(graph_path, bundle.root)
            for child_name, child_payload in bundle.children.items():
                write_json(graph_path.parent / child_name, child_payload)
            validation = WorkflowAppService().validate(
                graph_path,
                workflows_dir=graph_path.parent,
            )
            result["status"] = "written"
            result["validation"] = validation
            if validation.get("status") == "invalid":
                raise AccError(f"Workflow validation failed after normalize: {validation}")
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result) if json_output else dump_json(result))


@workflow_app.command("import-graph")
def workflow_import_graph(
    graph_path: Path,
    out: Annotated[
        Path | None,
        typer.Option("-o", "--out", help="Output .accflow.json path."),
    ] = None,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    legacy_assets_dir: Annotated[
        Path | None,
        typer.Option(
            "--legacy-assets-dir",
            help="Directory containing migration-only legacy assets.",
        ),
    ] = None,
) -> None:
    try:
        result = import_legacy_graph_payload(graph_path, out, legacy_assets_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


@migrate_app.command("graph")
def migrate_graph(
    graph_path: Path,
    out: Annotated[
        Path | None,
        typer.Option("-o", "--out", help="Output .accflow.json path."),
    ] = None,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
    legacy_assets_dir: Annotated[
        Path | None,
        typer.Option(
            "--legacy-assets-dir",
            help="Directory containing migration-only legacy assets.",
        ),
    ] = None,
) -> None:
    try:
        result = import_legacy_graph_payload(graph_path, out, legacy_assets_dir)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(dump_json(result))


def import_legacy_graph_payload(
    graph_path: Path,
    out: Path | None,
    legacy_assets_dir: Path | None,
) -> dict[str, Any]:
    if not graph_path.name.endswith(LEGACY_GRAPH_SUFFIX):
        raise AccError(f"Input path must end with {LEGACY_GRAPH_SUFFIX}")
    output_path = out or accflow_path_from_legacy_graph_path(graph_path)
    if not output_path.name.endswith(".accflow.json"):
        raise AccError("Migration output path must end with .accflow.json")
    source_dir = graph_path.resolve().parent
    if not output_path.resolve().is_relative_to(source_dir):
        raise AccError("Migration output path must stay inside the source graph directory")
    payload = legacy_graph_to_accflow_payload(graph_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, payload)
    _ = legacy_assets_dir
    validation = WorkflowAppService().validate(output_path)
    return {
        "status": "imported",
        "source_path": str(graph_path.resolve()),
        "output_path": str(output_path.resolve()),
        "workflow_id": payload.get("id"),
        "validation": validation,
    }


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
        result = WorkflowAppService().run_sync(
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
) -> None:
    try:
        payload = list_workflows_payload(workflows_dir=workflows_dir)
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
) -> None:
    try:
        payload = show_workflow_payload(
            workflow_ref,
            workflows_dir=workflows_dir,
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
) -> None:
    _ = graph_path, out
    log_stderr(
        "Legacy Conductor export from pre-Core-v2 workflow graphs has been removed. "
        "Export support must be rebuilt from Core v2 WorkflowFunctionTemplate."
    )
    raise typer.Exit(1)


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
        "conductor_output": conductor_output,
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
