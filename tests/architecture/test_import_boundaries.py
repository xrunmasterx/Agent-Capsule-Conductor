from __future__ import annotations

import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ACC_ROOT = PROJECT_ROOT / "acc"


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
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


def test_legacy_workflow_runner_module_is_removed() -> None:
    assert not (ACC_ROOT / "workflow_runner.py").exists()


def test_debugger_does_not_call_legacy_workflow_runner_internals() -> None:
    assert_no_forbidden_imports("debugger", {"acc.workflow_runner"})
