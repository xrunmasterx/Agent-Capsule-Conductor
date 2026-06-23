# Superpowers Plan Completion Status — 2026-06-22

This document records a code-grounded audit of every plan under `docs/superpowers/plans/`.

Audit method: a prior multi-agent audit plus focused workflows `wf_6b719c48-14d` and `wf_67b79942-237` inspected each plan against current repository files, tests, handoff docs, and targeted verification evidence. The latest cross-check revalidated the Workbench P0/P1/P2, runtime/dataflow/status/invocation/control-mode, architecture-reset, and P0-freeze rows after the follow-up implementation batch; it found the status categories materially accurate and identified wording fixes plus a tomorrow work queue.

## Overall answer

**No — the plan set is not fully complete.** The 2026-06-22 follow-up implementation closed several proof/test blockers, but most plans still have at least one of these blockers:

- unchecked/manual verification;
- stale or failing verification command;
- missing originally requested deliverable;
- compatibility shim or deletion target still present;
- checklist scope intentionally deferred or superseded;
- current code contradicting a strict completion criterion.

## Status table

| Plan | Current status | Evidence summary | Remaining blockers |
| --- | --- | --- | --- |
| `2026-06-20-acc-workbench-p0-stream-stability.md` | Mostly complete; open manual verification | Hook changes and focused frontend tests are implemented. | Manual Network-panel request-storm confirmation remains unchecked in the plan. |
| `2026-06-20-acc-workbench-p1-state-ownership.md` | Partially complete | Store selectors, canvas revisions, dedicated selector test, derived graph test, and runtime overlay helpers exist. | Writable `graphRef` compatibility remains; remaining hot-path subscription concerns are narrower than the original broad `tasks[]`/run-store wording. |
| `2026-06-20-acc-workbench-p2-backend-projection-slimming.md` | Complete for the named backend-slimming slice | JSONL offset streaming, heartbeat, slim canvas save, and async submit compile-flow work are present; the compile-count regression now patches the current app-layer boundary and passes. | Broader backend/projection cleanup is tracked by later plans, not this P2 slice. |
| `2026-06-20-acc-architecture-reset.md` | Partially complete / explicitly superseded | `docs/architecture/*` and archive README shell exist; the original `2026-06-20` audit/roadmap paths now resolve to supersession stubs that point to the 2026-06-21 artifacts. | Archive migration remains incomplete with listed candidates still active under `docs/`, many checklist items remain unchecked, and the plan should be treated as superseded rather than literally complete. |
| `2026-06-21-p0-freeze-and-prove-cleanup.md` | Partially complete; static proof gates improved | Later workflows added proof tests for status, dataflow, runtime, invocation, and control-mode slices; the follow-up added guards for new `core_v2_runtime` imports, duplicate run-status sets, and tracked route-boundary deviations. | Route-owned orchestration remains a known deviation, and broader cleanup/deletion targets are intentionally deferred. |
| `2026-06-21-status-and-submission-canonicalization.md` | Partially complete; duplicate-status guard implemented | `acc/run_status.py` exists, async `WorkflowSubmissionService` extracts important workflow/runner paths, and the duplicate-status architecture guard is present. | Sync workflow routes and route-level graph preparation/claim helpers remain; parity coverage is incomplete for several failure/terminal cases; cloud sync submission scope is undecided. |
| `2026-06-21-explicit-dataflow-and-evidence.md` | Partially complete | Strict explicit-dataflow mode, richer binding manifests, and typed supervisor/handoff snapshot evidence exist. | Legacy control-main compatibility remains the default; binder/materializer split and canonical workflow migration/deletion are not complete. |
| `2026-06-21-lightweight-runtime-kernel.md` | Partially complete | `ExecutionContext`, `RunRepository`, `NodeExecutionRecorder`, `NodeExecutionResult`, and scheduler-owned fixed-workflow aggregation exist. | `ExecutionContext` remains thin; `Path.cwd()` fallbacks and `core_v2_runtime` shim remain; continuation still owns a separate loop and some direct writes. |
| `2026-06-21-invocation-and-adapter-harness.md` | Mostly complete for fixed workflow; broader cleanup open | `NodeExecutionEnvelope`, `CallableInvocationPort`, and `AdapterProcessHarness` exist, with fixed-workflow routing through the port. | Legacy `CallableInvocationService`, supervisor procedural seams, direct adapter-selection edges, and fuller envelope/harness responsibilities remain. |
| `2026-06-21-control-mode-scheduler-convergence.md` | Mostly complete; compatibility/docs cleanup open | Common persisted continuation path handles human gate, supervisor, and handoff dispatch through Core v2 node execution. | `dispatch_gate.py` remains as a shim; docs still describe it as live; procedural supervisor execution seams remain; continuation is not literally the initial scheduler driver. |
| `2026-06-21-workbench-projection-storage-graphops-cleanup.md` | Partially complete | `LiveEventProjectionService`, GraphOps legacy patch-route retirement, and incremental storage-index primitives are implemented. | Compile-boundary ownership is unsettled; stable projection contracts are mostly docs-only; normal payloads still expose raw runtime evidence; some run-index rebuilds remain; examples and Workbench compatibility surfaces still need cleanup. |

