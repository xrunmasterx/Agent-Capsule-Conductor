"""Verify runtime public import contracts."""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

import pytest

MODULE_PUBLIC_SYMBOLS: dict[str, tuple[str, ...]] = {
    "acc.runtime": (
        "AgentPayload",
        "RuntimePayload",
        "RUNTIME_ONLY_KEYS",
        "TransferPolicy",
        "await_with_optional_timeout",
        "build_allowed_env",
        "materialize",
        "prepare_runtime_attempt_dir",
        "read_json_object",
        "split_payloads",
        "validate_permission_profile",
        "validate_workspace_access",
        "write_json",
    ),
    "acc.runtime.io": (
        "append_event",
        "append_runtime_error_to_stderr_log",
        "artifact_bundle_payload",
        "event_record_payload",
        "failure_record_payload",
        "function_invocation_payload",
        "read_required_artifact_bundle_id",
        "read_required_session_id",
        "run_record_payload",
        "scope_frame_payload",
        "session_instance_payload",
    ),
    "acc.runtime.node_payload": (
        "MISSING_PORT_VALUE",
        "ResolvedNodePayload",
        "binding_record",
        "control_main_aggregate_payload",
        "control_main_aggregate_record",
        "is_empty_runtime_input",
        "materialized_output_port_ids",
        "output_port_ids",
        "output_value_for_port",
        "resolve_node_payload",
        "sha256_json",
        "should_forward_main_output_on_control",
    ),
    "acc.app.runtime.orchestrator": (
        "FIXED_CONTROL_POLICY_ID",
        "run_core_v2_workflow_path",
        "run_workflow_function_invocation",
    ),
    "acc.app.runtime.executor": (
        "execute_core_v2_callable",
        "execute_core_v2_node",
        "execute_hermetic_callable",
        "project_root_for_agent_sessions",
        "put_result_store_value",
        "reject_artifact_path_escape",
        "resolve_node_workflow_binding",
        "validate_artifact_contract",
    ),
    "acc.app.runtime.scheduler": (
        "execute_core_v2_node_with_fixed_ledger",
        "run_ready_queue_execution",
        "workflow_max_concurrency",
    ),
    "acc.app.runtime.nested_workflow": (
        "apply_workflow_call_output_bindings",
        "execute_workflow_function_callable",
        "infer_project_root",
        "load_runtime_overlay_payloads",
        "read_child_workflow_outputs",
        "resolve_workflow_call_input_payload",
        "resolve_workflow_function_path",
        "workflow_resolution_candidates",
    ),
    "acc.app.runtime.workflow_io": (
        "node_summary_from_session_manifest",
        "write_core_v2_run_summary",
        "write_workflow_outputs",
    ),
}

CORE_V2_RUNTIME_EXPORTS = (
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


PUBLIC_SYMBOL_CASES = [
    pytest.param(module_name, symbol, id=f"{module_name}:{symbol}")
    for module_name, symbols in MODULE_PUBLIC_SYMBOLS.items()
    for symbol in symbols
]


@pytest.mark.parametrize(("module_name", "symbol"), PUBLIC_SYMBOL_CASES)
def test_runtime_public_symbols_importable(module_name: str, symbol: str) -> None:
    module = importlib.import_module(module_name)
    assert getattr(module, symbol) is not None


def test_core_v2_runtime_reexports_contract() -> None:
    module = importlib.import_module("acc.app.core_v2_runtime")

    assert tuple(module.__all__) == CORE_V2_RUNTIME_EXPORTS
    for symbol in CORE_V2_RUNTIME_EXPORTS:
        assert getattr(module, symbol) is not None

    retired = {
        "resume_approved_human_gate_dispatch",
        "dispatch_ready_supervisor_plan_steps",
        "dispatch_ready_handoff_plan_steps",
    }
    assert retired.isdisjoint(module.__all__)
    for symbol in retired:
        assert not hasattr(module, symbol)


def test_core_v2_runtime_is_thin_shim() -> None:
    source = Path("acc/app/core_v2_runtime.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    forbidden_nodes = (ast.AsyncFunctionDef, ast.ClassDef, ast.FunctionDef)

    assert not any(isinstance(node, forbidden_nodes) for node in ast.walk(tree))
