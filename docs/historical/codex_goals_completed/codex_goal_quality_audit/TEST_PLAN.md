# Quality Audit Test Plan

## Default test principle

All default tests must remain hermetic. They must not require:

- real Codex login;
- Claude credentials;
- network;
- Conductor installation;
- real Cursor/Gemini/Hermes tools;
- remote browser services.

## Required baseline tests

```bash
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
uv run acc validate fake-agent.generic
```

## Required core regression tests

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/quality_regression_echo \
  --emit-conductor-json

uv run acc run fake-agent.generic \
  --input capsules/fake-agent.generic/examples/input.json \
  --run-dir runs/quality_regression_fake \
  --emit-conductor-json
```

Verify:

- stdout is exactly one JSON object;
- `conductor_output.json` matches stdout JSON;
- required artifacts exist;
- no log text appears in stdout.

## Workflow regression tests

If workflow graph support exists:

```bash
uv run acc workflow validate examples/workflows/demo_serial.graph.json
uv run acc workflow validate examples/workflows/demo_parallel.graph.json
uv run acc workflow run examples/workflows/demo_serial.graph.json --run-dir runs/quality_serial --emit-json
uv run acc workflow run examples/workflows/demo_parallel.graph.json --run-dir runs/quality_parallel --emit-json
```

Verify:

- cycle detection;
- missing node detection;
- missing capsule detection;
- invalid mapping detection;
- parallel execution behavior;
- failure-mode behavior.

## Debugger/replay tests

If debugger commands exist:

```bash
uv run acc events replay runs/quality_serial --json
uv run acc workflow rerun-node runs/quality_serial <node_id> --out runs/quality_rerun_node
uv run acc workflow fork runs/quality_serial --from-node <node_id> --out runs/quality_fork
uv run acc run diff runs/quality_serial runs/quality_fork --json
```

## GraphOps tests

If GraphOps exists:

```bash
uv run acc graphops validate examples/graphops/add-review-node.patch.json --json
uv run acc graphops dry-run examples/graphops/add-review-node.patch.json --json
```

Negative tests:

- path traversal patch;
- deletion of human gate;
- enabling network;
- enabling danger-full-access;
- modifying output schema without high-risk flag.

## Security tests

Add or verify tests for:

- path traversal in capsule/workflow/artifact APIs;
- subprocess argument escaping;
- secret redaction;
- forbidden file paths like `.env` and `~/.ssh`;
- dangerous permission defaults.

## Performance tests

Add lightweight tests or benchmarks for:

- validating a 100-node graph;
- validating a 1000-node synthetic graph if fast enough;
- topological level computation;
- event replay with large JSONL file;
- artifact preview with large file.

Use bounded expectations rather than machine-specific strict timings.

## Browser E2E tests

If `web/` exists:

```bash
cd web && npm install && npm run build
```

Then run browser journeys through existing browser control or Playwright:

1. Chinese UI smoke.
2. Create capsule or open existing capsule.
3. Open workflow graph.
4. Drag/add two nodes.
5. Connect nodes with a graph edge.
6. Save and validate workflow.
7. Run workflow.
8. Inspect node artifacts.
9. Open parallel demo and visually confirm fan-out/fan-in.
10. Trigger validation error and confirm readable Chinese message.

Store evidence under:

```text
runs/browser_e2e/<timestamp>/
```
