# Test Plan

## Test philosophy

Default tests must be hermetic.

No default test may require:

- real Codex login,
- Claude credentials,
- Cursor/Hermes installation,
- network,
- Microsoft Conductor installation.

## Required test groups

### Domain tests

- WorkflowTemplate rejects absolute workspace paths.
- EnvironmentBinding accepts local workspace path.
- Node ids must be unique.
- Control edges must reference existing nodes.
- Data edges must reference existing ports.
- Cycles are rejected.

### Environment tests

- Stateless workflow creates run-scoped ephemeral workspace.
- ACC install directory is never used as default workspace.
- Stateful binding sets effective cwd.
- Agent node inherits effective cwd.
- Effective behavior pack snapshot is written.
- Nested environment policy is enforced.

### Port and artifact tests

- Node writes only to outbox.
- Scheduler materializes outbox to downstream inbox.
- Upstream direct downstream write is rejected or impossible.
- Data edge materialization prevents path traversal.
- ArtifactBundle is created and schema-valid.

### Scheduler tests

- Topological levels computed correctly.
- Parallel-ready nodes execute with bounded concurrency.
- Workspace write locks serialize write nodes in same environment.
- Read-only agent nodes may run concurrently.
- failure_mode fail_fast works.
- failure_mode continue_on_error works.
- retry policy works.
- timeout works.

### Node runner tests

- Fake agent node runs in effective cwd.
- Fake tool node produces outbox artifact.
- Nested workflow node returns parent-visible output.

### CLI tests

- workflow validate emits JSON under `--json`.
- workflow bind creates binding file.
- workflow run emits JSON under `--emit-json`.
- run inspect displays EnvironmentFrame and Inbox/Outbox.

### Regression tests

If old `acc run echo-test.generic --emit-conductor-json` remains supported, verify stdout is exactly one JSON object.

If old command is deprecated, verify replacement command satisfies the same machine-readable output contract.

### Browser tests if UI exists

- open workflow graph,
- bind workspace,
- run workflow,
- inspect node inbox/outbox/artifacts,
- verify Chinese labels.
