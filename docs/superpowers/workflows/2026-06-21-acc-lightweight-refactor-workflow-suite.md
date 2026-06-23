# ACC Lightweight Refactor Workflow Suite

生成日期: 2026-06-21

## Purpose

本文件设计后续使用 workflow 模式执行 ACC 轻量化重构的 orchestration suite。它不是单个大爆炸工作流，而是一组 proof-gated phase workflows。

目标顺序固定：

```text
status/submission
  -> explicit dataflow
  -> runtime kernel
  -> invocation/harness
  -> control modes
  -> Workbench/projection/storage
```

## First Principles

1. **先统一契约，再删代码。** 任何删除必须有 caller search、测试证明和文档更新。
2. **每个 workflow 只处理一个架构轴。** status、submission、dataflow、runtime kernel、invocation、control modes、projection/storage 不混在一个实现批次里。
3. **新抽象必须减少责任。** `WorkflowSubmissionService`、`RunRepository`、`Binder`、`CallableInvocationPort`、`AdapterProcessHarness`、`ProjectionService` 只有在接管具体行为并删除重复路径时才值得引入。
4. **轻量不是少证据。** evidence-first 仍然保留；减少的是重复路径、旧格式兼容、读侧修补、route orchestration、全量重建和隐式状态。
5. **控制和数据分离。** ControlModeStrategy 只授权和物化 intent/evidence；数据通过 explicit binding / result ref / artifact ref / snapshot input。
6. **scheduler owns concurrency.** Node tasks 返回 immutable `NodeExecutionResult`，scheduler 聚合结果。
7. **UI/server 是 projection。** Workbench 标准视图消费稳定 projection，raw runtime manifests 只在 debug/evidence surface 出现。
8. **compatibility bounded.** 旧 graph/session/event/run_dir/GraphOps patch 等兼容必须有迁移和删除条件。

## Recommended Granularity

推荐使用 **一个 master roadmap workflow + 六个 phase workflows**，而不是一个单体 mega-workflow。

原因：

- 每个 phase 都有不同 stop conditions；
- 很多删除依赖前一阶段产物；
- 单体 workflow 容易吞掉细节并产生危险大改；
- phase outputs 可以作为下一阶段输入，降低上下文和回滚成本。

## Master Workflow: `wf-acc-lightweight-refactor-master`

### Purpose

只负责排序、检查 gate、读取 phase handoff，不直接实现代码。

### Control Flow

```text
1. Run wf-01-status-submission
2. If validation passes, run wf-02-explicit-dataflow
3. If strict dataflow proof passes, run wf-03-runtime-kernel
4. If NodeExecutionResult and scheduler aggregation pass, run wf-04-invocation-harness
5. If CallableInvocationPort and harness pass, run wf-05-control-modes
6. If scheduler continuation passes, run wf-06-workbench-projection-storage
7. Generate final cleanup/deletion report
```

### When To Use

Use when starting a full ACC lightweight refactor campaign from the current Superpower plans.

### When Not To Use

Do not use for one-off bug fixes, UI-only tweaks, or isolated test cleanup. Use the specific phase plan instead.

### Global Safety Gates

1. Read `AGENTS.md` and the relevant `docs/superpower_acc_architecture/*` docs before implementation.
2. Run `git status --short` before each implementation batch.
3. Stop on first required validation failure.
4. Do not delete live compatibility paths until replacement and tests are complete.
5. Reject broad facades that do not own concrete behavior.
6. No hidden dataflow: strict payload keys must have binding manifest entries.
7. Node tasks must not mutate workflow-wide shared outputs after runtime-kernel phase.
8. Control-mode convergence cannot start until common scheduler/invocation substrate exists.
9. Workbench/projection deletion cannot start until projection contracts exist.
10. Incremental storage index must keep repair-only full rebuild until parity is proven.
11. Add static guards when removing duplicate statuses or compatibility paths.
12. Stop on unknown product-scope decisions, especially historical data retention, cloud sync, legacy GraphOps patch API, or handoff resume semantics.

## Handoff Protocol Between Phase Workflows

Each phase must produce a short handoff note containing:

