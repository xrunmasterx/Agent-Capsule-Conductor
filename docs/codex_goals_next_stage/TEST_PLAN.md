# ACC Next Stage Test Plan

## 1. Philosophy

Default tests must remain hermetic.

They must not require:

- real Codex login,
- real Claude credentials,
- real Hermes,
- real Cursor,
- network,
- paid services,
- real browser if browser runner is unavailable.

Browser E2E tests may be optional if tooling is unavailable, but browser journey specs and report generation must exist.

## 2. Baseline regression tests

Run before and after each major goal:

```bash
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/regression_echo --emit-conductor-json
```

Verify stdout contract manually or via test.

## 3. Goal 1 tests: Debugger & Replay

### Unit tests

- event replay reconstructs status,
- replay handles missing events gracefully,
- fork manifest records parent run,
- run diff detects output differences,
- artifact diff detects text/json differences.

### Integration tests

```bash
uv run acc workflow run examples/workflows/debugger_replay_demo.graph.json --run-dir runs/test_debugger_demo --emit-json
uv run acc events replay runs/test_debugger_demo --json
uv run acc workflow rerun-node runs/test_debugger_demo <node_id> --out runs/test_rerun_node
uv run acc workflow rerun-from runs/test_debugger_demo <node_id> --out runs/test_rerun_from
uv run acc workflow fork runs/test_debugger_demo --from-node <node_id> --input examples/workflows/fork_override.json --out runs/test_fork
uv run acc run diff runs/test_debugger_demo runs/test_fork --json
```

## 4. Goal 2 tests: Workflow Capsule

### Unit tests

- capsule kind validation,
- behavior pack path validation,
- lifecycle command validation,
- materialized snapshot generation,
- nested workflow isolation.

### Integration tests

```bash
uv run acc validate codex-workflow-capsule.example
uv run acc validate acc-subworkflow-capsule.example
uv run acc validate external-workflow-capsule.example
uv run acc run acc-subworkflow-capsule.example --input examples/capsules/acc-subworkflow-capsule.example/input.json --run-dir runs/test_acc_subworkflow --emit-conductor-json
```

Use fake/local commands only by default.

## 5. Goal 3 tests: Control Plane

### CLI JSON tests

```bash
uv run acc capsules list --json
uv run acc capsules show echo-test.generic --json
uv run acc workflows list --json
uv run acc workflows show examples/workflows/control_plane_demo.graph.json --json
uv run acc workflow run examples/workflows/control_plane_demo.graph.json --run-dir runs/test_control_plane --emit-json
uv run acc runs show runs/test_control_plane --json
uv run acc graphops validate examples/graphops/add-review-node.patch.json --json
uv run acc graphops dry-run examples/graphops/add-review-node.patch.json --json
```

### Safety tests

- destructive apply disabled by default,
- dangerous permission patch rejected or flagged,
- removing human gate flagged,
- output schema mutation flagged.

## 6. Goal 4 tests: Browser E2E UX

### Browser journeys

- create custom capsule,
- build two-node workflow,
- inspect parallel workflow,
- debug and replay,
- control-plane smoke.

### Required report

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
```

Validate with:

```bash
python -m json.tool runs/browser_e2e/<timestamp>/browser_e2e_report.json
```

### Optional Playwright

If Playwright exists:

```bash
cd web && npm run test:e2e
```

If not, document gap and use Codex browser-control tools if available.

## 7. Acceptance command

After all goals:

```bash
uv run pytest -q
uv run ruff check .
```

Then run all commands listed in `ACCEPTANCE.md`.
