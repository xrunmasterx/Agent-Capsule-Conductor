# ACC Documentation Map

## Current Entry Points

- `AGENTS.md`: project contract, module layout, stable invariants.
- `docs/CURRENT_ARCHITECTURE.md`: data flow, runtime boundaries, callable concepts, evidence files.
- `docs/concepts/`: first principles, capsule/template/session model, GraphOps control plane.

## Refactoring (2026-06)

- `docs/refactoring-plan/`: 7 feature plans + master plan, executed 2026-06-11.
- `docs/ACC_Architecture_Audit_2026.md`: full audit report with verification results.

## Current Goal Packages

These describe work reflected in the current architecture:

- `docs/codex_goal_callable_semantics/`: callable domain model, runtime evidence, migration boundary.
  Prefer `DESIGN.md`, `DOMAIN_MODEL.md`, `EXECUTION_BOUNDARIES.md`.
- `docs/codex_goal_visual_workbench_ux_refactor/`: Workbench UX, task persistence, resource/class
  vs node/instance boundary. Prefer `SPEC.md`, `DESIGN.md`.

## Strategic Planning

- `docs/codex_goals_next_stage/`: next-phase goal definitions.
- `docs/requirements/`: supervisor and platform evolution phases.
- `docs/workbench_authoring_agent/`: authoring agent roadmap (Phase 1-4).

## Reference Material

- `docs/human/`: plain-language explanations of callable semantics, workflow orchestration comparison.
- `docs/research/`: agent orchestration comparison research.
- `docs/concepts/`: architectural first principles.
- `docs/Design/`: strategic design directions (runtime control ledger, dispatch, lifecycle, etc.).
- `docs/problem/`: pre-refactoring architectural debt inventory. Many items resolved by 2026-06
  refactoring — see `docs/refactoring-plan/` for completion status.

## Historical Archive

`docs/historical/` contains archived material that is no longer current:

- `codex_goals_completed/`: 10 completed goal packages (codex_goal, clean_core_refactor,
  editable_workbench, environment_kernel, graph_workbench, ideal_layering, quality_audit,
  workbench, workflow_kernel, workflow_message_routing).
- `refactor_core_v2_phase0/`: pre-refactoring specs superseded by `docs/refactoring-plan/`.
- `CONTROL_ARCHITECTURE_GAP_REVIEW.md`: pre-refactoring gap analysis (stale line numbers).
- `ACC_WORKBENCH_PRODUCT_UI_ARCHITECTURE_BRANDKIT.md`: pre-refactoring UI architecture (stale refs).
- `dev_v1_architecture_robustness_findings.md`: v1 baseline findings.
- Legacy capsules, schemas, workflows, test fixtures, examples.

Historical docs remain useful for rationale and migration context, but their phase-specific
constraints do not override `AGENTS.md` or `CURRENT_ARCHITECTURE.md`.

## Workbench Runtime Facts

- Edits task canvases and saves Core v2 workflow templates through server APIs.
- Submits async runs: `POST /api/workflows/run-graph/submit`.
- Observes runs: `GET /api/runs/{run_id}`, `GET /api/runs/{run_id}/events`.
- Cancels runs: `POST /api/runs/{run_id}/cancel`.
- UI task state is a browser-local projection; run directories are evidence truth.
