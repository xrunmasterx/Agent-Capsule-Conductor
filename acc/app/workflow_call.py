from __future__ import annotations

from typing import Any

from acc.domain import AccError


def build_nested_workflow_input_payload(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = args, kwargs
    raise AccError("Core v2 workflow-function inputs are resolved by explicit bindings.")


def workflow_call_manifest_payload(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = args, kwargs
    raise AccError("Core v2 workflow-function calls are recorded as nested RunRecord evidence.")
