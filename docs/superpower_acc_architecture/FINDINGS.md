# ACC Superpower Architecture FINDINGS

生成日期: 2026-06-21

本文件记录基于当前代码与 workflow 多智能体剖析得到的架构问题。严重级别含义：

- Critical：直接违背核心架构不变量，必须优先处理。
- High：会持续放大复杂度、性能成本或行为漂移。
- Medium：局部债务明显，应在相关阶段清理。
- Low：文档/命名/边界轻微问题。

## Executive Summary

当前 ACC 的产品意图是清晰的：本地优先、callable-first、stateless definitions、run-scoped evidence、projection-derived UI。但实现中仍存在五类结构性问题：

1. **控制模式未收敛**：fixed workflow 最成熟，supervisor/handoff/resume 仍有 procedural 或 replay path。
2. **数据边界被破坏**：control edge 仍可能隐式搬运数据，supervisor/handoff 也存在 snapshot/static_input 注入。
3. **运行时职责过宽**：orchestrator/executor/lifecycle/dispatch gate 仍承担过多 filesystem、ledger、projection 和 adapter 细节。
4. **投影与性能放大**：run stream polling、nested JSONL reparsing、storage index full rebuild、summary cascade 都会随 repo 规模放大。
5. **兼容债未关停**：legacy graph/YAML、schema alias、wide shim、duplicate statuses、duplicate submission surfaces 让系统继续维持多套心智模型。

## Critical Findings

### F-CRIT-01 — Control flow still creates hidden data flow

**Category:** state / dataflow  
**Evidence:**

- `docs/architecture/00-constitution.md` 已把 control/data 分离列为不变量。
- `acc/runtime/node_payload.py` 的 `control_main_default` / `control_main_aggregate` 会在无显式 `main` input 时从控制前驱自动注入 payload。
- `acc/engine/control_flow.py` 定义了控制边默认转发 main output 的兼容语义。
- `acc/app/runtime/dispatch_gate.py` 为 supervisor/handoff 重建 node 时可能把 snapshot ref 写入 `CallableOverride.static_input`。

**Why bad:**

这使数据可以在未声明 data edge/input binding/result ref 的情况下进入下游 agent，破坏可审计性、可复现性和“agent 节点只看声明输入”的目标。

**Target design:**

control edge 只授权或排序执行；所有数据移动必须通过 workflow input、data edge、input binding、result ref、artifact ref 或显式 snapshot input。

**Remediation:**

1. 将 implicit control-main 标为 compatibility-only，并在 binding manifest 中记录 warning。
2. 为 supervisor/handoff snapshot 引入 explicit snapshot input object。
3. 新增测试：没有 binding 时下游不得收到前驱输出。
4. 删除 `control_main_default` / `control_main_aggregate`。

## High Findings

### F-HIGH-01 — Control-mode convergence is incomplete

**Evidence:**

- `docs/CURRENT_ARCHITECTURE.md` 说明 fixed workflow 最成熟，supervisor/handoff/human gate 尚未完全收敛。
- `acc/app/runtime/dispatch_gate.py` 通过重建 template/node overlay 执行 resume/dynamic steps。
- `acc/app/supervisor.py` 仍保留 procedural execution seam。
- `acc/engine/handoff.py` P0 仍拒绝 `resume_session` 和 human-approval/acceptance 等能力。

**Impact:**

系统名义上宣称 workflow/supervisor/handoff 是同一 substrate 上的策略，但实际路径仍分裂。

**Remediation:**

定义 `ControlModeStrategy`，让 fixed/human/supervisor/handoff 都只产出 authorization、PlanStep、DecisionRecord、explicit inputs，由 common scheduler/executor 调度。

### F-HIGH-02 — Runtime orchestrator/executor remain transaction scripts

**Evidence:**

- `acc/app/runtime/orchestrator.py` 同时加载模板、创建 invocation/scope、准备目录、写 manifest、初始化 ledger、驱动 scheduler、写 summary。
- `acc/app/runtime/executor.py` 同时创建 node dir/log、resolve payload、写 runtime/input/binding manifest、dispatch callable、写 result store、artifact bundle、failure record。

**Impact:**

职责聚合导致任何一个 evidence/storage/adapter 变化都影响 hot path，难以替换存储、测试状态转换或优化性能。

**Remediation:**

引入 `RunRepository`、`NodeExecutionRecorder`、`Binder`、`CallableInvocationPort`、`EventSink`，让 orchestrator 只做 composition，让 executor 只协调 node execution。

### F-HIGH-03 — Adapter boundary exposes ambient ACC topology

**Evidence:**

- adapter env/request 暴露 `ACC_RUN_DIR`、`ACC_NODE_ID`、`ACC_RUN_ID`、workspace/run paths、session/provider ids。
- `SessionInstance` 持久化 cwd、env keys、file paths。

**Impact:**

agent/tool 可以感知 ACC 内部拓扑和控制模式，甚至依赖 run layout，违背 workflow-unaware node 目标。

**Remediation:**

引入 `AdapterCapabilityEnvelope`，默认只给 declared inputs、artifact handles、workspace capability、approved env；raw paths 进入 debug/evidence surface，而非 agent default contract。

### F-HIGH-04 — Open metadata allows runtime/provider state in definitions

