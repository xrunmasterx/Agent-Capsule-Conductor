"""Integration test: ensure no Python file imports from the deleted acc.domain module."""

from __future__ import annotations

import ast
import pathlib


def test_no_from_acc_domain_import():
    acc_root = pathlib.Path("acc")
    for py_file in acc_root.rglob("*.py"):
        source = py_file.read_text(encoding="utf-8-sig")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert node.module != "acc.domain", (
                    f"{py_file} still imports from acc.domain (line {node.lineno})"
                )


def test_no_from_acc_domain_import_in_tests():
    tests_root = pathlib.Path("tests")
    for py_file in tests_root.rglob("*.py"):
        source = py_file.read_text(encoding="utf-8-sig")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert node.module != "acc.domain", (
                    f"{py_file} still imports from acc.domain (line {node.lineno})"
                )
