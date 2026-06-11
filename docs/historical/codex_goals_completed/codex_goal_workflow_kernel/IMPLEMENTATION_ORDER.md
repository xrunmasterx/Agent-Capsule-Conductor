# Implementation Order: Workflow Kernel Upgrade

Implement in this order.

## Milestone 1: Baseline audit and regression lock

Deliver:

- confirm current tests pass;
- record baseline in PROGRESS.md;
- identify current workflow_graph/workflow_runner/graphops modules.

Run:

```bash
uv run pytest -q
uv run ruff check .
```

## Milestone 2: Event schemas and emitters

Deliver:

- `WorkflowEventEmitter`;
- `SessionEventEmitter` or integration with existing session events;
- standardized event schema;
- JSONL writer;
- tests for event ordering and parseability.

## Milestone 3: WorkflowGraph v3 schema and semantic validation

Deliver:

- control edges;
- data edges;
- workflow policy;
- node retry/timeout/failure metadata;
- topological level computation;
- semantic validation tests.

## Milestone 4: Workflow Kernel level scheduler

Deliver:

- DAG level execution;
- max concurrency;
- per-node isolated session;
- workflow summary;
- workflow manifest;
- level events.

## Milestone 5: Failure modes and retries

Deliver:

- `fail_fast`;
- `continue_on_error`;
- `all_or_nothing`;
- deterministic manual review state;
- node retry/timeout tests.

## Milestone 6: Data/artifact edge materialization

Deliver:

- output field references;
- artifact name/path references;
- deterministic input materialization;
- validation for invalid references;
- input materialization events.

## Milestone 7: Capsule kinds and nested ACC workflow capsule

Deliver:

- capsule `kind` support;
- validation for `agent_workflow`, `acc_workflow`, `external_workflow`;
- execution for nested `acc_workflow` capsule;
- examples and tests.

## Milestone 8: GraphOps semantic validation

Deliver:

- dry-run materialization;
- resulting graph/capsule semantic validation;
- semantic diff report;
- safety policy tests;
- no auto-apply by default.

## Milestone 9: Conductor export bridge

Deliver:

- `acc conductor export`;
- exported YAML with script steps;
- tests that do not require Conductor installed;
- feature gap warnings.

## Milestone 10: Minimal Workbench/API integration and docs

Deliver only if existing server/UI exists:

- workflow event list endpoint;
- workflow inspect endpoint;
- Conductor export preview endpoint or CLI-only fallback;
- docs and acceptance updates.

Final run:

```bash
uv run pytest -q
uv run ruff check .
```
