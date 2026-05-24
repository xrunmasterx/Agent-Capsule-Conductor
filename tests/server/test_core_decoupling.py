from __future__ import annotations

from pathlib import Path


def test_core_modules_do_not_import_fastapi() -> None:
    core_files = [
        path
        for path in Path("acc").glob("*.py")
        if path.name not in {"cli.py"}
    ]

    for path in core_files:
        assert "fastapi" not in path.read_text(encoding="utf-8").lower(), path
