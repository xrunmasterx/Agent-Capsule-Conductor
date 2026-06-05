# AGENTS.md

## Current Project Contract

Agent Callable Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature
external agents or local tools as reusable callable assets.

Current cleanup work is problem-led, not phase-led. `docs/problem/*.md` contains the active
architecture debt inventory. `docs/goal.md` defines the execution contract for closing that
inventory. Older phase documents remain useful evidence, but they do not outrank this file,
`docs/CURRENT_ARCHITECTURE.md`, or the verified problem list.

Current architecture is Core v2 callable-only:

- `AgentClassTemplate` / `ToolClassTemplate`: reusable, stateless behavior definitions.
- `WorkflowFunctionTemplate`: reusable, stateless workflow function body.
- `NodeInvocationSpec`: one call site inside a workflow function.
- `FunctionInvocation`: one runtime call of a workflow function.
- `ScopeFrame`: the runtime scope for one invocation; owns cwd, inbox, outbox, artifacts, and
  behavior snapshot evidence.
- `SessionInstance`: one concrete agent/tool execution inside a scope frame.
- `ArtifactBundle`: stable files produced by a session, node, or workflow invocation.
- `GraphOps Control Plane`: proposal, validation, dry-run, human approval, then apply.

Legacy runtime architecture is not an active product architecture:

- `AgentClassTemplate`, `ToolClassTemplate`, `WorkflowFunctionTemplate`, `NodeInvocationSpec`, and
  `SessionInstance` are the active concepts.
- Legacy `CapsuleSpec`, `CapsuleRegistry`, `CapsuleRunner`, `WorkflowTemplate`, `NodeSpec`,
  `.graph.json`, old workflow graph schemas, and capsule YAML executable assets must not be used by
  product runtime paths.
- Legacy inputs may appear only as raw migration input, explicit rejection tests, or historical
  archived evidence. Do not reintroduce a compatibility registry, old runner, old graph runtime, or
  hidden fallback execution path.

If product code cannot express a needed behavior with the current Core v2 objects, extend the
canonical model and validation explicitly. Do not smuggle semantics through `raw`,
`metadata.legacy_*`, compatibility registries, or hidden normalization branches.

## Workflow Format

- **Canonical on-disk template**: `workflows/<id>.accflow.json` (Workbench/API save default).
- **Legacy import-only**: `*.graph.json` — convert with `acc workflow import-graph <path.graph.json>`.
- **CLI discovery**: `acc workflows list/show` must not list `.graph.json` files as runnable
  workflows.
- **Runtime path**: canonical `.accflow.json` parses directly to `WorkflowFunctionTemplate`, compiles
  to `ExecutionPlan`, and executes `CallableRef` as `SessionInstance` evidence. There is no
  opt-in legacy or compatibility hot path.
- **Active examples**: active `examples/` and `workflows/` assets must be canonical Core v2 assets.
  Legacy runnable examples belong under `tests/fixtures/legacy/`, migration tests, or historical
  docs only.

## Disposable Local Assets

The user has explicitly confirmed that the current workflow canvases, Workbench nodes, and
agent/tool template assets created only for functional testing are disposable. They may be deleted
or regenerated in cleanup work when doing so simplifies the architecture and no production contract
depends on preserving those concrete assets.

This authorization applies to temporary product-surface assets such as ad hoc
`workflows/*.accflow.json` files and testing-only agent/tool templates after their role has been
verified. It does not automatically apply to schemas, migration fixtures, explicit rejection tests,
historical evidence under `docs/historical/`, or checked-in examples that are still referenced by
tests, docs, CLI behavior, or server/API discovery contracts.

Deletion still requires a current `git status --short`, code/search evidence for each asset class,
focused tests for any changed discovery/runtime behavior, and an update to
`docs/problem/RESOLUTION_MATRIX.md` when the deletion closes a problem finding.

## Problem Repair Contract

When working on the current architecture cleanup, use `docs/problem/RESOLUTION_MATRIX.md` as the
required ledger. Every valid finding under `docs/problem/*.md` must end in exactly one of these
states:

- `fixed`: repaired with changed files and verification command recorded.
- `stale`: current code no longer has the issue, with file/line evidence.
- `deferred-with-reason`: real issue, but it needs ADR, profiling, contract change, or a separate
  risk-bounded batch.
- `blocked-with-evidence`: real issue, but progress is blocked; record the exact command/action,
  error evidence, and missing condition.

