# ACC Architecture Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Current audit status (2026-06-22)

Status: **partially complete / explicitly superseded**. The `docs/architecture/*` files and archive README shell exist, and the original `2026-06-20` audit/roadmap paths now resolve to supersession stubs pointing at refreshed `2026-06-21` artifacts. Archive migration is still incomplete with listed candidates active under `docs/`, and many checklist items below remain unchecked. Do not mark this plan literally complete unless the archive migration is finished and the remaining checklist items are either completed or intentionally amended as superseded.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

**Goal:** Replace ACC's conflicting architecture documentation with a new authoritative architecture spec tree, code-grounded debt audit, implementation roadmap, and dated historical archive.

**Architecture:** This is a documentation-only reset. New `docs/architecture/*` files become the source of truth, active entry points point to them, audits and roadmaps are subordinate, and old planning/goal documents move into a dated historical archive after their responsibilities are absorbed into active docs.

**Tech Stack:** Markdown documentation, Git file moves, PowerShell verification commands, existing Python/TypeScript codebase references only for evidence.

## Global Constraints

- Do not change runtime/backend/frontend code in this plan; modify Markdown docs and move historical docs only.
- Do not delete historical documentation; move old docs under `docs/historical/archived-2026-06-20/`.
- New spec is the highest authority; archived docs never override `docs/architecture/*`.
- Keep Core v2 vocabulary: `AgentClassTemplate`, `ToolClassTemplate`, `WorkflowFunctionTemplate`, `NodeInvocationSpec`, `FunctionInvocation`, `ScopeFrame`, `SessionInstance`, `ArtifactBundle`, `RunPlan`, `PlanStep`, `DispatchEnvelope`, and `DecisionRecord`.
- Do not claim fixed workflow, supervisor, and handoff already share one complete runtime kernel.
- Do not claim all agents are already workflow-unaware in every code path.
- Treat target abstractions such as `RuntimeKernel`, `ControlModeStrategy`, and `NodeExecutionEnvelope` as target concepts, not current implemented types.
- Treat callable YAML assets and workflow YAML compatibility separately.
- Every technical debt finding must cite current code or active docs with file paths and line numbers.
- Use PowerShell commands in this Windows repository.
- Do not commit unless the user explicitly asks for a commit.

---

## File Structure

### Create

- `docs/architecture/00-constitution.md` — highest architecture authority.
- `docs/architecture/01-core-object-model.md` — definition/runtime/control/evidence object model.
- `docs/architecture/02-runtime-kernel.md` — current runtime flow and target runtime substrate.
- `docs/architecture/03-control-modes.md` — fixed, supervisor, handoff, human gate, nested workflow mode semantics.
- `docs/architecture/04-data-plane-and-evidence.md` — explicit data movement and durable evidence truth.
- `docs/architecture/05-api-ui-boundaries.md` — server and Workbench responsibilities.
- `docs/architecture/06-graphops-governance.md` — governed durable mutation rules.
- `docs/architecture/07-compatibility-and-migration.md` — canonical, compatibility, migration-only, historical, and decision-pending surfaces.
- `docs/architecture/08-architecture-proof-obligations.md` — architecture invariants mapped to tests/proofs.
- `docs/audits/2026-06-20-architecture-debt-audit.md` — evidence-led technical debt report.
- `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` — staged implementation/refactor roadmap.
- `docs/historical/archived-2026-06-20/README.md` — archive rationale, authority warning, and replacement map.

### Modify

- `AGENTS.md` — concise active project contract and authority ladder.
- `README.md` — user-facing entry point updated to the new docs authority.
- `docs/README.md` — documentation map rewritten for the new active/archive split.
- `docs/CURRENT_ARCHITECTURE.md` — concise active architecture summary pointing to `docs/architecture/*`.

### Move

Move only after active replacements exist:

- `docs/Design/` -> `docs/historical/archived-2026-06-20/design-packages/Design/`
- `docs/refactoring-plan/` -> `docs/historical/archived-2026-06-20/roadmaps-and-plans/refactoring-plan/`
- `docs/codex_goal_assistant_cli_like_ux/` -> `docs/historical/archived-2026-06-20/goal-packages/codex_goal_assistant_cli_like_ux/`
- `docs/codex_goal_storage_runner_productization/` -> `docs/historical/archived-2026-06-20/goal-packages/codex_goal_storage_runner_productization/`
- `docs/schema_driven_ports/` -> `docs/historical/archived-2026-06-20/design-packages/schema_driven_ports/`
- `docs/workflow-viewer-refactor/` -> `docs/historical/archived-2026-06-20/roadmaps-and-plans/workflow-viewer-refactor/`
- `docs/codex_goal_callable_semantics/` -> `docs/historical/archived-2026-06-20/goal-packages/codex_goal_callable_semantics/`
- `docs/codex_goal_visual_workbench_ux_refactor/` -> `docs/historical/archived-2026-06-20/goal-packages/codex_goal_visual_workbench_ux_refactor/`
- `docs/codex_goals_next_stage/` -> `docs/historical/archived-2026-06-20/goal-packages/codex_goals_next_stage/`
- `docs/workbench_authoring_agent/` -> `docs/historical/archived-2026-06-20/product-experiments/workbench_authoring_agent/`
- `docs/requirements/` -> `docs/historical/archived-2026-06-20/roadmaps-and-plans/requirements/`
- `docs/sdd/` -> `docs/historical/archived-2026-06-20/old-sdd/sdd/`
- `docs/ACC_CODEX_APP_SERVER_RUNTIME.md` -> `docs/historical/archived-2026-06-20/legacy-root-docs/ACC_CODEX_APP_SERVER_RUNTIME.md`
- `docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md` -> `docs/historical/archived-2026-06-20/legacy-root-docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md`
- `docs/goal.md` -> `docs/historical/archived-2026-06-20/legacy-root-docs/goal.md`
- `docs/ACC_Architecture_Audit_2026.md` -> `docs/historical/archived-2026-06-20/old-audits/ACC_Architecture_Audit_2026.md`

If any listed source path does not exist, record it in the archive README under "listed candidate not present in this checkout" and continue.

---

### Task 1: Create the new documentation directories and archive shell

**Files:**
- Create: `docs/architecture/`
- Create: `docs/audits/`
- Create: `docs/implementation/`
- Create: `docs/historical/archived-2026-06-20/README.md`

**Interfaces:**
- Consumes: Approved spec `docs/superpowers/specs/2026-06-20-acc-architecture-reset-design.md`.
- Produces: Directory structure used by every later task.

- [ ] **Step 1: Create directories**

Run:

```powershell
$dirs = @(
  "docs/architecture",
  "docs/audits",
  "docs/implementation",
  "docs/historical/archived-2026-06-20",
  "docs/historical/archived-2026-06-20/goal-packages",
  "docs/historical/archived-2026-06-20/design-packages",
  "docs/historical/archived-2026-06-20/roadmaps-and-plans",
  "docs/historical/archived-2026-06-20/product-experiments",
  "docs/historical/archived-2026-06-20/legacy-root-docs",
  "docs/historical/archived-2026-06-20/old-audits",
  "docs/historical/archived-2026-06-20/old-sdd"
)
foreach ($dir in $dirs) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
}
```

Expected: command exits 0 and creates the listed directories.

- [ ] **Step 2: Write archive README shell**

Write `docs/historical/archived-2026-06-20/README.md` with this content:

```markdown
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
```

Expected: archive README exists and contains the authority warning.

- [ ] **Step 3: Verify directories and archive README**

Run:

```powershell
$required = @(
  "docs/architecture",
  "docs/audits",
  "docs/implementation",
  "docs/historical/archived-2026-06-20/README.md"
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Missing required path: $path" }
}
Select-String -Path "docs/historical/archived-2026-06-20/README.md" -Pattern "Archived documents are historical context only" -SimpleMatch
```

Expected: command exits 0 and prints the matching archive warning line.

---

### Task 2: Rewrite active entry points for the new authority ladder

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: `docs/CURRENT_ARCHITECTURE.md`

