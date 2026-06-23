# ACC Architecture Reset Design

Date: 2026-06-20
Status: Approved design for documentation reset; implementation/doc rewrite plan pending user review
Scope: ACC architecture authority reset, technical debt audit, implementation roadmap, and historical documentation archive

## 1. Background

Agent Callable Conductor (`acc`) is intended to be a local-first orchestration runtime and Workbench for wrapping mature external agents and local tools as reusable callable assets. The desired target architecture is lightweight, high-concurrency, extensible, low-coupling, and built around top-down object-oriented boundaries. ACC should coordinate execution, data movement, evidence, governance, and mode transitions. It should not become a custom LLM reasoning loop, and it should not teach agents how to work.

The current project has useful Core v2 foundations, but the documentation and implementation have drifted. Multiple documents act like architecture authority while disagreeing about legacy formats, evidence names, runtime responsibilities, and control-mode maturity. The code also shows accumulating seams: active compatibility paths, overlapping projections, runtime-state escape hatches on templates, Workbench/server boundary leakage, and incomplete convergence of workflow/supervisor/handoff execution.

This design establishes a new documentation authority model and a concrete plan for producing three classes of documents:

1. Architecture constitution and detailed architecture specs.
2. Code-grounded technical debt audit.
3. Implementation/refactor roadmap.

The user approved the direction: use a new spec as the highest authority, archive most old docs, and update or rewrite `AGENTS.md`, SDD/current architecture entry points, and related documentation.

## 2. Goals

- Establish a single, explicit architecture authority hierarchy for ACC.
- Preserve the valuable Core v2 vocabulary instead of replacing it with parallel concepts.
- Define the target architecture for a stateless, lightweight, high-concurrency orchestration runtime.
- Document current code facts, target invariants, and known deviations separately.
- Produce a debt audit grounded in actual file/line evidence.
- Produce an implementation roadmap that can later be converted into a staged execution plan.
- Archive most stale, phase-era, goal-package, and conflicting documentation without deleting historical context.
- Update active entry points so future developers and agents do not treat archived material as current truth.

## 3. Non-goals

- Do not rewrite runtime code as part of this documentation design step.
- Do not delete historical documents; move them under a dated archive with an index.
- Do not claim that fixed workflow, supervisor, and handoff already share one complete runtime kernel.
- Do not claim that all agents are already fully workflow-unaware in every code path.
- Do not present target abstractions such as `RuntimeKernel` or `NodeExecutionEnvelope` as existing code types unless introduced later.
- Do not blindly import findings from older audits; every retained finding must be revalidated against current code.
- Do not treat all YAML uniformly: callable YAML assets and workflow YAML compatibility require separate decisions.

## 4. New documentation authority model

The new active documentation tree should be:

```text
docs/
  architecture/
    00-constitution.md
    01-core-object-model.md
    02-runtime-kernel.md
    03-control-modes.md
    04-data-plane-and-evidence.md
    05-api-ui-boundaries.md
    06-graphops-governance.md
    07-compatibility-and-migration.md
    08-architecture-proof-obligations.md

  audits/
    2026-06-20-architecture-debt-audit.md

  implementation/
    2026-06-20-acc-runtime-refactor-roadmap.md

  historical/
    archived-2026-06-20/
      README.md
      goal-packages/
      design-packages/
      roadmaps-and-plans/
      product-experiments/
      legacy-root-docs/
      old-audits/
      old-sdd/
```

The authority hierarchy should be:

1. `docs/architecture/00-constitution.md` — highest architecture authority.
2. `docs/architecture/01-*` through `08-*` — detailed topic authority.
3. `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/CURRENT_ARCHITECTURE.md` — active entry points and summaries; if they conflict with `docs/architecture/*`, the architecture docs win.
4. `docs/implementation/*` — implementation roadmap, subordinate to architecture specs.
5. `docs/audits/*` — evidence-led audits; they identify debt but do not define architecture authority.
6. `docs/historical/archived-2026-06-20/*` — historical context only; archived docs never override active architecture specs.

## 5. Active entry points to rewrite

The following files should remain active but be rewritten or updated:

