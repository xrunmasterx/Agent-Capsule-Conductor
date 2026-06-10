from __future__ import annotations

from typing import Any

from acc.models import AccError


def build_clean_node_input_payload(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = args, kwargs
    raise AccError("Core v2 node inputs are materialized from explicit bindings.")


def collect_workflow_input_context(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    _ = args, kwargs
    return []


def materialize_clean_inboxes(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = args, kwargs
    raise AccError("Core v2 inbox materialization is handled by ScopeFrame.")