- files inspected;
- code paths changed;
- compatibility paths left in place;
- deletion targets newly safe or still blocked;
- tests added or updated;
- commands run and results;
- unresolved product decisions;
- recommended next workflow.

Suggested output file per phase:

```text
docs/superpowers/workflows/handoffs/<phase-name>-handoff.md
```

## Workflow Summary Table

| Workflow | Plan | Main Output | Next |
| --- | --- | --- | --- |
| `wf-01-status-submission` | `2026-06-21-status-and-submission-canonicalization.md` | canonical run status + submission service | `wf-02-explicit-dataflow` |
| `wf-02-explicit-dataflow` | `2026-06-21-explicit-dataflow-and-evidence.md` | binding manifest contract + strict dataflow migration | `wf-03-runtime-kernel` |
| `wf-03-runtime-kernel` | `2026-06-21-lightweight-runtime-kernel.md` | ExecutionContext + repository/recorder + NodeExecutionResult | `wf-04-invocation-harness` |
| `wf-04-invocation-harness` | `2026-06-21-invocation-and-adapter-harness.md` | CallableInvocationPort + AdapterProcessHarness | `wf-05-control-modes` |
| `wf-05-control-modes` | `2026-06-21-control-mode-scheduler-convergence.md` | common scheduler continuation + dispatch_gate deletion gate | `wf-06-workbench-projection-storage` |
| `wf-06-workbench-projection-storage` | `2026-06-21-workbench-projection-storage-graphops-cleanup.md` | projection contracts + incremental storage + legacy UI/API cleanup | complete |

## Phase Workflow Designs

### wf-01-status-submission

**Purpose:** Reduce duplicate run-status taxonomies and duplicated run submission paths while preserving route behavior.

**Agents:**

- backend-app-agent;
- route-contract-agent;
- state-machine-test-agent;
- architecture-guard-agent.

**Inputs:**

- `acc/app/run_lifecycle.py`
- `acc/server/routes/runs.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runner.py`
- `acc/storage_gc.py`
- `acc/cloud_sync.py`
- `acc/server/run_manager.py`
- related server tests.

**Phases:**

1. Inventory duplicate status sets and submission paths.
2. Create canonical run-status module without deleting callers.
3. Migrate callers incrementally.
4. Add duplicate-status static guard.
5. Extract small `WorkflowSubmissionService`.
6. Migrate workflow async submit first, runner submit second.
7. Delete only proven-unused helpers.

**Stop Conditions:**

- Cloud sync product scope is unknown and migration would require deletion/semantic decision.
- `WorkflowSubmissionService` imports FastAPI or owns scheduler/executor internals.
- Route DTO or rejected-receipt semantics differ without parity tests.

**Validation:**

```bash
uv run pytest -q tests/test_state_machine.py
uv run pytest -q tests/server/test_runner_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
```

### wf-02-explicit-dataflow

**Purpose:** Make hidden control-edge dataflow impossible in canonical path.

**Agents:**

- runtime-dataflow-agent;
- evidence-contract-agent;
- negative-proof-test-agent;
- fixture-migration-agent.

**Inputs:**

- `acc/runtime/node_payload.py`
- `acc/app/runtime/dispatch_gate.py`
- workflow fixtures and binding tests.

**Phases:**

1. Inventory implicit payload paths.
2. Define binding manifest schema.
3. Add negative proof tests.
4. Split logical binding from runtime materialization.
5. Migrate checked-in workflows/fixtures.
6. Delete control-main compatibility only after strict manifest coverage passes.

**Stop Conditions:**

- Any payload source remains unknown.
- Binding manifest cannot explain every payload key.
- Supervisor/handoff snapshot provenance cannot be represented explicitly.

**Validation:**

```bash
uv run pytest -q tests/integration/test_core_v2_workflow_bindings.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_handoff_p0.py
```

### wf-03-runtime-kernel

**Purpose:** Introduce concrete context/repository/recorder and scheduler-owned result aggregation.

**Agents:**

- runtime-kernel-agent;
- filesystem-evidence-agent;
- scheduler-agent;
- concurrency-test-agent.