Repair order should follow the problem inventory's risk model:

1. Dead code and patch scars that are locally provable.
2. Legacy and compatibility boundary cleanup.
3. Duplicate implementations and single-source-of-truth cleanup.
4. Layering violations.
5. Workbench/API run-model cleanup.
6. Performance issues with evidence.
7. Complexity hotspots and policy consolidation.

Do not mix unrelated categories in one broad cleanup. For each batch, verify the current code facts
first, make the smallest architecture-consistent change, run focused tests, then update the ledger.

### Deletion Rules

For active product paths, replace product callers and add Core v2 or rejection tests before deleting
old code.

For zero-import tombstones, deletion may happen first after full-repo `rg` confirms no product
caller. Confirm whether any remaining test reference is historical evidence, an explicit rejection
test, or a misleading dependency that should be removed.

Allowed legacy hits are limited to:

- `acc.migration.*` raw parser or migration provenance.
- `tests/migration/*`.
- Explicit rejection tests.
- `tests/fixtures/legacy/*`.
- Historical docs or archived fixtures.

These locations must not participate in default discovery, default execution, Workbench lists,
server lists, or active examples.

## Stable Invariants

These rules outrank older phase docs when there is a conflict.

1. Preserve public CLI behavior that matters.
   - `acc run ... --emit-conductor-json` stdout must contain exactly one JSON object.
   - `acc workflow run ... --emit-json` stdout must contain exactly one JSON object.
   - Logs go to stderr or files, not stdout, when a machine-readable JSON flag is used.

2. Default tests must stay hermetic.
   - No default test may require real Codex, Claude, Cursor, Gemini, Hermes, Conductor, network,
     browser credentials, cloud services, or paid external services.
   - Real external-agent/browser/network smoke tests must be opt-in.

3. Do not implement a custom LLM reasoning or tool-calling loop.
   - External mature agents own their internal loop.
   - `acc` owns execution boundaries, manifests, inputs, outputs, and artifacts.

4. Keep ACC lightweight and local-first.
   - Do not add a database, cloud backend, Kubernetes, distributed worker system, marketplace, SaaS
     surface, or team permission system unless a new explicit goal requires it.

5. Keep template state separate from runtime state.
   - Templates must not store run directories, local absolute workspace bindings, previous outputs,
     session ids, or agent conversation memory.
   - Runtime state belongs in run-scoped manifests, events, inboxes, outboxes, artifacts, and UI/API
     projections.

6. Keep data movement explicit.
   - Upstream nodes must not write directly into downstream workspaces or inboxes.
   - Use ports, inbox/outbox materialization, artifact references, and workflow-call bindings.

7. Keep GraphOps human-governed.
   - LLM-generated callable/workflow changes must default to proposal mode.
   - Destructive or persistent apply requires validation, dry-run evidence, and explicit human
     approval.

8. Keep layer boundaries clear.
   - `acc.domain` and `acc.engine` must remain pure: no filesystem IO, subprocesses, server/UI
     imports, or host environment reads.
   - `acc.store` owns filesystem manifests, inbox/outbox materialization, and path protection.
   - `acc.runtime` owns process/workspace execution policy.
   - `acc.app` coordinates use cases across engine/store/runtime.
   - `acc.server` is a thin API layer: request parsing, service call, response shaping, and HTTP
     error translation only.
   - `web/` owns interaction state and visual projection, not runtime truth.

9. Keep runtime evidence auditable.
   - `RunRecord`, `run_summary.json`, events, indexes, and UI projections must have explicit,
     non-overlapping responsibilities.
   - Runtime status should use canonical names such as `success`, `failed`, `cancelled`, and
     `crashed`; do not write `succeeded` and normalize it on read as a permanent compatibility scar.
   - `events.jsonl` must have one canonical event schema per evidence stream. Multiple writers may
     exist only if they write that same schema.

10. Keep foundation helpers centralized.
    - Do not add new ad hoc `write_json`, `copy_path`, JSON Schema validation, path-safety, or
      event-writing helpers when an existing store/runtime primitive can be extended.
    - If helper behavior differs by layer, document the boundary instead of copy-pasting a variant.

## Current Workbench Rules

The visual Workbench exists and is in scope. Older docs that say "do not build UI" or "do not build
visual canvas" are historical phase constraints, not current rules.

Workbench must follow these boundaries:

