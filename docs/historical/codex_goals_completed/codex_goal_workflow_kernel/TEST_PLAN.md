# Test Plan: Workflow Kernel Upgrade

## 1. Test philosophy

Default tests must be hermetic and local.

They must not require:

- real Codex login;
- Claude credentials;
- Hermes/Cursor;
- network;
- Conductor installation.

Existing tests must keep passing.

## 2. Required commands

```bash
uv run pytest -q
uv run ruff check .
```

## 3. WorkflowGraph v3 tests

Cases:

1. Valid graph passes.
2. Duplicate node id fails.
3. Missing capsule id fails.
4. Invalid control edge endpoint fails.
5. Invalid data edge endpoint fails.
6. Cycle fails.
7. Data edge from non-upstream node fails.
8. Missing required input after mapping fails.
9. Unsupported capsule kind fails.
10. Topological levels are computed correctly.

## 4. Workflow Kernel tests

Cases:

1. Serial graph runs in order.
2. Level-parallel graph schedules same-level nodes concurrently.
3. `max_concurrency` is respected.
4. `fail_fast` stops on first failure.
5. `continue_on_error` continues allowed nodes.
6. `all_or_nothing` marks group/level as failed or skipped when one sibling fails.
7. Node retry attempts expected number of times.
8. Node timeout returns timeout status.
9. Workflow summary contains all node results.
10. Workflow event log is valid JSONL.

## 5. Data/artifact edge tests

Cases:

1. Downstream input receives upstream output field.
2. Downstream input receives upstream artifact reference.
3. Invalid artifact name fails validation.
4. Materialized input is written to node run directory.
5. Input materialization event is emitted.

## 6. Capsule kind tests

Cases:

1. `atomic` capsule validates.
2. `agent_session` capsule validates.
3. `agent_workflow` capsule validates behavior pack path without real agent.
4. `acc_workflow` capsule validates nested graph.
5. `acc_workflow` capsule runs nested fake workflow.
6. `external_workflow` capsule validates local file reference without real Conductor.

## 7. Event tests

Cases:

1. Session events include required lifecycle events.
2. Workflow events include required lifecycle events.
3. Failed node emits node_failed.
4. Event replay/list command returns JSON.
5. Events are append-only JSONL and parse line-by-line.

## 8. GraphOps tests

Cases:

1. Valid patch passes schema/policy/semantic validation.
2. Patch adding cycle fails semantic validation.
3. Patch with invalid edge endpoint fails.
4. Patch enabling dangerous permission fails or requires explicit approval.
5. Dry-run does not mutate files.
6. Semantic diff contains added/changed/removed items.

## 9. Conductor export tests

Cases:

1. Valid graph exports YAML.
2. YAML contains every node id.
3. YAML contains `uv run acc run`.
4. YAML contains `--emit-conductor-json`.
5. Invalid graph fails before export.
6. Optional conductor validation is skipped if Conductor is unavailable.

## 10. Regression tests

Run existing MVP and workbench tests.

At minimum:

```bash
uv run acc list
uv run acc validate echo-test.generic
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/regression_echo --emit-conductor-json
uv run pytest -q
uv run ruff check .
```
