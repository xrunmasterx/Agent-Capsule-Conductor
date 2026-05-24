from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Annotated

import typer

from acc.batch import run_batch
from acc.capsule_authoring import clone_capsule, doctor_capsule
from acc.graphops import apply_patch_request, validate_patch_file
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.run_index import load_or_rebuild_run_index, load_run_summary, load_run_summary_by_id
from acc.runner import CapsuleRunner, load_input
from acc.scaffold import scaffold_capsule
from acc.utils import AccError, dump_json, load_json, log_stderr
from acc.workflow_graph import validate_workflow_graph
from acc.workflow_runner import run_workflow_graph_sync, workflow_json

app = typer.Typer(help="Agent Capsule Conductor CLI.")
session_app = typer.Typer(help="Session commands.")
graphops_app = typer.Typer(help="GraphOps control plane commands.")
runs_app = typer.Typer(help="Run discovery and inspection commands.")
capsule_app = typer.Typer(help="Capsule authoring commands.")
workflow_app = typer.Typer(help="Workflow graph commands.")
app.add_typer(session_app, name="session")
app.add_typer(graphops_app, name="graphops")
app.add_typer(runs_app, name="runs")
app.add_typer(capsule_app, name="capsule")
app.add_typer(workflow_app, name="workflow")


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


@app.command()
def run(
    capsule_id: str,
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
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        payload = load_input(input_path, input_json)
        runner = CapsuleRunner(registry=CapsuleRegistry(capsules_dir))
        conductor_output = asyncio.run(runner.run(capsule_id, payload, run_dir))
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
def graphops_validate_patch(patch_path: Path) -> None:
    try:
        patch = validate_patch_file(patch_path)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(
        json.dumps(
            {
                "status": "valid",
                "patch_id": patch["patch_id"],
                "target_path": patch["target_path"],
                "operations": len(patch["operations"]),
            },
            sort_keys=True,
        )
    )


@graphops_app.command("apply-patch")
def graphops_apply_patch(
    patch_path: Path,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Preview without mutation.")] = False,
    apply: Annotated[bool, typer.Option("--apply", help="Perform a real apply.")] = False,
    human_approved: Annotated[
        bool,
        typer.Option("--human-approved", help="Confirm human approval for real apply."),
    ] = False,
) -> None:
    try:
        result = apply_patch_request(
            patch_path,
            dry_run=dry_run,
            apply=apply,
            human_approved=human_approved,
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
        runner = CapsuleRunner(registry=CapsuleRegistry(capsules_dir))
        conductor_output = asyncio.run(run_batch(spec, run_dir, max_concurrency, runner=runner))
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
    run_id: str,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON output.")] = False,
) -> None:
    try:
        summary = load_run_summary_by_id(run_id)
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    payload = summary.model_dump()
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
        runner = CapsuleRunner(registry=CapsuleRegistry(capsules_dir))
        conductor_output = asyncio.run(
            runner.run(capsule_id, load_json(input_path), run_dir)
        )
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
    capsules_dir: Annotated[
        Path | None,
        typer.Option("--capsules-dir", help="Capsule registry directory."),
    ] = None,
) -> None:
    try:
        result = validate_workflow_graph(graph_path, registry=CapsuleRegistry(capsules_dir))
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
) -> None:
    try:
        result = run_workflow_graph_sync(
            graph_path,
            run_dir,
            registry=CapsuleRegistry(capsules_dir),
        )
    except AccError as exc:
        log_stderr(str(exc))
        raise typer.Exit(1) from exc
    typer.echo(workflow_json(result))
    if result["status"] != "success":
        raise typer.Exit(1)
    if not emit_json:
        return


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


if __name__ == "__main__":
    main()
