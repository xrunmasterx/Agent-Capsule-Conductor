# AGENTS.md

## Project

This repository implements **Agent Capsule Conductor V2**.

The project wraps mature external agents such as Codex CLI, Claude Code / Claude Agent SDK, Gemini / Antigravity CLI, Cursor CLI, or generic CLI tools as reusable **Capsule Templates**. Each execution creates an isolated **Session**.

Microsoft Conductor owns deterministic workflow topology. `acc` owns capsule execution boundaries. External mature agents own their internal reasoning/tool loop.

## Mandatory concepts

Use these concepts consistently:

- **Capsule Template / Agent Class**: static reusable behavior definition.
- **Session / Agent Instance**: one concrete runtime execution of a template.
- **Artifact Bundle**: stable files produced by one session.
- **GraphOps Control Plane**: controlled interface for editing workflows/capsules.
- **Human Authority**: humans author and approve workflows; LLMs may assist by proposing patches.
- **AgentClassTemplate / ToolClassTemplate**: reusable callable class definitions for agent/tool behavior.
- **WorkflowFunctionTemplate**: reusable stateless workflow function definition.
- **NodeInvocationSpec**: a call site inside a workflow function body.
- **FunctionInvocation**: one runtime call of a workflow function.
- **ScopeFrame**: the runtime function scope that owns cwd, inbox, outbox, artifacts, and behavior snapshot.
- **SessionInstance**: one concrete agent/tool execution inside a scope frame.

## Mandatory working rules

1. Read these files before changing code:
   - `docs/codex_goal/GOAL.md`
   - `docs/codex_goal/SPEC.md`
   - `docs/codex_goal/DESIGN.md`
   - `docs/codex_goal/TEST_PLAN.md`
   - `docs/codex_goal/ACCEPTANCE.md`
   - `docs/codex_goal/IMPLEMENTATION_ORDER.md`
   - `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`
   - `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`
   - `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`

2. Do not build:
   - visual canvas UI,
   - custom LLM agent loop,
   - Dify/LangGraph-style low-level agent builder,
   - database-backed artifact platform,
   - cloud/Kubernetes deployment,
   - unbounded autonomous scheduler,
   - self-modifying workflow system without human approval.

3. Default tests must be hermetic:
   - no real Codex login required,
   - no Claude credentials required,
   - no network required,
   - no Conductor installation required,
   - no Gemini/Cursor/Hermes installation required.

4. All CLI logs must go to stderr.
   If `--emit-conductor-json` is used, stdout must contain exactly one JSON object.

5. LLM-assisted GraphOps must default to proposal mode:
   - generate patch,
   - validate patch,
   - write rationale,
   - do not apply destructive changes without explicit human approval.

6. After every meaningful milestone, run the relevant tests.
   Before claiming completion, run all commands in `docs/codex_goal/ACCEPTANCE.md`.

7. If blocked, do not guess. Report:
   - what failed,
   - which command failed,
   - evidence collected,
   - external dependency or missing information required.

# Phase 2 Workbench Rules

## Context

The Agent Capsule Conductor MVP already exists. Do not re-implement the MVP unless tests show a defect.

The previous MVP contract remains valid:

- Conductor owns deterministic workflow topology.
- `acc` owns capsule execution boundary.
- External mature agents own their internal reasoning/tool loop.
- `--emit-conductor-json` stdout must remain exactly one JSON object.

## Phase 2 priorities

Build usability and observability on top of the existing core:

1. Usability Core first:
   - `acc runs list`
   - `acc runs show`
   - `acc inspect --json`
   - `acc capsule test`
   - `acc capsule clone`
   - `acc capsule doctor`
   - RunIndex
   - NodeRunSummary
   - ArtifactManifest v2

2. Then Local Workbench Server:
   - FastAPI API over existing `acc.core`
   - no UI dependency inside core

3. Then Visual Workbench Read-only MVP:
   - Run Inspector
   - Capsule Browser
   - Artifact Viewer
   - Workflow Viewer
   - no graph editing yet

## Non-goals for Phase 2A and 2B

Do not build yet:

- drag-and-drop graph editor
- node connection editing
- workflow save from UI
- custom LLM agent loop
- new autonomous scheduler
- database-first artifact backend
- cloud deployment

## Safety

If AI-assisted workflow modification is implemented later, it must use:

```text
proposal -> validation -> dry-run -> human approval -> apply
```

Never allow an LLM to directly apply workflow/capsule patches by default.

