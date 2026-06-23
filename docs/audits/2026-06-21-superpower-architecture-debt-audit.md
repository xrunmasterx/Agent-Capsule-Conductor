# ACC Architecture Debt Audit

生成日期: 2026-06-21

本审计由 workflow 多智能体分析与人工源码阅读综合生成。它是 evidence-led audit，不覆盖 `docs/architecture/*` 的规范权威。

## Scope

审计对象：

- `docs/architecture/*`、`AGENTS.md`、`README.md`、`docs/CURRENT_ARCHITECTURE.md`；
- `acc/models.py`、`acc/engine/*`；
- `acc/app/runtime/*`、`acc/app/*lifecycle*`、`acc/app/supervisor.py`、`acc/engine/handoff.py`；
- `acc/server/routes/*`、`acc/server/live_events.py`、`acc/server/run_projection.py`；
- `acc/storage_index.py`、`acc/storage_refresh.py`、`acc/app/run_events.py`；
- Workbench projection/model paths where architecture boundary is affected。

## Top Findings

### 1. Control/data separation is violated by implicit dataflow

Severity: Critical

Evidence:

- `docs/architecture/00-constitution.md` defines control/data separation and already names implicit control-main as deviation.
- `acc/runtime/node_payload.py` forwards predecessor output into `main` through control-main compatibility behavior.
- `acc/app/runtime/dispatch_gate.py` reconstructs supervisor/handoff nodes with snapshot/static input semantics.

Impact:

- Downstream agent can receive data not represented by explicit data edge/input binding/result ref.
- Audit cannot answer “why did this agent see this value?” from workflow definition alone.

Target:

- Explicit binding/result/artifact/snapshot refs only.

### 2. Control modes are not one substrate yet

Severity: High

Evidence:

- `docs/CURRENT_ARCHITECTURE.md` states fixed workflow is mature and other modes are not fully converged.
- `acc/app/runtime/dispatch_gate.py` rehydrates persisted state and runs a second dispatch skeleton.
- `acc/app/supervisor.py` has procedural execution seams.
- `acc/engine/handoff.py` keeps P0 limitations.

Impact:

- workflow/supervisor/handoff remain separate mental models.
- resume behavior is harder to reason about than initial run.

Target:

- `ControlModeStrategy` over common scheduler and `CallableInvocationPort`.

### 3. Runtime hot path has wide transaction scripts

Severity: High

Evidence:

- `acc/app/runtime/orchestrator.py` owns setup, persistence, ledger lifecycle, scheduler driving, terminalization.
- `acc/app/runtime/executor.py` owns node dirs/logs, payload resolution, callable dispatch, result-store writes, artifact/failure records.

Impact:

- Storage/evidence/adapter/projection changes all touch hot path.
- Hard to test and optimize responsibilities independently.

Target:

- repository/recorder/binder/invocation/event/projection ports.

### 4. Agent boundary exposes ACC internals

Severity: High

Evidence:

- adapter env/request shapes expose run/workspace/session topology.
- session evidence persists cwd/env/file path fields.

Impact:

- Agent nodes can become workflow-aware and depend on ACC layout.

Target:

- `AdapterCapabilityEnvelope` with declared capabilities only.

### 5. Open metadata undermines stateless definitions

Severity: High

Evidence:

- template/node metadata and behavior overlays are open dicts.
- runtime reads executable behavior from metadata.

Impact:

- reusable assets can silently carry runtime/provider/workspace/conversation state.

Target:

- typed descriptive metadata + runtime/adapter/control/artifact policy objects; active loaders reject runtime-like metadata keys.

### 6. Projection/storage paths have O(repository) amplification

Severity: High

Evidence:

- storage refresh can full rebuild SQLite index for ordinary dirty marker.
- run summary writes rebuild global index and request storage refresh.
- run streaming polls run tree and event files repeatedly.
- nested event tail reparses whole histories.

Impact:

- Performance degrades with run/session/artifact history even when only one object changes.

Target:

- incremental object upsert/delete, event-driven streams, tail indexes/checkpoints.

### 7. Compatibility debt keeps multiple canonical-looking models alive

Severity: High

Evidence:

- `core_v2_runtime` shim remains a broad re-export.
- legacy graph/YAML fallbacks exist in UI/model paths.
- callable registry still accepts schema aliases.
- run submission exists through workflow and runner routes.
- status taxonomies are duplicated and inconsistent.

Impact:

- More parsing paths, more tests, more behavior drift.

Target:

- one canonical accflow/callable schema/submission/status/invocation path.

## Recommended Priority

1. Document and test invariants.
2. Make dataflow explicit.
3. Introduce runtime ports without behavior change.
4. Fix scheduler aggregation.
5. Unify invocation boundary.
6. Converge control modes.
7. Thin server routes.
8. Move Workbench to projections.
9. Optimize projection/storage IO.
10. Delete compatibility.

## Relation to Superpower Docs

Detailed remediation is in:

- `docs/superpower_acc_architecture/FINDINGS.md`
- `docs/superpower_acc_architecture/IMPLEMENTATION_ORDER.md`
- `docs/superpower_acc_architecture/TEST_PLAN.md`
- `docs/architecture/03-control-modes.md` through `08-architecture-proof-obligations.md`