**Interfaces:**
- Consumes: Directory structure from Task 1.
- Produces: Active entry points that point to new docs and no longer treat archived packages as current authority.

- [ ] **Step 1: Rewrite `AGENTS.md`**

Replace the contents of `AGENTS.md` with a concise project contract containing these exact sections and commitments:

```markdown
# AGENTS.md

## Current Project Contract

Agent Callable Conductor (`acc`) is a local-first orchestration runtime and Workbench for wrapping mature external agents or local tools as reusable callable assets.

ACC owns orchestration boundaries: callable definitions, runtime invocations, control decisions, explicit data movement, evidence, artifacts, projections, and governed workflow/callable mutation. External agents and tools own their internal reasoning and execution behavior. ACC does not implement a custom LLM loop and does not teach agents how to do their work.

## Documentation Authority

The active architecture authority is:

1. `docs/architecture/00-constitution.md` — highest architecture authority.
2. `docs/architecture/01-core-object-model.md` through `docs/architecture/08-architecture-proof-obligations.md` — detailed topic authority.
3. `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/CURRENT_ARCHITECTURE.md` — entry points and summaries.
4. `docs/implementation/*` — subordinate implementation roadmaps.
5. `docs/audits/*` — evidence-led audit artifacts.
6. `docs/historical/*` — historical context only.

If active documents conflict, `docs/architecture/*` wins. Archived documents never override active architecture specs.

## Core Architecture Vocabulary

- `AgentClassTemplate` / `ToolClassTemplate`: reusable, stateless callable behavior definitions.
- `WorkflowFunctionTemplate`: reusable, stateless workflow function body.
- `NodeInvocationSpec`: one call site inside a workflow function.
- `ExecutionPlan`: compiled static execution shape for a workflow function.
- `FunctionInvocation`: one runtime call of a workflow function.
- `ScopeFrame`: the runtime scope for one invocation; owns cwd, inbox, outbox, artifacts, and behavior snapshot evidence.
- `SessionInstance`: one concrete agent/tool execution inside a scope frame.
- `ArtifactBundle`: stable files produced by a session, node, or workflow invocation.
- `RunPlan`, `PlanStep`, `DispatchEnvelope`, `DecisionRecord`: control-ledger objects for why work is authorized and dispatched.
- GraphOps Control Plane: proposal, validation, dry-run, human approval, then apply.

## Stable Invariants

1. ACC orchestrates; external agents and tools reason and act internally.
2. Templates are reusable and stateless. Runtime identity, run dirs, workspace bindings, session ids, provider memory, and conversation history belong to run-scoped evidence.
3. Control authorization is separate from data movement. Data moves through declared inputs, ports, bindings, inbox/outbox materialization, result refs, and artifacts.
4. Workflow, supervisor, handoff, human gate, and nested workflow are target control strategies over one execution substrate. Current gaps are documented in `docs/architecture/03-control-modes.md`.
5. Runtime evidence is durable truth. Server projections, UI stores, indexes, polling state, and SSE streams are derived views or transports.
6. Persistent callable/workflow mutation is governed through GraphOps unless a new active architecture spec defines another governed path.
7. Local-first filesystem evidence remains the default truth model. A database or cloud backend requires a new explicit architecture decision.
8. Legacy compatibility must be explicit. `.graph.json` is import-only/reject-plus-migrate; workflow YAML compatibility is decision-pending; callable YAML assets are treated separately.
9. Architecture claims require proof obligations. New control modes, evidence schemas, or compatibility exceptions must add or update tests.

## Layer Boundaries

- `acc.models`, `acc.engine`, and `acc.state_machine`: pure domain, planning, validation, and transition logic.
- `acc.runtime` and `acc.app.runtime`: data materialization, scheduling, dispatch, execution, and evidence writing.
- `acc.app`: use-case coordination.
- `acc.graphops`: governed durable asset mutation.
- `acc.server`: API validation, delegation, and projection.
- `web/`: authoring, interaction, and projection cache only.

## Workflow Format

Canonical active workflow templates are `.accflow.json` files containing Core v2 callable references. Legacy `.graph.json` files are import-only or explicit-rejection inputs. YAML workflow discovery is a compatibility edge documented in `docs/architecture/07-compatibility-and-migration.md`.

## Before Changing Files

1. Read `docs/architecture/00-constitution.md` before changing architecture-sensitive code.
2. Check `git status --short` and avoid overwriting unrelated work.
3. Identify the smallest architecture-consistent change.
4. If code and docs disagree, verify current code, then update active docs or record a debt item.
5. Do not use archived documents as current requirements.

## Verification

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

Documentation-only changes must at minimum verify that active docs do not point to archived docs as current authority.
```

- [ ] **Step 2: Rewrite `docs/README.md`**

Replace `docs/README.md` with a documentation map containing:

```markdown
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

- `docs/audits/2026-06-20-architecture-debt-audit.md`: current code-grounded architecture debt audit.

Audits identify debt and evidence. They do not override the architecture specs.

## Implementation Roadmaps

- `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md`: staged migration plan derived from the architecture reset.

Roadmaps are subordinate to the architecture specs.

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
```

- [ ] **Step 3: Rewrite `README.md`**

Replace `README.md` with a concise project introduction that includes:

```markdown
# Agent Callable Conductor

Agent Callable Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature external agents and local tools as reusable callable assets.

ACC does not implement a new LLM reasoning loop. Codex CLI, Claude Code, Cursor, Gemini, other external agents, and local tools own their internal behavior. ACC owns orchestration boundaries: callable definitions, invocations, control decisions, explicit data movement, evidence, artifacts, projections, and governed workflow edits.

## Architecture Authority

Start here before architecture-sensitive work:

```text
AGENTS.md
docs/architecture/00-constitution.md
docs/architecture/01-core-object-model.md
docs/architecture/02-runtime-kernel.md
docs/architecture/03-control-modes.md
docs/architecture/04-data-plane-and-evidence.md
docs/architecture/05-api-ui-boundaries.md
docs/architecture/06-graphops-governance.md
docs/architecture/07-compatibility-and-migration.md
docs/architecture/08-architecture-proof-obligations.md
```

Archived documents under `docs/historical/` are historical context only.

## Current Architecture Summary

Core v2 is callable-first:

```text
AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> events, results, inboxes, outboxes, artifacts
```

Templates are reusable and stateless. Runtime identity and evidence are run-scoped. Data movement is explicit through ports, bindings, inbox/outbox materialization, result refs, and artifacts.

## Install

This repository uses `uv`.

```bash
uv sync
uv run acc callable list
```

The Workbench UI lives in `web/`:

```bash
cd web
npm install
```

## Core CLI Commands

```bash
uv run acc callable list
uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json --run-dir runs/acceptance_callable_main --emit-json
```

When `--emit-json` is used, stdout must contain exactly one JSON object. Runtime logs go to stderr or files.

## Local Workbench Server

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

Workbench frontend:

```bash
cd web
npm run dev
```

Open `http://127.0.0.1:5173`.

## Tests

Backend:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```
```

- [ ] **Step 4: Rewrite `docs/CURRENT_ARCHITECTURE.md`**

Replace `docs/CURRENT_ARCHITECTURE.md` with a summary containing these headings:

```markdown
# ACC Current Architecture

## Authority

This document is a summary. The detailed architecture authority is `docs/architecture/00-constitution.md` through `docs/architecture/08-architecture-proof-obligations.md`.

## One-Sentence Model

ACC turns reusable agent/tool/workflow definitions into isolated runtime invocations, moves data through explicit ports/results/artifacts, writes local evidence, and exposes CLI/server/Workbench projections without owning a custom LLM reasoning loop.

## Core Object Flow

```text
WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> ResultStore values, events, artifacts, and projections
```

## Runtime Truth and Projections

Durable runtime truth lives in run-scoped evidence: run records, event logs, node input/output files, ResultStore values, artifacts, and session evidence. Server projections, run summaries, indexes, Workbench stores, polling state, and SSE state are derived views or transports.

## Control Modes

Fixed workflow is the most mature current execution path. Supervisor, handoff, human gate/resume, and nested workflow share domain vocabulary and some dispatch/evidence infrastructure, but they are not yet fully converged into one complete runtime kernel. Current gaps are tracked in `docs/architecture/03-control-modes.md` and `docs/audits/2026-06-20-architecture-debt-audit.md`.

## Compatibility Boundary

Canonical workflow templates are `.accflow.json`. `.graph.json` is import-only or explicit-rejection input. Callable YAML assets and workflow YAML compatibility are separate concerns documented in `docs/architecture/07-compatibility-and-migration.md`.

## Workbench Boundary

The Workbench is an authoring and projection surface. It may cache task state and selected run pointers for usability, but run evidence remains backend filesystem truth.

## GraphOps Boundary

GraphOps governs durable callable/workflow mutation through proposal, validation, dry-run, human approval, and apply. GraphOps is separate from runtime execution.

## Verification Contract

Use the commands in `AGENTS.md` for backend, frontend, and documentation verification.
```

- [ ] **Step 5: Verify active entry points**

Run:

```powershell
$checks = @(
  @{ Path = "AGENTS.md"; Pattern = "docs/architecture/00-constitution.md" },
  @{ Path = "docs/README.md"; Pattern = "Active Architecture Authority" },
  @{ Path = "README.md"; Pattern = "Architecture Authority" },
  @{ Path = "docs/CURRENT_ARCHITECTURE.md"; Pattern = "This document is a summary" }
)
foreach ($check in $checks) {
  Select-String -Path $check.Path -Pattern $check.Pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing pattern '$($check.Pattern)' in $($check.Path)" }
}
```

Expected: command exits 0.

---

### Task 3: Write core architecture documents 00 through 02

**Files:**
- Create: `docs/architecture/00-constitution.md`
- Create: `docs/architecture/01-core-object-model.md`
- Create: `docs/architecture/02-runtime-kernel.md`

**Interfaces:**
- Consumes: Authority ladder from Task 2.
- Produces: Highest architecture authority and core object/runtime model for later docs.

- [ ] **Step 1: Write `00-constitution.md`**

Create `docs/architecture/00-constitution.md` with these sections and required points:

```markdown
# ACC Architecture Constitution

## Status

This document is the highest active architecture authority for ACC. If it conflicts with `AGENTS.md`, `README.md`, `docs/README.md`, `docs/CURRENT_ARCHITECTURE.md`, implementation roadmaps, audits, or archived documents, this document wins.

## Mission

ACC is a local-first orchestration runtime for wrapping mature external agents, local tools, and workflow functions as reusable callable assets. ACC coordinates execution boundaries, control decisions, explicit data movement, evidence, artifacts, projections, and governed durable mutation.

## Non-Goals

- ACC does not implement a custom LLM reasoning loop.
- ACC does not teach agents how to perform their internal work.
- ACC does not make UI state, server DTOs, polling state, or SSE state durable runtime truth.
- ACC does not require a database, cloud backend, Kubernetes, or SaaS surface for core execution.
- ACC does not allow archived documents to define current architecture.

## Constitutional Invariants

### 1. ACC orchestrates; callable workers execute

External agents, tools, and child workflows own their internal behavior. ACC prepares inputs, dispatches work, records evidence, and moves outputs.

Current anchors: `AGENTS.md:78-85`, `docs/sdd/07-control-modes.md:11-22`.

### 2. Definitions are stateless; invocations are run-scoped

Reusable templates must not store run directories, workspace bindings, session ids, provider memory, or conversation history. Runtime identity belongs to `FunctionInvocation`, `ScopeFrame`, `SessionInstance`, run records, events, result values, and artifacts.

Current anchors: `acc/models.py:266-385`, `acc/models.py:397-491`.

Known deviation: executable metadata still permits runtime-like keys in `acc/models.py:58-89`, and `NodeInvocationSpec.metadata` exists in `acc/models.py:353-370`.

### 3. Control authorization is separate from data movement

Control edges and control decisions authorize or order execution. Data rights move only through explicit inputs, ports, data edges, bindings, inbox/outbox materialization, result refs, and artifacts.

Known deviation: `control_main_default` and `control_main_aggregate` in `acc/runtime/node_payload.py:138-185` create implicit dataflow from control predecessors.

### 4. Control modes are strategies over one target substrate

Fixed workflow, supervisor, handoff, human gate/resume, and nested workflow are target control strategies over one execution substrate. They may differ in who authorizes the next step, but the post-decision dispatch and evidence obligations should converge.

Current anchors: `acc/models.py:496-825`, `acc/app/runtime/dispatch_gate.py:59-235`.

Known deviation: supervisor and handoff are not fully converged with the fixed runtime path (`acc/app/supervisor.py:390-490`, `acc/engine/handoff.py:40-43`).

### 5. Runtime evidence is durable truth

Run-scoped evidence, ResultStore values, artifacts, and event logs are durable truth. Summaries, indexes, server projections, frontend stores, polling state, and SSE streams are derived.

### 6. GraphOps governs durable asset mutation

Durable callable/workflow mutation follows proposal, validation, dry-run, human approval, and apply unless a later active architecture spec defines another governed path.

Current anchors: `acc/graphops.py:276-510`.

### 7. Compatibility is explicit and bounded

`.accflow.json` is canonical for workflow templates. `.graph.json` is import-only or explicit-rejection input. Callable YAML assets and workflow YAML compatibility require separate treatment.

### 8. Architecture claims require proof obligations

Every invariant in this constitution needs tests or documented proof obligations. New control modes, evidence schemas, or compatibility exceptions must add or update proofs.

## Current Fact, Target Invariant, Known Deviation

Architecture docs must label facts as one of:

- Current fact: verified behavior in current code.
- Target invariant: desired architecture rule.
- Known deviation: current behavior that does not match the target and must be tracked.
```

- [ ] **Step 2: Write `01-core-object-model.md`**

Create `docs/architecture/01-core-object-model.md` with these sections:

```markdown
# ACC Core Object Model

## Status

This document expands the object model required by `docs/architecture/00-constitution.md`.

## Object Layers

ACC separates objects into definition-time objects, invocation/runtime objects, control-ledger objects, and evidence/projection objects.

## Definition-Time Objects

| Object | Role | Current anchor | Forbidden knowledge |
| --- | --- | --- | --- |
| `AgentClassTemplate` | Reusable agent behavior class | `acc/models.py:266-385` | Run ids, run dirs, provider session memory |
| `ToolClassTemplate` | Reusable local/tool behavior class | `acc/models.py:266-385` | Run ids, runtime workspace bindings |
| `WorkflowFunctionTemplate` | Reusable workflow function body | `acc/models.py:374-385` | Invocation identity, output values, run status |
| `NodeInvocationSpec` | One call site inside a workflow function | `acc/models.py:353-370` | Session ids, previous outputs as hidden state |
| `CallableRef` | Reference to a callable target | `acc/models.py` | Runtime execution results |

## Runtime and Invocation Objects

| Object | Role | Current anchor |
| --- | --- | --- |
| `ExecutionPlan` | Compiled static execution shape | `acc/models.py:390-401`, `acc/engine/__init__.py:149-171` |
| `FunctionInvocation` | One runtime workflow call | `acc/models.py:405-421` |
| `ScopeFrame` | Runtime scope containing cwd, inbox, outbox, artifacts, and behavior snapshot evidence | `acc/models.py:424-438` |
| `SessionInstance` | One concrete agent/tool execution | `acc/models.py:441-452` |
| `RunRecord` | Run-level durable status record | `acc/models.py` |
| `EventRecord` | Append-only runtime event record | `acc/models.py` |

## Control-Ledger Objects

| Object | Role | Current anchor |
| --- | --- | --- |
| `RunPlan` | Run-level control plan | `acc/models.py:496-825` |
| `PlanStep` | Authorizable dispatch unit | `acc/models.py:496-825` |
| `DispatchEnvelope` | Dispatch authorization/evidence envelope | `acc/models.py:496-825` |
| `DecisionRecord` | Human or system decision record | `acc/models.py:496-825` |
| `SupervisorPlan` | Supervisor-mode plan representation | `acc/models.py:496-825` |
| `HandoffRequest` | Handoff-mode request representation | `acc/models.py:496-825` |

## Evidence and Projection Objects

Evidence includes node inputs, node outputs, runtime payloads, binding manifests, ResultStore values, artifacts, events, run records, and run summaries. Projections include server DTOs, run indexes, Workbench stores, and UI overlays.

## Allowed References

- Templates may reference callable ids, declared ports, declared inputs, declared outputs, metadata that is definition-time only, and workflow graph structure.
- Runtime objects may reference template ids and snapshots, run ids, scope paths, session ids, result refs, and artifact refs.
- Projections may reference evidence ids and sanitized summaries.

## Forbidden References

- Templates must not contain run directories, live workspace bindings, provider session ids, prior outputs as hidden state, conversation history, or UI-only run status.
- External callable adapters must not require knowledge of whether they are inside fixed workflow, supervisor, handoff, or nested workflow.
- Frontend stores must not become evidence truth.
```

- [ ] **Step 3: Write `02-runtime-kernel.md`**

Create `docs/architecture/02-runtime-kernel.md` with these sections:

```markdown
# ACC Runtime Kernel

## Status

This document describes the current runtime substrate and the target convergence model. It does not claim that every control mode already uses one complete kernel.

## Current Fixed Workflow Path

Current fact:

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> scheduler
  -> executor
  -> SessionInstance or child FunctionInvocation
  -> ResultStore values, events, artifacts, projections
```

Code anchors:

- `acc/engine/__init__.py:149-171` compiles workflow templates into `ExecutionPlan`.
- `acc/app/runtime/orchestrator.py:44-219` creates invocation/scope/run evidence and enters runtime execution.
- `acc/app/runtime/scheduler.py:29-96` performs bounded ready-queue execution.
- `acc/app/runtime/executor.py:96-175` resolves payloads, executes callables, and writes evidence.

## Target Runtime Responsibilities

A unified runtime substrate should own:

- Run admission.
- Plan-step registration.
- Ready-set selection.
- Bounded concurrency.
- Dispatch authorization.
- Node execution envelope construction.
- Evidence writes.
- Failure, waiting, cancellation, and finalization.
- Projection invalidation or rebuild triggers.

## Target Node Execution Envelope

`NodeExecutionEnvelope` is a target concept, not a current implemented type. It should provide a narrow adapter-facing execution contract:

- callable reference
- resolved input refs and payload path
- execution policy
- workspace capability
- result sinks
- evidence writer handle
- cancellation context

It must not expose full workflow internals, control-mode internals, or UI authoring state to external agents/tools.

## Known Deviations

- Dynamic dispatch still reconstructs or overlays template/node structures in `acc/app/runtime/dispatch_gate.py:98-111`.
- Supervisor retains procedural execution seams in `acc/app/supervisor.py:390-490`.
- Handoff has P0 capability gaps in `acc/engine/handoff.py:40-43`.

## Roadmap Link

Implementation sequencing is in `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md`.
```

- [ ] **Step 4: Verify core docs**

Run:

```powershell
$checks = @(
  @{ Path = "docs/architecture/00-constitution.md"; Pattern = "highest active architecture authority" },
  @{ Path = "docs/architecture/01-core-object-model.md"; Pattern = "Definition-Time Objects" },
  @{ Path = "docs/architecture/02-runtime-kernel.md"; Pattern = "NodeExecutionEnvelope is a target concept" }
)
foreach ($check in $checks) {
  Select-String -Path $check.Path -Pattern $check.Pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing pattern '$($check.Pattern)' in $($check.Path)" }
}
```

Expected: command exits 0.

---

### Task 4: Write control, data/evidence, and API/UI architecture docs

**Files:**
- Create: `docs/architecture/03-control-modes.md`
- Create: `docs/architecture/04-data-plane-and-evidence.md`
- Create: `docs/architecture/05-api-ui-boundaries.md`

**Interfaces:**
- Consumes: Runtime vocabulary from Task 3.
- Produces: Mode, data, evidence, API, and UI boundaries for audit and roadmap tasks.

- [ ] **Step 1: Write `03-control-modes.md`**

Create `docs/architecture/03-control-modes.md` with:

```markdown
# ACC Control Modes

## Status

This document defines the target relationship between fixed workflow, supervisor, handoff, human gate/resume, and nested workflow. It records current gaps instead of claiming complete convergence.

## Target Rule

A control mode decides why and when work may run. After that decision, dispatch and evidence obligations should converge on the same runtime substrate.

## Fixed Workflow

Current fact: fixed workflow is the most mature path. It compiles a `WorkflowFunctionTemplate` to an `ExecutionPlan`, schedules ready nodes with bounded concurrency, executes callables, and writes evidence.

Anchors: `acc/app/runtime/orchestrator.py`, `acc/app/runtime/scheduler.py`, `acc/app/runtime/executor.py`.

## Supervisor

Target invariant: supervisor should plan or authorize dynamic work, then feed post-decision work into the shared dispatch/evidence substrate.

Current fact: supervisor domain objects and app/engine paths exist.

Known deviation: `acc/app/supervisor.py:390-490` still contains direct/procedural execution seams.

## Handoff

Target invariant: handoff should transfer control through explicit handoff requests and evidence records, then resume through the same dispatch/evidence obligations.

Current fact: `acc/engine/handoff.py:29-79` compiles handoff requests.

Known deviation: `acc/engine/handoff.py:40-43` documents P0 limitations.

## Human Gate and Resume

Human gate is an authorization barrier. It should not create a separate runtime. Approval or rejection should be represented as decisions and plan-step transitions.

## Nested Workflow

Nested workflow should create a child `FunctionInvocation` and preserve the same evidence/data rules as top-level workflow execution.

## Proof Obligations

- Fixed/supervisor/handoff status transitions use shared control-ledger vocabulary or document the remaining exception.
- Human approval records are durable and auditable.
- Dynamic work never mutates reusable templates to smuggle runtime state.
```

- [ ] **Step 2: Write `04-data-plane-and-evidence.md`**

Create `docs/architecture/04-data-plane-and-evidence.md` with:

```markdown
# ACC Data Plane and Evidence

## Status

This document defines explicit data movement and durable evidence truth.

## Data Movement Rule

Control authorization is not data movement. Data moves through declared inputs, ports, data edges, workflow-call bindings, inbox/outbox materialization, result refs, and artifacts.

## Current Data Plane Anchors

- `acc/runtime/node_payload.py:49-185` resolves node payloads.
- `acc/runtime/node_payload.py:221-270` records binding materialization.
- `acc/app/runtime/executor.py:96-175` writes payloads, outputs, and evidence.
- `acc/result_store/filesystem.py:7-126` defines ResultStore layout.

## Durable Truth

Durable truth includes:

- run records
- event logs
- node input files
- node output files
- runtime payloads
- binding manifests
- ResultStore values
- artifact bundles
- session evidence

## Derived Views

Derived views include:

- run summaries
- run indexes
- server projections
- Workbench stores
- polling state
- SSE state

Derived views can be rebuilt or refreshed from durable truth. They must not become the source of execution decisions.

## Known Deviations

- `control_main_default` and `control_main_aggregate` in `acc/runtime/node_payload.py:138-185` allow control predecessors to provide implicit data.
- Workflow output writer/projection terminal ids diverge between `__workflow_outputs` and `__workflow__`.

## Forbidden Patterns

- Direct upstream-to-downstream workspace writes.
- Shared blackboard state between nodes.
- Hidden ambient workflow context as node input.
- UI-local status as runtime evidence.
```

- [ ] **Step 3: Write `05-api-ui-boundaries.md`**

Create `docs/architecture/05-api-ui-boundaries.md` with:

```markdown
# ACC API and UI Boundaries

## Status

This document defines server and Workbench responsibilities.

## Server Boundary

`acc.server` validates requests, delegates to app/runtime services, and returns projections or references. Server routes should not become the owner of runtime orchestration semantics.

Current risk anchors:

- Sync and async run routes coexist in `acc/server/routes/workflows.py:142-209`.
- Workbench-derived repair/enrichment participates in runnable graph preparation in `acc/server/routes/workflows.py:232-318` and `acc/app/workbench_adapter.py:165-229`.

## Workbench Boundary

The Workbench is an authoring and projection surface. It may store task canvases, selected resources, selected run ids, and local UI state for usability. It must not become durable runtime truth.

Current risk anchors:

- `web/src/components/workflow-viewer/WorkflowViewerController.tsx:112-961` is a large controller hotspot.
- `web/src/hooks/useRunStream.ts` and `web/src/hooks/useSubmittedRunPolling.ts` show that SSE and polling both participate in run observation.

## Streaming and Polling

SSE is a live UX transport. Polling/projection may be used for durable convergence and recovery while the current code requires it. Active docs must not imply a push-only architecture until code and tests prove it.

## API/UI Proof Obligations

- Production Workbench run submission uses one documented canonical contract.
- Compatibility run routes are explicitly classified and tested.
- Frontend stores remain projection/cache state.
- Runnable graph preparation has a named boundary for any Workbench-derived enrichment.
```

- [ ] **Step 4: Verify docs 03 through 05**

Run:

```powershell
$checks = @(
  @{ Path = "docs/architecture/03-control-modes.md"; Pattern = "does not create a separate runtime" },
  @{ Path = "docs/architecture/04-data-plane-and-evidence.md"; Pattern = "Control authorization is not data movement" },
  @{ Path = "docs/architecture/05-api-ui-boundaries.md"; Pattern = "SSE is a live UX transport" }
)
foreach ($check in $checks) {
  Select-String -Path $check.Path -Pattern $check.Pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing pattern '$($check.Pattern)' in $($check.Path)" }
}
```

Expected: command exits 0.

---

### Task 5: Write governance, compatibility, and proof-obligation docs

**Files:**
- Create: `docs/architecture/06-graphops-governance.md`
- Create: `docs/architecture/07-compatibility-and-migration.md`
- Create: `docs/architecture/08-architecture-proof-obligations.md`

**Interfaces:**
- Consumes: Core, runtime, control, and evidence docs from Tasks 3 and 4.
- Produces: Governance, migration, and test-proof rules for audit and roadmap tasks.

- [ ] **Step 1: Write `06-graphops-governance.md`**

Create `docs/architecture/06-graphops-governance.md` with:

```markdown
# ACC GraphOps Governance

## Status

This document defines governed durable callable/workflow mutation. It does not describe runtime execution.

## Governance Rule

LLM-generated or user-generated durable callable/workflow changes must pass through proposal, validation, dry-run, human approval, and apply unless a later active architecture spec defines another governed path.

## Current Anchors

- `acc/graphops.py:201-455` defines proposal, validation, dry-run, and apply behavior.
- `acc/graphops.py:495-510` records staleness and apply checks.
- `acc/server/routes/graphops.py:96-167` exposes proposal APIs.

## Status Concepts

Proposal lifecycle status and dry-run evidence status are different concepts. Documentation and UI must not mix them.

Durable proposal flow includes drafted, validated, validation failed, awaiting human approval, approved, applying, applied, stale base, apply failed, and rejected states when represented by current code.

## Approval Context

Caller-supplied approval context and ACC-recorded apply-time staleness context are distinct. Apply must re-check the base state instead of trusting a stale dry-run.

## Forbidden Patterns

- Runtime execution mutating reusable templates as a side effect.
- Applying destructive persistent changes without validation, dry-run evidence, and human approval.
- Treating example patch endpoints as the primary architecture path.
```

- [ ] **Step 2: Write `07-compatibility-and-migration.md`**

Create `docs/architecture/07-compatibility-and-migration.md` with:

```markdown
# ACC Compatibility and Migration

## Status

This document classifies compatibility surfaces. Compatibility exists only where named here or in a later active architecture spec.

## Compatibility Classes

| Class | Meaning |
| --- | --- |
| Active canonical | Current preferred source-of-truth format or API. |
| Active compatibility | Supported path retained for compatibility, with explicit boundaries. |
| Migration-only | Accepted only by import/migration tools or explicit rejection-with-hint paths. |
| Historical-only | Archived context, not active product behavior. |
| Decision-pending | Current code supports or exposes a path whose long-term status is not decided. |

## Workflow Formats

- `.accflow.json`: active canonical workflow template format.
- `.graph.json`: migration-only or explicit-rejection input.
- Workflow YAML discovery/resolution: decision-pending compatibility edge.

Current anchors:

- `AGENTS.md:61-66`
- `acc/app/core_v2_loader.py:12-33`
- `tests/unit/test_legacy_graph_rejected.py:12-28`
- `tests/integration/test_workflow_import_graph.py:88-121`
- `acc/control_plane.py:325-375`

## Callable YAML

Callable YAML assets under callable resource directories are not automatically the same category as workflow YAML compatibility. Their status must be documented separately before removal or promotion.

## Archive Rule

Archived docs are historical-only. They may explain why a design existed, but they do not define current architecture.
```

- [ ] **Step 3: Write `08-architecture-proof-obligations.md`**

Create `docs/architecture/08-architecture-proof-obligations.md` with:

```markdown
# ACC Architecture Proof Obligations

## Status

This document maps architectural claims to tests or verification obligations.

## Existing Test Seeds

- `tests/architecture/test_import_boundaries.py:61-167`
- `tests/integration/test_core_v2_control_ledger_runtime.py:374-457`
- `tests/server/test_graphops_api.py:107-166`
- `tests/unit/test_legacy_graph_rejected.py:12-28`

## Required Proofs

| Invariant | Required proof |
| --- | --- |
| Templates are stateless | Saved templates reject run dirs, session ids, workspace bindings, provider memory, and prior output state. |
| `.graph.json` is not active runtime input | Direct runtime loading rejects `.graph.json` with a migration/import hint. |
| Control authorization differs from data movement | Control-only edges do not silently grant data payload access. |
| GraphOps governs durable mutation | Apply requires validation, dry-run evidence, human approval, and base-state staleness checks. |
| Runtime evidence is truth | Server/frontend projections can be rebuilt from run evidence and do not drive execution. |
| Control modes share vocabulary | Fixed/supervisor/handoff use shared control-ledger records or document tested exceptions. |
| Frontend stores are projections | Workbench state cannot become persisted runtime truth. |
| Multiple runs are isolated | Concurrent runs do not use a global `isRunning` singleton or shared node output state. |
| Path/evidence access is contained | Artifact and evidence reads enforce path safety. |

## Proof Strength

- Strong proof: behavioral test that exercises the runtime or API.
- Medium proof: integration test over app/server boundaries.
- Weak proof: import-boundary or string-guard test.

Weak proofs are useful but cannot be the only protection for high-risk runtime invariants.
```

- [ ] **Step 4: Verify docs 06 through 08**

Run:

```powershell
$checks = @(
  @{ Path = "docs/architecture/06-graphops-governance.md"; Pattern = "proposal, validation, dry-run, human approval, and apply" },
  @{ Path = "docs/architecture/07-compatibility-and-migration.md"; Pattern = "Decision-pending" },
  @{ Path = "docs/architecture/08-architecture-proof-obligations.md"; Pattern = "Templates are stateless" }
)
foreach ($check in $checks) {
  Select-String -Path $check.Path -Pattern $check.Pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing pattern '$($check.Pattern)' in $($check.Path)" }
}
```

Expected: command exits 0.

---

### Task 6: Write the code-grounded technical debt audit

**Files:**
- Create: `docs/audits/2026-06-20-architecture-debt-audit.md`

**Interfaces:**
- Consumes: Architecture docs from Tasks 3 through 5.
- Produces: Evidence-led debt list consumed by roadmap Task 7.

- [ ] **Step 1: Write the audit**

Create `docs/audits/2026-06-20-architecture-debt-audit.md` with this structure and finding set:

```markdown
# ACC Architecture Debt Audit — 2026-06-20

## Status

This audit is evidence-led. It identifies current architecture debt and remediation themes, but it does not override `docs/architecture/*`.

## Target Architecture Rubric

Debt is measured against these targets:

- ACC orchestrates; callable workers execute.
- Templates are stateless; runtime evidence is run-scoped.
- Control authorization is separate from data movement.
- Control modes converge after authorization onto a shared dispatch/evidence substrate.
- Durable evidence outranks projections.
- Server and frontend remain boundary/projection layers.
- Compatibility surfaces are explicit and bounded.

## Priority 1 Findings

### 1. Workbench viewer/controller orchestration hotspot

Rule violated: frontend should be an authoring/projection boundary, not a broad orchestration owner.

Evidence: `web/src/components/workflow-viewer/WorkflowViewerController.tsx:112-961`, with concentrated local state and wiring around `:164-188`, `:196-232`, `:340-350`, and broad prop passing around `:769-961`.

Impact: task lifecycle, run lifecycle, assistant, GraphOps, binding editing, evidence inspection, and view composition are hard to reason about independently.

Remediation: split by task lifecycle, run lifecycle, assistant/GraphOps authoring, binding editor, evidence inspector, graph canvas, and view composition.

Proof obligation: Workbench stores remain projection/cache state after decomposition.

### 2. Duplicate graph-run submission surfaces

Rule violated: runtime submission contract should be explicit.

Evidence: sync `/api/workflows/run-graph` in `acc/server/routes/workflows.py:142-169`, async `/api/workflows/run-graph/submit` in `acc/server/routes/workflows.py:172-209`, and frontend APIs in `web/src/api.ts:277-306`.

Impact: callers and docs can disagree about the canonical run path.

Remediation: classify sync route as active compatibility, internal/debug, soft-deprecated, or removal candidate.

Proof obligation: production Workbench path uses the documented canonical contract; compatibility path has tests or is removed.

### 3. Runnable graph preparation leaks Workbench-derived repair/enrichment

Rule violated: runtime graph truth should not depend on unnamed UI repair semantics.

Evidence: `acc/server/routes/workflows.py:232-233`, `acc/server/routes/workflows.py:295-318`, and `acc/app/workbench_adapter.py:165-229`.

Impact: authoring projection compatibility can influence runtime graph preparation.

Remediation: make canonical runnable payloads self-sufficient or introduce a named pre-run authoring-enrichment adapter.

Proof obligation: runtime validation either needs no repair or calls the named adapter explicitly.

### 4. Supervisor/control-mode convergence gap

Rule violated: control modes should converge after authorization onto shared dispatch/evidence obligations.

Evidence: shared dispatch skeleton in `acc/app/runtime/dispatch_gate.py:59-183`; supervisor procedural execution in `acc/app/supervisor.py:390-420` and `acc/app/supervisor.py:451-490`; handoff P0 gap in `acc/engine/handoff.py:40-43`.

Impact: fixed/supervisor/handoff can evolve as separate runtimes.

Remediation: define common post-decision dispatch/evidence requirements and migrate direct paths into them.

Proof obligation: fixed/supervisor/handoff share tested control-ledger vocabulary or document exceptions.

### 5. Template/runtime contamination through metadata

Rule violated: templates are stateless; runtime identity is run-scoped.

Evidence: runtime-like `EXECUTABLE_METADATA_KEYS` in `acc/models.py:58-89`, `NodeInvocationSpec.metadata` in `acc/models.py:353-370`, and invariant language in archived/current SDD source `docs/sdd/00-constitution.md:161-178` before archive.

Impact: reusable call sites can carry run/session/workspace/conversation concepts.

Remediation: reject runtime-like keys in persisted templates or move them into runtime-only records.

Proof obligation: saved templates reject run/session/workspace/conversation fields.

### 6. Implicit dataflow through control edges

Rule violated: control authorization is separate from data movement.

Evidence: `control_main_default` and `control_main_aggregate` in `acc/runtime/node_payload.py:138-185`; validation treatment in `acc/engine/workflow_validation.py:219-241`; explicit data-rights invariant in pre-archive `docs/sdd/00-constitution.md:197-215`.

Impact: control predecessors can implicitly supply payload data.

Remediation: remove implicit forwarding, or represent it as explicit declared data edges, or fence it as transitional compatibility.

Proof obligation: control-only edges do not grant data access unless an explicit compatibility exception is tested.

## Priority 2 Findings

### 7. Evidence/result duplication and legacy probing

Evidence: canonical evidence list in `docs/CURRENT_ARCHITECTURE.md:205-232`, multi-generation probing in `acc/run_index.py:149-195`, and old manifest names in `acc/artifact_store.py:20-47`.

Remediation: normalize result/evidence vocabulary and classify legacy readers.

### 8. Frontend projection churn and compatibility mirrors

Evidence: `web/src/stores/workbenchStore.ts:36-47`, `web/src/stores/runStore.ts:14-21`, `web/src/hooks/useRunProjectionActions.ts:67-228`, `web/src/hooks/useOpenedWorkflowCanvas.ts:44-46`.

Remediation: classify transformations as view adapters, compatibility adapters, or runtime semantic leaks.

### 9. Assistant/authoring APIs carry large editor context

Evidence: `acc/app/agent_sessions.py:620-657`, `acc/app/agent_sessions.py:723-751`, `acc/app/agent_sessions.py:830-850`, `acc/app/authoring.py:719-731`, `web/src/api.ts:402-455`.

Remediation: consider typed deltas, selection refs, catalog refs, and proposal inputs after Workbench boundaries are clearer.

### 10. Intentional compatibility/layering debt

Evidence: `acc/app/core_v2_runtime.py:1-10`, `tests/test_runtime_imports.py:139-184`, `acc/server/run_projection.py:14-20`.

Remediation: document deliberate shims and retire them only after replacement surfaces are proven.

## Priority 3 Findings

### 11. Workflow format ambiguity around YAML

Evidence: `acc/server/routes/workflows.py:105-136`, `acc/server/routes/workflows.py:443-466`, `acc/control_plane.py:325-375`, and `.graph.json` rejection in `acc/app/core_v2_loader.py:9-33`.

Remediation: decide workflow YAML status separately from callable YAML assets.

### 12. Documentation authority contradiction

Evidence: pre-reset `AGENTS.md` and `docs/README.md` presented several older goal/planning packages as current context while other docs and current code had moved on.

Remediation: complete the architecture authority reset and archive old docs.

## Remediation Themes

- Establish architecture authority first.
- Normalize evidence/result vocabulary before deeper runtime changes.
- Make compatibility status explicit before removal.
- Split large frontend orchestration surfaces by responsibility.
- Converge control modes after authorization, not by hiding mode-specific decisions.

## Open Decisions

- Long-term status of sync run route.
- Long-term status of workflow YAML discovery.
- Whether implicit control-main forwarding is removed or expressed as explicit data edges.
- When to introduce named runtime kernel/envelope code types.
```

- [ ] **Step 2: Verify audit contents**

Run:

```powershell
$path = "docs/audits/2026-06-20-architecture-debt-audit.md"
$patterns = @(
  "Workbench viewer/controller orchestration hotspot",
  "Duplicate graph-run submission surfaces",
  "Template/runtime contamination through metadata",
  "Implicit dataflow through control edges",
  "Workflow format ambiguity around YAML"
)
foreach ($pattern in $patterns) {
  Select-String -Path $path -Pattern $pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing audit finding: $pattern" }
}
```

Expected: command exits 0.

---

### Task 7: Write the implementation roadmap

**Files:**
- Create: `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md`

**Interfaces:**
- Consumes: Architecture docs and audit from Tasks 3 through 6.
- Produces: Staged plan for future code/documentation implementation work.

- [ ] **Step 1: Write the roadmap**

Create `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md` with:

```markdown
# ACC Runtime Refactor Roadmap — 2026-06-20

## Status

This roadmap is subordinate to `docs/architecture/*`. It sequences future implementation work derived from the architecture reset and debt audit.

## Goal

Move ACC toward a low-coupling, high-concurrency, extensible orchestration runtime with stateless templates, explicit data movement, durable local evidence, and unified post-decision dispatch/evidence obligations for workflow, supervisor, handoff, human gate, and nested workflow.

## Non-Goals

- Do not rewrite runtime code merely to match new names.
- Do not remove compatibility surfaces before classifying and testing them.
- Do not introduce `RuntimeKernel`, `ControlModeStrategy`, or `NodeExecutionEnvelope` code types before evidence/result and compatibility noise are reduced.

## Stage 0 — Documentation Authority and Archive

Files: `AGENTS.md`, `README.md`, `docs/README.md`, `docs/CURRENT_ARCHITECTURE.md`, `docs/architecture/*`, `docs/audits/*`, `docs/historical/archived-2026-06-20/README.md`.

Acceptance:

- Active docs point to `docs/architecture/*` as authority.
- Archived docs are labeled historical only.
- No active doc treats archived packages as current truth.

## Stage 1 — Runnable Graph Truth Boundary Cleanup

Modules: `acc/server/routes/workflows.py`, `acc/app/workbench_adapter.py`, `web/src/hooks/useOpenedWorkflowCanvas.ts`.

Decision: canonical runnable graph payloads must be self-sufficient, or Workbench repair/enrichment must become a named pre-run authoring adapter.

Acceptance:

- Runtime validation no longer depends on unnamed snapshot repair.
- Any enrichment path is documented and tested as authoring boundary logic.

## Stage 2 — Run Submission Contract Rationalization

Modules: `acc/server/routes/workflows.py`, `acc/server/run_manager.py`, `web/src/api.ts`, `web/src/components/ControlPlanePanel.tsx`.

Decision: classify sync `/api/workflows/run-graph` as active compatibility, internal/debug, soft-deprecated, or removal candidate.

Acceptance:

- Production Workbench path uses the documented canonical submit/observe/cancel contract.
- Compatibility path is tested or removed.

## Stage 3 — Evidence and Result Normalization

Modules: `acc/app/runtime/executor.py`, `acc/app/runtime/workflow_io.py`, `acc/result_store/filesystem.py`, `acc/run_index.py`, `acc/server/run_projection.py`, `web/src/stores/runStore.ts`.

Acceptance:

- Runtime writer and projection reader agree on workflow terminal ids.
- Active runtime path does not need multi-generation summary probing except explicit archival/migration readers.
- Frontend consumes projections rather than guessing durable truth.

## Stage 4 — Explicit Dataflow and Metadata Cleanup

Modules: `acc/models.py`, `acc/runtime/node_payload.py`, `acc/engine/workflow_validation.py`.

Acceptance:

- Persisted templates reject runtime-like metadata fields.
- Implicit control-main forwarding is removed, represented as declared data edges, or fenced as a tested transitional exception.

## Stage 5 — Workbench Orchestration Decomposition

Modules: `web/src/components/workflow-viewer/WorkflowViewerController.tsx`, `web/src/stores/workbenchStore.ts`, `web/src/stores/runStore.ts`, `web/src/hooks/useRunProjectionActions.ts`.

Acceptance:

- Task lifecycle, run lifecycle, assistant/GraphOps authoring, binding editor, evidence inspector, graph canvas, and view composition have separate boundaries.
- Stores remain projection/cache state.

## Stage 6 — Assistant and Authoring Boundary Slimming

Modules: `acc/app/agent_sessions.py`, `acc/app/authoring.py`, `web/src/api.ts`.

Acceptance:

- Agent/authoring requests carry the necessary task context through typed deltas, selections, catalog refs, or proposal inputs where useful.
- ACC orchestration metadata remains ACC-owned.

## Stage 7 — Control-Mode Convergence Over Shared Substrate

Modules: `acc/app/runtime/dispatch_gate.py`, `acc/app/runtime/scheduler.py`, `acc/app/supervisor.py`, `acc/app/handoff.py`, `acc/engine/supervisor.py`, `acc/engine/handoff.py`, `acc/ledger_writer.py`.

Acceptance:

- Fixed/supervisor/handoff share post-decision dispatch/evidence obligations, or remaining differences are documented and tested.
- Supervisor direct/procedural execution seams are migrated or fenced.
- Handoff P0 gaps are tracked with tests and status vocabulary.

## Stage 8 — Evaluate Named Kernel and Envelope Abstractions

Candidate concepts: `RuntimeKernel`, `ControlModeStrategy`, `NodeExecutionEnvelope`, `EvidenceWriter`, `ProjectionService`.

Acceptance:

- Any new abstraction removes duplicated seams.
- Mode-specific authorization semantics remain explicit.
- The abstraction is introduced through an active architecture decision and tests.

## Stage 9 — Compatibility and Naming Cleanup

Modules: `acc/cli.py`, `acc/migration/graph_importer.py`, `acc/app/core_v2_runtime.py`, `acc/server/run_projection.py`, `web/src/workbench/model/workflowRuntimeProjection.ts`.

Acceptance:

- Legacy graph conversion is migration-only.
- Active UI legacy fallback is removed or documented as compatibility.
- `core_v2` shims and old projection paths are classified.

## Global Acceptance Checklist

- Architecture authority docs are active and linked.
- Technical debt audit findings are revalidated against current code.
- Runtime evidence vocabulary is consistent.
- Compatibility surfaces have explicit classes.
- Control-mode convergence gaps are tested or fenced.
- Frontend stores remain projection/cache state.
```

- [ ] **Step 2: Verify roadmap stages**

Run:

```powershell
$path = "docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md"
$patterns = @(
  "Stage 0 — Documentation Authority and Archive",
  "Stage 3 — Evidence and Result Normalization",
  "Stage 7 — Control-Mode Convergence Over Shared Substrate",
  "Stage 9 — Compatibility and Naming Cleanup"
)
foreach ($pattern in $patterns) {
  Select-String -Path $path -Pattern $pattern -SimpleMatch | Out-Null
  if (-not $?) { throw "Missing roadmap stage: $pattern" }
}
```

Expected: command exits 0.

---

### Task 8: Move historical documentation into the dated archive

**Files:**
- Move: archive candidates listed in File Structure.
- Modify: `docs/historical/archived-2026-06-20/README.md`

**Interfaces:**
- Consumes: Active replacement docs from Tasks 2 through 7.
- Produces: Historical archive with moved docs and active tree reduced to current authority/reference docs.

- [ ] **Step 1: Move existing archive candidates**

Run this PowerShell script from repository root:

```powershell
$moves = @(
  @{ Source = "docs/Design"; Dest = "docs/historical/archived-2026-06-20/design-packages/Design" },
  @{ Source = "docs/refactoring-plan"; Dest = "docs/historical/archived-2026-06-20/roadmaps-and-plans/refactoring-plan" },
  @{ Source = "docs/codex_goal_assistant_cli_like_ux"; Dest = "docs/historical/archived-2026-06-20/goal-packages/codex_goal_assistant_cli_like_ux" },
  @{ Source = "docs/codex_goal_storage_runner_productization"; Dest = "docs/historical/archived-2026-06-20/goal-packages/codex_goal_storage_runner_productization" },
  @{ Source = "docs/schema_driven_ports"; Dest = "docs/historical/archived-2026-06-20/design-packages/schema_driven_ports" },
  @{ Source = "docs/workflow-viewer-refactor"; Dest = "docs/historical/archived-2026-06-20/roadmaps-and-plans/workflow-viewer-refactor" },
  @{ Source = "docs/codex_goal_callable_semantics"; Dest = "docs/historical/archived-2026-06-20/goal-packages/codex_goal_callable_semantics" },
  @{ Source = "docs/codex_goal_visual_workbench_ux_refactor"; Dest = "docs/historical/archived-2026-06-20/goal-packages/codex_goal_visual_workbench_ux_refactor" },
  @{ Source = "docs/codex_goals_next_stage"; Dest = "docs/historical/archived-2026-06-20/goal-packages/codex_goals_next_stage" },
  @{ Source = "docs/workbench_authoring_agent"; Dest = "docs/historical/archived-2026-06-20/product-experiments/workbench_authoring_agent" },
  @{ Source = "docs/requirements"; Dest = "docs/historical/archived-2026-06-20/roadmaps-and-plans/requirements" },
  @{ Source = "docs/sdd"; Dest = "docs/historical/archived-2026-06-20/old-sdd/sdd" },
  @{ Source = "docs/ACC_CODEX_APP_SERVER_RUNTIME.md"; Dest = "docs/historical/archived-2026-06-20/legacy-root-docs/ACC_CODEX_APP_SERVER_RUNTIME.md" },
  @{ Source = "docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md"; Dest = "docs/historical/archived-2026-06-20/legacy-root-docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md" },
  @{ Source = "docs/goal.md"; Dest = "docs/historical/archived-2026-06-20/legacy-root-docs/goal.md" },
  @{ Source = "docs/ACC_Architecture_Audit_2026.md"; Dest = "docs/historical/archived-2026-06-20/old-audits/ACC_Architecture_Audit_2026.md" }
)

$missing = @()
foreach ($move in $moves) {
  if (Test-Path $move.Source) {
    $destParent = Split-Path $move.Dest -Parent
    if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent | Out-Null }
    Move-Item -Path $move.Source -Destination $move.Dest
  } else {
    $missing += $move.Source
  }
}

if ($missing.Count -gt 0) {
  Add-Content -Path "docs/historical/archived-2026-06-20/README.md" -Value ""
  Add-Content -Path "docs/historical/archived-2026-06-20/README.md" -Value "Missing in this checkout:"
  foreach ($path in $missing) { Add-Content -Path "docs/historical/archived-2026-06-20/README.md" -Value "- `$path`" }
}
```

Expected: command exits 0. Existing sources are moved. Missing sources are recorded in the archive README.

- [ ] **Step 2: Verify moved paths and active paths**

Run:

```powershell
$mustExist = @(
  "docs/architecture/00-constitution.md",
  "docs/audits/2026-06-20-architecture-debt-audit.md",
  "docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md",
  "docs/historical/archived-2026-06-20/README.md"
)
foreach ($path in $mustExist) {
  if (-not (Test-Path $path)) { throw "Missing required active/archive path: $path" }
}

$shouldBeArchived = @(
  "docs/Design",
  "docs/refactoring-plan",
  "docs/codex_goal_callable_semantics",
  "docs/sdd"
)
foreach ($path in $shouldBeArchived) {
  if (Test-Path $path) { throw "Archive candidate still active: $path" }
}
```

Expected: command exits 0.

---

### Task 9: Run documentation consistency verification

**Files:**
- Verify all modified and created docs.
- Modify docs only if verification identifies broken authority links or forbidden wording.

**Interfaces:**
- Consumes: All prior tasks.
- Produces: Verified doc reset ready for user review.

- [ ] **Step 1: Scan for incomplete markers**

Run:

```powershell
$terms = @(
  ("TB" + "D"),
  ("TO" + "DO"),
  ("FIX" + "ME"),
  ("place" + "holder"),
  ([string][char]24453 + [string][char]23450),
  ([string][char]26410 + [string][char]23450)
)
$pattern = ($terms | ForEach-Object { [regex]::Escape($_) }) -join "|"
$matches = Select-String -Path "AGENTS.md","README.md","docs/**/*.md" -Pattern $pattern -CaseSensitive:$false
if ($matches) {
  $matches | Format-Table Path, LineNumber, Line -AutoSize
  throw "Incomplete marker language found"
}
```

Expected: command exits 0 and prints no table.

- [ ] **Step 2: Scan active docs for archived docs presented as current authority**

Run:

```powershell
$activeFiles = @(
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/CURRENT_ARCHITECTURE.md"
) + (Get-ChildItem "docs/architecture" -Filter "*.md" | ForEach-Object { $_.FullName }) + (Get-ChildItem "docs/audits" -Filter "*.md" | ForEach-Object { $_.FullName }) + (Get-ChildItem "docs/implementation" -Filter "*.md" | ForEach-Object { $_.FullName })

