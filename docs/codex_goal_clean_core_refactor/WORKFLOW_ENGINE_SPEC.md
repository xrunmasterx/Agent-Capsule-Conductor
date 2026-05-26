# Workflow Engine Spec

## Required validation

The engine must validate:

- unique node ids,
- valid control edge endpoints,
- valid data edge endpoints,
- no cycles in control graph,
- port existence,
- no self-edge unless explicitly allowed,
- no unreachable required nodes,
- environment nesting policy,
- resource lock policy,
- no local absolute paths in WorkflowTemplate.

## Scheduling

The scheduler must compute topological levels in O(V + E).

Execution semantics:

1. A node becomes ready when all required control predecessors have completed successfully or failure policy permits continuation.
2. Data edges are materialized before node execution.
3. Nodes at the same ready level may run concurrently up to `max_concurrency`.
4. Workspace write locks prevent simultaneous writes to the same environment.
5. Read-only agent nodes may run concurrently in the same environment.

## Failure policies

Workflow-level:

```text
fail_fast
continue_on_error
all_or_nothing
manual_review
```

Node-level:

```text
retry
skip
goto_manual_review
fail
```

## Node lifecycle

```text
scheduled
inbox_materialized
started
running
outbox_written
artifacts_collected
completed
failed
skipped
```

Every lifecycle change must emit an event.

## Output

A workflow run must produce:

```text
workflow_run_manifest.json
workflow_events.jsonl
environments/<env_id>/environment_manifest.json
nodes/<node_id>/node_run_manifest.json
nodes/<node_id>/events.jsonl
nodes/<node_id>/output.json
nodes/<node_id>/artifacts/
```