- `AGENTS.md` — concise project contract and authority ladder.
- `README.md` — user-facing project introduction and current docs pointer.
- `docs/README.md` — documentation index and authority map.
- `docs/CURRENT_ARCHITECTURE.md` — concise current architecture summary, no longer a mixed historical/phase document.

The rewritten `AGENTS.md` should direct readers to the new architecture constitution first, then the topic specs, then the implementation roadmap and audit.

## 6. Architecture spec design

### 6.1 `docs/architecture/00-constitution.md`

Purpose: define ACC's architectural constitution.

Required articles:

- ACC is an orchestration runtime, not an agent-brain framework.
- ACC coordinates execution boundaries, governance, data materialization, evidence, and projection.
- External agents/tools/workflows remain callable workers.
- Templates are reusable and stateless; invocations are run-scoped.
- Control authorization and data movement are separate.
- Workflow, supervisor, handoff, human gate, and nested workflow should become control strategies over one execution substrate.
- Durable local evidence outranks projections, indexes, server DTOs, frontend stores, and SSE state.
- GraphOps governs durable asset mutation.
- Legacy compatibility must be explicit and bounded.
- Architecture claims require proof obligations.

Code evidence to cite:

- `AGENTS.md:78-85` for no custom LLM loop and template/runtime separation.
- `docs/sdd/07-control-modes.md:11-22` for modes as control policies.
- `acc/models.py:266-385` for definition-time objects.
- `acc/models.py:397-491` for runtime/evidence objects.
- `acc/models.py:496-825` for control-ledger/control-mode objects.
- `acc/app/runtime/orchestrator.py:44-219` for current fixed runtime orchestration.
- `acc/app/runtime/scheduler.py:29-96` for ready-queue DAG scheduling.
- `acc/app/runtime/dispatch_gate.py:59-235` for shared dispatch skeleton and dynamic paths.
- `acc/graphops.py:276-510` for GraphOps dry-run, approval, apply, and staleness guards.

Known deviations to record:

- Runtime-like metadata keys still exist on executable metadata and `NodeInvocationSpec.metadata` (`acc/models.py:58-89`, `acc/models.py:353-370`).
- Control predecessors can implicitly supply `main` payload data (`acc/runtime/node_payload.py:138-185`).
- Supervisor/handoff are not fully converged with the fixed runtime kernel (`acc/app/supervisor.py:390-490`, `acc/engine/handoff.py:40-43`).

### 6.2 `docs/architecture/01-core-object-model.md`

Purpose: document the executable mental model of ACC.

Sections:

- Definition-time objects:
  - `AgentClassTemplate`
  - `ToolClassTemplate`
  - `WorkflowFunctionTemplate`
  - `NodeInvocationSpec`
  - `CallableRef`
  - ports, control edges, data edges
- Runtime/invocation objects:
  - `ExecutionPlan`
  - `FunctionInvocation`
  - `ScopeFrame`
  - `SessionInstance`
  - `RunRecord`
  - `EventRecord`
- Control-ledger objects:
  - `RunPlan`
  - `PlanStep`
  - `DispatchEnvelope`
  - `DecisionRecord`
  - `SupervisorPlan`
  - `HandoffRequest`
- Evidence objects:
  - node input/output
  - session evidence
  - result-store values
  - artifacts
  - events
  - run summaries and indexes

The document should include allowed references and forbidden references. For example, templates may reference callable definitions and declared ports, but must not reference run directories, session ids, workspace bindings, provider memory, or conversation history.

### 6.3 `docs/architecture/02-runtime-kernel.md`

Purpose: define the target runtime substrate and distinguish current facts from target abstractions.

Current flow to document:

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> RunPlan / PlanStep
  -> DispatchEnvelope
  -> SessionInstance or child FunctionInvocation
  -> evidence / result / artifact
