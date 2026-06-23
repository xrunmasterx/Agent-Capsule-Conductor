# ACC Lightweight Refactor Plan Pack

生成日期: 2026-06-21

## Purpose

本文件是后续使用 workflow 模式执行重构的总索引。每个 plan 都遵循 Superpower 风格：先证明，再迁移，再删除；每个阶段只处理一个架构维度，避免一次性大爆炸重构。

## First-Principles Target

最终 ACC 应收敛为：

```text
WorkflowSubmissionService
  -> Strict Loader / Planner
  -> ControlModeStrategy
  -> Scheduler
  -> Binder
  -> CallableInvocationPort
  -> RunRepository / NodeExecutionRecorder
  -> Projection Services
```

核心原则：

1. ACC orchestrates; workers execute.
2. Definitions are stateless; invocations are run-scoped.
3. Control authorization is not data movement.
4. Agents are workflow-unaware.
5. One substrate, multiple control modes.
6. Runtime evidence is truth; UI/server are projections.
7. Compatibility is bounded and deletable.
8. New abstraction is allowed only when it removes responsibility or prevents invalid state.

## Execution Order

| Order | Plan | Theme |
| --- | --- | --- |
| 0 | `2026-06-21-p0-freeze-and-prove-cleanup.md` | Freeze invariants and add proof gates before deletion. |
| 1 | `2026-06-21-status-and-submission-canonicalization.md` | One status taxonomy and one submission service. |
| 2 | `2026-06-21-explicit-dataflow-and-evidence.md` | Delete hidden dataflow by making bindings/evidence explicit. |
| 3 | `2026-06-21-lightweight-runtime-kernel.md` | ExecutionContext, repository/recorder, NodeExecutionResult. |
| 4 | `2026-06-21-invocation-and-adapter-harness.md` | One callable invocation boundary and shared adapter harness. |
| 5 | `2026-06-21-control-mode-scheduler-convergence.md` | Human gate, supervisor, handoff over one scheduler continuation path. |
| 6 | `2026-06-21-workbench-projection-storage-graphops-cleanup.md` | Projection-first Workbench, live event contract, storage/index cleanup, legacy GraphOps retirement. |

## Deletion Strategy

- **Delete-ready after proof:** shims, dead services, tombstone tests, debug UI exposure.
- **Migrate then delete:** implicit dataflow, dispatch gate, legacy graph/session/event/run_dir paths.
- **Consolidate then delete:** status, submission, invocation, adapter lifecycle, event projection, storage index, route orchestration.
- **Do not blindly delete:** evidence model, control ledger contract, GraphOps governance, human/supervisor/handoff concepts.

## How to Use With Workflow Mode

For each plan:

1. Launch an understanding/audit workflow over the listed `Must read` files.
2. Generate a concrete code-change plan with proof tests first.
3. Apply one small track only.
4. Run the focused validation commands in the plan.
5. Update `docs/problem/RESOLUTION_MATRIX.md` or relevant Superpower docs with fixed/stale/deferred evidence.
6. Only then proceed to the next plan.

## Workflow Suite Design

后续按 workflow 模式执行时，使用以下 orchestration suite 作为设计依据：

```text
docs/superpowers/workflows/2026-06-21-acc-lightweight-refactor-workflow-suite.md
```

该 suite 定义了 master workflow、六个 phase workflows、每个 phase 的 agents、inputs、outputs、stop conditions、validation 和 handoff protocol。

## Open Product Decisions

Before aggressive deletion, decide:

- whether historical run/workflow/session data must remain readable;
- whether handoff resume/acceptance is in-scope now;
- whether ready-queue mode should become default;
- whether Workbench compile boundary is server-only or mirrored with TypeScript specs;
- whether legacy GraphOps patch API is still supported;
- whether streaming app-server adapter should join the first process harness extraction.