## Detailed blockers by plan

### P0 Stream Stability

- Keep open until a browser/manual Workbench run confirms that one `runId` no longer accumulates multiple submitted-run polling chains after re-submission or error.
- Automated evidence is strong, but the plan explicitly requested manual Network-panel confirmation.

### P1 State Ownership

Implemented slices:

- per-task state and canvas revision storage;
- active canvas/task metadata selectors;
- graph derivation coverage;
- status-map overlay helpers.

Open slices:

- broad task/run projection compatibility remains narrower than the original plan wording but is not fully retired from hot paths;
- writable graph reference/source graph compatibility remains;
- dedicated `workbenchStore.selectors.test.ts` coverage for active canvas, active metadata without canvas payload, and active canvas revision selection.

### P2 Backend Projection Slimming

Implemented slices:

- appended JSONL offset helper and stream heartbeat behavior;
- slim canvas save response;
- submit path structurally compiles once through the current app-layer service;
- compile-count regression now patches `acc.app.workflow_submission.compile_runtime_graph` and passes.

Remaining note:

- broader backend/projection cleanup is tracked by later status/submission and projection/storage plans rather than this P2 slice.

### Architecture Reset

This plan should not be closed as literally completed. Treat it as **explicitly superseded/partial**: the original `2026-06-20` audit and roadmap paths now exist as supersession stubs pointing to the refreshed `2026-06-21` artifacts, while archive migration and many checklist items remain intentionally unfinished.

Current evidence:

- `docs/architecture/00-constitution.md` through `08-architecture-proof-obligations.md` exist.
- The archive README shell exists, but listed archive candidates such as `docs/Design`, `docs/refactoring-plan`, `docs/codex_goal_callable_semantics`, `docs/sdd`, and legacy root docs remain active under `docs/`.
- The required original paths `docs/audits/2026-06-20-architecture-debt-audit.md` and `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` now exist as supersession stubs pointing to the refreshed 2026-06-21 artifacts.
- Newer replacements exist as `docs/audits/2026-06-21-superpower-architecture-debt-audit.md` and `docs/implementation/2026-06-21-acc-runtime-refactor-roadmap.md`.

### P0 Freeze and Prove Cleanup

The proof-first direction is partly satisfied by later workflow work and the 2026-06-22 follow-up static checks. The plan is still not a deletion-complete milestone: route-owned orchestration remains an explicit known deviation, and broader dataflow/runtime/control cleanup targets remain deferred. New proof gates now block production imports of `acc.app.core_v2_runtime`, detect duplicate run-summary status-set definitions outside the canonical module/allowed re-export, and keep route-boundary deviations executable and visible.

### Status and Submission Canonicalization

Implemented slices:

- canonical run-summary taxonomy in `acc/run_status.py`;
- duplicate-status static guard in `tests/architecture/test_import_boundaries.py`;
- async workflow/runner submission extraction in `acc/app/workflow_submission.py`.

Open slices:

- remaining sync route helper ownership;
- broader parity/failure/terminal response tests;
- decision on cloud sync submission scope.

### Explicit Dataflow and Evidence

Implemented slices:

