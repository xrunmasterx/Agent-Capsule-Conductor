# Implementation Order: Visual Workbench UX Refactor

## Milestone 0: Goal setup and baseline

Deliver:

- goal docs;
- initial `FINDINGS.md`;
- baseline test command results.

Tests:

```bash
uv run pytest -q
uv run ruff check .
cd web && npm run test -- --run
cd web && npm run build
```

## Milestone 1: Findings and cleanup inventory

Deliver:

- classify UI demo nodes, examples, capsules, run artifacts, and generated intermediates;
- identify which can be removed safely;
- identify which are test fixtures;
- record current task persistence and mojibake defects.

Tests:

- no code required unless cleanup is performed;
- after cleanup, run focused tests that reference affected files.

## Milestone 2: Navigation and Chinese text repair

Deliver:

- icon + label sidebar;
- readable Simplified Chinese labels;
- dark restrained sidebar styling;
- responsive fallback for narrow screens;
- tests for nav labels and accessibility.

Tests:

```bash
cd web && npm run test -- --run
cd web && npm run build
```

## Milestone 3: Persistent task store

Deliver:

- `WorkbenchTaskStore` boundary or equivalent API-backed store;
- persistent task create/select/update/delete;
- trash button;
- empty default task;
- no automatic old demo canvas on startup.

Tests:

```bash
cd web && npm run test -- --run
```

## Milestone 4: Resource/class editor boundary

Deliver:

- resource library supports semiconductor agent creation/editing;
- class-level system prompt remains in resource library;
- task node inspector hides system prompt editing by default;
- tests for separation.

Tests:

```bash
cd web && npm run test -- --run
uv run pytest -q tests/server/test_capsules_api.py tests/integration/test_cli_capsule_authoring.py
```

## Milestone 5: Node inspector evidence refactor

Deliver:

- inspector shows invocation config;
- inspector loads real input/output artifacts;
- full output is visible in a scrollable/readable panel;
- missing evidence states are explicit.

Tests:

```bash
cd web && npm run test -- --run
uv run pytest -q tests/server/test_artifacts_api.py tests/server/test_runs_api.py
```

## Milestone 6: Semiconductor workflow fixtures and runs

Deliver:

- hermetic semiconductor agents or fixture-backed capsules;
- serial workflow acceptance;
- nested workflow bound through local binding;
- run evidence available for UI inspection.

Tests:

```bash
uv run pytest -q tests/integration/test_workflow_graph_runner.py tests/integration/test_nested_workflow_function_call.py
cd web && npm run test -- --run
```

## Milestone 7: Browser QA and UX hardening

Deliver:

- Journey A report;
- Journey B report;
- screenshots, console logs, network logs;
- fixes for discovered friction;
- rerun evidence.

Tests:

```bash
cd web && npm run build
node web/scripts/browser-e2e.mjs
```

If the script needs adjustment for this goal, update it without requiring external credentials.

## Milestone 8: Full acceptance and final report

Deliver:

- all `ACCEPTANCE.md` commands pass;
- `PROGRESS.md`;
- `QUALITY_REPORT.md`;
- `INTEGRATION_GAPS.md` only if something is genuinely blocked.

Do not mark complete until all critical/high findings are resolved.
