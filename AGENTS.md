# AGENTS.md

## Current Project Contract

Agent Callable Conductor (`acc`) is a local-first orchestration runtime and Workbench for wrapping mature external agents, local tools, and child workflows as reusable callable assets.

ACC owns orchestration boundaries: callable/workflow definitions, runtime invocations, control decisions, explicit data movement, evidence, artifacts, projections, and governed workflow/callable mutation. External agents and tools own their internal reasoning and execution behavior. ACC does **not** implement a custom LLM reasoning loop and does **not** teach agents how to do their work.

## Documentation Authority

The active architecture authority is:

1. `docs/architecture/00-constitution.md` — highest architecture authority.
2. `docs/architecture/01-core-object-model.md` through `docs/architecture/08-architecture-proof-obligations.md` — detailed topic authority.
3. `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/CURRENT_ARCHITECTURE.md` — entry points and summaries.
4. `docs/superpower_acc_architecture/*` — Superpower-style SPEC/DESIGN/FINDINGS/IMPLEMENTATION_ORDER/TEST_PLAN/ACCEPTANCE package for architecture convergence work.
5. `docs/implementation/*` — subordinate implementation roadmaps.
6. `docs/audits/*` — evidence-led audit artifacts.
7. `docs/historical/*` — historical context only.

If active documents conflict, `docs/architecture/*` wins. Archived documents never override active architecture specs. Audits and Superpower goal packages identify debt and execution order, but they do not override the architecture constitution.

## Superpower Architecture Package

For architecture reset, debt cleanup, or runtime refactor work, read these before changing code:

