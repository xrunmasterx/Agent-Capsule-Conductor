# 复杂度热点

> 本文档记录 ACC 当前架构中属于 "复杂度热点" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 当前的复杂度热点集中在两类：一是单一函数承担过多职责（典型代表是 `execute_core_v2_node`，一个 165 行、跨三层关注点的整流式实现），二是同一概念被多个重叠的值对象重复表达（"Policy" 一词在 domain/schemas/runtime 三处至少对应六种不同语义，且部分容器字段三次重复）。这些热点本身并未破坏运行时行为——既有的 resolver、precedence 函数仍能正确工作——但显著抬高了维护成本：新增一个 policy 字段需要猜放在哪个容器，新增一个 node 失败分支需要在 125 行 try/except 中找到对的位置。它们对"轻量性"和"可演进性"目标构成持续侵蚀。本文档另收录一项 minor 级 stat-call 冗余问题，作为参考。

## 详细问题清单

### 1. [MAJOR] `execute_core_v2_node` 是一个 165 行、三层嵌套的巨型函数

**证据**:
- `acc/app/core_v2_runtime.py` (218-381) — 单一函数顺序执行：mkdir×2、写 4 份日志、append_event、构造 `SessionInstance`、写 manifest、`resolve_node_payload`、写 5 个文件、按 binding 循环 → append_event、执行 callable、写 output+artifact、按 port 循环、写 bundle、更新 session、append_event；随后是一个 38 行的 except 分支，重新构造 `SessionInstance` + `FailureRecord` + 写入 2 条路径 + append 日志 + append 事件。
- `acc/app/core_v2_runtime.py` (343-381) — except 分支以 `SessionInstance(**{**session.__dict__, 'status': 'failed', ...})` 形式重新构造 session，复制了 try 分支 (237-251) 中 completed_session 的构造逻辑。

**为什么是问题**: 该函数混合了三类彼此独立的关注点：(1) 节点目录的 scaffold 与 teardown；(2) payload 解析与 binding 物化；(3) callable 调度与 output 落盘。try/except 的覆盖范围跨 125 行，使失败路径难以推理。failed_session 与 completed_session 的并行构造意味着：未来给其中一个加字段时，另一个容易遗漏，存在分支漂移风险。

**建议**: 抽出三个子函数：`scaffold_node_dir(node_dir, node, invocation)` 负责目录与初始 manifest 写入；`execute_and_persist_output(...)` 负责核心执行与产物落盘；`handle_node_failure(exc, node_dir, ...)` 负责写失败记录并更新 manifest。每个单元收敛到 50 行以内，try/except 的边界变得直观，且各部分可独立测试。

**可行性 / 风险**: 纯结构性重构，不改变行为。中等工作量。主要风险点是共享变量 `session`（以及 `ended_at`）需要正确地在子函数之间传递。复核确认：该重构不破坏 AGENTS.md 中的任何不变量；问题描述与 line number 准确（±2 行内）；分支漂移风险确实存在但当前因 `**session.__dict__` spread 影响有限。

来源: performance-and-complexity / performance-and-complexity#7

---

### 2. [MAJOR] "Policy" 在系统中由 5+ 个语义重叠的值对象表达，且无成文的 precedence 文档

**证据**:
- `acc/domain.py` (171-198, 229-236, 307-312, 314-326) — `PermissionProfile`（workspace_access / network / shell / dangerous / env_policy / allowed_env / timeout_seconds）、`RuntimePolicy`（retry + timeout_seconds + permission_profile）、`CallableOverride`（retry + timeout_seconds + permission_profile）、`InvocationPolicy`（retry + TimeoutPolicy + permission_profile）—— 同一个 retry+timeout+permission_profile 三元组在三个不同容器名下重复出现三次。`CallDepthPolicy`（default_max_depth / allow_deeper_with_explicit_flag / recursion_guard）和 `RecursionPolicy`（allow_recursive / max_depth）则在"递归深度限制"这一同一关注点上语义重叠。
- `acc/schemas.py` (33-39, 51-72) — `AgentCapabilitiesSpec`（Pydantic）与 `AgentCapabilities`（domain.py L499 的 frozen dataclass）重复表达同一份 4 个布尔字段。`PermissionSpec`（sandbox / network / write_files / timeout_seconds / allow_dangerous）与 `PermissionProfile` 在概念上重叠，但**字段布局并不兼容**。
- `acc/runtime/transfer_policy.py` + `acc/app/supervisor.py` (module / 159-215) — `TransferPolicy`（REFERENCE / SYMLINK，含 Windows fallback）治理 port-IO 物化；`SupervisorRouter.check_dispatch_policy` 治理 dispatch 预算。两者都被称作 "policy" 但建模无关概念；与此同时，`InvocationPolicy / RuntimePolicy / CallableOverride` 不与任一者组合。

