# Workflow Kernel Spec

## 1. Purpose

The Workflow Kernel gives ACC the minimum reliable orchestration semantics needed for multi-capsule workflows.

It must remain lightweight. It is not a full production workflow platform.

## 2. Required semantics

### 2.1 Topological validation

Validate:

- every node id is unique;
- every control edge endpoint exists;
- every data edge endpoint exists;
- the control graph is acyclic;
- data edges reference upstream nodes only;
- every referenced capsule exists;
- unsupported capsule kinds fail validation.

### 2.2 Topological levels

Compute levels:

```text
level 0: nodes with no control dependencies
level 1: nodes whose control dependencies are satisfied by level 0
...
```

Nodes in one level may run concurrently.

### 2.3 Concurrency

Workflow policy:

```json
{
  "max_concurrency": 3
}
```

The runner must use a semaphore or equivalent limit.

### 2.4 Failure modes

Workflow-level:

```text
fail_fast
continue_on_error
all_or_nothing
manual_review
```

Node-level:

```json
{
  "on_failure": "fail|skip|retry|manual_review",
  "retry": { "max_attempts": 2, "backoff_seconds": 0 }
}
```

### 2.5 Input materialization

Node input is built from:

1. static `node.input`;
2. workflow input;
3. data edge mappings from upstream outputs/artifacts.

Materialized input must be written to:

```text
node_runs/<node_id>/input.json
```

### 2.6 Output aggregation

Workflow summary must contain:

- per-node status;
- per-node output path;
- per-node artifact directory;
- per-node error;
- level execution order;
- workflow failure mode;
- workflow final status.

### 2.7 Determinism

If graph, inputs, capsule configs, and fake adapters are unchanged, hermetic tests should produce deterministic manifests.

## 3. Commands

```bash
acc workflow validate <workflow.graph.json>
acc workflow run <workflow.graph.json> --run-dir <run_dir> --emit-json
acc workflow inspect <run_dir> --json
acc workflow events <run_dir> --json
```

## 4. Minimum event emission

Workflow runner must emit:

```text
workflow_started
workflow_level_started
node_scheduled
node_started
node_completed
node_failed
workflow_level_completed
workflow_completed
workflow_failed
```

## 5. Required manifests

```text
workflow_run_manifest.json
workflow_summary.json
workflow_events.jsonl
node_runs/<node_id>/...
```

## 6. Deferred features

Defer full implementation of:

- durable checkpoint/resume;
- distributed workers;
- cron/scheduled execution;
- complex loops;
- long-lived external event subscriptions.