**Inputs:**

- `acc/app/runtime/orchestrator.py`
- `acc/app/runtime/executor.py`
- `acc/app/runtime/scheduler.py`
- `acc/app/runtime/nested_workflow.py`
- `acc/app/runtime/workflow_io.py`

**Phases:**

1. Define concrete `ExecutionContext` at submission boundary.
2. Thread context through fixed workflow runtime.
3. Introduce narrow `RunRepository` and `NodeExecutionRecorder`.
4. Draft `NodeExecutionResult`.
5. Make executor return `NodeExecutionResult`.
6. Move aggregation and terminal decisions into scheduler.
7. Delete direct shared-output mutation after tests.

**Stop Conditions:**

- A new seam has no immediate caller or deletion target.
- Runtime code introduces new `Path.cwd()` guessing.
- `RunRepository` becomes generic filesystem facade.
- NodeExecutionResult fields are unresolved.

**Validation:**

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_function_invocation_manifests.py tests/integration/test_session_instance_manifests.py
```

Additional proof:

- two project roots in one process;
- high-concurrency workflow no shared output mutation;
- failure/waiting/cancellation behavior preserved.

### wf-04-invocation-harness

**Purpose:** Unify callable execution and one-shot adapter lifecycle.

**Agents:**

- invocation-boundary-agent;
- callable-routing-agent;
- adapter-harness-agent;
- unit-test-agent.

**Inputs:**

- NodeExecutionResult from `wf-03`;
- `acc/app/runtime/executor.py`;
- `acc/callable_runner.py`;
- `acc/app/invocation.py`;
- `acc/app/runtime/nested_workflow.py`;
- adapter modules.

**Phases:**

1. Confirm NodeExecutionResult is reviewed and tested.
2. Define `NodeExecutionEnvelope`.
3. Implement concrete `CallableInvocationPort` with fixed-workflow caller migration.
4. Extract `AdapterProcessHarness` for one-shot subprocess adapters.
5. Keep Codex app-server streaming path separate unless overlap is proven.
6. Delete old invocation seams only after consumer search.

**Stop Conditions:**

- NodeExecutionResult missing or untested.
- Adapters receive raw workflow topology.
- CallableInvocationPort becomes abstract framework without hot-path caller.
- Streaming adapter is forced into one-shot harness prematurely.

**Validation:**

```bash
uv run pytest -q tests/unit/test_callable_normalization.py
uv run pytest -q tests/unit/test_generic_cli_adapter.py tests/unit/test_codex_cli_adapter.py tests/unit/test_codex_app_server_adapter.py
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py
```

### wf-05-control-modes

**Purpose:** Converge human gate, supervisor, and handoff onto one scheduler continuation path.

**Agents:**

- control-mode-agent;
- scheduler-agent;
- human-gate-service-agent;
- handoff-supervisor-agent.

**Inputs:**

- CallableInvocationPort from `wf-04`;
- scheduler continuation candidate from `wf-03`;
- `acc/app/runtime/dispatch_gate.py`;
- `acc/app/human_gate_service.py`;
- `acc/app/supervisor.py`;
- `acc/engine/handoff.py`.

**Phases:**

1. Add shared scheduler continuation foundation without deleting `dispatch_gate.py`.
2. Migrate human-gate resume first.
3. Migrate supervisor execution to emit decisions/steps/refs only.
4. Migrate supported handoff execution with typed context/result refs.
5. Keep unsupported handoff semantics explicit.
6. Delete or isolate `dispatch_gate.py` after zero callers and proof tests.

**Stop Conditions:**

- Common continuation cannot load persisted run plan/steps/invocation/evidence.
- Human-gate approval still calls `resume_approved_human_gate_dispatch` on active path.
- Supervisor/handoff invokes agents outside common scheduler/invocation port.
- Hidden static_input/snapshot path remains active for migrated semantics.

**Validation:**

```bash
uv run pytest -q tests/integration/test_core_v2_control_ledger_runtime.py
uv run pytest -q tests/integration/test_handoff_p0.py
uv run pytest -q tests/server/test_runner_api.py
```

Additional proof:

- no active calls to `resume_approved_human_gate_dispatch`, `dispatch_ready_supervisor_plan_steps`, or `dispatch_ready_handoff_plan_steps` before deletion.

### wf-06-workbench-projection-storage

**Purpose:** Thin API/UI/storage boundaries after runtime/control evidence contracts are stable.

**Agents:**

- projection-contract-agent;
- server-live-events-agent;
- web-workbench-agent;
- storage-index-agent;
- graphops-governance-agent;
- cleanup-gate-agent.

**Inputs:**

- `docs/Design/workbench-projection-contract.md`
- `acc/app/run_events.py`
- `acc/server/run_projection.py`
- `acc/server/live_events.py`
- `acc/server/routes/graphops.py`
- `acc/storage_index.py`
- `acc/storage_refresh.py`
- Workbench projection TS files.

**Phases:**

1. Settle Workbench compile-boundary ownership.
2. Define projection contracts and fixtures.
3. Migrate Workbench standard views to projection endpoints.
4. Extract live-event projection service semantics.
5. Add incremental storage/index upsert/delete.
6. Keep and test repair-only full rebuild.
7. Migrate GraphOps callers to proposal APIs.
8. Retire legacy routes/fallbacks after zero-caller proof.

**Stop Conditions:**

- Workbench compile-boundary ownership is unresolved.
- Standard Workbench views still parse runtime manifests outside debug disclosure.
- Ordinary writes still trigger repository-wide full rebuild.
- Browser/tooling still calls legacy GraphOps patch helpers.
- Proposal APIs do not preserve validation/dry-run/apply semantics.

**Validation:**

```bash
uv run pytest -q tests/server/test_workbench_canvas_snapshots_api.py
uv run pytest -q tests/server/test_run_log_projection_api.py tests/server/test_runs_projection_api.py
cd web
npm run test -- --run
npm run build
```

Additional proof:

- one run-summary write does not trigger repository-wide rebuild;
- repair rebuild reconstructs index from durable evidence;
- no production browser calls legacy GraphOps patch APIs.

## Suggested Workflow Script Skeletons

The actual implementation workflow should be generated per phase from the phase plan. Keep each script small.

### Master skeleton

```javascript
export const meta = {
  name: 'acc-lightweight-refactor-master',
  description: 'Run ACC lightweight refactor workflows in proof-gated order',
  phases: [
    { title: 'Status/Submission' },
    { title: 'Dataflow' },
    { title: 'Runtime Kernel' },
    { title: 'Invocation/Harness' },
    { title: 'Control Modes' },
    { title: 'Workbench/Projection/Storage' },
  ],
}

