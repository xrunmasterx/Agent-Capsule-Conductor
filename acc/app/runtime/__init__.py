"""acc.app.runtime -- extracted modules from core_v2_runtime.py God Module.

Sub-modules:
    scheduler       -- DAG-based ready-queue execution loop
    executor        -- single-node execution, callable routing
    dispatch_gate   -- deduplicated dispatch functions (human gate, supervisor, handoff)
    node_payload    -- payload resolution, binding, control-main propagation
    io              -- payload serialization, event logging
    workflow_io     -- workflow-level output writing, run summaries
    nested_workflow -- nested/child workflow execution and path resolution
"""
