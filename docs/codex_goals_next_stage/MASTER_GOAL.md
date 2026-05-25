# Master Goal: ACC Next Stage Validation and Optimization

## Objective

Upgrade ACC from a working Agent Workflow Kernel into a usable, debuggable, reusable, browser-validated Agent Workflow orchestration system.

This goal should implement and validate four areas:

1. Workflow Debugger & Replay.
2. Workflow Capsule & Agent Workflow Adapter.
3. Agent-callable ACC Control Plane.
4. Browser E2E UX Optimization.

## Completion condition

The master goal is complete only when all required acceptance sections in:

```text
docs/codex_goals_next_stage/ACCEPTANCE.md
```

pass, including:

- CLI regression tests.
- Workflow debugger/replay tests.
- Workflow capsule tests.
- Control plane tests.
- Browser E2E journey reports.
- UI Chinese-label checks.
- No regression in existing MVP stdout JSON contract.
- No default test requires real external credentials.

## Process rule

Work in this order:

1. Baseline audit.
2. Goal 1 Debugger & Replay.
3. Goal 2 Workflow Capsule.
4. Goal 3 Agent Control Plane.
5. Goal 4 Browser E2E UX.
6. Full acceptance.

After each phase:

- run relevant tests,
- update `docs/codex_goals_next_stage/PROGRESS.md`,
- record gaps in `INTEGRATION_GAPS.md`,
- do not claim completion if any acceptance command fails.

## Non-goals

- No full SaaS platform.
- No full Conductor clone.
- No new LLM agent framework.
- No auto-apply destructive graph mutation.
- No default external-agent dependency.
- No UX-only changes without browser verification.
