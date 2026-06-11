# Audit Plan

## Phase 0: Baseline snapshot

Before modifying code:

```bash
git status
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
```

Run legacy acceptance commands if corresponding docs exist:

```bash
find docs -path '*ACCEPTANCE.md' -maxdepth 4 -print
```

Record baseline in:

```text
runs/quality_audit/<timestamp>/baseline_report.json
docs/codex_goal_quality_audit/FINDINGS.md
```

## Phase 1: Architecture audit

Inspect:

- package/module structure;
- boundary between CLI/API/UI/core;
- dependency direction;
- duplicate logic;
- abstractions with only one implementation;
- cyclic imports;
- overly broad manager/service classes;
- places where UI directly reaches into core internals;
- places where workflow kernel duplicates capsule runtime logic;
- places where ACC starts implementing agent reasoning/tool loops.

Output architecture findings.

## Phase 2: Correctness audit

Inspect and test:

- capsule discovery;
- schema validation;
- artifact validation;
- prompt rendering;
- workspace preparation;
- adapter error handling;
- workflow graph validation;
- cycle detection;
- DAG level scheduling;
- parallel failure aggregation;
- node retry/timeout;
- data/control edge mapping;
- nested workflow capsule behavior;
- graphops validation/dry-run/apply if implemented.

## Phase 3: Security audit

Inspect:

- path traversal;
- arbitrary file read/write;
- shell command construction;
- subprocess environment leakage;
- token/secret logging;
- browser artifact API file reads;
- dangerous sandbox defaults;
- GraphOps escalation.

## Phase 4: Performance audit

Inspect:

- graph validation complexity;
- topological scheduling complexity;
- event replay memory behavior;
- artifact viewer memory behavior;
- capsule registry repeated disk scanning;
- browser graph rendering for demo-sized graphs;
- unnecessary JSON/YAML reparsing;
- blocking subprocess calls in async paths.

Add lightweight benchmarks where useful.

## Phase 5: Test audit

Inspect:

- tests that depend on local machine state;
- tests that require external tools;
- missing regression tests for known critical paths;
- missing browser E2E reports;
- tests that assert implementation details instead of contracts;
- missing failure tests.

## Phase 6: Browser UX audit

If a browser UI exists, run browser journeys:

1. Chinese UI smoke.
2. Create capsule.
3. Add two nodes.
4. Connect nodes by graph edge, not button-only sequence.
5. Save workflow.
6. Validate workflow.
7. Run workflow.
8. Inspect node input/output/artifacts/logs.
9. Open parallel workflow demo and verify fan-out/fan-in is visually clear.
10. Trigger validation error and verify user-readable Chinese error.

## Phase 7: Fix and regression

Fix in priority order:

1. Critical.
2. High.
3. Medium if low effort.
4. Low if cheap or improves clarity.

Each fix should update tests and `FIXLOG.md`.

## Phase 8: Final report

Write `QUALITY_AUDIT_REPORT.md` with:

- baseline summary;
- key findings;
- fixes applied;
- tests run;
- browser evidence;
- performance evidence;
- security evidence;
- remaining risks;
- recommended next work.
