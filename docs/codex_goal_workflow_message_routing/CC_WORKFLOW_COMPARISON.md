> 文档状态: v0.1 分析报告（基于 dynamic workflows 在本会话中的工具规范 + 公开材料检索 + DESIGN.md v0.2）
> 用途: 横向对比、回答"当前 DESIGN 是否最适合 ACC"的问题
> 不替代 DESIGN.md，仅作为评估附件

# ACC vs Claude Code Workflow 信息传递机制对比与适配度评估

本文从"信息传递（message routing / state passing）"这一第一性维度出发，将 ACC v0.2 推荐方案 `Binding-First Result Store with Layered Provenance` 与 Claude Code（下称 CC）dynamic workflow 做横向比对，回答两个问题：

1. ACC 当前 DESIGN.md 是否在该维度上做出了正确的设计选择？
2. CC workflow 还有哪些思想可以在不破坏 ACC 定位（异构 agent + 声明式 .accflow.json + Workbench 可视化）的前提下被借鉴？

> **术语约定**：本文将明确区分「代码事实/工具规范引用」（confidence=high/medium 的 RECON 事实）与「推断」（标注 *推断* 字样）。CC workflow 的内部实现细节仅引用公开规范与 RECON high/medium 事实，不做反编译式编造。

---

## 1. 研究问题与方法

**研究问题**：在"编排者如何把信息从一个 agent 传递到下一个 agent"这一第一性维度上，ACC v0.2 推荐方案与 CC dynamic workflow 是否同构？哪些差异是 ACC 三大约束（异构 agent / 声明式 / Workbench）必然推导出的？还有哪些 CC 思想可以低风险借鉴？

**方法**：

1. 从 ACC `DESIGN.md v0.2` 中提取推荐方案的 12 个关键不变量（AC1–AC6 + ProvenanceObject 分层 + binding_mode/prompt_appendix_policy 三档 + WorkflowCallInputBinding 嵌套）。
2. 从 CC dynamic workflow 工具规范（Agent tool prompt / StructuredOutput / parallel / phase / resume cache 等）中提取对应不变量。
3. 沿 12 个维度（编排者中间状态位置 / 父对话可见性 / agent 间通道 / 输出契约 / 异构性 / 声明式 vs 命令式 / 可视化 / 可寻址性 / resume / 并发隔离 / 副作用边界 / 可保存性）做 side-by-side 比对。
4. 把差异标记为 `identical / similar / diverge_intentionally / diverge_due_to_constraint`，对每条 `diverge_*` 条目逐一检查"是否被 ACC 三大约束所必然要求"。
5. 综合得到 `verdict + 借鉴清单 + 必须分歧清单 + DESIGN.md 缺口清单 + 行动项`。

