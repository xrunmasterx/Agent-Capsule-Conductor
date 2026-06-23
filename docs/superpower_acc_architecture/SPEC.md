# ACC Superpower Architecture SPEC

生成日期: 2026-06-21

## 1. Product Definition

ACC（Agent Callable Conductor）是一个本地优先、轻量、高性能的编排运行时和 Workbench。它把成熟外部 agent、本地工具和子 workflow 包装成可复用 callable asset，并负责：

- callable / workflow 定义；
- runtime invocation；
- 控制决策与调度；
- 显式数据移动；
- 运行证据、artifact、result ref；
- server / Workbench 投影；
- 受治理的 workflow / callable mutation。

ACC 不实现自定义 LLM reasoning loop，不教 agent 如何工作，不把 UI state / SSE / polling / localStorage / raw browser canvas 当运行时真相。

## 2. Normative Principles

1. **ACC orchestrates; workers execute.** ACC 只准备输入、调度、记录证据、移动输出；外部 agent/tool/child workflow 拥有内部行为。
2. **Definitions are stateless.** `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate`、`NodeInvocationSpec` 不允许持有 run id、run dir、workspace binding、provider session、conversation memory 或 UI selection state。
3. **Invocations are run-scoped.** runtime identity 只存在于 `FunctionInvocation`、`ScopeFrame`、`SessionInstance`、`RunRecord`、events、ResultStore、artifact 和 projection evidence 中。
4. **Control authorization is not data movement.** control edge / decision 只决定能否执行；数据只能通过 workflow inputs、input bindings、data edges、result refs、artifact refs、inbox/outbox 或显式 snapshot input 移动。
5. **Agents are workflow-unaware.** agent 节点只收到声明的任务输入和显式 capability，不应感知自己处在 workflow、supervisor、handoff 或 human gate 中。
6. **One substrate, multiple control modes.** workflow、supervisor、handoff、human gate、nested workflow 都是同一 runtime substrate 上的 control strategies，不是多套执行器。
7. **Low coupling through ports.** 运行时组件通过显式 `ExecutionContext`、repository、recorder、binder、invocation port、event sink、projection invalidator 协作；禁止 ambient cwd、宽 façade、monkeypatch seam 作为目标设计。
8. **High concurrency by isolation.** node task 之间不得共享可变输出状态；node execution 返回不可变 `NodeExecutionResult`，由 scheduler 汇总。
9. **Evidence-first, projection-derived.** run-scoped evidence 是 durable truth；server DTO、run index、Workbench store、polling state、SSE stream 都是派生视图或传输。
10. **Compatibility is bounded.** legacy graph/YAML、schema alias、shim、implicit dataflow、duplicate status models 必须登记删除条件，不能成为第二套 canonical model。

## 3. Canonical Object Model

### 3.1 Definition-Time Objects

| Object | Role | Must | Must Not |
| --- | --- | --- | --- |
| `AgentClassTemplate` / `ToolClassTemplate` | 可复用 callable class 定义 | 声明行为、adapter/runtime policy、artifact contract、descriptive metadata、control policy | 持有 provider session、run id、run dir、workspace dir、conversation transcript、UI state |
| `WorkflowFunctionTemplate` | 可复用 workflow function body | 声明 workflow inputs/outputs、node specs、control edges、data edges、policies | 嵌入 runtime evidence、browser canvas truth、provider memory |
| `NodeInvocationSpec` | workflow function 内一个 call site | 声明 node id、callable ref、input/output binding、node control policy | 携带 session state、hidden predecessor payload、provider memory handle、mode-specific runtime state |
| `CallableRef` | callable target reference | 引用 typed callable id/version/kind | 引用 runtime result 或 session state |

### 3.2 Planning Objects

| Object | Role | Rules |
| --- | --- | --- |
| `ExecutionPlan` / `OrchestrationIntent` | engine 产生的纯语义计划 | 不拥有 filesystem path、run dir、mutable execution state；不得直接等同 ledger serialization。 |
| `ControlModeStrategy` | fixed/supervisor/handoff/human gate 策略接口 | 可 validate / authorize / declare inputs / emit decisions / resume；不得直接 invoke callable 或写 runtime files。 |

### 3.3 Runtime Objects

| Object | Role | Rules |
| --- | --- | --- |
| `ExecutionContext` / `ProjectContext` | 顶层运行上下文 | 从 CLI/server 显式传入，包含 project root、storage roots、environment policy、registry、workspace bindings、request identity。禁止用 `Path.cwd()` 替代。 |
| `FunctionInvocation` | 一次 workflow function 调用 | run-scoped；记录 invocation id、run id、workflow id、parent invocation、status、input payload、root scope。 |
| `ScopeFrame` | invocation runtime scope | 拥有 workspace root、environment root、inbox/outbox/artifact roots、behavior snapshot、parent frame、call depth。 |
| `SessionInstance` | 一次 agent/tool 执行 | 记录最小执行证据；标准投影不得把它整体暴露给 UI。 |
| `NodeExecutionResult` | 一个节点执行的不可变结果 | 包含 declared input refs、output refs、artifact refs、status、timing、diagnostics；由 scheduler 合并。 |
| `AdapterCapabilityEnvelope` | ACC 与外部 agent/tool 的窄边界 | 只暴露允许的 workspace capability、inbox/outbox handle、artifact handle、declared env keys、explicit result refs。 |

### 3.4 Control-Ledger Objects