phase('Status/Submission')
const p1 = await workflow('wf-01-status-submission')
if (p1?.stop) return p1

phase('Dataflow')
const p2 = await workflow('wf-02-explicit-dataflow', { previous: p1 })
if (p2?.stop) return p2

phase('Runtime Kernel')
const p3 = await workflow('wf-03-runtime-kernel', { previous: p2 })
if (p3?.stop) return p3

phase('Invocation/Harness')
const p4 = await workflow('wf-04-invocation-harness', { previous: p3 })
if (p4?.stop) return p4

phase('Control Modes')
const p5 = await workflow('wf-05-control-modes', { previous: p4 })
if (p5?.stop) return p5

phase('Workbench/Projection/Storage')
const p6 = await workflow('wf-06-workbench-projection-storage', { previous: p5 })
return { p1, p2, p3, p4, p5, p6 }
```

Note: saved workflows must be created separately as workflow scripts or run manually phase-by-phase. The master is a design pattern, not yet a saved executable registry entry.

## Open Decisions

Ask the user before aggressive deletion if a phase depends on any of these:

1. Must historical run/workflow/session data remain readable?
2. Should handoff `resume_session` / acceptance / human approval be implemented now?
3. Should ready-queue mode become default during control-mode convergence?
4. Should Workbench compile boundary live server-side, web-side, or mirrored by shared spec?
5. Are legacy GraphOps patch endpoints still supported API?
6. Should Codex app-server streaming join the first adapter harness extraction?
