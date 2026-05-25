# Implementation Order

## Phase 0: Baseline audit

Run:

```bash
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
```

Verify existing `acc run --emit-conductor-json` contract.

## Phase 1: Debugger & Replay

Implement:

1. event replay command,
2. run/node state reconstruction,
3. rerun-node,
4. rerun-from,
5. fork run,
6. run diff,
7. artifact diff,
8. tests and demo graph.

## Phase 2: Workflow Capsule

Implement:

1. capsule kind validation,
2. `agent_workflow`,
3. `acc_workflow`,
4. `external_workflow`,
5. behavior pack validation,
6. lifecycle stages,
7. materialized snapshot,
8. nested workflow demo,
9. tests.

## Phase 3: Agent-callable Control Plane

Implement:

1. stable JSON CLI commands,
2. graphops validate/dry-run JSON reports,
3. optional MCP server or documented gap,
4. safety policy tests,
5. agent-callable demo.

## Phase 4: Browser E2E UX

Implement or verify:

1. Chinese core labels,
2. browser journey runner / Playwright / Codex browser-control support,
3. browser report generation,
4. create capsule journey,
5. build graph journey,
6. parallel graph inspection journey,
7. debugger/replay journey,
8. graphops safety journey,
9. fix-and-rerun loop.

## Phase 5: Full acceptance

Run all commands in `ACCEPTANCE.md`.
