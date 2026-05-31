"""Discover callable references from registry and workflow templates (REQ-B4-002)."""

from __future__ import annotations

from pathlib import Path

from acc.domain import AccError, WorkflowFunctionTemplate
from acc.registry import CapsuleRegistry
from acc.utils import load_json

HERMETIC_CALLABLE_REFS: set[tuple[str, str]] = {
    ("tool_class", "fake_producer"),
    ("tool_class", "merge"),
    ("tool_class", "fake"),
    ("agent_class", "generic_fake_agent"),
    ("agent_class", "generic_cli"),
}


def discover_known_callable_refs(
    registry: CapsuleRegistry,
    *,
    workflows_dir: Path | None = None,
) -> tuple[set[tuple[str, str]], set[str]]:
    """Return (callable_ref keys, workflow_function ids) for validation."""
    refs: set[tuple[str, str]] = set(HERMETIC_CALLABLE_REFS)
    workflow_ids: set[str] = set()

    for capsule in registry.discover():
        kind = capsule.spec.kind or "agent_session"
        refs.add(("legacy_capsule", capsule.spec.id))
        refs.add(("agent_class", capsule.spec.runtime.type))
        refs.add(("agent_class", capsule.spec.id))
        refs.add(("tool_class", capsule.spec.id))
        if kind in {"atomic"}:
            refs.add(("tool_class", capsule.spec.runtime.type))
        elif kind in {"agent_session", "agent_workflow", "external_workflow"}:
            pass
        elif kind == "acc_workflow":
            refs.add(("workflow_function", capsule.spec.id))
            workflow_ids.add(capsule.spec.id)

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
        expanded.add(ref_id)
        candidate = Path(ref_id)
        if not candidate.is_absolute():
            candidate = base_dir / candidate
        if candidate.exists():
            expanded.add(candidate.name)
            expanded.add(str(candidate.resolve()))
            try:
                payload = load_json(candidate)
            except AccError:
                continue
            if isinstance(payload, dict):
                expanded.add(str(payload.get("id") or candidate.stem))
    return expanded
