# ACC Compatibility and Migration

## Status

Compatibility is permitted only as bounded migration scaffolding. It is not a second canonical architecture.

## SPEC

Canonical active formats and paths:

- workflow templates: `.accflow.json` / Core v2 callable graph;
- callable templates: strict typed callable schema;
- data movement: explicit inputs, data edges, bindings, result refs, artifact refs;
- run state: one run status taxonomy;
- Workbench reads: projection-first APIs;
- runtime imports: concrete runtime modules/ports, not broad shims.

Compatibility must have:

- owner;
- reason;
- current reader/writer;
- target replacement;
- deletion condition;
- tests or rejection fixtures.

## Active Deletion Candidates

| Candidate | Current role | Deletion condition |
| --- | --- | --- |
| `acc/app/core_v2_runtime.py` | former God Module compatibility shim | all internal imports migrated to concrete modules/ports |
| legacy graph/YAML UI hydration | Workbench can still normalize legacy shapes | stored assets migrated; standard open/run path uses canonical accflow only |
| `graph.edges` fallback | UI/model compatibility | canonical fixtures no longer use fallback |
| callable YAML schema aliases | live callable registry accepts old aliases | migration/import layer handles aliases; active loader strict |
| duplicate run submission surfaces | runner/workflow routes overlap | `WorkflowSubmissionService` used everywhere |
| duplicate status sets | runtime/server/cloud/gc local constants | canonical status module used everywhere |
| implicit control-main dataflow | compatibility behavior | all workflows use explicit bindings/result refs |
| raw node detail endpoint dependence | UI consumes runtime side-channel shapes | UI standard views use projection schemas |
| `dispatch_gate` replay path | human/supervisor/handoff resume mini-orchestrator | resume/control modes share scheduler state machine |
| full storage rebuild refresh path | projection repair/default refresh | incremental upsert/delete handles ordinary mutations |
| ambient cwd fallbacks | implicit project root lookup | top-down `ExecutionContext` available |

## Migration Rules

1. Legacy inputs may be accepted by migration/import commands or explicit rejection tests.
2. Legacy inputs must not be first-class runnable workflow models in active runtime.
3. Runtime loaders should reject legacy-only spellings after migration.
4. UI should open/run canonical projections, not hydrate old task/YAML graph shapes.
5. Any temporary compatibility branch must emit warning/evidence and have a linked removal milestone.

## IMPLEMENTATION_ORDER

1. Freeze canonical schemas and document all compatibility readers.
2. Add migration commands/tests for legacy assets that must survive.
3. Migrate checked-in examples and fixtures.
4. Update backend and UI consumers to canonical shape.
5. Convert runtime hot path fallback to explicit rejection.
6. Delete fallback code.
7. Update `docs/problem/RESOLUTION_MATRIX.md` with fixed/stale/deferred evidence.

## ACCEPTANCE / TEST_PLAN

- Migration tests convert legacy graph/callable fixtures once.
- Runtime loaders reject legacy-only spellings after migration.
- Workbench standard open/run tests do not use `graphFromLegacyWorkflow`.
- No new code imports `acc.app.core_v2_runtime` as canonical path.
- Static checks detect duplicate status taxonomies and route-level runtime assembly.
