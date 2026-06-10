"""Verify the runtime package structure: all public symbols are importable."""

from __future__ import annotations


def test_runtime_pure_helpers_importable() -> None:
    """acc.runtime exports pure helpers (node_payload, io, policy)."""
    from acc.runtime import (
        AgentPayload,
        RuntimePayload,
        RUNTIME_ONLY_KEYS,
        TransferPolicy,
        await_with_optional_timeout,
        build_allowed_env,
        materialize,
        prepare_runtime_attempt_dir,
        split_payloads,
        validate_permission_profile,
        validate_workspace_access,
        write_json,
        read_json_object,
    )
    assert callable(write_json)
    assert callable(read_json_object)
    assert callable(validate_permission_profile)


def test_runtime_io_payload_helpers_importable() -> None:
    """acc.runtime.io exports serialization and event helpers."""
    from acc.runtime.io import (
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
    assert callable(append_event)
    assert callable(function_invocation_payload)


def test_runtime_node_payload_importable() -> None:
    """acc.runtime.node_payload exports payload resolution functions."""
    from acc.runtime.node_payload import (
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
    assert MISSING_PORT_VALUE is not None
    assert callable(resolve_node_payload)


def test_app_runtime_orchestrator_importable() -> None:
    """acc.app.runtime.orchestrator exports top-level entry points."""
    from acc.app.runtime.orchestrator import (
        FIXED_CONTROL_POLICY_ID,
        run_core_v2_workflow_path,
        run_workflow_function_invocation,
    )
    assert FIXED_CONTROL_POLICY_ID == "fixed_control_policy"
    assert callable(run_core_v2_workflow_path)
    assert callable(run_workflow_function_invocation)


def test_app_runtime_executor_importable() -> None:
    """acc.app.runtime.executor exports node execution functions."""
    from acc.app.runtime.executor import (
        execute_core_v2_callable,
        execute_core_v2_node,
        execute_hermetic_callable,
        project_root_for_agent_sessions,
        put_result_store_value,
        reject_artifact_path_escape,
        resolve_node_workflow_binding,
        validate_artifact_contract,
    )
    assert callable(execute_core_v2_node)


def test_app_runtime_scheduler_importable() -> None:
    """acc.app.runtime.scheduler exports scheduling functions."""
    from acc.app.runtime.scheduler import (
        execute_core_v2_node_with_fixed_ledger,
        run_ready_queue_execution,
        workflow_max_concurrency,
    )
    assert callable(run_ready_queue_execution)


def test_app_runtime_dispatch_gate_importable() -> None:
    """acc.app.runtime.dispatch_gate exports dispatch functions."""
    from acc.app.runtime.dispatch_gate import (
        dispatch_ready_handoff_plan_steps,
        dispatch_ready_supervisor_plan_steps,
        resume_approved_human_gate_dispatch,
    )
    assert callable(dispatch_ready_handoff_plan_steps)


def test_app_runtime_nested_workflow_importable() -> None:
    """acc.app.runtime.nested_workflow exports nested workflow functions."""
    from acc.app.runtime.nested_workflow import (
        apply_workflow_call_output_bindings,
        execute_workflow_function_callable,
        infer_project_root,
        load_runtime_overlay_payloads,
        read_child_workflow_outputs,
        resolve_workflow_call_input_payload,
        resolve_workflow_function_path,
        workflow_resolution_candidates,
    )
    assert callable(execute_workflow_function_callable)


def test_app_runtime_workflow_io_importable() -> None:
    """acc.app.runtime.workflow_io exports workflow I/O functions."""
    from acc.app.runtime.workflow_io import (
        node_summary_from_session_manifest,
        write_core_v2_run_summary,
        write_workflow_outputs,
    )
    assert callable(write_workflow_outputs)


def test_backward_compat_shim_reexports() -> None:
    """core_v2_runtime.py still re-exports all symbols for backward compatibility."""
    from acc.app.core_v2_runtime import (
        FIXED_CONTROL_POLICY_ID,
        MISSING_PORT_VALUE,
        FixedRunControlLedger,
        append_event,
        dispatch_ready_handoff_plan_steps,
        dispatch_ready_supervisor_plan_steps,
        execute_core_v2_callable,
        execute_core_v2_node,
        execute_workflow_function_callable,
        function_invocation_payload,
        infer_project_root,
        node_summary_from_session_manifest,
        output_value_for_port,
        resolve_node_payload,
        resume_approved_human_gate_dispatch,
        run_core_v2_workflow_path,
        run_ready_queue_execution,
        run_workflow_function_invocation,
        write_core_v2_run_summary,
        write_workflow_outputs,
    )
    assert FIXED_CONTROL_POLICY_ID == "fixed_control_policy"
    assert callable(run_core_v2_workflow_path)


def test_core_v2_runtime_is_thin_shim() -> None:
    """core_v2_runtime.py should be a thin shim (no function/class/async definitions)."""
    from pathlib import Path

    source = Path("acc/app/core_v2_runtime.py").read_text(encoding="utf-8")
    # A thin shim should have no def, async def, or class statements
    for line in source.splitlines():
        stripped = line.strip()
        assert not stripped.startswith("def "), (
            f"core_v2_runtime.py should not define functions: {stripped}"
        )
        assert not stripped.startswith("async def "), (
            f"core_v2_runtime.py should not define async functions: {stripped}"
        )
        assert not stripped.startswith("class "), (
            f"core_v2_runtime.py should not define classes: {stripped}"
        )
