# ACC Documentation Map

## Active Architecture Authority

Read these first:

1. `docs/architecture/00-constitution.md`
2. `docs/architecture/01-core-object-model.md`
3. `docs/architecture/02-runtime-kernel.md`
4. `docs/architecture/03-control-modes.md`
5. `docs/architecture/04-data-plane-and-evidence.md`
6. `docs/architecture/05-api-ui-boundaries.md`
7. `docs/architecture/06-graphops-governance.md`
8. `docs/architecture/07-compatibility-and-migration.md`
9. `docs/architecture/08-architecture-proof-obligations.md`

## Active Entry Points

- `AGENTS.md`: concise project contract and authority ladder.
- `README.md`: project introduction and operating commands.
- `docs/CURRENT_ARCHITECTURE.md`: short summary of the active architecture.

If an entry point conflicts with `docs/architecture/*`, the architecture docs win.

## Audits

- `docs/audits/2026-06-21-superpower-architecture-debt-audit.md`: current code-grounded architecture debt audit generated from the Superpower architecture analysis.

Audits identify debt and evidence. They do not override the architecture specs.

## Implementation Roadmaps

- `docs/implementation/2026-06-21-acc-runtime-refactor-roadmap.md`: staged migration plan derived from the Superpower architecture reset.

Roadmaps are subordinate to the architecture specs.

## Superpower Goal Package

- `docs/superpower_acc_architecture/`: Superpower-style SPEC/DESIGN/FINDINGS/IMPLEMENTATION_ORDER/TEST_PLAN/ACCEPTANCE package for converging ACC toward a lightweight, stateless, low-coupling orchestration kernel.

## Historical Archive

- `docs/historical/archived-2026-06-20/`: documents moved during the 2026-06-20 architecture authority reset.
- Older `docs/historical/*` material remains historical context.

Archived documents are not current architecture authority. They may contain stale module names, old file names, phase-era assumptions, or pre-reset priorities.

## Current Runtime Facts

- ACC is local-first.
- ACC owns orchestration, data movement, evidence, and governance.
- External agents/tools own internal reasoning and execution behavior.
- Runtime evidence is durable truth; server and frontend projections are derived.
- GraphOps governs persistent callable/workflow mutation.
