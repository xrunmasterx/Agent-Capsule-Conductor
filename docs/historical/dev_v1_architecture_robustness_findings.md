# dev_v1 Architecture Robustness Findings

## Scope

This document records the dynamic workflow review findings for the current `dev_v1` update. The review focused on robustness, redundant or temporary legacy code, hard-coded behavior, lightweight architecture health, complete state-machine design, top-down design, and object-oriented/domain modeling.

Workflow result summary:

- Raw findings: 47
- Deduplicated findings: 47
- Adversarially verified findings: 46

## Overall judgment

The main risks in `dev_v1` are not isolated implementation mistakes. They come from several architectural boundaries that have not yet become first-class system invariants:

1. Run identity, run directories, runtime specs, and behavior snapshots do not have exclusive ownership.
2. The state machine is not the central source of truth for execution lifecycle.
3. Runtime workflow bundles are not immutable, atomic, manifest-authoritative execution snapshots.
4. Temporary, legacy, and hard-coded production paths can still turn real failures into apparent success.
5. Core concepts are not sufficiently object-oriented or domain-owned; too much behavior is encoded as dictionaries, strings, helper functions, and if-chains.

## P0: Run directory and run identity ownership risks

Severity: Critical / High

### Evidence

- `acc/server/routes/workflows.py:542-546`: arbitrary project-internal directories can be used as `run_dir`; validation only checks containment under `project_root`.
- `acc/app/core_v2_runtime.py:638-641`: runtime startup can delete an existing `run_dir` via `shutil.rmtree(run_dir)`.
- `acc/server/run_manager.py:48-56`, `acc/server/run_manager.py:76-85`: `_active[job.run_dir.name] = task` can overwrite an existing task handle; duplicate run IDs are not reliably rejected.
- `acc/app/core_v2_runtime.py:1422-1427`, `acc/app/core_v2_runtime.py:2220-2244`, `acc/result_store/filesystem.py:69-95`, `acc/result_store/filesystem.py:110-127`: node IDs and port IDs participate in filesystem paths without a strong shared safe-path boundary.

### First-principles problem

A run directory is not ordinary user input. It is a security boundary, lifecycle boundary, persistence boundary, and concurrency ownership boundary.

If the API accepts arbitrary project-internal paths while the runtime can delete those paths, run isolation is not real. Likewise, a run ID must be a claimed resource, not just a string used as a dictionary key.

### Recommended direction

- API should accept only `run_id`, not arbitrary `run_dir`.
- Server should construct run directories as `project_root / "runs" / <safe_run_id>`.
- Introduce a shared `SafePathComponent` / `RunId` value object that rejects `.`, `..`, separators, drive prefixes, UNC paths, reserved Windows names, trailing dots/spaces, control characters, and empty values.
- `WorkbenchRunManager.submit()` should atomically claim run IDs under a lock. Queued, active, waiting, resuming, and cancel-requested runs should all count as occupied.
- Duplicate submissions should return HTTP 409 unless strict idempotency keys are implemented.
- Runtime should verify an ownership marker before deleting a run directory.
- ResultStore and evidence writes should perform resolved containment checks.
- `_active` cleanup should compare task identity so an older task cannot remove a newer task with the same run ID.

## P1: Execution lifecycle is not a complete central state machine

Severity: High

### Evidence

#### Human approval can leave the DAG stuck

- `acc/app/core_v2_runtime.py:865-870`: initial execution stops launching when it hits `waiting_interaction`.
- `acc/app/run_lifecycle.py:137-166`, `acc/app/core_v2_runtime.py:924-1026`: resume only restores the matching gate step.
- Descendant nodes can remain `pending`, while the run remains in `resuming` without re-entering the ready queue.

#### Human rejection is not graph-aware failure propagation

- `acc/app/run_lifecycle.py:186-252`: only the gate step is changed to `skipped`; descendants are not systematically skipped and the run plan is not centrally finalized.

#### Projections can contradict each other

- `acc/app/core_v2_runtime.py:733-739`: the primary path only finalizes the run plan in some branches.
- `acc/app/core_v2_runtime.py:2166-2173`: output materialization failure can write `run_summary.status=failed` while `run_plan.status` may remain active.
- `acc/app/core_v2_runtime.py:980-1021`, `acc/app/core_v2_runtime.py:1080-1127`, `acc/app/core_v2_runtime.py:1186-1233`: resume, supervisor, and handoff dispatch paths duplicate terminal projection writes instead of routing through one finalizer.