- `docs/superpower_acc_architecture/SPEC.md` — target architecture and non-negotiable invariants.
- `docs/superpower_acc_architecture/DESIGN.md` — runtime/service/port decomposition.
- `docs/superpower_acc_architecture/FINDINGS.md` — current unhealthy architecture, redundancy, low-performance paths, and boundary violations.
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md` — staged migration order.
- `docs/superpower_acc_architecture/TEST_PLAN.md` and `docs/superpower_acc_architecture/ACCEPTANCE.md` — required proof and acceptance criteria.

## Core Architecture Vocabulary

- `AgentClassTemplate` / `ToolClassTemplate`: reusable, stateless callable behavior definitions.
- `WorkflowFunctionTemplate`: reusable, stateless workflow function body.
- `NodeInvocationSpec`: one call site inside a workflow function.
- `CallableRef`: typed reference to a callable target.
- `ExecutionPlan` / `OrchestrationIntent`: compiled semantic execution shape; target design keeps this pure and separate from ledger persistence.
- `FunctionInvocation`: one runtime call of a workflow function.
- `ScopeFrame`: runtime scope for one invocation; owns workspace/environment/inbox/outbox/artifact roots and behavior snapshot evidence.
- `SessionInstance`: one concrete agent/tool execution inside a scope frame.
- `NodeExecutionResult`: target immutable result of one node execution; scheduler should aggregate these rather than node tasks mutating shared output state.
- `AdapterCapabilityEnvelope`: target narrow adapter-facing contract; external agents/tools should receive declared inputs/capabilities, not raw ACC topology.
- `RunPlan`, `PlanStep`, `DispatchEnvelope`, `DecisionRecord`: control-ledger evidence for why work is authorized and dispatched.
- `ControlModeStrategy`: target abstraction for fixed workflow, supervisor, handoff, and human gate as strategies over one runtime substrate.
- GraphOps Control Plane: proposal, validation, dry-run, human approval, then apply for durable asset mutation only.

## Stable Invariants

1. ACC orchestrates; external agents and tools reason and act internally.
2. Templates are reusable and stateless. Runtime identity, run dirs, workspace bindings, session ids, provider memory, conversation history, and UI selection state belong to run-scoped evidence or projections, not definitions.
3. Control authorization is separate from data movement. Data moves through declared workflow inputs, ports, bindings, data edges, inbox/outbox materialization, result refs, artifact refs, or explicit snapshot inputs.
4. Agent nodes are workflow-unaware. They receive declared task inputs and explicit capabilities; they should not need to know whether they are inside fixed workflow, supervisor, handoff, human gate, or nested workflow execution.
5. Workflow, supervisor, handoff, human gate, and nested workflow are target control strategies over one execution substrate, not separate runtimes.
6. Runtime evidence is durable truth. Server projections, UI stores, indexes, polling state, and SSE/live streams are derived views or transports.
7. Persistent callable/workflow mutation is governed through GraphOps unless a new active architecture spec defines another governed path.
8. Local-first filesystem evidence remains the default truth model. A database, cloud backend, distributed worker, or SaaS surface requires a new explicit architecture decision.
9. Legacy compatibility must be explicit and bounded. `.accflow.json` is canonical for workflow templates; `.graph.json`, legacy YAML workflow shapes, schema aliases, and old shims are migration/rejection/historical concerns unless an active spec says otherwise.
10. Architecture claims require proof obligations. New control modes, evidence schemas, compatibility exceptions, or projection contracts must add or update tests/static checks.

## Current Code Facts and Known Deviations

Treat the following as current reality, not target architecture:

- Fixed workflow is the most mature runtime path.
- Supervisor, handoff, and some resume flows are not fully converged into one runtime kernel yet.
- `acc/app/runtime/dispatch_gate.py` still rehydrates persisted state and may reconstruct dynamic node/template overlays for resume/supervisor/handoff paths.
- `acc/runtime/node_payload.py` still contains implicit control-main forwarding compatibility; this violates the target control/data separation and must not be expanded.
- Template/node metadata and behavior overlays still have open-ended surfaces; do not add new runtime/session/workspace/provider/conversation semantics there.
- Adapter request/env surfaces currently expose more run/workspace/session topology than the target `AdapterCapabilityEnvelope`; do not depend on this as a permanent contract.
- `acc/app/core_v2_runtime.py` is a backward-compatibility shim. New code should import concrete runtime modules or target ports directly.
- Storage and run projections still contain performance-debt paths such as full index rebuilds, polling streams, and repeated JSONL/manifest parsing. Optimize by incremental projection, caching, batching, or explicit repositories — not by adding hidden state truth.

When code and target specs disagree, label the current behavior as a known deviation, add/adjust proof obligations, and migrate in the order documented by `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`.

## Layer Boundaries

- `acc.models`, `acc.engine`, and state-machine helpers: pure domain, planning, validation, and transition logic. No filesystem IO, subprocess, host env reads, server/UI imports, or runtime adapter dispatch.
- `acc.runtime` and `acc.app.runtime`: data materialization, scheduling, dispatch, execution, and evidence writing. Target direction is explicit repositories/recorders/ports rather than broad transaction scripts.
- `acc.app`: use-case coordination across engine, runtime, store, projection, and governance services.
- `acc.graphops`: governed durable asset mutation. GraphOps must not become runtime dispatch.
- `acc.server`: thin API layer for request parsing, app/projection/evidence service delegation, and HTTP error translation. Do not put runtime graph assembly, run claiming, subprocess, or complex event merge policy directly in routes.
- `web/`: Workbench authoring and projection surface only. It must not become runtime truth.

## Workflow and Callable Formats

- Canonical active workflow templates are `.accflow.json` files containing Core v2 callable references.
- Legacy `.graph.json` files are import-only or explicit-rejection inputs.
- Callable YAML assets are separate from workflow YAML compatibility; do not treat every YAML format as one legacy bucket.
- Legacy compatibility in active loaders must have a migration reason, tests, and deletion condition.

## Before Changing Architecture-Sensitive Files

1. Read `docs/architecture/00-constitution.md`.
2. Read the relevant topic spec under `docs/architecture/*`.
3. For runtime/refactor/debt work, read `docs/superpower_acc_architecture/SPEC.md`, `FINDINGS.md`, and `IMPLEMENTATION_ORDER.md`.
4. Check `git status --short` and avoid overwriting unrelated work.
5. Identify the smallest architecture-consistent change.
6. If code and docs disagree, verify current code, then update active docs or record a debt/deviation item.
7. Do not use archived documents as current requirements.

## Implementation Guardrails

- Do not implement a custom LLM reasoning loop or tool-calling loop inside ACC.
- Do not teach agents how to do their internal work; pass declared task input and capabilities only.
- Do not add a second runtime for supervisor/handoff/human gate.
- Do not add hidden data movement over control edges.
- Do not add new executable behavior to arbitrary `metadata` or `raw` fields.
- Do not make Workbench localStorage, canvas snapshots, polling state, or SSE state durable runtime truth.
- Do not make GraphOps apply part of normal runtime dispatch.
- Do not add database/cloud/distributed-worker infrastructure as a core requirement without an explicit architecture decision.
- Prefer hermetic tests that do not require real Claude/Codex/Cursor/Gemini, network, browser credentials, cloud services, or paid external services.

## Verification

Full local quality gate:

```bash
uv run python scripts/quality_gate.py
```

Backend checks:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend checks:

```bash
cd web
npm run test -- --run
npm run build
```

Documentation-only changes must at minimum verify that active docs references resolve and that active docs do not point to archived docs as current authority.
