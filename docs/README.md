# ACC Documentation Map

This directory contains both current architecture docs and historical goal packages. Treat them
differently.

## Current Entry Points

Read these first when you need the current system contract:

- `AGENTS.md`: repository-level working rules and non-negotiable invariants.
- `README.md`: current user-facing setup, CLI, server, Workbench, and evidence overview.
- `docs/CURRENT_ARCHITECTURE.md`: current first-principles architecture and runtime boundaries.
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`: why ACC separates reusable definitions from runtime
  executions and keeps GraphOps human-governed.
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`: template/session and callable runtime mental model.
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`: controlled workflow/capsule mutation path.

## Current Implementation Goal Packages

These packages describe work that is reflected in the current architecture:

- `docs/codex_goal_callable_semantics/`
  - Current callable domain model, runtime evidence, compatibility mapping, and final acceptance.
  - Prefer `DESIGN.md`, `DOMAIN_MODEL.md`, `EXECUTION_BOUNDARIES.md`, and `QUALITY_REPORT.md`.

- `docs/codex_goal_visual_workbench_ux_refactor/`
  - Current Workbench UX, task persistence, resource/class vs node/instance boundary, and browser
    evidence.
  - Prefer `SPEC.md`, `DESIGN.md`, `ACCEPTANCE.md`, and `QUALITY_REPORT.md`.

## Human-Readable Explanations

- `docs/human/ACC_CALLABLE_SEMANTICS_PLAIN_LANGUAGE.md` explains the callable model in plain
  language.
- `docs/human/ACC_WORKFLOW_ORCHESTRATION_COMPARISON.md` compares ACC with Multica, Paperclip,
  LangGraph, Dify, Conductor, and related systems. It is explanatory; architecture facts still defer
  to `docs/CURRENT_ARCHITECTURE.md`.

## Historical Goal Packages

The other `docs/codex_goal*` directories are historical implementation packages. They remain useful
for rationale, migrations, and old acceptance evidence, but their phase-specific non-goals do not
override the current contract in `AGENTS.md` and `docs/CURRENT_ARCHITECTURE.md`.

Examples:

- Early docs that say "do not build visual UI" are historical. The Workbench now exists and is in
  scope.
- Early docs that describe only `Capsule Template` / `Session` are historical shorthand. The current
  model is callable-first and maps legacy concepts through compatibility layers.
- Old progress or findings files may describe failures that were later fixed. Check the relevant
  `QUALITY_REPORT.md` before treating a finding as current.
- `FINDINGS.md` files are usually baseline or audit snapshots. They are evidence of what was found
  at that time, not proof that the issue still exists.
- `PROGRESS.md` files are chronological logs. They may contain intermediate blockers that were later
  resolved.
- `GOAL_COMMAND.txt` and `USAGE_WITH_GOAL.md` are instructions for a historical goal run. They are
  not current repository rules unless the active task explicitly names that goal package.

## Current Workbench Runtime Facts

The Workbench is no longer read-only.

- It edits task canvases and saves workflow graphs through server APIs.
- It submits async runs through `POST /api/workflows/run-graph/submit`.
- It observes runs through `GET /api/runs/{run_id}` and `GET /api/runs/{run_id}/events`.
- It can cancel queued/running runs through `POST /api/runs/{run_id}/cancel`.
- UI task state is a browser-local projection; run directories remain runtime evidence truth.

## How To Update Docs

Use these rules when changing documentation:

1. Keep `AGENTS.md` short and normative. It should say what must be true now.
2. Keep `docs/CURRENT_ARCHITECTURE.md` explanatory. It should explain why the current architecture is
   shaped this way.
3. Do not delete historical goal packages just because they are old; tests, migration notes, and
   acceptance history may still reference them.
4. When a historical doc conflicts with current implementation, either mark the conflict locally or
   point readers to the current entry points.
5. Do not claim acceptance or test results in docs unless the command was actually run.
6. Fix mojibake or unreadable text in active docs and example READMEs when found.
7. Prefer a small status note over rewriting an entire historical goal package.
