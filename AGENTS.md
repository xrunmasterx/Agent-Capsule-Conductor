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
