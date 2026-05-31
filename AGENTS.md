# AGENTS.md

## Current Project Contract

Agent Capsule Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature
external agents or local tools as reusable callable assets.

Current architecture is callable-first:

- `AgentClassTemplate` / `ToolClassTemplate`: reusable, stateless behavior definitions.
- `WorkflowFunctionTemplate`: reusable, stateless workflow function body.
- `NodeInvocationSpec`: one call site inside a workflow function.
- `FunctionInvocation`: one runtime call of a workflow function.
- `ScopeFrame`: the runtime scope for one invocation; owns cwd, inbox, outbox, artifacts, and
  behavior snapshot evidence.
- `SessionInstance`: one concrete agent/tool execution inside a scope frame.
- `ArtifactBundle`: stable files produced by a session, node, or workflow invocation.
- `GraphOps Control Plane`: proposal, validation, dry-run, human approval, then apply.

Legacy names still exist for compatibility:

- `Capsule Template` maps to `AgentClassTemplate`, `ToolClassTemplate`, or a legacy compatibility
  wrapper.
- `Session` maps to the legacy `acc run` session artifact and to clean workflow `SessionInstance`
  evidence.
- Existing `.accflow.json`, `.graph.json`, `CapsuleSpec`, and `NodeSpec` behavior must not be
  removed without migration notes and tests.

## Dual workflow format (P0 convergence)

- **Canonical on-disk template**: `workflows/<id>.accflow.json` (Workbench/API save default).
- **Legacy import-only**: `*.graph.json` — convert with `acc workflow import-graph <path.graph.json>`.
- **CLI discovery**: `acc workflows list/show` discovers `.accflow.json` first; legacy `.graph.json`
  is listed only when no matching accflow file exists for the same workflow id.
- **Callable hot path (opt-in)**: set `ACC_USE_CALLABLE_DISPATCH=1` (or `true`/`yes`) to route clean
  workflow nodes through `CallableInvocationService`; default remains off for byte-stable manifests.
  See `docs/codex_goal_callable_semantics/MIGRATION_NOTES.md`.

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
   - LLM-generated graph/capsule/workflow changes must default to proposal mode.
   - Destructive or persistent apply requires validation, dry-run evidence, and explicit human
     approval.

8. Keep layer boundaries clear.
   - `acc.domain` and `acc.engine` must remain pure: no filesystem IO, subprocesses, server/UI
     imports, or host environment reads.
   - `acc.store` owns filesystem manifests, inbox/outbox materialization, and path protection.
   - `acc.runtime` owns process/workspace execution policy.
   - `acc.app` coordinates use cases across engine/store/runtime.
   - `acc.server` is a thin API layer.
   - `web/` owns interaction state and visual projection, not runtime truth.

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

## Documentation Source of Truth

Read only the docs needed for the task. Do not blindly load every historical goal package.

Start here for architecture or documentation work:

- `README.md`
- `docs/README.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`

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
3. Identify the smallest architecture-consistent change. Do not stack patches on a wrong model.
4. If a doc says one thing and the code proves another, update the doc or report the discrepancy.

## Verification Expectations

Run the smallest meaningful test set after each meaningful change.

Default full regression commands:

```bash
uv run pytest -q
uv run ruff check .
```

When changing server/API/workflow behavior, include focused backend tests under `tests/server`,
`tests/unit`, or `tests/integration`.

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