**confidence caveat**：CC workflow 的 `agent() opts` 全字段、`StructuredOutput` 校验失败处理、`resume cache` 命中判定函数等内部实现无官方公开 schema；本报告 CC 侧描述均基于 RECON high/medium 事实与 [code.claude.com 公开文档](https://code.claude.com/docs)，**未做反编译或 sandbox 实验**。所有 ACC 侧描述以 `DESIGN.md` 当前版本为准；如本文 §N.M 引用与原文档章节号不一致，应以原文档为准。

---

## 2. Claude Code workflow 信息传递机制（基于公开规范）

以下为 CC dynamic workflow 在"信息传递"维度上的核心不变量（confidence=high/medium）：

- **编排中间状态位于 JS 闭包变量**：workflow 脚本本身是一段 JavaScript，`await agent(...)`、`parallel([...])`、`phase(...)` 的返回值通过 JS 局部变量持有，仅在脚本生命周期内有效。脚本结束时整体 `return` 给编排器作为最终输出。
- **subagent 起 fresh conversation**：subagent 不继承父对话历史，其输入完全来自编排者通过模板字符串显式构造的 `prompt` 参数。
- **subagent 之间无直接通道**：所有跨 agent 数据流必须经编排者 JS 变量中转；脚本中将上一次 `agent()` 返回值序列化进下一次 `agent()` 的 `prompt` 字符串。Agent Teams 的 `mailbox/SendMessage` 仅作为实验特性存在，不属于默认 dynamic workflow API。
- **输出契约 = StructuredOutput JSON**：`agent()` 调用通过 `opts.schema` 强约束最终返回值为单一 JSON 对象；agent 在执行过程中产生的工具副作用文件不进入编排者返回值。
- **副作用边界**：workflow 脚本本身**不具备** filesystem / shell 访问能力；任何文件/网络副作用必须由 agent 通过其工具调用发起。
- **resume / cache 仅同 session**：同一 Claude Code session 内 workflow 可 resume，已完成 agent 命中 cache 跳过；exit Claude Code 后，**跨 session 必须重跑**。
- **并发**：每 subagent 独立 context；最多 16 并发，单 run 累计 1000 个 agent。
- **可观测性**：`/workflows` 面板可观测运行；workflow 脚本本身是 `.js` 文件，没有图形化编辑器；运行时通过 `Ctrl+G` 查看脚本（*推断：UX 入口名称按 RECON 描述记录，未做反向校验*）。
- **可保存性**：workflow 是 `.js` 文件，需 `v2.1.154+`，`allowedTools` 必须含 `Workflow`。

> *推断*：`agent()` 默认使用 Claude API，`agentType` 影响角色但 LLM provider 维度未在脚本 API 中暴露——这意味着 CC workflow 在"异构 LLM provider"上不是一等公民。

> *confidence caveat*：Anthropic 工程博客提到的 "multi-agent token 消耗 ~15×" 数据源自 Claude.ai Research 产品而非 Claude Code Workflow 本身，不可直接外推到 ACC 异构 agent 场景。

---

## 3. ACC DESIGN.md 当前推荐方案信息传递机制

`DESIGN.md v0.2` 推荐方案 `Binding-First Result Store with Layered Provenance` 在"信息传递"维度的核心不变量：

- **disk-as-truth**：编排中间状态全部落于 `runs/<run_id>/nodes/<node_id>/outbox/` 与 `run_manifest.json`，事件流以 append-only `events.jsonl` 串行化。
- **NodeResult 全局可寻址**：`(run_id, node_id, port_id) → ArtifactBundle`；`BindingResolver` 通过该三元组解析 binding。
- **agent-visible 由 binding 唯一决定（AC2）**：`explicit_only` 模式下 agent 只看到 binding 声明的输入，不继承父对话历史；`mixed` / `legacy_full` 模式向下兼容，给 legacy 工作流渐进迁移空间。
- **runtime_payload vs agent_payload 分层（AC3）**：`ProvenanceObject` 等 runtime-only 元数据默认不进 prompt；通过 `acc_expose_*` 白名单 opt-in 暴露。
- **5 类 Binding 声明式表达**：`InputBinding / OutputBinding / WorkflowOutputBinding / WorkflowCallInputBinding / ParameterBinding`；`ControlEdge` 与 `DataEdge` 严格分离，readiness 由控制边推导。
- **跨 run 物理隔离 + 引用断言双保险（AC5）**：每 run 独立 `runs/<run_id>/` 子目录树；`BindingResolver` 在 runtime 断言 source `run_id == 当前 run_id`。
- **跨 session resume（AC6）**：`run_manifest.completed_nodes` + `binding_materializations` 显式 checkpoint；resume 仅信本 run checkpoint。
- **嵌套工作流**：`WorkflowCallInputBinding` + `ScopeFrame.parent_frame_id / call_depth` 支持工作流作为可复用模块。
- **声明式可保存**：`.accflow.json` 是节点 + 边 + binding 的静态描述；Workbench 可视化拖拽编辑、版本化 diff、non-Claude 用户编排。
- **三档可见性渐进迁移**：workflow 级 `binding_mode`（`explicit_only / mixed / legacy_full`）+ capsule 级 `prompt_appendix_policy`（三档），允许在不破坏存量工作流前提下推进。

---

## 4. 横向对比表

| 维度 | CC workflow | ACC DESIGN.md v0.2 | 关系 | 备注 |
|---|---|---|---|---|
| (a) 编排者中间状态位置 | JS 闭包内存变量（脚本生命周期） | disk-as-truth：`runs/<run_id>/nodes/<node_id>/outbox/` + `run_manifest.json` + `events.jsonl` | diverge_intentionally | ACC 必须落盘以支持声明式存档、可视化回放、跨 session resume 与异构协作 |
| (b) agent 是否看到父对话历史 | 否，subagent 起 fresh conversation | `explicit_only` 模式下不可见；`mixed`/`legacy_full` 向下兼容 | identical | 两者本质同构：从隐式继承改成编排者显式注入 |
| (c) agent 间通信路径 | 无直接通道，必须经编排者 JS 变量中转 | 无直接通道，必须经 `BindingResolver` 解析 `(run_id,node_id,port_id)` | identical | 都禁止 sibling-to-sibling 隐式可见，orchestrator-mediated |
| (d) 输出契约 | `StructuredOutput` 按 `opts.schema` 强约束 JSON 返回值 | `ArtifactBundle` 写 `outbox/`，schema 强制不在 runtime 层（依赖 binding 声明 + capsule 自检） | diverge_due_to_constraint | ACC 异构 agent + 多文件资产无法收敛为单一 JSON |
| (e) 异构 agent 支持 | 默认 Claude API；`agentType` 影响角色，LLM provider 维度未暴露 | 一等公民：capsule 类型可对应不同 LLM 提供者 / 工具链 / 本地脚本 | diverge_intentionally | ACC 核心定位之一 |
| (f) 声明式 vs 命令式 | 命令式 JS：`await agent()/parallel()/phase()` | 声明式 `.accflow.json`：节点 + ControlEdge + DataEdge + 5 类 Binding | diverge_intentionally | ACC 选声明式以支持保存 / diff / 可视化编辑 |
| (g) 可视化操作支持 | `/workflows` 面板观测；脚本是 `.js` 文件，无图编辑器 | Workbench 一等公民：可视化拖拽 + 运行面板 + `events.jsonl` 回放 | diverge_intentionally | Workbench 是 ACC 核心哲学 |
| (h) 中间状态可寻址性 | 仅脚本内 JS 变量名引用，外部工具无法稳定寻址 | `(run_id, node_id, port_id)` 全局唯一寻址 ArtifactBundle | diverge_intentionally | 可寻址性服务可视化 / 审计 / 回放 |
| (i) resume / cache 机制 | 同 session 内可 resume；跨 session 必须重跑 | 跨 session resume：`run_manifest.completed_nodes` + `binding_materializations` 显式 checkpoint | diverge_intentionally | ACC 因 disk-as-truth 自然获得跨 session resume |
| (j) 并发隔离机制 | 每 subagent 独立 context；最多 16 并发 / 单 run 1000 | 每 run 独立 `runs/<run_id>/` 子目录 + `WorkbenchRunManager` + AC5 引用断言 | similar | 原理同构（物理 + 引用双保险），ACC 多一层目录隔离 |
| (k) 副作用与文件系统访问 | 脚本无 fs/shell；副作用必须由 agent 工具发起 | 节点（capsule）通过 outbox 写文件是 first-class；编排器（runtime）也参与物化 | diverge_due_to_constraint | ACC 异构 agent 必须直接产文件资产 |
| (l) 开发者入口与可保存性 | `.js` 脚本 + `v2.1.154+` + `allowedTools` 含 `Workflow` | `.accflow.json` + Workbench 编辑 + capsule 库；non-Claude 用户也能编排 | diverge_intentionally | ACC 必须可保存可分发 |

---

## 5. 适配度评估

⭐ **Verdict: well_fit — design_is_close_minor_patches**

在"信息传递"第一性层面，ACC 与 CC workflow 收敛到同一组核心不变量：

1. **agent 不继承父对话历史**（CC fresh conversation ≡ ACC AC2 `explicit_only`）
2. **编排者显式构造 agent 输入**（CC 模板字符串 ≡ ACC binding-driven `agent_payload`）
3. **agent 之间无直接通道**（CC JS 变量中转 ≡ ACC `BindingResolver` 中转）
4. **编排中间状态在 agent context 之外**（CC JS 闭包 ≡ ACC `runtime_payload` / outbox / `ProvenanceObject`）

ACC 在 `disk-as-truth / 声明式 / 异构 / 跨 session resume / 可视化` 维度的所有发散，都是异构 agent + 声明式 .accflow.json + Workbench 三大约束的**必然推论**，**不是设计欠考虑**。ACC 还多出 CC workflow 没有的能力：

- 跨 session resume（CC 必须重跑）
- 全局 NodeResult 可寻址（CC 仅 JS 变量名）
- Workbench 可视化编辑 + 回放（CC 仅运行面板）
- ProvenanceObject 分层 + opt-in 白名单（CC 没有 runtime-only 元数据分层概念）

**剩余开放项（DESIGN.md §15.12 / §15.13 / §15.14 / §15.15 等）属于边角细化，不影响主轴。** 本评估的结论是 ACC 当前 DESIGN.md 在"信息传递"维度上**与 CC 同源 + 因约束理性发散**，不需要架构级返工，仅需 minor patches。

---

## 6. ACC 借鉴得好的 CC workflow 思想

按"是否完整复刻了 CC workflow 第一性原则"的标准，以下四项 ACC 已做到：

1. **"agent 输入由编排者显式注入而非继承父对话"**：被 binding-driven `agent_payload` 完整复刻（AC2）。
2. **"agent 之间无直接通信，全部经编排者中转"**：被 `BindingResolver` + 禁止 sibling outbox 跨读完整复刻（AC5）。
3. **"编排中间状态不污染 agent context"**：被 `runtime_payload` vs `agent_payload` 分层 + `ProvenanceObject` runtime-only 实现（AC3）。
4. **"fresh context + 显式注入"式 isolation 模型**：被 `explicit_only` 模式 + `acc_expose_*` opt-in 白名单复刻；ACC 还多出三档可见性渐进迁移设计，比 CC 一步到位的 fresh context 更适合存量场景。

---

## 7. ACC 故意没借鉴、且决策正确的部分

下列 CC workflow 设计点 ACC 故意没有照搬，且每条都有约束级的正当理由：

1. **JS 闭包持有中间状态**：ACC 必须落盘以支持 `.accflow.json` 声明式可保存、Workbench 可视化回放、跨 session resume；闭包不可序列化、不可可视化、不能被 non-Claude 用户消费。
2. **StructuredOutput 单一 schema 强约束**：ACC 异构 agent（图片生成 / 音频 / 外部工具 / 本地脚本）输出天然多形态资产，必须用 `ArtifactBundle` 文件契约；强行 schema-only 会切掉资产保存能力。
3. **命令式 JS 编排（`await agent()/parallel()`）**：ACC 选 `.accflow.json` 声明式以支持 Workbench 拖拽编辑、版本化 diff、non-Claude 用户编排；把控制流锁进 JS 会破坏这三个目标。
4. **"脚本本身无 filesystem/shell"**：CC 把副作用全推给 agent 是因为单 LLM 进程足够；ACC 异构 capsule 必须直接产文件资产，编排器 runtime 也参与物化（reference / symlink / copy）。
5. **"Agent 不能 spawn agent"**：ACC 已通过 `ScopeFrame.parent_frame_id / call_depth` 支持工作流嵌套调用（`WorkflowCallInputBinding`），这是 Workbench 模块化复用的基础；CC 的禁止规则不适用于 ACC。

---

## 8. 仍可安全借鉴的部分（不破坏 ACC 定位）

下列 CC 思想在不动摇 ACC 三大约束的前提下，可以低风险纳入 DESIGN.md：

1. **并发与总量硬限的显式数字声明**
   - *why_safe*：纯运行时配额，与异构 / 声明式 / Workbench 三大约束都正交。
   - *how_to_apply*：在 `§11.1 WorkbenchRunManager` 段落补一节"并发与总量上限"——`max_concurrent_nodes_per_run` / `max_total_nodes_per_run` / `max_active_runs`，给默认值并说明触发后行为（拒绝排队 / 失败 / 软限警告）。

2. **NodeCacheKey 显式定义**
   - *why_safe*：ACC 已有 `run_manifest.completed_nodes` + `binding_materializations`，本质就是 cache 表；只是缺一个"相同 `(binding_inputs_sha256, capsule_version)` 命中即跳过"的明确表述。
   - *how_to_apply*：在 `§11.2` 加一段：`NodeCacheKey = sha256(capsule_id + capsule_version + ordered binding_inputs_sha256)`；resume 时优先命中；新 run 默认不跨 run 命中（与 AC5 一致）。

3. **`invoking_workflow_call_id` 字段（嵌套追踪）**
   - *why_safe*：ACC 已有 `parent_frame_id / call_depth`，再补一个 caller-side 的 binding 调用点 ID 即可；纯 runtime-only，不出现在 `agent_payload`，不破坏 AC3。
   - *how_to_apply*：`§7.2 ProvenanceObject` 字段表新增 `invoking_workflow_call_id?: str`；事件流同步加一个对应字段；不进 `input.json / resolved_prompt.md`。

4. **`Approve the plan before it runs`（PlanPreview）**
   - *why_safe*：纯 UX/Workbench 层增强，对 runtime 不变；与 `§11.3 approval barrier` 同源但作用于"整个 plan"。
   - *how_to_apply*：Workbench `Run` 按钮触发后先生成 `PlanPreview`（节点拓扑 + 所有 binding 解析结果 + materialization mode），用户确认后写 `run_manifest` 并进入实际执行。

5. **内置 aggregation capsule 作为 final summary**
   - *why_safe*：把"谁是 workflow 最终输出"从启发式（最后一个无下游节点）改成显式声明，与 binding-first 哲学一致。
   - *how_to_apply*：`§13 Phase 3` 补充内置 `capsule type=acc.aggregation`，仅消费 `WorkflowOutputBinding`，写 final summary 到 run 根；`§15.3` 直接收敛为"是"。

---

## 9. 必须分歧的部分

下列差异不可借鉴 CC 做法，否则会破坏 ACC 定位：

1. **中间状态必须落盘而非闭包变量** — `.accflow.json` 声明式可保存 + Workbench 可视化 + 跨 session resume + 异构 agent 文件资产，四个约束任一都强制 disk-as-truth。
2. **节点输出必须是 ArtifactBundle 文件契约而非 StructuredOutput JSON** — 异构 agent 产出图片/音频/PDF/外部脚本结果，schema-only JSON 无法承载；`binding selector` 也需要稳定 `(run_id,node_id,port_id)` 寻址路径。
3. **工作流描述必须声明式而非命令式 JS** — Workbench 拖拽编辑、版本化 diff、non-Claude 用户编排都要求"描述"与"解释器"解耦，命令式 JS 把控制流锁死在 Claude 端。
4. **编排器（runtime）参与文件物化（reference / symlink / copy）** — 异构 capsule 输出物千差万别，必须由 runtime 统一执行 binding materialization 策略；不能像 CC 把副作用全推给 agent。
5. **工作流嵌套调用（`WorkflowCallInputBinding` + `ScopeFrame`）必须支持** — Workbench 哲学要求"工作流即可复用模块"；CC 明确禁止 subagent spawn subagent，ACC 不能照搬。
6. **agent-visible 必须有三档可见性** — ACC 要在不破坏 legacy 工作流前提下渐进迁移；CC 是新生 API 不背包袱，可以一步到位 fresh context。

---

## 10. 当前 DESIGN.md 的缺口

按 severity 分级整理：

| # | severity | gap | 建议动作 |
|---|---|---|---|
| 1 | should_fix | 没有把"编排者中间状态在 agent context 之外"作为开篇点题——目前散落在 §2.3 / §7.2 / §7.3 / AC2 / AC3 多处，新读者难以一眼看到与 CC workflow 第一性的同构关系 | 在 §1 或 §2 开头加"核心不变量速查"：4 条与 CC 同构的第一性原则 + 3 条 ACC 必须发散的设计约束（异构 / 声明式 / Workbench） |
| 2 | should_fix | 并发与总量硬限（§11.1）没有显式数字，与 CC 16/1000 形成不必要的不对称 | §11.1 给 `max_active_runs` / `max_concurrent_nodes_per_run` / `max_total_nodes_per_run` 默认值与超限行为；为 SLO/告警奠基 |
| 3 | should_fix | Cache/复用语义在 §11.2 仅描述了 resume 路径，未独立定义 NodeCacheKey 与命中条件 | 新增 §11.2.x：NodeCacheKey 定义、命中条件、与 AC5（不跨 run 命中）的关系 |
| 4 | should_fix | §15.13 selector 四态混用未规范化，会让 BindingResolver 实现复杂度上升 | 确认 `namespace:<path>` 统一形态（`field:` / `outbox:` / `artifact:` / `each_of:`），在 §7.2 给 selector 语法 EBNF |
| 5 | should_fix | §15.14 `each_of` fan-in 是否一等公民未拍板，影响 Workbench 编辑器与 BindingResolver 接口稳定性 | 明确 Phase 3 是否进；进则定义 readiness / 物化 / 失败语义；不进则给迁移路径 |
| 6 | should_fix | §15.15 多文件 outbox 的 `source_artifact_sha256` 表达未拍板，影响 lineage 审计与可重放性 | 三选一：(a) per-file 数组 (b) 顺序串接哈希 (c) `outbox_manifest.json` 自身 sha256；推荐 (c) |
| 7 | nice_to_have | §15.12 standalone path AC4 收敛后，缺一份与 CC 同构的对照说明，新读者会以为 ACC 比 CC 弱 | §15.12 补一句：CC workflow 也不保证 prompt 字节级一致；本质契约是"metadata 字段集 + binding 解析结果可重放" |
| 8 | nice_to_have | ProvenanceObject 是否对外稳定 schema（§15.2）未拍板 | Phase 1 标 `internal, may break`；Phase 3 ResultStore 翻转后冻结为对外 schema |
| 9 | nice_to_have | 缺少与 CC `/workflows` 面板 / `Ctrl+G` 对齐的 Workbench 可观测性最低基线 | 在 §10 或新增 §11.x 列必须暴露的视图：节点状态 / binding 解析图 / events.jsonl 回放 / run_manifest checkpoint |

---

## 11. 最终结论与建议

**最终判定（4 选 1）：✅ `design_is_close_minor_patches`**

候选项对比：

- ❌ `design_is_wrong_needs_rearch` — 不成立，核心不变量与 CC 同构。
- ❌ `design_has_major_gap` — 不成立，所有发散都被 ACC 三大约束所必需。
- ✅ **`design_is_close_minor_patches`** — 成立，仅需开篇速查 + §11.1/§11.2 数字 + §15.x 收敛。
- ❌ `design_is_perfect_no_change_needed` — 不成立，第 10 章列了 9 条缺口。

**一段话总结**：ACC v0.2 推荐方案在"信息传递"第一性层面与 CC workflow 高度同构（agent 不看父历史 / 编排者显式注入 / agent 间无直通 / 中间状态在 agent context 之外），且因异构 agent + 声明式 `.accflow.json` + Workbench 三大约束做出的所有发散（disk-as-truth / ArtifactBundle 文件契约 / 5 类 Binding 声明式 / 工作流嵌套 / 三档可见性）都是必要的、不该回退的。当前缺的只是"对外讲清楚"与"边角拍板"——开篇缺一段与 CC 同构原则的速查；§11.1 缺并发硬限数字；§11.2 缺 `NodeCacheKey` 显式定义；§15.12–15 四个待确认项需收敛；ProvenanceObject schema 治理策略需要标版本。这些都是 minor patches，不需要架构级返工。

**立即行动项（5 条）**：

1. **补"核心不变量速查"**：在 DESIGN.md §1 或 §2 开头补一段，4 条与 CC workflow 同构的第一性原则 + 3 条 ACC 必须发散的设计约束（异构 / 声明式 / Workbench），让新读者一眼看到设计立场。
2. **§11.1 并发与总量硬限默认值**：显式给出 `max_active_runs` / `max_concurrent_nodes_per_run` / `max_total_nodes_per_run` 与超限行为；§11.2 新增 `NodeCacheKey` 定义与命中条件，与 AC5（不跨 run 命中）显式关联。
3. **拍板 §15.13 / §15.14 / §15.15 三项联动**：selector 统一为 `namespace:<path>` + `each_of` 是否进 Phase 3 + 推荐 `outbox_manifest.json` sha256 作为 `source_artifact_sha256`；收敛 BindingResolver 与 Workbench 编辑器的接口稳定性。
4. **ProvenanceObject 版本治理 + 嵌套追踪字段**：在 §7.2 ProvenanceObject 字段表标注版本治理策略（Phase 1 `internal-may-break` / Phase 3 frozen public schema），并新增 `invoking_workflow_call_id` 字段以增强嵌套工作流的反向追踪。
5. **新增 Workbench 可观测性最低基线（§11.x）**：节点状态视图 / binding 解析图 / events.jsonl 回放 / run_manifest checkpoint 视图，与 CC `/workflows` 面板对齐。

---

## 附录 A: RECON 引用清单

> 以下 source 经去重后按字典序排序。`DESIGN.md:<line>` 表示 ACC 仓库内引用；`tool_spec` 表示来自本会话提供的 dynamic workflows 工具规范；URL 表示公开文档。

- `DESIGN.md` §1 / §2 / §2.3（ACC 推荐方案概述与核心不变量分布）
- `DESIGN.md` §7.2（ProvenanceObject 字段表与 binding selector 语法）
- `DESIGN.md` §7.3（runtime_payload vs agent_payload 分层）
- `DESIGN.md` §10（Workbench 编辑与运行面板）
- `DESIGN.md` §11.1（WorkbenchRunManager / max_active_runs）
- `DESIGN.md` §11.2（resume / completed_nodes / binding_materializations）
- `DESIGN.md` §11.3（approval barrier）
- `DESIGN.md` §13（Phase 1 / Phase 3 路线图）
- `DESIGN.md` §15.2（ProvenanceObject schema 治理）
- `DESIGN.md` §15.3（aggregation capsule 待确认）
- `DESIGN.md` §15.12（standalone path AC4）
- `DESIGN.md` §15.13（selector 四态规范化）
- `DESIGN.md` §15.14（each_of fan-in 一等公民）
- `DESIGN.md` §15.15（多文件 outbox source_artifact_sha256）
- `DESIGN.md` AC1 / AC2 / AC3 / AC5 / AC6（核心不变量声明）
- `DESIGN.md` Binding 类型定义（InputBinding / OutputBinding / WorkflowOutputBinding / WorkflowCallInputBinding / ParameterBinding / ScopeFrame）
- `tool_spec`：dynamic workflows `agent()` / `parallel()` / `phase()` 调用语义
- `tool_spec`：dynamic workflows `StructuredOutput` 工具与 `opts.schema` 强约束
- `tool_spec`：dynamic workflows resume cache 行为（同 session 命中）
- `tool_spec`：dynamic workflows 并发上限（16 并发 / 单 run 1000 agent）
- `tool_spec`：dynamic workflows allowedTools = `Workflow`，要求 `v2.1.154+`
- `tool_spec`：subagent fresh conversation 与 prompt 字符串显式注入
- `tool_spec`：subagent 之间无直接通道（Agent Teams `mailbox/SendMessage` 仅实验特性）
- `tool_spec`：workflow 脚本无 filesystem / shell 访问，副作用由 agent 工具发起
- [Anthropic Engineering Blog — Multi-agent research system（仅作 token 成本背景，不外推 CC workflow）](https://www.anthropic.com/engineering)
- [Claude Code 公开文档（code.claude.com/docs）](https://code.claude.com/docs)