| Object | Role | Rules |
| --- | --- | --- |
| `RunPlan` | run-level control plan evidence | 由 app/control-ledger adapter 从 abstract intent materialize。 |
| `PlanStep` | 可授权 dispatch unit | fixed/supervisor/handoff/human gate 使用同一模型。 |
| `DispatchEnvelope` | dispatch authorization/evidence envelope | 记录为什么允许执行，不携带 hidden data payload。 |
| `DecisionRecord` | human/system decision evidence | UI/API 只是 projection，不是 decision truth。 |

### 3.5 Projection Objects

| Object | Role | Rules |
| --- | --- | --- |
| `RunProjection` / `NodeInspectorProjection` / `LiveEventProjection` | Server-to-Workbench 稳定读模型 | 隐藏 raw storage layout；标准 UI 不解析 `runtime.json`、`binding_manifest.json`、session manifests。 |
| `AuthoringIntentProjection` | Workbench assistant 输入契约 | browser 发送 normalized intent / graph operation proposal；raw canvas snapshot 只作 debug/evidence。 |

## 4. Runtime Kernel Requirements

目标 runtime kernel 必须负责：

- run admission；
- plan-step registration；
- ready-set selection；
- bounded concurrency；
- dispatch authorization；
- node execution envelope construction；
- explicit data binding；
- evidence writes；
- failure / waiting / cancellation / finalization；
- projection invalidation or incremental update。

它不应该把这些责任集中在单个 transaction script 中。目标协作者：

```text
WorkflowSubmissionService
  -> RuntimeGraphPreparationService
  -> ExecutionContext
  -> Orchestrator
       -> Scheduler
       -> Binder
       -> RunRepository
       -> NodeExecutionRecorder
       -> ControlLedgerPort
       -> CallableInvocationPort
       -> ResultStorePort
       -> EventSink
       -> ProjectionInvalidator
```

## 5. Control Modes

### Fixed Workflow

- 编译静态 DAG；
- 通过 common scheduler 执行；
- control edges 只决定 readiness；
- data edges/bindings/result refs 决定 payload；
- nested workflow 是 callable node，不是特殊 opaque path。

### Supervisor

- supervisor 只产生或批准 `PlanStep` / `DecisionRecord` / explicit input binding；
- 不直接创建 node dir，不直接 invoke agent，不绕过 common executor；
- replay 使用 recorded decisions，不重新问 LLM；
- 当前 procedural supervisor path 是 deviation，必须收敛为 `ControlModeStrategy`。

### Handoff

- handoff 是 control decision + explicit context/result refs；
- 不等同 provider conversation continuation；
- `resume_session`、acceptance、human approval、timeout、fallback 都必须是 typed policy；
- receiving node 只看到声明输入和 capability。

### Human Gate

- human gate 是 node control policy；
- scheduler 在 dispatch 前暂停；
- approval/rejection 写 `DecisionRecord` 和 lifecycle transition；
- resume 走同一个 scheduler state machine，不使用 ad hoc mini-orchestrator。

## 6. Dataflow Rules

1. 没有 declared binding/result ref，就没有数据传递。
2. control predecessor output 不得自动成为下游 `main`。
3. supervisor/handoff snapshot 必须是 explicit snapshot input object 或 result ref。
4. provider conversation reuse 默认不构成数据输入；若要影响节点，必须声明 carry-forward input 或 session policy。
5. binding manifest 必须能解释节点收到的每个输入来自哪里。

## 7. Performance Rules

1. ordinary run mutation 不触发全仓库 storage index rebuild。
2. run summary 更新不同步重建所有 runs index。
3. SSE / live stream 以 event-driven / append-offset / cached topology 为目标；不得每 500ms 全量扫 run tree。
4. JSONL tail API 不得为了返回少量 tail 反复从头解析全部历史。
5. ResultStore projection 必须 metadata-first，只有调用方需要 payload 时才读取 blob/inline value。
6. node concurrency 不共享可变 output dict；scheduler 聚合 immutable result。

## 8. Compatibility Deviations

| Deviation | Current Evidence | Target |
| --- | --- | --- |
| open metadata 可携带 executable/runtime-like keys | `acc/models.py` 的 metadata / behavior_overlay；schemas 允许 open object | typed metadata + runtime policy；active loaders reject runtime/session/workspace/provider keys |
| implicit control-main forwarding | `acc/runtime/node_payload.py` control_main_default / aggregate | deprecate -> warn -> remove；只允许 explicit binding/result ref |
| broad adapter topology exposure | env/request 暴露 run/workspace/session ids/paths | `AdapterCapabilityEnvelope` |
| procedural supervisor/handoff | `acc/app/supervisor.py`、`acc/engine/handoff.py`、`dispatch_gate.py` dynamic overlay | `ControlModeStrategy` + common scheduler |
| resume mini-orchestrator | `dispatch_gate.py` rehydrate/replay | one scheduler state machine + RunRepository |
| duplicate run submission surfaces | runner/workflow route 双路径 | one `WorkflowSubmissionService` |
| full projection rebuild/polling | storage index rebuild, run SSE polling, nested JSONL parse | incremental projection + event driven |
| `core_v2_runtime` shim | wide re-export compatibility module | migrate imports, delete shim |

## 9. Acceptance Summary

本 SPEC 被视为满足，只有当：

- active docs 引用全部存在；
- stateless definition 和 explicit dataflow 有 schema/static/runtime proof；
- workflow/supervisor/handoff/human gate 共享 invocation substrate；
- adapters 默认不接收 raw ACC topology；
- Workbench 标准路径消费 projection；
- projection/storage hot path 不做 O(repository) 级联；
- duplicate status、submission、adapter process management 和 compatibility shim 有删除计划或已删除。
