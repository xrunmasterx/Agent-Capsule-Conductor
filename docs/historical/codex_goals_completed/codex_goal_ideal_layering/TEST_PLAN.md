# Test Plan

## Philosophy

Default tests must remain hermetic:

- no real Codex,
- no real Claude,
- no real Cursor,
- no real Hermes,
- no network,
- no Conductor installation requirement.

## 1. Dependency-boundary tests

Create tests such as:

```text
tests/architecture/test_import_boundaries.py
```

Required checks:

1. `acc.domain` imports no `acc.store`, `acc.runtime`, `acc.engine`, `acc.cli`, `subprocess`, `os`, `typer`, `fastapi`.
2. `acc.engine` imports no `acc.store`, `acc.runtime`, `acc.cli`, `subprocess`, `os.environ`.
3. `acc.store` imports no `acc.runtime`, `acc.cli`, subprocess runner modules.
4. `acc.runtime` imports no `acc.cli` or UI/server modules.
5. `acc.cli` may import app, but app must not import cli.

## 2. Domain tests

- WorkflowTemplate round-trip serialization.
- Reject local absolute workspace path inside template.
- EnvironmentBinding accepts local workspace path.
- PermissionProfile validates workspace_access enum.
- ArtifactBundle is JSON serializable.

## 3. Engine tests

- Duplicate node id rejected.
- Missing control edge endpoint rejected.
- Cycle rejected.
- Missing port rejected.
- DataEdge without control ancestor rejected.
- Topological levels computed correctly.
- fail_fast stops scheduling after failure.
- continue_on_error records error and continues allowed nodes.
- all_or_nothing marks workflow failed.
- Retry policy produces fresh attempt.
- Scheduler plan is deterministic.

## 4. Store tests

- Run layout created.
- Environment manifest written.
- Workflow events append JSONL.
- Node events append JSONL.
- Inbox/outbox materialization works.
- Path traversal rejected.
- Retry attempt cleanup deletes stale output/artifact/outbox.
- Store can be used by CLI and server without exposing internal layout.

## 5. Runtime tests

- FakeNodeRunner runs without real external tools.
- Runtime receives only allowed env.
- Runtime rejects full env inheritance.
- writes_workspace requires workspace lock.
- read_only fake node cannot write workspace.
- timeout returns structured RuntimeResult.
- Runtime writes only through provided dirs.

## 6. App integration tests

- Execute serial workflow.
- Execute parallel DAG levels.
- Execute nested workflow if supported.
- Verify outbox->inbox materialization.
- Verify event sequence.
- Verify failure modes.

## 7. CLI regression tests

- Existing useful CLI commands pass or have documented migration.
- JSON output commands print one JSON object.
- Logs go to stderr.

## 8. Performance tests

- Validate 1000-node DAG in O(V+E)-like time.
- Compute levels for 1000-node DAG without quadratic blowup.
- Store should not scan whole run tree during node scheduling.

These can be marked as performance/sanity tests; do not make thresholds too brittle.

## 9. Security negative tests

- Danger permission rejected by default.
- Network enabled rejected in hermetic mode unless explicitly allowed.
- Path traversal rejected.
- Full env inheritance rejected.
- Workspace write without declaration rejected.