**Evidence:**

- `AgentClassTemplate.metadata`、`ToolClassTemplate.metadata`、`NodeInvocationSpec.metadata`、`WorkflowFunctionTemplate.metadata`、`CallableOverride.behavior_overlay` 是 open dict。
- schemas 对 metadata/open overlay 无键约束。
- runtime 读取 metadata 中的 model、reasoning_effort、command、execution knobs。

**Impact:**

定义时对象可以悄悄携带 runtime/provider/workspace/conversation 语义，破坏 stateless definition 不变量。

**Remediation:**

拆分 typed structures：descriptive metadata、runtime policy、adapter policy、artifact contract、control policy、migration-only legacy fields；active loaders 拒绝 runtime-like metadata keys。

### F-HIGH-05 — Storage/projection update path amplifies small mutations

**Evidence:**

- `acc/storage_refresh.py` 普通 dirty marker 触发 `rebuild_storage_index_best_effort`。
- `acc/storage_index.py` rebuild 扫描 runs/tasks/sessions/artifacts/graphops/trash/gc/runner jobs 并 delete+insert 全表。
- `acc/app/runtime/workflow_io.py` summary write 触发 run index rebuild 和 storage refresh。

**Impact:**

O(1) run mutation 变成 O(repository) IO/JSON/SQLite 工作，长时间运行后性能会明显恶化。

**Remediation:**

改为 object_ref/run_id 粒度 incremental upsert/delete，dirty journal 批处理，full rebuild 仅维护/修复时执行。

### F-HIGH-06 — Run streaming polls and reparses too much

**Evidence:**

- run SSE stream 每 500ms 扫 node identities、读取 log delta、agent events、summary。
- nested event APIs 递归读取 nested workflow event logs，常从头 parse JSONL 再取 tail。

**Impact:**

每个客户端成本随 node 数、nested 深度、历史事件数增长，而不是随新增事件数增长。

**Remediation:**

缓存 per-stream topology 和 runtime metadata；用 append offset / watcher / publish bus；维护 nested event fan-in 或 tail index。

### F-HIGH-07 — Duplicate status taxonomies are inconsistent

**Evidence:**

- `acc/app/run_lifecycle.py`、`acc/server/routes/runs.py`、`acc/cloud_sync.py`、`acc/storage_gc.py` 各自定义 terminal/active status set。
- `timeout` 在不同模块中 terminal 语义不一致。

**Impact:**

cleanup、polling、cloud sync、UI terminal 判断可能漂移。

**Remediation:**

创建唯一 run-status module；区分 run status、plan-step status、adapter status、provider event status、agent-turn status，并定义转换表。

### F-HIGH-08 — Duplicate run submission surfaces

**Evidence:**

- runner routes 和 workflow routes 都做 run claiming、runtime graph preparation、manager submission、receipt creation。

**Impact:**

两个入口会在 validation、projection、receipt、error semantics 上漂移。

**Remediation:**

创建一个 `WorkflowSubmissionService`，routes 只做 transport wrapper。

## Medium Findings

### F-MED-01 — `core_v2_runtime` shim preserves obsolete module boundary

Wide re-export shim 让旧 God Module 入口继续存在，隐藏新 runtime decomposition。迁移所有 imports 后删除。

### F-MED-02 — Agent execution ownership fragmented

`AgentTurnService`、`CallableClassRunner`、`CallableInvocationService`、hermetic branch、nested workflow branch 分散处理 prompt/schema/permission/adapter/session。应统一到 `CallableInvocationPort`。

### F-MED-03 — Adapter process lifecycle duplicated

`generic_cli`、`codex_cli`、`codex_app_server` 重复 subprocess lifecycle、timeout/cancel/log/output 逻辑。应提取 shared `AdapterProcessHarness`。

### F-MED-04 — Ambient cwd as hidden service locator

`acc/app/__init__.py`、nested workflow resolution、executor fallback 使用 `Path.cwd()` 推断 project root/registry。应改为 top-down `ExecutionContext`。

### F-MED-05 — Workbench assistant persists raw UI/session context

browser 提交 canvas_snapshot/selection/context snapshot 并作为 agent prompt context。应规范为 `AuthoringIntentProjection` / graph operation proposal；raw snapshot 只作 debug evidence。

### F-MED-06 — Provider-side conversation state reused implicitly

provider_session/threadId 持久化并恢复会让执行语义依赖 opaque provider memory。应变成 explicit session policy，workflow-bound nodes 默认关闭或要求 declared carry-forward input。

### F-MED-07 — ResultStore projection reparses manifests

RunProjection list nodes 时重复打开/解析 result manifests。应 metadata-first、batch load、payload lazy materialization。

## Healthy Patterns to Preserve

- ACC 不拥有自定义 LLM loop 的产品边界已经清晰。
- fixed workflow 的 template -> plan -> invocation -> scope -> scheduler/executor -> evidence 路径已基本形成。
- engine validation/plan compilation 相对纯净，是良好 seam。
- nested workflow 已使用 FunctionInvocation/ScopeFrame/call_depth，而不是完全特殊机制。
- human gate 已作为 node control policy + ledger-backed waiting，而非 UI-only state。
- ResultStore/evidence-first 模型方向正确，只需要收敛性能与边界。