#### Cancellation is not a durable command

- `acc/server/run_manager.py:65-73`: active cancellation only writes `run_dir/cancel_requested`.
- `acc/app/core_v2_runtime.py:638-641`: runtime startup can delete the run directory and therefore delete the cancellation marker.
- `acc/app/core_v2_runtime.py:575-588`, `acc/app/core_v2_runtime.py:804-812`, `acc/app/core_v2_runtime.py:1895-1906`: nested workflows do not inherit a root cancellation token.
- `acc/callable_runner.py:98-119`: adapter cancellation uses a child-scope marker.

#### Child workflow status is flattened

- `acc/app/core_v2_runtime.py:1852-1910`: child workflow statuses such as waiting, cancelled, and resuming are effectively treated as non-success failures rather than explicit parent-visible states.

### First-principles problem

A workflow runtime should have a single explicit state machine. Events such as `HumanApproved`, `HumanRejected`, `CancelRequested`, `NodeSucceeded`, `NodeFailed`, `ChildWorkflowWaiting`, `ChildWorkflowCompleted`, and `OutputMaterializationFailed` should all pass through the same transition function.

Current behavior is spread across helper functions that directly mutate JSON files, append ledger entries, and update summaries. This can create contradictions between ledger, run plan, run summary, and API projection.

### Recommended direction

- Introduce a centralized `RunStateMachine` or `RunLifecycle`.
- Human approval should rebuild scheduler state from durable plan/ledger, apply `HumanApproved`, transition the gate, re-enter the normal ready-queue loop, and release descendants.
- Human rejection should perform graph-aware propagation, skip descendants, and terminalize the run through the same finalizer used by other failure paths.
- All terminalization should go through one helper that finalizes `run_plan.json`, appends a terminal ledger event, writes `run_record.json`, writes `function_invocation.json`, and writes `run_summary.json`.
- Cancellation should use a root `CancellationToken` propagated into nested workflows and adapters, not a marker file in a directory that may be deleted.
- Child workflow statuses should be mapped to explicit parent-visible states rather than collapsed into generic failure.

## P2: Runtime spec and workflow bundles are mutable caches rather than immutable execution snapshots

Severity: High / Medium

### Evidence

- `acc/server/routes/workflows.py:216-222`: runtime spec directories use deterministic short hashes.
- `acc/server/routes/workflows.py:178-180`: directories are reused with `exist_ok=True`.
- `acc/server/routes/workflows.py:733-774`: only the current bundle files are replaced; old `.accflow.json` files may remain.
- `acc/app/core_v2_runtime.py:1992-2038`: runtime can still enumerate `.accflow.json` files from the directory rather than consuming only the manifest.
- `acc/server/routes/workflows.py:272-296`: `runtime_specs.json` is written, but it is not the sole runtime source of truth.
- `acc/server/routes/workflows.py:143-150`, `acc/server/routes/workflows.py:178-212`: mutable specs are materialized before the run ID is claimed by the manager.

### First-principles problem

A run should execute one immutable behavior snapshot. The current runtime spec mechanism behaves more like a shared mutable cache:

- Same run directory can map to the same hash bucket.
- Buckets can retain stale child workflow files.
- A queued job may execute specs written by a later submission.
- The manifest is not authoritative.
- Runtime directory globbing can include files outside the intended bundle.

### Recommended direction

- Each submission should create an immutable spec namespace, such as `runs/_workflow_function_specs/<run_id>/<submission_id>/`.
- Jobs should store exact `graph_path` and `manifest_path` values.
- `runtime_specs.json` should become the sole list of root and child specs consumed by runtime.
- Runtime should ignore or reject manifest-external `.accflow.json` files.
- The run ID should be reserved before spec materialization begins.
- Spec publication should use a staging directory plus atomic swap or committed marker.
- Persistent workflow saves should use versioned bundles with validation and atomic active-pointer switching.
- Introduce a `ProjectLayout` or `WorkflowRepositoryConfig` so routes, runtime, authoring, and template code do not each hard-code workflow directories.

## P3: Temporary and legacy fallback paths can produce false success

Severity: High / Medium

### Evidence

#### Registered `tool_class` can succeed without real execution