# Phase 3: Editable Workbench MVP rules

The previous MVP and read-only workbench are the baseline. Do not rewrite `acc run`, core adapters, or existing acceptance behavior unless a test proves it is necessary.

## New phase objective

Build the smallest useful editable workbench:

1. Capsule Scaffold: create a custom capsule without hand-writing every file.
2. Capsule Editor: edit prompt/schema/artifact manifest safely.
3. Workflow Graph: add capsule nodes, connect nodes, save a graph file.
4. Local Graph Runner: run a simple deterministic graph for demos.
5. Workbench UI: minimal read/write UI for capsule creation, graph editing, workflow run, and artifact inspection.

## Boundaries

Do not build:

- a full Dify/LangGraph replacement;
- a new LLM agent loop;
- a complex database backend;
- cloud deployment;
- multi-user/team permissions;
- AI auto-apply workflow editing;
- real external agent calls in default tests.

## Core safety rule

All graph edits must validate before save. Dangerous permission escalation must be blocked or explicitly marked as a warning.

## Testing rule

Keep all previous acceptance tests passing. Add new tests for capsule scaffolding, workflow graph validation, graph runner, API endpoints, and web build. Default tests must remain hermetic.

# Phase 4: Graph Workbench Rules

This repository already has a working headless Agent Capsule runtime and an editable workbench prototype. In this phase, implement a graph-first workbench.

## Must preserve

- Do not rewrite `acc run`.
- Do not rewrite existing adapters.
- Do not break existing MVP tests.
- Default tests must remain hermetic.
- Do not require real Codex/Claude credentials for default tests.
- `--emit-conductor-json` stdout contract must remain unchanged.

## UX priorities

1. UI must be Chinese-first.
2. The workflow builder must show actual node dependencies as a DAG.
3. Users must be able to add capsules as graph nodes.
4. Users must be able to connect nodes by dragging edges.
5. The graph must support serial and parallel structure visually.
6. Each node must show status, runtime, capsule id, and important warnings.
7. Node input/output/artifact inspection must be reachable from the graph.
8. Keep the UI practical and clean. Avoid decorative features.

## Forbidden in this phase

- No full Dify clone.
- No custom LLM agent loop.
- No autonomous graph scheduler.
- No AI auto-apply graph mutation without validation and human confirmation.
- No complex collaboration, permissions, cloud deployment, or marketplace.

## Recommended frontend direction

Prefer React Flow + ELK/Dagre layout for the graph canvas, unless the existing project has already committed to a different graph library. Keep the graph schema independent from the UI library.

Phase 5: Workflow Kernel Upgrade Rules
This repository already has an ACC core/runtime/workbench baseline. This phase must upgrade workflow semantics without rewriting the existing capsule runner or mature-agent adapters.
Mandatory boundaries
Do not rewrite `acc run` unless needed for event emission integration. Preserve its stdout JSON contract.
Do not implement a custom LLM agent loop.
Do not copy Microsoft Conductor's full YAML DSL.
Do not remove or weaken existing hermetic tests.
Do not let default tests require real Codex, Claude, Cursor, Hermes, network, or Conductor installation.
Keep ACC local-first, artifact-first, and session-isolated.
LLM-generated workflow/capsule mutations must go through GraphOps: proposal -> validation -> dry-run -> human approval -> apply.
WorkflowGraph is the ACC authoring IR. Conductor YAML is an export target, not the internal source of truth.
New phase priorities
Implement in this order:
Standard event emitters.
WorkflowGraph v3 validation.
DAG level parallel execution and failure modes.
Explicit data/control edges and artifact references.
Workflow Capsule kinds, especially nested `acc_workflow`.
GraphOps semantic validation after dry-run.
Conductor export bridge.
Minimal API/UI integration only if existing workbench code already exists.
Test rule
Every feature must have hermetic tests using fake capsules/workflows. Optional real-agent or Conductor tests must be skipped unless environment variables explicitly enable them.
ACC 
Phase 6: Debugger, Workflow Capsules, Agent Control Plane, Browser UX
Context
The repository should already contain the ACC MVP, Workbench, Graph Workbench, and Workflow Kernel work. The next stage must not rewrite the existing runtime. It must improve debuggability, workflow reuse, agent-callable control, and browser-based usability.
Mandatory rules
Preserve existing `acc run` behavior and stdout JSON contract.
Do not implement a new LLM agent loop.
Do not replace the existing Capsule Runtime or Workflow Kernel; extend them.
Do not make default tests require real Codex, Claude, Hermes, Cursor, browser credentials, network, or external paid services.
Browser E2E validation may use Playwright or Codex browser-control tools. If the browser cannot run, record the gap and keep hermetic tests passing.
UI must default to Chinese for all core user-visible labels in this phase.
When using browser automation, record:
journey name
exact steps
pass/fail result
screenshots or evidence path if available
console errors
network errors
usability issues discovered
Do not mark a goal complete until its acceptance file passes.
If an issue is discovered during browser testing, fix it and repeat the relevant journey until it passes or record a blocker.
GraphOps or agent-driven changes must remain proposal/dry-run/review-first. Do not allow unattended destructive apply by default.

