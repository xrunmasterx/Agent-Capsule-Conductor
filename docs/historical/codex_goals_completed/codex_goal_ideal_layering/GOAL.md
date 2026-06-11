# Goal: ACC Ideal Layering Refactor

## Objective

Refactor ACC Clean Core into a clean, lightweight, robust layered architecture suitable for real AgentNodeRunner integration.

The current Clean Core may be a lightweight integrated module. That is acceptable for fake runner validation, but it is not the final architecture. This goal moves the implementation toward a durable layering model:

```text
acc.domain
acc.ports
acc.engine
acc.store
acc.runtime
acc.app
acc.cli
```

This goal allows aggressive refactoring. It is acceptable to delete, rename, or replace legacy modules if the final behavior satisfies the new acceptance criteria.

## Core outcome

After completion:

1. Domain models are pure and IO-free.
2. Engine validates and schedules workflows without doing filesystem IO or subprocess execution.
3. Store owns run directories, inbox/outbox, artifact bundles, and event logs.
4. Runtime owns node execution and enforces permissions, env whitelist, cwd, timeout, and artifact collection.
5. App service orchestrates engine + runtime + store.
6. CLI is a thin entry layer.
7. Legacy `acc.clean_workflow` is either removed or reduced to a compatibility facade delegating to the new layers.
8. Default tests remain hermetic.
9. Real Codex/Claude/Cursor/Hermes are never required in default tests.
10. Existing critical contracts remain protected: clean stdout JSON, no workspace pollution, outbox->inbox materialization, control/data edge separation.

## Must deliver

- New module layout.
- Dependency-boundary tests.
- Pure engine tests.
- Store contract tests.
- Runtime permission/env tests.
- App-level workflow execution tests.
- CLI regression tests.
- Performance sanity tests.
- Security negative tests.
- FINDINGS.md, MIGRATION_NOTES.md, QUALITY_REPORT.md.

## Non-goals

Do not implement:

- a new LLM agent loop,
- a database backend,
- cloud deployment,
- distributed workers,
- full Conductor DSL clone,
- default real Codex/Claude/Cursor/Hermes execution,
- UI redesign.

## Completion condition

The goal is complete only when all commands and checks in `docs/codex_goal_ideal_layering/ACCEPTANCE.md` pass and the final report explains:

- what was moved,
- what was deleted,
- what legacy behavior remains,
- why the new layering is simpler and safer,
- which risks remain.