- `acc/app/core_v2_runtime.py:1812-1849`: callable dispatch only truly supports `workflow_function` and `agent_class`.
- `acc/app/core_v2_runtime.py:2110-2156`: registry-backed callable fallback can return adapter stub success.
- `acc/callable_registry.py:46-65`, `acc/callable_registry.py:140-160`: the tool registry defines runner information, but the runtime path does not provide a real execution chain.

#### Unknown status can become success

- `acc/server/run_manager.py:165-170`
- `acc/app/run_lifecycle.py:19-31`

#### Retry policy is parsed but runtime execution is fixed to one attempt

- `acc/domain.py:186-200`, `acc/domain.py:1184-1197`
- `acc/app/core_v2_runtime.py:149-164`, `acc/app/core_v2_runtime.py:902-918`

#### Validator TypeError fallback hides validator bugs

- `acc/server/routes/workflows.py:589-607`

#### Empty Workbench containers are treated as runnable no-ops

- `acc/app/workbench_adapter.py:305-310`, `acc/app/workbench_adapter.py:450-484`
- `tests/server/test_workbench_core_v2_api.py:738-760` locks in successful submission behavior for this case.

### First-principles problem

The runtime should fail closed. Registered does not mean executed. Unknown does not mean successful. Accepted policy does not mean implemented policy. Empty graph does not automatically mean intentional no-op.

These fallback paths can give users and tests false confidence:

- A tool did not run, but the run reports success.
- A validator crashed, but save continues.
- A future status is unrecognized, but the API shows success.
- Stale Workbench state can influence execution permissions.
- Empty child workflows can mask modeling errors.

### Recommended direction

- Remove production stub success for registered `tool_class` callables.
- If `tool_class` has no real runner, raise `AccError`.
- Keep fake callables only in hermetic/test mode.
- Introduce a `CallableExecutor` registry for `agent_class`, `tool_class`, and `workflow_function`, where each executor explicitly declares runner, capability, timeout, and retry support.
- Unknown statuses should fail closed as `invalid_status` or `crashed`, never `success`.
- Retry policy should either be rejected when unsupported or implemented as an orchestrator-level attempt loop with backoff, attempt-specific dispatch IDs, and idempotency keys.
- Remove TypeError validator fallback. A TypeError should be treated as a validator bug or explicit legacy adapter path, not normal success.
- Empty containers should be rejected by default unless explicitly marked as intentional no-op.

## P4: Human gate answers lack transactional safety and replay repair

Severity: Medium / High

### Evidence

- `acc/app/human_gate_service.py:34-82`: answer flow writes answered state, appends decision, enqueues wakeup, and resumes execution as separate side effects.
- `acc/app/human_gate.py:50-62`: idempotency checks only the interaction file.
- `acc/app/interactions.py:94-118`: answer writes do not use CAS or a per-interaction lock.
- `acc/store/control_ledger.py:256-259`: ledger append is not atomic with interaction answer.

### First-principles problem

A human answer is a business transaction spanning multiple durable artifacts. If the process fails halfway, retry must verify and repair all expected artifacts. It is not enough to observe that the interaction is already answered and return no-op success.

### Recommended direction

- Use a per-interaction lock or compare-and-swap update. Conflicting answers should return 409.
- Use deterministic decision IDs and wakeup IDs so retries can verify and repair state.
- Idempotent retry should validate decision existence, wakeup queue entry, plan step transition, run status, and dispatch/resume scheduling.
- Inline dispatch and wakeup queue ownership should be unified to avoid stale pending wakeups.

## P5: Module boundaries and domain objects are too weak

Severity: Medium

### Evidence

- `acc/app/core_v2_runtime.py` is a large module that combines ledger coordination, root execution/finalization, ready queue execution, node execution, workflow calls, result publishing, summaries, and events.
- `acc/domain.py:90-118`, `acc/domain.py:329-363`, `acc/domain.py:513-602`: many domain dataclasses are mostly anemic data bags.
- `acc/engine/__init__.py:174-214`, `acc/engine/workflow_validation.py:71-132`: important invariants live in external parser/validator code rather than domain objects.
- `web/src/components/WorkflowViewer.tsx` combines API orchestration, polling, canvas state, authoring state, evidence panels, and serialization.
- `acc/app/workbench_adapter.py` combines UI layout interpretation, inline containers, Core v2 projection, Codex policy, and edge boundary inference.
- `acc/app/authoring.py` and `web/src/components/WorkflowViewer.tsx` both contain repeated string dispatch and operation switch logic.

