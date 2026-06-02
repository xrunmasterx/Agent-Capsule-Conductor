from __future__ import annotations

from pathlib import Path

from acc.domain import WorkflowFunctionTemplate
from acc.engine import parse_workflow_function_template, validate_workflow_function_template
from acc.utils import AccError, load_json

LEGACY_GRAPH_SUFFIX = ".graph" + ".json"


def legacy_graph_migration_hint(path: Path) -> str:
    return (
        f"{LEGACY_GRAPH_SUFFIX} is not runnable in Core v2: {path}. "
        "Migrate it with `acc migrate graph <path.graph" + ".json> "
        "--out <workflow.accflow.json>` or "
        "`acc workflow import-graph <path.graph" + ".json>`."
    )


def load_workflow_function_template(path: Path) -> WorkflowFunctionTemplate:
    reject_legacy_graph_path(path)
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"WorkflowFunctionTemplate must be a JSON object: {path}")
    template = parse_workflow_function_template(payload, source_path=path)
    validate_workflow_function_template(template)
    return template


def reject_legacy_graph_path(path: Path) -> None:
    if path.name.endswith(LEGACY_GRAPH_SUFFIX):
        raise AccError(legacy_graph_migration_hint(path))