# Phase 7: ACC Quality Audit and Hardening Rules

This phase is a quality audit, not a feature expansion.

## Mandatory priority order

1. Preserve existing public behavior and contracts.
2. Audit architecture and code before changing code.
3. Fix correctness, safety, and maintainability issues before optimizing performance.
4. Optimize only when supported by profiling, complexity analysis, or measurable evidence.
5. Keep the framework lightweight. Prefer removing complexity over adding abstraction.
6. Every meaningful fix must have a test, browser E2E evidence, or documented rationale.
7. Do not mark the goal complete while critical or high-severity issues remain unresolved.

## Invariants that must not be broken

- `acc run ... --emit-conductor-json` stdout must contain exactly one JSON object.
- Logs must go to stderr or files, not stdout, when machine-readable output is requested.
- Default tests must remain hermetic.
- Default tests must not require real Codex, Claude, Cursor, Gemini, Hermes, Conductor, browser cloud services, external network, or paid credentials.
- Existing accepted commands from older `docs/codex_goal*/ACCEPTANCE.md` files must continue to pass unless a documented migration updates them.
- Do not implement a custom LLM reasoning/tool loop.
- Do not turn ACC into Dify/LangGraph/Conductor clone.
- Do not add database/cloud/team/SaaS features for this goal.

## Review discipline

Before modifying code:

1. Generate or update `docs/codex_goal_quality_audit/FINDINGS.md`.
2. Classify issues by severity: critical, high, medium, low.
3. Identify the root cause and first-principles design violation.
4. Propose the smallest safe fix.
5. Then implement fixes in priority order.

## Browser QA

If a browser UI exists, run real browser journeys through Playwright or the available browser-control tool. Capture screenshots, console logs, network logs, and browser QA reports.

# Phase 8: Environment-Scoped Workflow Capsule Rules

## Purpose

This phase upgrades ACC from a flat capsule-kind model into an environment-scoped workflow model.

## Non-negotiable rules

1. Do not rewrite `acc run` from scratch.
2. Do not break the existing `--emit-conductor-json` stdout contract.
3. Do not implement a custom LLM tool-calling loop.
4. Do not make the ACC install directory the default mutable workspace.
5. Do not let sender nodes write directly into receiver workspaces.
6. Do not implicitly share agent session context across nodes.
7. Do not introduce cloud, database, or remote registry dependencies by default.
8. Default tests must remain hermetic.

## Architecture rules

- `WorkflowTemplate` is a saved, reusable, stateless graph asset.
- `EnvironmentFrame` is a runtime binding of a workflow to a workspace root.
- `AgentSessionNode` should feel like starting an agent CLI in the workflow working directory.
- Data transfer between nodes must go through explicit `Port`, `Inbox`, `Outbox`, and `ArtifactBundle` contracts.
- Scheduler must materialize data into receiver inboxes; sender nodes must not mutate receiver folders directly.
- A stateful environment may not contain another stateful environment by default.
- A stateless workflow template may instantiate one stateful environment frame when explicitly bound by the user.
- Saved workflows must not store machine-specific workspace paths unless explicitly marked as a local binding file.

## Validation rules

Codex must add tests for:

- workspace binding and stateless template reuse;
- agent node cwd inheritance;
- inbox/outbox materialization;
- fan-out/fan-in readiness;
- stateful-in-stateful nesting rejection;
- sender cannot write receiver workspace directly;
- existing stdout contract regression.

# Phase 9: Clean Core Refactor Rules

## Priority

The current priority is clean architecture, correctness, robustness, and maintainability.

Previous implementation details may be removed or replaced if they conflict with the new clean-core architecture. Previous docs are historical references; `docs/codex_goal_clean_core_refactor/` is the active contract for this refactor.

## Core principles

