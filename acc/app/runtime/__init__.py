"""acc.app.runtime -- extracted modules from core_v2_runtime.py God Module.

Sub-modules:
    orchestrator    -- top-level entry points
                       (run_core_v2_workflow_path, run_workflow_function_invocation)
    scheduler       -- DAG-based ready-queue execution loop
    executor        -- single-node execution, callable routing
    dispatch_gate   -- deduplicated dispatch functions (human gate, supervisor, handoff)
    workflow_io     -- workflow-level output writing, run summaries
    nested_workflow -- nested/child workflow execution and path resolution
"""
