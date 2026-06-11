# Master Goal: ACC Quality Audit, Hardening, Simplification, and Validation

## Objective

Perform a first-principles quality audit of the entire ACC codebase and harden it without changing the product direction.

This is not a feature-expansion goal. The purpose is to make the already implemented ACC framework:

- lighter,
- more robust,
- safer,
- easier to reason about,
- faster where it matters,
- better tested,
- easier to use in the browser,
- and consistent with the original architecture philosophy.

## Core philosophy to preserve

ACC exists to orchestrate reusable Agent Capsules and Agent Workflow Capsules. It must stay lightweight and pluggable.

ACC must not become:

- a Dify clone,
- a LangGraph clone,
- a Conductor clone,
- a custom LLM tool-calling loop,
- a cloud SaaS platform,
- or a heavyweight database-backed enterprise workflow product.

The intended mental model remains:

```text
ACC Workbench = human/agent-visible authoring and inspection layer
ACC Workflow Kernel = lightweight deterministic graph execution
ACC Capsule Runtime = template/session/artifact boundary
External mature agents = Codex / Claude / Cursor / Hermes / external workflow internals
Optional Conductor Bridge = production deterministic workflow backend export/integration
```

## Required process

Codex must not start by editing code blindly.

It must follow this loop:

1. Read existing docs and repository structure.
2. Run baseline tests and record results.
3. Run browser smoke tests if UI exists.
4. Inspect architecture, code, tests, performance, security, and UX.
5. Write `docs/codex_goal_quality_audit/FINDINGS.md` with severity-ranked findings.
6. Fix issues in priority order.
7. Add or update regression tests.
8. Re-run all relevant tests.
9. Run browser E2E and capture evidence if UI exists.
10. Write `docs/codex_goal_quality_audit/QUALITY_AUDIT_REPORT.md`.
11. Do not complete until `ACCEPTANCE.md` passes.

## Completion condition

The goal is complete only when:

- all baseline and regression tests pass;
- old acceptance commands still pass or documented migrations exist;
- default tests remain hermetic;
- critical and high-severity findings are fixed or explicitly justified as non-actionable;
- no stdout contract regression exists;
- no dangerous default permission exists;
- browser E2E evidence exists if UI exists;
- performance-critical graph algorithms are O(V+E) or documented otherwise;
- large artifact/event paths avoid unbounded memory loading;
- final reports exist and are machine-readable where required;
- `QUALITY_AUDIT_REPORT.md` summarizes evidence, fixes, remaining risks, and next recommended work.

## Non-goals

Do not implement new product features except when needed to fix a discovered defect or make an existing feature testable.

Do not add:

- new agent model integrations,
- cloud deployment,
- database migration,
- enterprise auth,
- marketplace,
- complex scheduler replacement,
- new UI pages unrelated to existing workflows,
- or an autonomous LLM decision loop.