1. Do not patch around architecture debt. Prefer a smaller clean core.
2. Keep ACC lightweight. Avoid database, cloud, distributed workers, or heavy frameworks unless explicitly required by acceptance criteria.
3. Separate template from runtime state.
4. Separate control dependencies from data dependencies.
5. Separate workflow environment from node execution.
6. Separate UI/API state from runtime state.
7. No implicit shared context between Agent sessions.
8. No direct upstream writes into downstream workspaces.
9. Default stateless workflows must use run-scoped ephemeral workspaces, not the ACC install directory.
10. Existing old commands may be deprecated if they conflict with the new model, but document the replacement clearly.

## Must preserve

- Default tests must remain hermetic.
- No default tests may require real Codex, Claude, Cursor, Hermes, network, or Conductor.
- External integrations must be optional smoke tests.
- Logs must not pollute machine-readable JSON outputs.
- Any browser/UI tests must capture screenshots and console logs if UI exists.

## Prohibited during this goal

- Building a new LLM tool-calling agent framework.
- Recreating Microsoft Conductor's full DSL.
- Adding database/cloud/distributed worker infrastructure.
- Treating the ACC installation directory as a default workflow workspace.
- Allowing LLM-proposed GraphOps patches to apply without validation and approval.


# Phase 10: Ideal Layering Refactor Rules

This phase is a clean architecture refactor of ACC Clean Core.

## Mandatory goal docs

Before changing code, read:

- docs/codex_goal_ideal_layering/GOAL.md
- docs/codex_goal_ideal_layering/SPEC.md
- docs/codex_goal_ideal_layering/DESIGN.md
- docs/codex_goal_ideal_layering/LAYERING_CONTRACT.md
- docs/codex_goal_ideal_layering/TEST_PLAN.md
- docs/codex_goal_ideal_layering/ACCEPTANCE.md
- docs/human/ACC_IDEAL_LAYERING_PLAIN_LANGUAGE.md

## Non-negotiable constraints

1. Do not preserve old module layout just for compatibility.
2. Preserve public behavior that matters: stable JSON CLI, run artifacts, stdout contract, hermetic default tests.
3. Do not implement a custom LLM agent loop.
4. Do not introduce database/cloud/distributed worker dependencies.
5. Do not call real Codex/Claude/Cursor/Hermes in default tests.
6. Do not let domain import IO/process/UI modules.
7. Do not let engine run subprocesses or write files.
8. Do not let runtime mutate workflow graph semantics.
9. Do not let store know CLI/UI concepts.
10. Do not pass full host environment to real or fake runners by default.

## Completion discipline

- Create FINDINGS.md before refactoring.
- Refactor by contract, not by taste.
- Every moved responsibility must have tests.
- Every security contract must have negative tests.
- The final report must explain what was deleted, kept, renamed, and why.

# Phase 11: Callable Semantics Refactor Rules

This phase upgrades ACC Clean Core from a node/capsule-oriented runtime into an explicit callable runtime. It must preserve the correct mechanics already achieved by Clean Core and Ideal Layering.

## Mandatory goal docs

Before changing code for this phase, read:

- docs/codex_goal_callable_semantics/GOAL.md
- docs/codex_goal_callable_semantics/SPEC.md
- docs/codex_goal_callable_semantics/DESIGN.md
- docs/codex_goal_callable_semantics/DOMAIN_MODEL.md
- docs/codex_goal_callable_semantics/WORKFLOW_AS_FUNCTION_SPEC.md
- docs/codex_goal_callable_semantics/AGENT_TOOL_AS_CLASS_SPEC.md
- docs/codex_goal_callable_semantics/SCOPE_FRAME_SPEC.md
- docs/codex_goal_callable_semantics/PORT_DATA_FLOW_SPEC.md
- docs/codex_goal_callable_semantics/EXECUTION_BOUNDARIES.md
- docs/codex_goal_callable_semantics/TERMINATION_CONDITIONS.md
- docs/codex_goal_callable_semantics/TEST_PLAN.md
- docs/codex_goal_callable_semantics/ACCEPTANCE.md
- docs/codex_goal_callable_semantics/IMPLEMENTATION_ORDER.md
- docs/codex_goal_callable_semantics/MIGRATION_PLAN.md
- docs/codex_goal_callable_semantics/MIGRATION_NOTES.md
- docs/codex_goal_callable_semantics/RISK_REGISTER.md
- docs/human/ACC_CALLABLE_SEMANTICS_PLAIN_LANGUAGE.md