**为什么是问题**: permission、runtime、invocation、recursion、transfer、dispatch 六个 "policy" 概念被编码在 8 个以上值对象里：字段重叠、布局不兼容（`PermissionProfile` vs `PermissionSpec`）、retry+timeout+permission_profile 三元组重复三次。维护者新增一个 policy 字段时需要猜应放进哪个容器；调用方读取配置时需要猜哪一个是权威源。`AgentCapabilities` 与 `AgentCapabilitiesSpec` 也手工同步了同一份 4 字段定义两次。这是 ACC "运行时是如何被配置的" 类困惑的核心成因。

**建议**: 每一个关注点定义唯一的 canonical Policy 类型：
- `PermissionPolicy` —— 合并 `PermissionProfile` + `PermissionSpec`（择一 schema 并迁移）；
- `CapabilityPolicy` —— 合并 `AgentCapabilities` + `AgentCapabilitiesSpec`；
- `ExecutionPolicy` —— 作为 retry + timeout + recursion + depth 的唯一持有者，替代 `InvocationPolicy` + `RuntimePolicy` + `CallableOverride` + `CallDepthPolicy` + `RecursionPolicy`；
- `TransferPolicy` —— 已经隔离良好，保持原状。

precedence 写入一处文档：`callable_override > invocation_policy > runtime_policy`。删除 schemas.py 中的并行 Pydantic 副本，改为通过单一 `from_dict` 直接装入 dataclass。

**可行性 / 风险**: 概念上变更不大，但触及每一条 node-config 代码路径。复核给出三点重要修正，需在落地时纳入考虑：
- **关于 precedence**："zero documentation of precedence" 在源码层并不成立 —— `callable_runner.py` 中有 `effective_permission_profile`、`effective_timeout_seconds` 两个 resolver 函数已显式编码 `invocation_policy > overrides > runtime_policy > template` 的优先级。当前问题更准确地说是"resolver 散落在调用点、缺少集中文档"，而非"无 precedence"。
- **关于 PermissionSpec 是 active footgun**：复核确认 `PermissionSpec` 在生产路径中并未被调用，仅出现在 schemas.py 与其单测里，因此当前不会"静默丢字段"；但作为遗留 schema 仍构成长期的认知负担，建议清理。
- **关于 AgentCapabilities 的双胞胎**：domain dataclass 与 Pydantic spec 的分离是 parse-boundary 的有意设计，并有 `capabilities_from_mapping` adapter 衔接，并非偶然的平行编码；合并需考虑是否真的要抹平这一边界。

落地时最高杠杆动作是收口 `PermissionProfile` / `PermissionSpec`；其次是把三个 retry+timeout+permission 三元组合成单一 `ExecutionPolicy`，这一步本质上是一份 ADR（决定 per-node override / workflow defaults / callable-author defaults 的优先级）。`CallDepthPolicy` 经复核确认为 dead code（无调用方），`RecursionPolicy` 在 `engine/__init__.py:580` 被 `_ = ...` 显式丢弃，功能上等同于 dead，可直接删除。建议作为一个 feature branch 推进，作为一个 PR 提交。

来源: cross-cutting / cross#7

---

### 3. [MINOR] `write_core_v2_run_summary` 每节点 N 次 `.exists()` 检查，无批处理

