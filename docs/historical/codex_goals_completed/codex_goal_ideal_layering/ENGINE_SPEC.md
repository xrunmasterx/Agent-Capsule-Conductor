# Engine Spec

## Responsibilities

`acc.engine` owns deterministic workflow logic:

- graph validation,
- topological level computation,
- data/control consistency validation,
- workflow policy validation,
- scheduling plan,
- failure policy transition,
- retry decision,
- node readiness.

## Required APIs

Names can vary, but equivalent functions/classes must exist.

```python
validate_workflow(template: WorkflowTemplate) -> ValidationReport
compute_topological_levels(template: WorkflowTemplate) -> list[list[NodeId]]
validate_data_edges(template: WorkflowTemplate) -> ValidationReport
build_execution_plan(template: WorkflowTemplate, state: WorkflowState) -> ExecutionPlan
apply_node_result(state: WorkflowState, node_id: NodeId, result: RuntimeResult) -> WorkflowState
apply_failure_policy(policy: WorkflowPolicy, state: WorkflowState) -> WorkflowState
```

## Forbidden

- No filesystem writes.
- No subprocess.
- No real runner.
- No print/log to stdout.
- No environment variable reads.

## Must test

- Cycle detection.
- Duplicate node id.
- Missing port.
- Data edge without control upstream is rejected.
- Topological level concurrency.
- fail_fast / continue_on_error / all_or_nothing.
- Retry plan does not reuse failed artifact attempts.
