# AGENTS.md

## Current Project Contract

Agent Capsule Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature
external agents or local tools as reusable callable assets.

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

## Module Layout (post-refactoring 2026-06)

```text
acc/
  models.py            — frozen dataclass definitions (62 domain types)
  serialization.py     — to_dict / from_dict functions
  validation.py        — validate_core_v2_* functions
  state_machine.py     — pure transition tables & helpers (PlanStep/Dispatch/Run)
  ledger_writer.py     — FixedRunControlLedgerWriter (sole mutable writer)
  graphops.py          — unified GraphOpsService with typed operation handlers
  utils.py             — consolidated shared utilities
  constants.py         — shared constants (no cross-module duplication)
  engine/              — pure scheduling, normalization, dependency analysis
  runtime/             — transfer policy, node payload, IO helpers
  app/
    runtime/           — orchestrator, scheduler, executor, dispatch_gate, workflow_io
    agent_sessions.py  — session lifecycle + indexed lookup
    authoring.py       — authoring session service
    run_lifecycle.py   — run creation and lifecycle
    handoff.py         — handoff execution
    supervisor.py      — supervisor plan execution
    decisions.py       — human gate and decision handling
  server/              — FastAPI routes
  cli.py               — CLI entry point
  mcp_server/          — MCP tool server

web/
  src/
    stores/            — Zustand (workbenchStore, runStore, assistantStore)
    components/
      WorkflowViewer.tsx  — thin shell importing sub-modules
      canvas/          — ReactFlow canvas, node types, layout constants
      authoring/       — AI authoring session, proposal review
      assistant/       — chat drawer, turn list
      execution/       — run dock, overlay
      inspector/       — node detail, selection panels
      workbench/       — shell layout, top bar, task rail, workspace switcher
    hooks/             — useAssistantStream, useRunStream (SSE)
    i18n/              — zh-CN.ts (UI language: Chinese)
```

## Workflow Format

- **Canonical on-disk template**: `workflows/<id>.accflow.json` (Workbench/API save default).
- **Legacy import-only**: `*.graph.json` — convert with `acc workflow import-graph <path>`.
- **Runtime path**: canonical `.accflow.json` parses to `WorkflowFunctionTemplate`, compiles to
  `ExecutionPlan`, executes `CallableRef` as `SessionInstance` evidence.

## Stable Invariants

These rules outrank older phase docs when there is a conflict.

1. **CLI machine-readable output**: `acc run ... --emit-conductor-json` / `--emit-json` stdout
   contains exactly one JSON object. Logs go to stderr.

2. **Hermetic tests**: No default test may require real Codex, Claude, Cursor, Gemini, Hermes,
   network, or paid services. External smoke tests are opt-in only.

3. **No custom LLM loop**: External agents own their internal reasoning. ACC owns execution
   boundaries, manifests, inputs, outputs, and artifacts.

4. **Local-first**: No database, cloud backend, Kubernetes, or SaaS surface unless a new
   explicit goal requires it.

5. **Template ≠ runtime state**: Templates must not store run dirs, workspace bindings, session
   ids, or conversation memory. Runtime state lives in run-scoped evidence.

6. **Explicit data movement**: No direct upstream→downstream workspace writes. Use ports,
   inbox/outbox materialization, artifact references, and workflow-call bindings.

7. **Human-governed GraphOps**: LLM-generated changes default to proposal mode. Destructive
   apply requires validation + dry-run + human approval.

8. **Layer boundaries**:
   - `acc.models`, `acc.engine`, `acc.state_machine`: pure — no IO, no subprocesses.
   - `acc.store`: filesystem manifests, path protection.
   - `acc.runtime`, `acc.app.runtime`: process/workspace execution.
   - `acc.app`: use-case coordination.
   - `acc.server`: thin API layer.
   - `web/`: interaction state and visual projection only.

9. **Auditable evidence**: RunRecord, events.jsonl, and UI projections have non-overlapping
   responsibilities. Status uses canonical names (`success`, `failed`, `cancelled`, `crashed`).

10. **Centralized helpers**: No ad hoc `write_json`, `copy_path`, or JSON Schema validation
    duplicates. Extend `acc/utils.py` or `acc/store` instead of copy-pasting.

## Workbench Rules

- Chinese is the default language for user-visible labels.
- The graph canvas is the primary workflow editing surface.
- UI task state is a projection; workflow templates and run artifacts are durable truth.
- System prompts belong to Agent/Tool class resources. Task nodes configure invocation-scoped
  data only (user prompt, static input, bindings).
- Multiple concurrent runs are modeled by `run_id` + `task_id`. No global `isRunning` singleton.

## Workbench Async Run Model

- `/api/workflows/run-graph/submit` is the async Workbench submit path.
- `/api/workflows/run-graph` remains for synchronous compatibility.
- In-memory active-task maps are execution handles only, not durable facts.

## Documentation Source of Truth

Start here:

- `AGENTS.md` (this file) — project contract and module layout
- `docs/CURRENT_ARCHITECTURE.md` — data flow, callable concepts, evidence files
- `docs/concepts/` — first principles, capsule/template/session, GraphOps control plane

For refactoring history and completion status:

- `docs/refactoring-plan/` — 7 feature plans + master plan (executed 2026-06)
- `docs/ACC_Architecture_Audit_2026.md` — full audit with verification results

For callable runtime semantics:

- `docs/codex_goal_callable_semantics/DESIGN.md`
- `docs/codex_goal_callable_semantics/DOMAIN_MODEL.md`

For Workbench UX:

- `docs/codex_goal_visual_workbench_ux_refactor/DESIGN.md`

For strategic planning:

- `docs/requirements/` — supervisor and platform evolution phases
- `docs/codex_goals_next_stage/` — next-stage goal definitions

Historical goal packages and legacy material are in `docs/historical/`.

## Before Changing Files

1. Inspect current implementation first. Use `rg` / `rg --files` for search.
2. Check `git status --short` and avoid overwriting unrelated changes.
3. Identify the smallest architecture-consistent change.
4. If a doc says one thing and code proves another, update the doc.

## Verification

```bash
# Backend
python -m pytest -q --ignore=tests/integration --ignore=tests/server
# or with all deps:
uv run pytest -q

# Frontend
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

## Disposable Local Assets

Temporary workflow canvases, Workbench nodes, and agent/tool templates created for testing are
disposable. They may be deleted when doing so simplifies the architecture and no production
contract depends on them. Historical evidence belongs under `docs/historical/`.
