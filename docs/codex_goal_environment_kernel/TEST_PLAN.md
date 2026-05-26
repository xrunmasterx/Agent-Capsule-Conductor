# Test Plan

## 1. Default philosophy

Default tests must remain hermetic.

They must not require:

```text
real Codex login
Claude credentials
network
Conductor installation
browser if not already part of project test setup
```

## 2. Regression tests

Run existing core tests:

```bash
uv run pytest -q
uv run ruff check .
```

Must keep passing:

```bash
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/regression_env_echo --emit-conductor-json
```

## 3. Model tests

Add tests for:

1. `WorkflowTemplate` saved without workspace path.
2. `WorkspaceBinding` stores local path separately.
3. `EnvironmentFrame` created with ephemeral workspace when no binding is provided.
4. `EnvironmentFrame` created with bound workspace when provided.
5. `AgentSessionNode` inherits environment cwd.
6. Node-level relative cwd override works.
7. Behavior pack mode validates.
8. Effective behavior pack snapshot is written.

## 4. Port IO tests

1. Node A writes outbox.
2. Scheduler materializes A outbox into B inbox.
3. B reads from inbox.
4. Multiple upstreams feed one input port.
5. Sender cannot directly write receiver inbox.
6. Path traversal rejected.
7. Inbox/outbox manifests contain source/session/artifact metadata.

## 5. Scheduler tests

1. Node readiness waits for all required inputs.
2. Fan-out schedules multiple downstream nodes.
3. `max_concurrency` is respected.
4. Workspace read locks permit concurrent read-only nodes.
5. Workspace write lock serializes write nodes.
6. `fail_fast` works.
7. `continue_on_error` works.
8. `manual_review` status is emitted.

## 6. Nesting tests

1. Stateless workflow can be nested.
2. Stateless child can inherit parent workspace.
3. Stateless root can instantiate a bound stateful environment.
4. Stateful environment containing another stateful environment is rejected by default.

## 7. UI tests if UI exists

1. Workflow shows environment boundary.
2. Bound workspace badge appears.
3. Agent node shows cwd.
4. Port edges are visible.
5. Inbox/outbox inspector opens.
6. Binding workspace UI does not persist absolute path into workflow template.

## 8. Acceptance artifacts

Produce:

```text
runs/acceptance_environment_bound/
runs/acceptance_environment_stateless/
runs/acceptance_environment_nested/
```