## Core semantic rules

- Agent and Tool are reusable ClassTemplates.
- Workflow is a reusable WorkflowFunctionTemplate.
- A workflow node is a NodeInvocationSpec, not a session and not a class definition.
- A workflow run is a FunctionInvocation.
- The working directory, inbox, outbox, artifacts, and behavior snapshot belong to a ScopeFrame.
- Every agent/tool execution creates a SessionInstance.
- Templates are stateless; runtime state belongs to invocations, scope frames, sessions, events, inboxes, outboxes, and artifacts.
- Workflow templates must not store local absolute workspace paths, run directories, session ids, prior outputs, or agent conversation memory.

## Non-negotiable constraints

1. Do not rewrite `acc run`.
2. Do not break `--emit-conductor-json` or workflow `--emit-json` stdout single-JSON contracts.
3. Do not require real Codex, Claude, Cursor, Gemini, Hermes, Conductor, network, or paid credentials in default tests.
4. Do not implement a custom LLM agent loop.
5. Do not introduce database, cloud, Kubernetes, distributed worker, SaaS, or marketplace infrastructure.
6. Do not let sender nodes write directly into receiver workspaces or inboxes.
7. Do not let child workflows read parent data unless it was explicitly bound into child exposed inputs.
8. Do not use `upstream_context` as the primary nested workflow data protocol.
9. Do not let runtime mutate workflow graph semantics or call app/store orchestration directly.
10. Do not let engine perform filesystem IO, read host env, spawn processes, or import app/store/runtime/cli/server/ui.
11. Do not remove legacy CapsuleSpec/NodeSpec behavior without compatibility mapping, migration notes, and tests.
12. Do not allow GraphOps or LLM-generated changes to auto-apply destructive mutations.

## Required implementation direction

- Add callable domain types before changing behavior.
- Normalize legacy `.accflow.json` fields into callable semantics instead of breaking existing examples.
- Map existing CapsuleSpec paths to AgentClassTemplate, ToolClassTemplate, or WorkflowFunctionTemplate compatibility views.
- Add `function_invocation_manifest.json`, `scope_frame_manifest.json`, `session_instance_manifest.json`, and workflow-call evidence as additive runtime evidence.
- Refactor nested workflow execution into explicit input/output function-call bindings.
- Keep store as the only owner of inbox/outbox materialization and path traversal protection.
- Keep runtime focused on cwd/env/permission/timeout/workspace execution policy.
- Split `acc.app` coordination if needed so workflow service, execution loop, node invocation, workflow call handling, and legacy compatibility do not collapse into one unbounded runner.

## Completion discipline

- Update `docs/codex_goal_callable_semantics/FINDINGS.md` before code changes.
- Implement milestone by milestone according to `IMPLEMENTATION_ORDER.md`.
- Every new semantic rule must have positive and negative tests.
- Every security contract must have negative tests.
- Performance claims require at least the large-DAG sanity test described in `ACCEPTANCE.md`.
- Do not mark the goal complete until every command in `docs/codex_goal_callable_semantics/ACCEPTANCE.md` passes.
- Final `QUALITY_REPORT.md` must document what was added, deleted, renamed, preserved, how legacy concepts map to callable concepts, exact test evidence, stdout contract evidence, and remaining risks.

# Phase UI: Visual Workbench UX Refactor Rules

## Objective

This phase improves the usability and visual clarity of the existing ACC Workbench. It must not rewrite the Clean Core, the workflow kernel, or the capsule runtime.

## Mandatory principles

1. Chinese is the default UI language.
2. Graph-first workflow editing is mandatory. Button-only node connection is not acceptable.
3. Raw JSON/YAML must not be the default reading experience. Raw views may exist behind tabs or details panels.
4. UI must use progressive disclosure: simple first, advanced details hidden until requested.
5. The workbench must make serial, parallel, fan-out, fan-in, branch, and failure states visually obvious.
6. Existing core acceptance tests must continue passing.
7. Browser E2E evidence is required: screenshots, console logs, network logs, and journey reports.
8. Do not introduce database, cloud backend, new LLM agent framework, or unrelated product features.
9. Do not degrade stdout JSON contract for CLI commands.
10. Do not bypass the existing app/core/runtime contracts.

## Design tone

Aim for a calm, high-end engineering tool:

- low visual noise;
- crisp typography;
- subtle borders and muted surfaces;
- clear hierarchy;
- concise Chinese copy;
- strong artifact readability;
- minimal but obvious action buttons.