### First-principles problem

A lightweight architecture is not necessarily a small number of files. It means core concepts are stable and explicit:

- `RunLifecycle` owns run transitions.
- `ControlLedgerSession` owns ledger transitions.
- `ReadyQueueExecutor` owns scheduling.
- `NodeExecutionSession` owns node execution.
- `WorkflowFunctionInvoker` owns child workflow invocation.
- `RuntimeWorkflowSpecMaterializer` owns behavior snapshots.
- `ProjectLayout` owns filesystem layout.
- `AuthoringOperationRegistry` owns authoring operations.

Current logic is often assembled from dictionaries, strings, route helpers, and monolithic functions. Adding a new state, callable kind, permission, operation, or container shape will require changes across many switch points and risks projection/runtime divergence.

### Recommended direction

Do not rewrite everything at once. Preserve public facades and gradually extract collaborators:

- Keep `core_v2_runtime.py` as an entry facade, but extract:
  - `RunFinalizer`
  - `ControlLedgerSession`
  - `ReadyQueueExecutor`
  - `NodeExecutionSession`
  - `PayloadMaterializer`
  - `WorkflowFunctionInvoker`
  - `ResultPublisher`
- Add domain value objects and local invariants for:
  - safe IDs
  - callable kind/ID
  - port direction/cardinality/materialization
  - environment policy
  - plan step legal transitions
- Introduce typed Workbench intermediate models:
  - `WorkbenchDraft`
  - `WorkflowContainer`
  - `CanvasEdge`
  - `WorkflowBoundaryBindings`
  - `CompiledBundle`
- Convert authoring operations into a registry with operation name, schema, semantic validator, apply handler, analyzer, and summary.
- Split `WorkflowViewer.tsx` into codecs, run hooks, authoring reducer, inspector panels, and evidence panels.

## Recommended fix order

### P0: Close destructive and path-escape risks first

1. Restrict run directories to `runs/<safe_run_id>`.
2. Verify ownership markers before runtime directory deletion.
3. Add a shared safe path component validator.
4. Add containment checks to ResultStore and evidence writes.

### P1: Establish run ID exclusivity and immutable runtime specs

5. Reject duplicate queued/active/waiting/resuming run IDs in `WorkbenchRunManager.submit()`.
6. Materialize runtime specs only after run ID reservation succeeds.
7. Use immutable per-submission spec directories.
8. Make runtime consume only manifest-listed specs.

### P2: Make lifecycle transitions state-machine driven

9. Resume human approval by rebuilding scheduler state and re-entering the ready queue.
10. Make human rejection graph-aware.
11. Route all terminal status writes through one finalizer.
12. Finalize run plan on output materialization failure.
13. Propagate cancellation tokens into nested workflows and adapters.
14. Map child workflow waiting/cancelled/resuming into explicit parent-visible states.

### P3: Make human answers transactional

15. Add per-interaction CAS or locking.
16. Make retries verify and repair decision, wakeup, plan, run status, and dispatch state.
17. Unify inline dispatch and wakeup queue ownership.

### P4: Remove false-success fallback paths

18. Remove production stub success for registered `tool_class` callables.
19. Stop mapping unknown statuses to success.
20. Prevent stale Workbench snapshots from implicitly changing execution mode.
21. Reject unsupported retry policies or implement real retry execution.
22. Remove TypeError validation fallback.
23. Reject empty containers by default unless explicitly marked as intentional no-op.

### P5: Improve module and object boundaries

24. Extract `RunLifecycle`, `ControlLedgerSession`, and `ReadyQueueExecutor`.
25. Extract a `CallableExecutor` registry.
26. Extract `ProjectLayout` or `WorkflowRepositoryConfig`.
27. Split Workbench adapter and `WorkflowViewer.tsx` responsibilities.
28. Convert authoring operations to registry-driven design.

## Tests to add

- Duplicate run ID while queued, active, waiting, and resuming.
- Malicious or destructive `run_dir` inputs.
- Stale runtime spec child cleanup.
- Runtime manifest enforcement.
- Forced runtime spec hash collision.
- Nested workflow cancellation propagation.
- Human gate approval followed by downstream DAG execution.
- Human rejection descendant propagation.
- Output materialization failure consistency across run plan, summary, and ledger.
- `tool_class` without runner fails closed.
- Unknown status is not displayed as success.
- Empty container is rejected by default.