- Chinese is the default language for core user-visible labels.
- The graph canvas is the primary workflow editing surface.
- UI task state is a user interaction projection; workflow templates and run artifacts remain the
  durable runtime truth.
- System prompts belong to reusable Agent/Tool class resources. Task canvas nodes are invocation
  instances and may configure only invocation-scoped data such as user prompt, static input, and
  bindings.
- Node inspectors should show useful invocation config plus real input/output/artifact evidence from
  the selected run.
- Multiple Workbench runs may be submitted concurrently through run-scoped state. Do not reintroduce
  one global UI run singleton.

## Workbench Async Run Model

Workbench async runs use a lightweight server-scoped `WorkbenchRunManager`.

- `/api/workflows/run-graph` remains the synchronous compatibility endpoint.
- `/api/workflows/run-graph/submit` is the async Workbench submit path.
- Run directories, summaries, events, and artifacts are the source of truth.
- In-memory active-task maps are execution handles only; they must not be treated as durable facts.
- Queued/running/terminal state must be scoped by `run_id` and associated with a `task_id` in UI
  projections.
- Do not delete or change `/api/workflows/run-graph` unless this file, `docs/CURRENT_ARCHITECTURE.md`,
  server routes, web callers, and tests are updated in the same change. New Workbench behavior should
  prefer async submit.

## Documentation Source of Truth

Read only the docs needed for the task. Do not blindly load every historical goal package.

Start here for architecture or documentation work:

- `README.md`
- `docs/README.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`

For the current architecture-debt cleanup, also read:

- `docs/goal.md`
- `docs/problem/README.md`
- `docs/problem/RESOLUTION_MATRIX.md`
- The specific `docs/problem/*.md` files relevant to the category being fixed.

For callable runtime changes, also read:

- `docs/codex_goal_callable_semantics/DESIGN.md`
- `docs/codex_goal_callable_semantics/DOMAIN_MODEL.md`
- `docs/codex_goal_callable_semantics/EXECUTION_BOUNDARIES.md`
- `docs/codex_goal_callable_semantics/QUALITY_REPORT.md`

For Workbench UI changes, also read:

- `docs/codex_goal_visual_workbench_ux_refactor/DESIGN.md`
- `docs/codex_goal_visual_workbench_ux_refactor/SPEC.md`
- `docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md`

Older `docs/codex_goal*` directories are historical goal packages unless a current task explicitly
names one. They are useful for rationale and acceptance history, but their non-goals do not override
the current architecture contract above.

Within historical goal packages, `FINDINGS.md` and `PROGRESS.md` are usually time-stamped evidence
logs. Prefer the package's `QUALITY_REPORT.md` for final state when it exists.

## Before Changing Files

1. Inspect the current implementation first. Prefer `rg` / `rg --files` for search.
2. Check `git status --short` and avoid overwriting unrelated user changes.
3. Treat untracked generated artifacts cautiously. Files such as `progress.jsonl`,
   `web/test-results/`, `tests/e2e/` artifacts, and timestamped Workbench `workflows/*.accflow.json`
   may be user or test output. Do not promote them to active examples without confirming their role.
   If the current goal invokes the disposable local asset authorization above, workflow/template
   artifacts that are verified as test-only may be deleted, but the deletion scope must be explicit
   and recorded.
4. Identify the smallest architecture-consistent change. Do not stack patches on a wrong model.
5. If the work targets `docs/problem`, update `docs/problem/RESOLUTION_MATRIX.md` as part of the
   same batch.
6. If a doc says one thing and the code proves another, update the doc or report the discrepancy.

## Verification Expectations

Run the smallest meaningful test set after each meaningful change.

Default full regression commands:

```bash
uv run pytest -q
uv run ruff check .
```

When changing server/API/workflow behavior, include focused backend tests under `tests/server`,
`tests/unit`, or `tests/integration`.

When changing CLI behavior, run existing focused CLI/integration tests. If `tests/cli/` does not
exist, do not treat the missing directory as a failure; use existing integration tests or add a
minimal focused test for the changed behavior.

When changing the Workbench, include:

```bash
cd web
npm run test -- --run
npm run build
```

When changing browser-facing behavior, run a browser journey when feasible and record screenshots,
console errors, network errors, and the report path. If browser tooling is unavailable, state that
gap and keep hermetic tests passing.

## Reporting Blockers

If blocked, do not guess. Report:

- what failed,
- the exact command or action,
- evidence collected,
- which external dependency or missing information is required.