```

Current evidence:

- `acc/engine/__init__.py:149-171` compiles workflow templates into execution plans.
- `acc/app/runtime/orchestrator.py:44-219` prepares invocation/scope/run evidence and invokes scheduling.
- `acc/app/runtime/scheduler.py:29-96` performs bounded ready-queue execution.
- `acc/app/runtime/executor.py:96-175` resolves payloads, executes callables, and writes evidence.

Target concept to introduce cautiously:

- `NodeExecutionEnvelope` as a future narrow adapter-facing interface. It should contain callable ref, resolved input refs, execution policy, workspace capability, result sinks, and evidence writer handles. It must not leak full workflow/template/scope internals to external agents.

Known gaps:

- Dynamic dispatch still reconstructs or overlays template/node structures.
- Supervisor contains direct procedural execution seams.
- Handoff is still P0 in some capabilities.

### 6.4 `docs/architecture/03-control-modes.md`

Purpose: define fixed workflow, supervisor, handoff, human gate/resume, and nested workflow as control strategies over one target runtime substrate.

Sections:

- Fixed workflow: most mature path; plan compile, ready queue, bounded concurrency, evidence finalization.
- Supervisor: existing domain model and partial app/engine implementation, but still has procedural direct execution paths.
- Handoff: existing request/compile concepts, but P0 limitations remain.
- Human gate/resume: authorization-driven dispatch continuation, not a separate runtime.
- Nested workflow: child `FunctionInvocation` through the same evidence and data contracts.

Important constraint: the document must not claim full convergence exists today.

### 6.5 `docs/architecture/04-data-plane-and-evidence.md`

Purpose: define explicit data movement and durable evidence truth.

Rules:

- Control edges schedule or authorize; they do not grant data rights.
- Data rights move through ports, bindings, inbox/outbox materialization, artifact refs, result refs, and workflow-call bindings.
- Direct upstream-to-downstream workspace writes are forbidden.
- Shared blackboards and hidden ambient context buses are forbidden.

Current evidence:

- `acc/runtime/node_payload.py:49-185` for payload resolution.
- `acc/runtime/node_payload.py:221-270` for binding materialization records.
- `acc/app/runtime/executor.py:96-175` for writing payload/output/evidence.
- `acc/result_store/filesystem.py:7-126` for result-store layout.

Known deviations:

- `control_main_default` and `control_main_aggregate` create implicit dataflow from control predecessors.
- Workflow output terminal id mismatch exists between writer and projection reader (`__workflow_outputs` vs `__workflow__`).

The document should define:

- Durable truth: run records, node inputs/outputs, ResultStore values, artifacts, events.
- Derived views: run summaries, indexes, server projections, frontend stores, SSE state.

### 6.6 `docs/architecture/05-api-ui-boundaries.md`

Purpose: define server and Workbench responsibilities.

Target boundaries:

- Server routes validate, delegate, and project; they should not become runtime orchestration owners.
- Frontend stores are authoring/projection caches; they do not own durable runtime truth.
- SSE is a live UX transport; polling/projection must be described honestly as current convergence/recovery behavior if still required.

Evidence and current debt:

- Sync and async workflow run routes coexist (`acc/server/routes/workflows.py:142-209`).
- Workbench-derived repair/enrichment participates in runnable graph preparation (`acc/server/routes/workflows.py:232-318`, `acc/app/workbench_adapter.py:165-229`).
- `WorkflowViewerController` is a major frontend orchestration hotspot (`web/src/components/workflow-viewer/WorkflowViewerController.tsx:112-961`).
- SSE and polling are both active (`web/src/hooks/useRunStream.ts`, `web/src/hooks/useSubmittedRunPolling.ts`).

### 6.7 `docs/architecture/06-graphops-governance.md`

Purpose: define governed durable mutation.

Required content:

- GraphOps is the control plane for governed durable asset changes.
- Mutation path: proposal -> validation -> dry-run -> human approval -> apply.
- LLM-generated changes default to proposal; destructive or privileged apply requires explicit human approval.
- GraphOps is separate from runtime execution.
- Runtime self-modification of durable templates is forbidden.

Evidence:

- `acc/graphops.py:201-455`
- `acc/graphops.py:495-510`
- `acc/server/routes/graphops.py:96-167`

The document should distinguish proposal statuses, dry-run evidence statuses, apply-time staleness guards, and caller-supplied approval fields.

### 6.8 `docs/architecture/07-compatibility-and-migration.md`

Purpose: classify compatibility surfaces.

Required classification:

- Active canonical.
- Active compatibility.
- Migration-only.
- Historical-only.
- To be decided.

Rules:

- `.accflow.json` is canonical workflow format.
- `.graph.json` is import-only/reject-plus-migrate.
- Callable YAML templates and workflow YAML discovery must be treated separately.

Evidence:

- `AGENTS.md:61-66`
- `acc/app/core_v2_loader.py:12-33`
- `tests/unit/test_legacy_graph_rejected.py:12-28`
- `tests/integration/test_workflow_import_graph.py:88-121`
- `acc/control_plane.py:325-375`

### 6.9 `docs/architecture/08-architecture-proof-obligations.md`

Purpose: convert architecture claims into tests/proofs.

Proof obligations should include:

- Templates reject runtime state.
- `.graph.json` cannot directly execute.
- GraphOps apply requires approval and staleness checks.
- Control modes share control-ledger vocabulary.
- UI/server projections do not become durable truth.
- Explicit data movement is enforced.
- Path/evidence containment is tested.
- Multiple runs do not collapse into global singleton state.

Current test seeds:

- `tests/architecture/test_import_boundaries.py:61-167`
- `tests/integration/test_core_v2_control_ledger_runtime.py:374-457`
- `tests/server/test_graphops_api.py:107-166`
- `tests/unit/test_legacy_graph_rejected.py:12-28`

## 7. Technical debt audit design

Target document:

```text
docs/audits/2026-06-20-architecture-debt-audit.md
```

Required structure:

```text
1. Executive summary
2. Target architecture rubric
3. Priority 1 findings
4. Priority 2 findings
5. Priority 3 findings
6. Documentation and authority drift
7. Remediation themes
8. Proof obligations
9. Open decisions
```

Each finding must include:

- Violated rule or target.
- Current observed behavior.
- File/line evidence.
- Blast radius.
- Why this is current debt rather than style preference.
- Conservative remediation direction.
- Proof obligation.
- Confidence/scope note.

Priority 1 findings:

1. Workbench viewer/controller orchestration hotspot.
   - Evidence: `web/src/components/workflow-viewer/WorkflowViewerController.tsx:112-961`.
   - Issue: task lifecycle, run lifecycle, assistant, GraphOps, binding editor, evidence inspector, and composition are still concentrated.

2. Duplicate graph-run submission surfaces.
   - Evidence: `acc/server/routes/workflows.py:142-169`, `acc/server/routes/workflows.py:172-209`, `web/src/api.ts:277-306`.
   - Issue: sync and async runtime submission contracts coexist without a clear product status.

3. Runnable graph preparation leaks Workbench-derived repair/enrichment.
   - Evidence: `acc/server/routes/workflows.py:232-233`, `acc/server/routes/workflows.py:295-318`, `acc/app/workbench_adapter.py:165-229`.
   - Issue: authoring projection compatibility can influence runnable graph preparation.

4. Supervisor/control-mode convergence gap.
   - Evidence: `acc/app/runtime/dispatch_gate.py:59-183`, `acc/app/supervisor.py:390-490`, `acc/engine/handoff.py:40-43`.
   - Issue: fixed/supervisor/handoff are not yet one shared execution kernel.

5. Template/runtime contamination through metadata.
   - Evidence: `acc/models.py:58-89`, `acc/models.py:353-370`, `docs/sdd/00-constitution.md:161-178`.
   - Issue: definitions still allow runtime-ish keys.

6. Implicit dataflow through control edges.
   - Evidence: `acc/runtime/node_payload.py:138-185`, `acc/engine/workflow_validation.py:219-241`, `docs/sdd/00-constitution.md:197-215`.
   - Issue: control dependency can imply data payload fallback.

Priority 2 findings:

- Evidence/result duplication and legacy probing (`docs/CURRENT_ARCHITECTURE.md:205-232`, `acc/run_index.py:149-195`, `acc/artifact_store.py:20-47`).
- Frontend projection churn and compatibility mirrors (`web/src/stores/workbenchStore.ts:36-47`, `web/src/stores/runStore.ts:14-21`, `web/src/hooks/useRunProjectionActions.ts:67-228`).
- Assistant/authoring APIs carry large editor context (`acc/app/agent_sessions.py:620-850`, `acc/app/authoring.py:719-731`, `web/src/api.ts:402-455`).
- Intentional compatibility/layering debt (`acc/app/core_v2_runtime.py:1-10`, `tests/test_runtime_imports.py:139-184`, `acc/server/run_projection.py:14-20`).

Priority 3 findings:

- Workflow format ambiguity around YAML (`acc/server/routes/workflows.py:105-136`, `acc/server/routes/workflows.py:443-466`, `acc/control_plane.py:325-375`).
- Documentation authority contradiction across old root docs, SDD, requirements, goal packages, and historical audits.

## 8. Implementation roadmap design

Target document:

```text
docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md
```

Required structure:

```text
1. Purpose
2. Non-goals
3. Preconditions
4. Staged roadmap
5. Acceptance criteria
6. Proof obligations
7. Risks and open decisions
```

Stages:

### Stage 0 — Documentation authority and archive

- Rewrite `AGENTS.md`, `README.md`, `docs/README.md`, and `docs/CURRENT_ARCHITECTURE.md`.
- Create new architecture docs and archive index.
- Archive stale docs only after active replacements exist.

Acceptance:

- No active doc points at archived material as current truth.
- Archive README explains authority ladder and replacement map.

### Stage 1 — Runnable graph truth boundary cleanup

Modules:

- `acc/server/routes/workflows.py`
- `acc/app/workbench_adapter.py`
- `web/src/hooks/useOpenedWorkflowCanvas.ts`

Goal:

- Decide whether canonical runnable graph payloads are self-sufficient or formally pass through an authoring-enrichment adapter.

Acceptance:

- Runtime validation no longer depends on unnamed repair logic.

### Stage 2 — Run submission contract rationalization

Modules:

- `acc/server/routes/workflows.py`
- `acc/server/run_manager.py`
- `web/src/api.ts`
- `web/src/components/ControlPlanePanel.tsx`

Goal:

- Classify sync route as compatibility, internal/debug, soft-deprecated, or removal candidate.
- Canonical Workbench path should be explicit.

### Stage 3 — Evidence/result normalization

Modules:

- `acc/app/runtime/executor.py`
- `acc/app/runtime/workflow_io.py`
- `acc/result_store/filesystem.py`
- `acc/run_index.py`
- `acc/server/run_projection.py`
- `web/src/stores/runStore.ts`

Goal:

- Align runtime writer, ResultStore, index, server projection, and frontend projection around one result vocabulary.
- Resolve `__workflow_outputs` vs `__workflow__`.

### Stage 4 — Explicit dataflow and metadata cleanup

Modules:

- `acc/models.py`
- `acc/runtime/node_payload.py`
- `acc/engine/workflow_validation.py`

Goal:

- Remove or quarantine runtime-like metadata.
- Decide the fate of implicit control-main forwarding.

### Stage 5 — Workbench orchestration decomposition

Modules:

- `web/src/components/workflow-viewer/WorkflowViewerController.tsx`
- `web/src/stores/workbenchStore.ts`
- `web/src/stores/runStore.ts`
- `web/src/hooks/useRunProjectionActions.ts`

Goal:

- Split task lifecycle, run lifecycle, assistant/GraphOps authoring, binding editor, evidence inspector, and graph composition.

### Stage 6 — Assistant/authoring boundary slimming

Modules:

- `acc/app/agent_sessions.py`
- `acc/app/authoring.py`
- `web/src/api.ts`

Goal:

- Replace repeated large canvas/editor context payloads with typed deltas, selection refs, catalog refs, or proposal inputs where appropriate.

### Stage 7 — Control-mode convergence over shared substrate

Modules:

- `acc/app/runtime/dispatch_gate.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/supervisor.py`
- `acc/app/handoff.py`
- `acc/engine/supervisor.py`
- `acc/engine/handoff.py`
- `acc/ledger_writer.py`

Goal:

- Make fixed/supervisor/handoff share post-decision dispatch/evidence obligations, or document and test remaining differences.

### Stage 8 — Evaluate named kernel/envelope abstractions

Potential target abstractions:

- `RuntimeKernel`
- `ControlModeStrategy`
- `NodeExecutionEnvelope`
- `EvidenceWriter`
- `ProjectionService`

Important: introduce only after evidence/compatibility noise is reduced and after ADR/spec decision.

### Stage 9 — Compatibility and naming cleanup

Modules:

- `acc/cli.py`
- `acc/migration/graph_importer.py`
- `acc/app/core_v2_runtime.py`
- `acc/server/run_projection.py`
- `web/src/workbench/model/workflowRuntimeProjection.ts`

Goal:

- Fence legacy graph conversion and compatibility naming.
- Clarify `core_v2` shims and old projection paths.

## 9. Archive plan design

Archive destination:

```text
docs/historical/archived-2026-06-20/
```

Archive index requirements:

- Archive date and rationale.
- Authority ladder.
- Category meanings.
- Active replacement docs.
- Old path -> archive path -> replacement active doc mapping.
- Stale identifier warning.
- Rule that archived docs never override the active constitution/spec.

Extraction-first candidates:

- `docs/codex_goal_callable_semantics/**`
- `docs/codex_goal_visual_workbench_ux_refactor/**`
- `docs/codex_goals_next_stage/**`
- `docs/workbench_authoring_agent/**`
- `docs/requirements/supervisor_and_platform_evolution/**`
- `docs/sdd/**`

Likely archive candidates after replacement active docs exist:

- `docs/Design/**`
- `docs/refactoring-plan/**`
- `docs/codex_goal_assistant_cli_like_ux/**`
- `docs/codex_goal_storage_runner_productization/**`
- `docs/schema_driven_ports/**`
- `docs/workflow-viewer-refactor/**`
- legacy root explainers such as `docs/ACC_CODEX_APP_SERVER_RUNTIME.md`, `docs/ACC_CODEX_CLI_INVOCATION_EXPLAINED.md`, and `docs/goal.md`.

## 10. Write order

The full documentation reset should be written in this order:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/architecture/00-constitution.md`
4. `docs/architecture/01-core-object-model.md`
5. `docs/architecture/02-runtime-kernel.md`
6. `docs/architecture/03-control-modes.md`
7. `docs/architecture/04-data-plane-and-evidence.md`
8. `docs/architecture/05-api-ui-boundaries.md`
9. `docs/architecture/06-graphops-governance.md`
10. `docs/architecture/07-compatibility-and-migration.md`
11. `docs/architecture/08-architecture-proof-obligations.md`
12. `docs/audits/2026-06-20-architecture-debt-audit.md`
13. `docs/implementation/2026-06-20-acc-runtime-refactor-roadmap.md`
14. `docs/historical/archived-2026-06-20/README.md`
15. Move/archive old docs.
16. Final update to `README.md` and `docs/CURRENT_ARCHITECTURE.md`.

This order prevents documentation holes: new authority exists before old docs are demoted.

## 11. Risks and safeguards

- Risk: over-claiming current runtime convergence.
  - Safeguard: every architecture doc uses "current fact", "target invariant", and "known deviation" labels.

- Risk: archiving docs still referenced by active entry points.
  - Safeguard: rewrite entry points before moving docs; archive README maps replacements.

- Risk: accidentally deleting historical material.
  - Safeguard: move, do not delete.

- Risk: copying stale findings from older audits.
  - Safeguard: every audit finding must have current code evidence.

- Risk: treating compatibility surfaces as dead code.
  - Safeguard: classify compatibility status before removal; sync route and YAML surfaces need explicit decisions.

- Risk: introducing future abstraction names too early.
  - Safeguard: mark `RuntimeKernel`, `ControlModeStrategy`, and `NodeExecutionEnvelope` as target concepts until implemented.

## 12. Verification and acceptance criteria for this design

This design is ready to become an implementation plan when:

- The user approves this written spec.
- The new authority tree is accepted.
- The three target document classes are accepted.
- The archive strategy is accepted.
- The write order is accepted.
- The user explicitly approves moving from brainstorming/spec into implementation planning.

The next process step after user review is to invoke the `superpowers:writing-plans` skill and create a detailed implementation plan for writing/updating/moving the actual project documents.
