"""Discover callable references from registry and workflow templates (REQ-B4-002)."""

from __future__ import annotations

from pathlib import Path

from acc.callable_registry import CallableRegistry
from acc.models import AccError, WorkflowFunctionTemplate
from acc.hermetic_callables import HERMETIC_CALLABLE_REFS
from acc.utils import load_json


def discover_known_callable_refs(
    callable_registry: CallableRegistry | None = None,
    *,
    workflows_dir: Path | None = None,
) -> tuple[set[tuple[str, str]], set[str]]:
    """Return (callable_ref keys, workflow_function ids) for validation."""
    refs: set[tuple[str, str]] = set(HERMETIC_CALLABLE_REFS)
    workflow_ids: set[str] = set()

    if callable_registry is not None:
        refs.update(callable_registry.ref_keys())
        workflow_ids.update(callable_registry.workflow_ids())

    if workflows_dir is not None and workflows_dir.exists():
        for path in sorted(workflows_dir.glob("*.accflow.json")):
            try:
                payload = load_json(path)
            except AccError:
                continue
            if not isinstance(payload, dict):
                continue
            workflow_id = str(payload.get("id") or path.stem.removesuffix(".accflow"))
            workflow_ids.add(workflow_id)
            workflow_ids.add(path.name)
            workflow_ids.add(str(path.resolve()))
            refs.add(("workflow_function", workflow_id))
            refs.add(("workflow_function", path.name))
            refs.add(("workflow_function", str(path.resolve())))

    return refs, workflow_ids


def expand_workflow_ids_for_template(
    function_template: WorkflowFunctionTemplate,
    *,
    base_dir: Path,
    known_workflow_ids: set[str],
) -> set[str]:
    expanded = set(known_workflow_ids)
    for node in function_template.node_invocations.values():
        if node.callable_ref.kind != "workflow_function":
            continue
        ref_id = node.callable_ref.id
        candidate = Path(ref_id)
        if not candidate.is_absolute():
            candidate = base_dir / candidate
        if candidate.exists():
            expanded.add(ref_id)
            expanded.add(candidate.name)
            expanded.add(str(candidate.resolve()))
            try:
                payload = load_json(candidate)
            except AccError:
                continue
            if isinstance(payload, dict):
                expanded.add(str(payload.get("id") or candidate.stem))
    return expanded
