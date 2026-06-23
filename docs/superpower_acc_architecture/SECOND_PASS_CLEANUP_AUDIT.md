# ACC Second-Pass Cleanup Audit

生成日期: 2026-06-21

## Purpose

本文件记录第二轮 `ultracode` 深度查漏补缺的核心观点。它服务于后续删减重构：把 ACC 从当前偏重、兼容债过多、路径分裂的实现，收敛为轻量、高性能、健壮、可扩展的本地 agent/tool/workflow 编排内核。

## First Principles

ACC 的本质复杂度只有这些：

```text
submit workflow/task
  -> validate canonical definition
  -> plan executable steps
  -> schedule concurrent nodes
  -> bind explicit inputs
  -> invoke external worker/tool/child workflow
  -> record evidence/results/artifacts
  -> expose projections/live updates
```

因此目标架构应是：

```text
WorkflowSubmissionService
  -> Strict Loader / Planner
  -> ControlModeStrategy
  -> Scheduler
  -> Binder
  -> CallableInvocationPort
  -> Filesystem Evidence Repository
  -> Projection Services
```

任何不服务于这条链路的东西，都必须被归类为：

- delete-ready；
- needs migration；
- consolidatable；
- active-design-not-dead。

## Executive Conclusion

当前 ACC 架构确实过重。过重的主要来源不是核心编排问题本身，而是：

1. old Core v2 / graph / YAML / run-dir / session-root compatibility 没有彻底退出；
2. workflow、runner、server route、Workbench 各自保留了局部 orchestration；
3. event、status、submission、projection、adapter、callable invocation 存在重复路径；
4. read-side repair / defensive fallback 把历史 schema 永久留在 steady-state runtime；
5. Workbench UI 和 backend runtime 之间缺少唯一 compiler/projection boundary；
6. storage/run/event projection 用 full rebuild、polling、whole-file parse 等方式放大成本。

目标不是继续增加大型抽象层，而是减少执行路径：

```text
one submission service
one status taxonomy
one scheduler continuation path
one binder
one callable invocation port
one evidence repository
one projection contract
bounded compatibility exits
```

## What Must Not Be Deleted Blindly

以下概念是 active architecture，应瘦身、端口化、收敛，不应粗暴删除：

- filesystem evidence truth；
- control ledger / decision evidence contract；
- GraphOps as durable mutation governance；
- human gate / supervisor / handoff concepts；
- Workbench authoring and projection capability。

正确动作：把它们放到窄接口后面，并删除重复/兼容/旧路径，而不是删除能力本身。

## Highest-Confidence Cleanup Areas

### 1. Compatibility and Tombstone Surfaces

Candidate targets:

- `acc/app/core_v2_runtime.py` — former God Module re-export shim；
- `acc/app/invocation.py` — dead-end `CallableInvocationService`；
- `acc/app/runtime/dispatch_gate.py` — live mini-orchestrator; late-delete only after scheduler resume exists；
- `acc/runtime/node_payload.py` control-main compatibility branches；
- legacy graph import stack；
- legacy session roots under `runs/_agent_sessions` and `runs/_authoring_sessions`；
- reader-side legacy event repair；
- legacy Workbench aliases and graph metadata heuristics；
- legacy GraphOps patch endpoints；
- `parse_legacy_run_dir` and run_dir-shaped inputs。

### 2. Duplicate Contracts

Consolidate:

- duplicated run status sets；
- duplicated workflow/runner submission wiring；
- duplicated callable invocation seams；
- duplicated adapter subprocess lifecycle；
- duplicated event projection/repair/read framing；
- duplicated storage/run index rebuild logic；
- duplicated workflow/callable reference discovery。

### 3. Heavy Runtime Transaction Scripts

Current hot spots:

- `acc/app/runtime/orchestrator.py`；
- `acc/app/runtime/executor.py`；
- `acc/app/runtime/scheduler.py`；
- `acc/app/run_lifecycle.py`；
- `acc/app/runtime/dispatch_gate.py`。

Target: move concrete side effects into `RunRepository` / `NodeExecutionRecorder`, but only when that movement deletes responsibilities rather than wrapping the same code in another layer.

### 4. Workbench / Projection / Storage Weight

Target cleanup:

- define one Workbench compile boundary；
- standard UI consumes projections, not raw manifests；
- live stream owns cursor/replay/gap semantics；
- polling is fallback/refetch only；
- ordinary writes use incremental projection/index updates；
- full rebuild remains repair command only。

## Safe Deletion Buckets

### Delete-Ready After Proof

- `acc/app/core_v2_runtime.py` after internal/external import search and boundary test update；
- `acc/app/invocation.py` after confirming no external consumers and `CallableInvocationPort` exists；
- duplicate tombstone tests after parametrization；
- default exposure of `ControlPlanePanel.tsx` after debug/admin route decision。

### Migrate Then Delete

- control-main implicit dataflow；
- `dispatch_gate.py`；
- legacy graph importer/CLI/tests；
- legacy session roots；
- reader-side event repair；
- Workbench legacy aliases；
- legacy GraphOps patch endpoints；
- path-shaped `run_dir` inputs。

### Consolidate Before Delete

- run statuses；
- submission services；
- callable invocation；
- adapter process lifecycle；
- event projections；
- storage/run index projection；
- route orchestration；
- ambient cwd/project-root lookup。

## Genuine Product Decisions

These decisions affect how aggressive deletion can be:

1. Must existing user run directories, saved workflows, and Workbench sidecars remain readable, or can they be migrated/dropped once?
2. Should handoff `resume_session`, acceptance, and human-approval semantics be implemented now, or remain explicitly unsupported until after scheduler resume is stable?
3. Should ready-queue mode become default during control-mode convergence, or should dual-mode stay until after `dispatch_gate.py` deletion?
4. Should Workbench compile boundary be server-only, web-only, or mirrored by a shared spec?
5. Are legacy GraphOps patch endpoints supported API, or can proposal APIs replace them fully?
6. Should Codex app-server streaming lifecycle join the first adapter harness extraction, or stay separate while one-shot adapters converge first?

Unless the user says otherwise, plans assume conservative migration first and deletion after proof.

## Plan Pack

Detailed Superpower refactor plans are in:

- `docs/superpowers/plans/2026-06-21-p0-freeze-and-prove-cleanup.md`
- `docs/superpowers/plans/2026-06-21-status-and-submission-canonicalization.md`
- `docs/superpowers/plans/2026-06-21-explicit-dataflow-and-evidence.md`
- `docs/superpowers/plans/2026-06-21-lightweight-runtime-kernel.md`
- `docs/superpowers/plans/2026-06-21-invocation-and-adapter-harness.md`
- `docs/superpowers/plans/2026-06-21-control-mode-scheduler-convergence.md`
- `docs/superpowers/plans/2026-06-21-workbench-projection-storage-graphops-cleanup.md`
