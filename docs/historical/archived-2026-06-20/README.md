# Archived ACC Documentation — 2026-06-20

This archive contains historical ACC design, audit, planning, and goal-package documents moved during the 2026-06-20 architecture authority reset.

## Authority Warning

Archived documents are historical context only. They do not define current architecture, runtime behavior, implementation requirements, or product direction. If an archived document conflicts with an active document, the active document wins.

Current authority order:

1. `docs/architecture/00-constitution.md`
2. `docs/architecture/01-core-object-model.md` through `docs/architecture/08-architecture-proof-obligations.md`
3. `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/CURRENT_ARCHITECTURE.md` as entry points and summaries
4. `docs/implementation/*` as subordinate implementation roadmaps
5. `docs/audits/*` as evidence-led audit artifacts
6. This archive as historical context only

## Why These Documents Were Archived

The project previously had multiple planning, SDD, audit, and goal-package document families that could all appear authoritative. Many contain useful history, but they also contain stale module names, phase-era assumptions, old runtime vocabulary, and pre-reset priorities. The active architecture has been consolidated under `docs/architecture/*`.

## Stale Identifier Policy

Archived files may reference removed or renamed modules, old evidence filenames, legacy workflow formats, and phase-specific status names. Before using an archived claim, verify it against the current codebase and the active architecture specs.

## Replacement Map

| Old location | Archived location | Active replacement |
| --- | --- | --- |
| `docs/Design/` | `design-packages/Design/` | `docs/architecture/02-runtime-kernel.md`, `docs/architecture/03-control-modes.md`, `docs/architecture/06-graphops-governance.md` |
| `docs/refactoring-plan/` | `roadmaps-and-plans/refactoring-plan/` | `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` |
| `docs/codex_goal_callable_semantics/` | `goal-packages/codex_goal_callable_semantics/` | `docs/architecture/01-core-object-model.md`, `docs/architecture/04-data-plane-and-evidence.md` |
| `docs/codex_goal_visual_workbench_ux_refactor/` | `goal-packages/codex_goal_visual_workbench_ux_refactor/` | `docs/architecture/05-api-ui-boundaries.md` |
| `docs/codex_goals_next_stage/` | `goal-packages/codex_goals_next_stage/` | `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` |
| `docs/requirements/` | `roadmaps-and-plans/requirements/` | `docs/architecture/03-control-modes.md`, `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` |
| `docs/sdd/` | `old-sdd/sdd/` | `docs/architecture/00-constitution.md` through `docs/architecture/08-architecture-proof-obligations.md` |
| `docs/ACC_Architecture_Audit_2026.md` | `old-audits/ACC_Architecture_Audit_2026.md` | `docs/audits/2026-06-20-architecture-debt-audit.md` |
| `docs/ACC_CODEX_APP_SERVER_RUNTIME.md` | `legacy-root-docs/ACC_CODEX_APP_SERVER_RUNTIME.md` | `docs/architecture/02-runtime-kernel.md`, `docs/architecture/05-api-ui-boundaries.md` |
| `docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md` | `legacy-root-docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md` | `README.md`, `docs/CURRENT_ARCHITECTURE.md` |
| `docs/goal.md` | `legacy-root-docs/goal.md` | `docs/architecture/00-constitution.md` |

## Listed Candidates Not Present In This Checkout

Record any planned archive candidate that did not exist when the move command ran.