$bad = Select-String -Path $activeFiles -Pattern "docs/(Design|refactoring-plan|codex_goal_|requirements|sdd)/" -CaseSensitive:$false
if ($bad) {
  $bad | Format-Table Path, LineNumber, Line -AutoSize
  throw "Active docs still point to archived package paths as if active"
}
```

Expected: command exits 0 and prints no table.

- [ ] **Step 3: Verify authority references exist**

Run:

```powershell
$requiredFiles = @(
  "docs/architecture/00-constitution.md",
  "docs/architecture/01-core-object-model.md",
  "docs/architecture/02-runtime-kernel.md",
  "docs/architecture/03-control-modes.md",
  "docs/architecture/04-data-plane-and-evidence.md",
  "docs/architecture/05-api-ui-boundaries.md",
  "docs/architecture/06-graphops-governance.md",
  "docs/architecture/07-compatibility-and-migration.md",
  "docs/architecture/08-architecture-proof-obligations.md",
  "docs/audits/2026-06-20-architecture-debt-audit.md",
  "docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md"
)
foreach ($path in $requiredFiles) {
  if (-not (Test-Path $path)) { throw "Missing required doc: $path" }
}
```

Expected: command exits 0.

- [ ] **Step 4: Run git diff review command**

Run:

```powershell
git diff --stat
git diff -- AGENTS.md README.md docs/README.md docs/CURRENT_ARCHITECTURE.md docs/architecture docs/audits docs/implementation docs/historical/archived-2026-06-20
```

Expected: diff shows documentation changes and archive moves only. If code files under `acc/` or `web/` changed, stop and revert those unintended code changes before proceeding.

---

### Task 10: Final user-review handoff

**Files:**
- No new file edits unless Task 9 found issues.

**Interfaces:**
- Consumes: Verification output from Task 9.
- Produces: Summary for user review.

- [ ] **Step 1: Summarize changed document classes**

Prepare a user-facing summary with these bullets:

```markdown
- New architecture authority: `docs/architecture/00-constitution.md` through `08-architecture-proof-obligations.md`.
- New technical debt audit: `docs/audits/2026-06-20-architecture-debt-audit.md`.
- New implementation roadmap: `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md`.
- Updated active entry points: `AGENTS.md`, `README.md`, `docs/README.md`, `docs/CURRENT_ARCHITECTURE.md`.
- Archived historical docs under `docs/historical/archived-2026-06-20/`.
- Verification commands run: incomplete-marker scan, active-doc archive reference scan, required-file existence check, and git diff review.
```

- [ ] **Step 2: Report verification evidence**

Include the exact command names and outcomes from Task 9. If any command failed and was fixed, report both the failure and the fix.

- [ ] **Step 3: Ask for review**

Ask the user to review the documentation reset before any future runtime refactor work begins.

Expected: user receives a clear summary and review request. Do not claim tests pass unless the exact commands were run and exited 0.

---

## Plan Self-Review Checklist

- Spec coverage:
  - Authority tree: Tasks 1 and 2.
  - Architecture constitution/spec docs: Tasks 3, 4, and 5.
  - Technical debt audit: Task 6.
  - Implementation roadmap: Task 7.
  - Historical archive: Task 8.
  - Verification and handoff: Tasks 9 and 10.
- Incomplete-marker policy: plan uses concrete headings, file paths, commands, and expected outcomes.
- Type/name consistency: document names match the approved spec except `docs/historical/archived-2026-06-20/README.md`, which is the archive index specified by the design.
- Execution constraint: no commits are included because this session's higher-priority instruction requires committing only when the user asks.