**证据**:
- `acc/app/core_v2_runtime.py` (822-857) — `node_summary_from_session_manifest` 调用 `(node_dir / 'agent_payload.json').exists()`、`(node_dir / 'resolved_prompt.md').exists()`、`(node_dir / 'output.json').exists()`、`(node_dir / 'artifacts').exists()`、`(node_dir / 'events.jsonl').exists()`、`(node_dir / 'stdout.log').exists()`、`(node_dir / 'stderr.log').exists()` —— 每节点 7 次 stat。
- `acc/app/core_v2_runtime.py` (794-797) — `nodes = [node_summary_from_session_manifest(run_dir, node_id) for node_id in sorted(template.node_invocations) if (run_dir / 'nodes' / node_id / 'session_instance_manifest.json').exists()]` —— 每节点额外 1 次 `.exists()` guard。

**为什么是问题**: 对一个 N 节点的 workflow，理论上每次 `write_core_v2_run_summary` 调用会发出 8×N 次 `stat()` 系统调用，且该函数在每个 run 中被调用两次。被检查的部分路径（agent_payload.json、output.json、stdout.log、stderr.log）在 `execute_core_v2_node` 中刚被写入过，存在性其实由执行路径在结构上保证，重复 probe 是冗余的。

**建议**: 把已知路径（或一个 `NodeExecutionResult` 结构，记录哪些可选文件实际写入了）从 `execute_core_v2_node` 透传到 `node_summary_from_session_manifest`，消除 `.exists()` probe；或者把"已写文件"的标志位合入 `session_instance_manifest.json`，让一次 read 替代 7 次 stat。

**可行性 / 风险**: 复核认为该问题真实存在但范围与严重度均小于初始描述：
- 7 个 `.exists()` 中只有 4 个（stdout.log / stderr.log / events.jsonl / artifacts/）是真正冗余的（它们在 setup 阶段无条件写入）。其余 3 个（resolved_prompt.md、agent_payload.json、output.json）属于合理的防御式检查 —— resolved_prompt.md 在 hermetic 模式与 `workflow_function` callable 下不存在；agent_payload.json 与 output.json 在 early failure 时不存在。
- "8×N per call, called twice per run" 的描述具有误导性：第一次调用会在外层 guard 短路（彼时尚无 `session_instance_manifest.json`），内层 7 次检查根本不会触达。
- 透传 `NodeExecutionResult` 的方案需要穿过 `execute_core_v2_callable` → `execute_workflow_function_callable` → `execute_hermetic_callable` 等多种 callable kind 与嵌套 workflow 路径，实施成本较高。把已写入的标志位合入 `session_instance_manifest.json` 是更可行的备选，但仍需保留 hermetic / failure-path 的原有语义。

考虑到该问题为 minor，重构带来的维护成本可能超过节省 ~4 次 / node / run 的 stat 收益。建议暂缓，仅在该路径出现实际性能压力时再处理。

来源: performance-and-complexity / performance-and-complexity#12

## 整体建议

清理顺序建议按"杠杆 / 风险"排序：

1. **优先：Policy 类型收口（问题 #2）**。这是当前 ACC "运行时如何被配置"语义模糊的核心成因，且其中一部分（`CallDepthPolicy` 全死、`RecursionPolicy` 在 engine 入口被显式丢弃）可以以"删除 dead code"为切入点低风险落地，先回收 surface area。剩余的 `PermissionProfile / PermissionSpec` 收口和 `RuntimePolicy / InvocationPolicy / CallableOverride` 三元组合并应作为同一 feature branch 推进，并以一份 ADR 沉淀 precedence（即便 `effective_*` resolver 已隐式编码，仍需显式化为团队级约定）。

2. **次优先：`execute_core_v2_node` 三段式重构（问题 #1）**。纯结构性重构，无行为变化，且与问题 #2 的影响面不重叠（前者改 domain 类型、后者改 app 层执行流），两者可并行；但建议在 #2 的 Policy 类型稳定后再做，否则失败分支的 SessionInstance 重构需要二次返工。

3. **暂缓：`write_core_v2_run_summary` 的 stat 优化（问题 #3）**。属于真实但低收益的复杂度热点，建议仅在 metrics 显示该路径成为瓶颈、或在做 #1 的重构时顺便携带 `NodeExecutionResult` 时再一并处理。

#1 与 #2 在工程上彼此正交，可由不同人并行推进；#3 不应单独立项。