- strict mode and manifest evidence for explicit dataflow;
- compatibility warnings for legacy control-edge data movement;
- typed snapshot provenance for supervisor/handoff dynamic dispatch.

Open slices:

- strict mode is not the default;
- `control_main_default` / `control_main_aggregate` compatibility remains;
- canonical workflows and fixtures have not been fully migrated to strict explicit bindings;
- nested workflow boundary provenance remains a follow-up.

### Lightweight Runtime Kernel

Implemented slices:

- explicit context/result/repository seams;
- scheduler-owned aggregation for fixed workflow;
- tests for concurrency and two project roots.

Open slices:

- context is still narrower than the plan target;
- legacy ambient fallbacks remain;
- continuation and compatibility paths still duplicate some ownership;
- `acc/app/core_v2_runtime.py` remains as a shim.

### Invocation and Adapter Harness

Implemented slices:

- fixed-workflow callable boundary through `CallableInvocationPort`;
- one-shot subprocess lifecycle extraction for CLI adapters;
- direct invocation-port tests.

Open slices:

- old `CallableInvocationService` remains;
- supervisor procedural paths are not fully retired;
- `NodeExecutionEnvelope` is intentionally minimal and does not yet carry every planned capability/evidence/result-sink field.

### Control Mode Scheduler Convergence

Implemented slices:

- persisted continuation path for human gate, supervisor, and handoff;
- dispatch-gate production callers reduced to compatibility shims;
- integration and architecture proofs cover migrated paths.

Open slices:

- `dispatch_gate.py` still exists as a compatibility shim;
- docs still describe dispatch gate as a live runtime module;
- procedural supervisor execution seams remain;
- no explicit `ControlModeStrategy` abstraction was introduced, which is acceptable only because the plan allowed adding it "only as needed".

### Workbench Projection Storage GraphOps Cleanup

Implemented slices:

- live-event projection service;
- selected stream replay/cursor tests;
- storage-index object upsert/delete and incremental refresh requests;
- legacy GraphOps patch POST routes removed from server routing and production browser calls.

Open slices:

- compile boundary is not settled as server-only, web-only, or shared schema;
- stable projection contract names are mostly documentation-level, not code-level API contracts;
- normal projections still expose raw `runtime` and `binding_manifest` fields;
- some ordinary run summary writes still rebuild run indexes;
- legacy GraphOps patch POST routes are retired; governed proposal validate/dry-run APIs remain active architecture, while examples and compatibility surfaces still need cleanup.

## Tomorrow work queue

1. Perform and record the manual Workbench Network-panel request-storm verification required by `2026-06-20-acc-workbench-p0-stream-stability.md` before considering P0 closed.
2. Retire or explicitly defer remaining Workbench P1 writable `graphRef.current` dependencies and residual broad task/run hot-path compatibility wrappers.
3. Decide the sync workflow route boundary: migrate sync `/api/workflows/run-graph` orchestration/helpers into an app-layer service or explicitly document it as deferred compatibility; then add parity tests for success, claim failure, validation failure, manager submission failure, cancellation, timeout, and terminal response semantics.
4. Update broader architecture/control docs outside this plan directory where they still describe `dispatch_gate.py` as the live rehydrating module instead of a compatibility shim delegating to `continuation.py`.
5. Continue explicit-dataflow/runtime cleanup after the route/status and Workbench mismatches are handled: migrate fixtures to strict bindings, reduce `Path.cwd()` fallbacks, and fence or shrink compatibility shims.
6. Continue Workbench projection/storage cleanup: define code-level projection contracts, hide raw `runtime` / `binding_manifest` from normal payloads, and remove normal-path run-index rebuilds in favor of incremental updates.

## Documentation policy going forward

When a plan has an implemented slice but open compatibility/deletion work, update that plan with one of these labels rather than marking it fully complete:

- **Mostly complete; verification/manual step open**
- **Mostly complete for named slice; broader cleanup deferred**
- **Partially complete; compatibility/deletion gates remain**
- **Superseded/partial; replacement plan or newer artifact owns the path**

Do not convert unchecked checkboxes to checked unless the exact acceptance condition has been verified or the plan text is amended to explicitly defer/supersede that condition.
