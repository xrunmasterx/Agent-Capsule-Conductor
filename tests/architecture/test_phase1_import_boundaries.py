from __future__ import annotations

import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ACC_ROOT = PROJECT_ROOT / "acc"

LAYER_FORBIDDEN: set[str] = {
    "acc.app",
    "acc.server",
    "acc.cli",
    "fastapi",
    "typer",
}


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
    assert violations == [], "\n".join(violations)


def test_acc_binding_does_not_import_app_or_server() -> None:
    assert_no_forbidden_imports("binding", LAYER_FORBIDDEN)


def test_acc_result_store_does_not_import_app_or_server() -> None:
    assert_no_forbidden_imports("result_store", LAYER_FORBIDDEN)


def test_acc_runtime_does_not_import_app_or_server() -> None:
    assert_no_forbidden_imports("runtime", LAYER_FORBIDDEN)


def test_acc_persistence_does_not_import_app_or_server() -> None:
    assert_no_forbidden_imports("persistence", LAYER_FORBIDDEN)


def test_acc_scheduler_does_not_import_app_or_server() -> None:
    assert_no_forbidden_imports("scheduler", LAYER_FORBIDDEN)


def test_acc_binding_does_not_import_fastapi_or_typer() -> None:
    assert_no_forbidden_imports("binding", {"fastapi", "typer"})
