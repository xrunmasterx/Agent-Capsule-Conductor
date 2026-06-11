# Environment-Aware Scheduler Spec

## 1. Readiness

A node is ready when:

```text
all required control inputs succeeded
all required data input ports have inbox materialized
resource locks are available
```

## 2. Fan-out

When a node completes, all downstream candidates are checked.

Ready downstream nodes may run concurrently subject to:

```text
max_concurrency
workspace locks
node resource policy
failure mode
```

## 3. Resource locks

Default:

```text
read-only nodes in same workspace may run concurrently
write nodes require exclusive workspace lock
```

## 4. Failure modes

Workflow-level:

```text
fail_fast
continue_on_error
all_or_nothing
manual_review
```

Node-level override:

```text
retry
skip
goto
manual_gate
fail
```

## 5. Event stream

Emit:

```text
workflow_started
environment_created
node_ready
inbox_materialized
node_started
agent_session_started
tool_started
outbox_written
node_completed
node_failed
workflow_completed
workflow_failed
```

## 6. Do not implement

Do not add LLM dynamic routing in this goal.

All routing must be deterministic.
