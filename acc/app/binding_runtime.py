from __future__ import annotations

from typing import Any

from acc.domain import AccError, WorkflowFunctionTemplate

DEFAULT_RESULT_STORE_PORT_ID = "main"
TERMINAL_WORKFLOW_NODE_ID = "__workflow__"


def resolve_core_v2_mode(template: WorkflowFunctionTemplate) -> str:
    _ = template
    return "core_v2"


def record_node_result_in_store(*args: Any, **kwargs: Any) -> None:
    _ = args, kwargs
    raise AccError("Node result recording is owned by Core v2 ResultStore.")


def record_workflow_outputs_in_store(*args: Any, **kwargs: Any) -> None:
    _ = args, kwargs
    raise AccError("Workflow output recording is owned by Core v2 ResultStore.")


def build_node_input_payload_with_bindings(*args: Any, **kwargs: Any) -> dict[str, Any]:
    _ = args, kwargs
    raise AccError("Node input materialization is owned by Core v2 ScopeFrame.")


def resolve_prompt_appendix_policy(*args: Any, **kwargs: Any) -> str:
    _ = args, kwargs
    return "task_only"
