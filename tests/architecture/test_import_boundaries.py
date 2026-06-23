from __future__ import annotations

import ast
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ACC_ROOT = PROJECT_ROOT / "acc"


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module)
    return imports


def package_files(package: str) -> list[Path]:
    package_path = ACC_ROOT / package
    if package_path.is_file():
        return [package_path]
    if package_path.with_suffix(".py").is_file():
        return [package_path.with_suffix(".py")]
    return sorted(path for path in package_path.rglob("*.py") if "__pycache__" not in path.parts)


def assert_no_forbidden_imports(package: str, forbidden: set[str]) -> None:
    violations: list[str] = []
    for path in package_files(package):
        for module in imported_modules(path):
            if module in forbidden or any(module.startswith(f"{item}.") for item in forbidden):
                violations.append(f"{path.relative_to(PROJECT_ROOT)} imports {module}")
    assert violations == []


def called_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    calls: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            calls.add(node.func.id)
        elif isinstance(node.func, ast.Attribute):
            calls.add(node.func.attr)
    return calls


def assert_no_forbidden_calls(package: str, forbidden: set[str]) -> None:
    violations: list[str] = []
    for path in package_files(package):
        for name in called_names(path):
            if name in forbidden:
                violations.append(f"{path.relative_to(PROJECT_ROOT)} calls {name}")
    assert violations == []


def test_domain_has_no_io_process_or_layer_imports() -> None:
    assert_no_forbidden_imports(
        "domain",
        {
            "acc.app",
            "acc.cli",
            "acc.engine",
            "acc.runtime",
            "acc.server",
            "acc.store",
            "fastapi",
            "os",
            "subprocess",
            "typer",
        },
    )


def test_engine_is_pure_graph_logic() -> None:
    assert_no_forbidden_imports(
        "engine",
        {
            "acc.app",
            "acc.cli",
            "acc.runtime",
            "acc.server",
            "acc.store",
            "os",
            "subprocess",
            "typer",
        },
    )


def test_domain_and_engine_do_not_perform_filesystem_io() -> None:
    forbidden_calls = {
        "open",
        "read_text",
        "write_text",
        "mkdir",
        "unlink",
        "rmtree",
        "copy2",
        "copytree",
        "create_subprocess_exec",
        "run",
        "Popen",
    }
    assert_no_forbidden_calls("domain", forbidden_calls)
    assert_no_forbidden_calls("engine", forbidden_calls)


def test_store_does_not_depend_on_runtime_cli_or_engine() -> None:
    assert_no_forbidden_imports(
        "store",
        {
            "acc.cli",
            "acc.engine",
            "acc.runtime",
            "acc.server",
            "subprocess",
            "typer",
        },
    )


def test_runtime_does_not_depend_on_cli_or_server() -> None:
    assert_no_forbidden_imports(
        "runtime",
        {
            "acc.app",
            "acc.cli",
            "acc.server",
            "acc.store",
            "fastapi",
            "typer",
        },
    )


def test_app_does_not_import_cli() -> None:
    assert_no_forbidden_imports("app", {"acc.cli", "typer"})


def test_app_workflow_submission_is_route_neutral() -> None:
    assert_no_forbidden_imports(
        "app/workflow_submission.py",
        {
            "fastapi",
            "acc.server.routes",
        },
    )


def test_new_code_does_not_import_core_v2_runtime_shim() -> None:
    """Keep acc.app.core_v2_runtime as compatibility-only, not a canonical import path."""

    allowed_files = {
        ACC_ROOT / "app" / "core_v2_runtime.py",
    }
    violations: list[str] = []
    for path in ACC_ROOT.rglob("*.py"):
        if path in allowed_files or "__pycache__" in path.parts:
            continue
        for module in imported_modules(path):
            if module == "acc.app.core_v2_runtime" or module.startswith(
                "acc.app.core_v2_runtime."
            ):
                violations.append(f"{path.relative_to(PROJECT_ROOT)} imports {module}")
    assert violations == []


def test_run_status_sets_are_defined_only_in_canonical_module() -> None:
    """Run-summary status taxonomy must live in acc.run_status.

    Temporary re-export aliases are allowed from acc.app.run_lifecycle for legacy callers,
    but new local status-set definitions should fail this proof gate.
    """

    allowed_defs = {
        ACC_ROOT / "run_status.py",
        ACC_ROOT / "app" / "run_lifecycle.py",
    }
    forbidden_names = {
        "TERMINAL_RUN_STATUSES",
        "ACTIVE_RUN_STATUSES",
        "WAITING_RUN_STATUSES",
        "RESUMING_RUN_STATUSES",
        "RESTART_INTERRUPTED_RUN_STATUSES",
    }
    violations: list[str] = []
    for path in ACC_ROOT.rglob("*.py"):
        if path in allowed_defs or "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and target.id in forbidden_names:
                    violations.append(
                        f"{path.relative_to(PROJECT_ROOT)} defines {target.id}"
                    )
    assert violations == []


def test_route_boundary_regressions_are_recorded_as_known_deviations() -> None:
    """Keep route-owned orchestration visible until the submission routes are thinned."""

    routes_path = ACC_ROOT / "server" / "routes" / "workflows.py"
    text = routes_path.read_text(encoding="utf-8")
    current_deviations = {
        "sync run route still owns preflight": "preflight_runtime_graph(payload.graph, request",
        "sync run route still claims runs": "claim_run_for_payload(",
        "route helper still constructs callable registry": "CallableRegistry.from_project_root(project_root)",
        "route helper still compiles runtime graph": "def compile_runtime_graph(",
    }
    missing = [name for name, marker in current_deviations.items() if marker not in text]
    if missing:
        pytest.fail(
            "Route-boundary deviation markers changed; update this proof gate and the "
            f"P0 freeze/status plans before claiming route cleanup complete: {missing}"
        )


def test_cli_does_not_import_concrete_runtime_runners() -> None:
    assert_no_forbidden_imports(
        "cli",
        {
            "acc.adapters",
            "acc.runner",
            "acc.runtime",
            "acc.workflow_runner",
        },
    )


def test_runtime_layers_do_not_import_legacy_workflow_graph_authoring() -> None:
    for package in ("app", "runtime", "store", "cli", "server"):
        assert_no_forbidden_imports(package, {"acc.workflow_graph"})


def test_no_production_callers_use_legacy_dispatch_gate_symbols() -> None:
    forbidden = {
        "resume_approved_human_gate_dispatch",
        "dispatch_ready_supervisor_plan_steps",
        "dispatch_ready_handoff_plan_steps",
    }
    violations: list[str] = []
    allowed_file = ACC_ROOT / "app" / "runtime" / "dispatch_gate.py"
    for path in ACC_ROOT.rglob("*.py"):
        if path == allowed_file or "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for symbol in forbidden:
            if symbol in text:
                violations.append(f"{path.relative_to(PROJECT_ROOT)} references {symbol}")
    assert violations == []


def test_debugger_does_not_call_legacy_workflow_runner_internals() -> None:
    assert_no_forbidden_imports("debugger", {"acc.workflow_runner"})
