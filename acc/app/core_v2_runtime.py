"""Backward-compatibility shim for the former God Module.

All implementation has been extracted into focused sub-modules:

  acc/runtime/              -- pure helpers (node_payload, io, policy)
  acc/app/runtime/          -- app-layer modules (orchestrator, executor, scheduler,
                               dispatch_gate, nested_workflow, workflow_io)

This file re-exports every public symbol so that existing callers continue to work.
New code should import directly from the sub-modules above.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Re-exports from acc.app.runtime (app-layer modules)
# ---------------------------------------------------------------------------
from acc.app.runtime.executor import (  # noqa: F401
    execute_core_v2_callable,
    execute_core_v2_node,
    execute_hermetic_callable,
    project_root_for_agent_sessions,
    put_result_store_value,
    reject_artifact_path_escape,
    resolve_node_workflow_binding,
    validate_artifact_contract,
)
from acc.app.runtime.nested_workflow import (  # noqa: F401
    apply_workflow_call_output_bindings,
    execute_workflow_function_callable,
    infer_project_root,
    load_runtime_overlay_payloads,
    read_child_workflow_outputs,
    resolve_workflow_call_input_payload,
    resolve_workflow_function_path,
    workflow_resolution_candidates,
)

# ---------------------------------------------------------------------------
# Canonical entry points (now live in orchestrator.py)
# ---------------------------------------------------------------------------
from acc.app.runtime.orchestrator import (  # noqa: F401
    FIXED_CONTROL_POLICY_ID,
    run_core_v2_workflow_path,
    run_workflow_function_invocation,
)
from acc.app.runtime.scheduler import (  # noqa: F401
    execute_core_v2_node_with_fixed_ledger,
    run_ready_queue_execution,
    workflow_max_concurrency,
)
from acc.app.runtime.workflow_io import (  # noqa: F401
    node_summary_from_session_manifest,
    write_core_v2_run_summary,
    write_workflow_outputs,
)

# ---------------------------------------------------------------------------
# Backward-compatible alias
# ---------------------------------------------------------------------------
from acc.ledger_writer import FixedRunControlLedgerWriter as FixedRunControlLedger  # noqa: F401
from acc.runtime.io import (  # noqa: F401
    append_event,
    append_runtime_error_to_stderr_log,
    artifact_bundle_payload,
    event_record_payload,
    failure_record_payload,
    function_invocation_payload,
    read_required_artifact_bundle_id,
    read_required_session_id,
    run_record_payload,
    scope_frame_payload,
    session_instance_payload,
)

# ---------------------------------------------------------------------------
# Re-exports from acc.runtime (pure helpers)
# ---------------------------------------------------------------------------
from acc.runtime.node_payload import (  # noqa: F401
    MISSING_PORT_VALUE,
    ResolvedNodePayload,
    binding_record,
    control_main_aggregate_payload,
    control_main_aggregate_record,
    is_empty_runtime_input,
    materialized_output_port_ids,
    output_port_ids,
    output_value_for_port,
    resolve_node_payload,
    sha256_json,
    should_forward_main_output_on_control,
)

__all__ = (
    "FIXED_CONTROL_POLICY_ID",
    "MISSING_PORT_VALUE",
    "FixedRunControlLedger",
    "ResolvedNodePayload",
    "append_event",
    "append_runtime_error_to_stderr_log",
    "artifact_bundle_payload",
    "apply_workflow_call_output_bindings",
    "binding_record",
    "control_main_aggregate_payload",
    "control_main_aggregate_record",
    "event_record_payload",
    "execute_core_v2_callable",
    "execute_core_v2_node",
    "execute_core_v2_node_with_fixed_ledger",
    "execute_hermetic_callable",
    "execute_workflow_function_callable",
    "failure_record_payload",
    "function_invocation_payload",
    "infer_project_root",
    "is_empty_runtime_input",
    "load_runtime_overlay_payloads",
    "materialized_output_port_ids",
    "node_summary_from_session_manifest",
    "output_port_ids",
    "output_value_for_port",
    "project_root_for_agent_sessions",
    "put_result_store_value",
    "read_child_workflow_outputs",
    "read_required_artifact_bundle_id",
    "read_required_session_id",
    "reject_artifact_path_escape",
    "resolve_node_payload",
    "resolve_node_workflow_binding",
    "resolve_workflow_call_input_payload",
    "resolve_workflow_function_path",
    "run_core_v2_workflow_path",
    "run_ready_queue_execution",
    "run_record_payload",
    "run_workflow_function_invocation",
    "scope_frame_payload",
    "session_instance_payload",
    "sha256_json",
    "should_forward_main_output_on_control",
    "validate_artifact_contract",
    "workflow_max_concurrency",
    "workflow_resolution_candidates",
    "write_core_v2_run_summary",
    "write_workflow_outputs",
)
