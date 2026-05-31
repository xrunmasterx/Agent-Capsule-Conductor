# ACC Workflow Message Routing 设计文档

> 文档状态: 设计草案 v0.2（基于代码勘察 + Claude Code dynamic workflows 公开思想借鉴；v0.2 在 v0.1 基础上完成第一性原理查漏补缺，详见各节内联说明与 §15.1）

本文件回答 ACC 当前 workflow 消息路由层的两个核心 pain：(1) agent 看不见自己被怎样组装出来的输入/prompt；(2) 同一 capsule 在 standalone 与 workflow 模式下行为分化、standalone-equivalent execution 被破坏。设计目标是在不丢弃现有 substrate（ScopeFrame / EnvironmentFrame / ArtifactBundle / port_io / WorkflowNodeResult / RunManager）的前提下，把"control flow / data flow / data grain / binding / provenance / agent-visible input"这六层重新分层，并让 prompt 与 input.json 完全由显式 binding 决定。

---

## 1. 结论摘要

- 推荐方案：**Binding-First Result Store with Layered Provenance**——以 `minimal_increment` 起步，分三阶段收敛到 `result_store` 终态。
- 核心论断：ACC 现有底座已覆盖 ~95% 需求，缺口集中在六处——binding 解析分散、provenance 松散、prompt 渲染不可控、agent-visible 与 runtime-only 未分层、UI 不透明、测试锁死全量传递。
- 不变量声明（按落地阶段递进）：
  - **Control edge 只表示 readiness/触发**，数据语义全部由 DataEdge + 五种 Binding 承担（AC1）。
  - **Agent-visible 输入由显式 binding 唯一决定**，未声明字段默认不可见（AC2/AC8）。
  - **Provenance 默认 runtime-only**，不进入 `input.json` / `resolved_prompt.md`，除非 capsule 显式 opt-in（AC3）。
  - **Standalone-equivalent execution**：在 workflow 模式下产生的 `input.json` 与 `resolved_prompt.md` 中**不出现 ACC 编排 metadata 字段集** {`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`} 中的任意键，除非 capsule 显式 opt-in（AC4）。原"字节级一致"目标由于 standalone 路径的 `input_payload` 顶层结构由用户自由决定（`acc/runner.py:47-62`），结构上不可能与 workflow 路径完全相同，已修订为字段集不变量。
  - **并发 run 与 pause/resume** 必须以 `run_id` 为唯一作用域，禁止跨 run 读 outbox/inbox（AC5/AC6）。
- 兼容策略：保留 v1/v2/v3 accflow 与 `.graph.json` 可执行；引入 workflow 级 `binding_mode`（`legacy_full` / `mixed` / `explicit_only`）为渐进迁移开关；测试三层分层（`@legacy` / `@compat` / `@explicit`）。
- Claude Code dynamic workflows 内部实现是黑盒，本文仅借鉴其"binding 显式化、agent-visible 输入由 capability 声明、orchestration 用脚本/配置而非引擎硬编码"等公开思想，不复制其私有数据结构与协议。

---

## 2. 当前 ACC 代码事实

本章列举与设计相关的、已通过代码勘察确认的事实。所有结论严格附带 `file:line` 证据；推断条款留到 §3、§4 再展开。

### 2.1 Graph schema 与 domain 模型已分离 control / data

- ControlEdge 仅含 `source/target/condition`；DataEdge 含 DataEndpoint 与 materialization：见 `acc/domain.py:62-79`。
- DataEndpoint 显式区分 `node` 与 `port`，支持端口级精确寻址：见 `acc/domain.py:70-73`。
- WorkflowInputBinding / NodeInputBinding 等显式 binding 概念已存在，支持 `copy/reference/symlink` 三种 materialization：见 `acc/domain.py:83-87`、`acc/domain.py:218-231`。
- v3 JSON schema 在结构上已分离 `control_edges` 与 `data_edges`：见 `schemas/workflow_graph_v3_schema.json:58-105`。

### 2.2 Runtime 已有 binding 解析与 ancestor 校验

- store 层调用 `materialize_data_edge` 把 DataEdge 翻译为 inbox/outbox 物理操作：见 `acc/store/__init__.py:199-206`、`acc/store/__init__.py:745-791`。
- `validate_data_edges` 通过 ancestor_masks 强制 data_edge 的 source 必须是 target 的控制流上游：见 `acc/workflow_graph.py:243-264`。
- `port_io.materialize_inbox` 已能解析上游 outbox→下游 inbox 的端口级路径，并生成包含 `source_node_id/source_port_id/materialization` 的 `inbox_manifest.json`：见 `acc/port_io.py:97-158`。
- reference 物化模式当前**仅在 workflow output binding 层启用**；一般 node-to-node 仍走 copy：见 `acc/store/__init__.py:339-348`。

### 2.3 节点输入组装与 prompt 渲染

- workflow 模式下 `build_clean_node_input_payload` 把 `node / input / workflow.input / upstream_context / inbox.records` 五段组装成 input：见 `acc/app/node_invocation.py:78-91`。
- `collect_upstream_context` 从 `control_edges + node_outputs` 收集上游执行结果（含 `output_summary / output_inline`）：见 `acc/app/node_invocation.py:94-117`。
- `render_prompt` 只做 Jinja2 模板渲染；当模板未引用 `input_json` 时，会**自动**把整个 `input_payload` 序列化为 `## ACC Runtime Input` JSON 块追加到 prompt 末尾：见 `acc/prompting.py:12-33`、`acc/runner.py:108-112`。
- standalone 模式下 `CapsuleRunner.run` 接收的 `input_payload` 由调用方直接提供，结构与 workflow 节点的 `build_clean_node_input_payload` 输出**不同**（不含 `upstream_context / inbox.records / workflow.input`）：见 `acc/runner.py:47-62`。
- legacy capsule 仅在 `acc_receive_upstream_context=true` 时才注入 upstream_context；clean node 总是注入——两条路径行为分化：见 `acc/app/__init__.py:912-927`。
- `execute_agent_node` 通过 `read_node_input` 拿到 upstream_context 并记录 `upstream_context_count`，确认 standalone 与 workflow 的输入维度差异已渗透到 runtime 层：见 `acc/runtime/__init__.py:136-171`。

### 2.4 Provenance、Run 隔离与持久化

- ArtifactBundle 当前的 `provenance` 字段是 `dict[str, Any]`，仅记录 `workflow_id/node_kind` 等少量字段，无结构化 schema：见 `acc/domain.py:142-151`、`acc/store/__init__.py:724-739`。
- `WorkflowNodeResult` 已是可寻址的持久化对象（`node_id/run_dir/conductor_output/output/artifact_dir`），存于 `runs/<run_id>/nodes/<node_id>/`：见 `acc/debugger.py:43-55`、`acc/debugger.py:771-775`。
- `load_preserved_node_results` 已能从 `run_dir/nodes/` 加载已完成节点结果：见 `acc/debugger.py:778-810`。
- `events.jsonl` 为 append-only JSONL，可被 `iter_jsonl_events` 重放：见 `acc/events.py:69-154`。
- `WorkbenchRunManager` 通过独立的 `runs/<run_id>` 子目录实现并发 run 隔离，`max_active_runs` 控制并发上限：见 `acc/server/run_manager.py:36-52`。
- ScopeFrame 已支持 `parent_frame_id / call_depth` 树形嵌套；EnvironmentFrame 持有 session 级 `inbox_root/outbox_root`：见 `acc/domain.py:321-335`、`acc/environment.py:41-51`。

### 2.5 前端与 UI 投影

- `WorkflowCanvasEdge` 已是 union type，明确区分 `kind='data'|'control'`，并以虚线/实线区分：见 `web/src/types.ts:193-227`、`web/src/components/WorkflowViewer.tsx:3575-3622`。
- 前端通过 HTTP poll（1–2.5 秒间隔）获取 run 状态，无 WebSocket：见 `web/src/components/WorkflowViewer.tsx:812-869`。
- `PortInspector` 仅展示 binding 拓扑（source→target port），不展示运行时 upstream_context 实际内容或 resolved_prompt 是否已注入：见 `web/src/components/WorkflowViewer.tsx:2941-2995`。
- `build_node_run_projection` 不投影 `acc_receive_upstream_context / upstream_context` 内容到前端 `NodeRunSummary`：见 `acc/app/run_projection.py:17-34`。

### 2.6 Workflow 文件与现网行为

- 现有 `acc_workspace_canvas.accflow.json` 已显式声明 9 条 data_edges（port-to-port binding）：见 `workflows/acc_workspace_canvas.accflow.json:29-128`。
- 部分节点声明 `acc_receive_upstream_context=true` + `acc_upstream_context_fields`：见 `workflows/acc_workspace_canvas__Implementation_Flow.accflow.json:41-43`。
- legacy graph 文件（`demo_parallel.graph.json` / `ui_demo_graph.graph.json`）目前 0 条 data_edges，仅靠 control_edges + 隐式全量上游传递工作：见 `acc/legacy_graph_importer.py:157-211`、`acc/legacy_graph_importer.py:396-423`。
- `bindings/*.binding.local.json` 仅记录 `workspace_root / state_mode / behavior_policy`，与 data binding 无关：见 `bindings/Implementation_Flow.binding.local.json:1-9`。

### 2.7 测试已锁死的"全量传递"行为

- `test_control_edge_default_passes_upstream_context_without_inbox` 等用例已锁死"默认全量传递 upstream_context"行为：见 `tests/unit/test_clean_workflow_engine.py:169-198`、`tests/unit/test_clean_workflow_engine.py:254-276`。

---

## 3. 问题本质：为什么控制流连线不应默认等于全量数据传递

### 3.1 现状

- ControlEdge 概念上只表示"上游终结 → 下游可调度"，但 `collect_upstream_context` 仍以 `control_edges + node_outputs` 为线索拉取 `output_summary / output_inline`，事实上让 control edge 承担了"附带上游产物全量"的语义（`acc/app/node_invocation.py:94-117`）。
- 测试已锁死：当节点没有显式 inbox/data_edge 时，control edge 的 source 仍会把 upstream_context 全量送到下游 input（`tests/unit/test_clean_workflow_engine.py:169-198`）。

### 3.2 为什么这是反模式

- **职责混淆**：readiness 是调度概念，数据传递是 dataflow 概念；二者放在同一条边上意味着用户无法只表达"等 A 完成"而不顺带把 A 的 output 全部塞过去。
- **不可控的可见性**：下游 capsule 默认看到所有上游 output，违背最小可见性原则；同时让 prompt 文本依赖于"上游产生了什么"，破坏 standalone-equivalence。
- **可观测代价被掩盖**：UI 投影未展示 upstream_context 是否生效（`acc/app/run_projection.py:17-34`、`web/src/components/WorkflowViewer.tsx:2941-2995`），用户长期看不见自己被注入了什么 (推断)。
- **测试反向锁定**：现有用例把"全量传递"固化为合约（`tests/unit/test_clean_workflow_engine.py:169-198`），让任何收敛动作都看起来像 breaking change。

### 3.3 设计立场

- ControlEdge 在新设计中**只承担 readiness 语义**；`context='upstream_output'` 字段保留但仅作为 legacy 兼容标记，新代码路径不读它。
- 任何"上游 output 进入下游 input"的事实都必须由显式 DataEdge / NodeInputBinding / WorkflowInputBinding 承载。
- 旧测试通过 `@pytest.mark.legacy` 标签隔离，并加注释说明"此行为是 legacy 兼容，不构成新 feature 合约"。

---

## 4. 问题本质：为什么 Agent 节点应保持 standalone-equivalent execution

### 4.1 现状的分化点

- standalone 路径：`CapsuleRunner.run` 直接收用户构造的 `input_payload`（`acc/runner.py:47-62`）。
- workflow 路径：`build_clean_node_input_payload` 必然构造 `node / input / workflow.input / upstream_context / inbox.records` 五段（`acc/app/node_invocation.py:78-91`）。
- 两条路径汇入同一个 `render_prompt`，`render_prompt` 又会无差别把 `input_payload` 全量序列化追加到 prompt（`acc/prompting.py:12-33`、`acc/runner.py:108-112`）。
- legacy capsule 与 clean capsule 对 upstream_context 的处理还存在分支（`acc_receive_upstream_context` flag），进一步加剧分化（`acc/app/__init__.py:912-927`）。
- 现网 capsule（`workflows/acc_workspace_canvas__Implementation_Flow.accflow.json:41-43`）已对 workflow 模式额外注入产生**事实依赖**——这是 pain2 的硬证据。

### 4.2 为什么 standalone-equivalence 是核心契约

- **可调试性**：作者必须能用最小输入复现 capsule 行为；如果 workflow 模式额外注入字段会改变 prompt 文本，"能在 CLI 调通但在 workflow 里行为漂移"会变成常态故障。
- **可组合性**：capsule 是 ACC 的最小复用单元；如果其行为依赖编排上下文，组合时的可预期性会随节点增多指数式衰减 (推断)。
- **测试稳定性**：standalone 单元测试与 workflow 集成测试应基于同一组 prompt/输入合约；当前 `render_prompt` 自动追加 JSON 块的双通道行为是导致 prompt 文本差异最主要的来源 (推断)。
- **可观测一致性**：用户在 UI 看到的 `resolved_prompt.md` 应能被 capsule 作者在 CLI 复现；现网 UI 投影连 upstream_context 都不显示（`acc/app/run_projection.py:17-34`），让分化在 UI 层不可见，间接放大代价 (推断)。

### 4.3 设计立场

- **Workflow 模式的额外字段必须显式声明**：`acc_expose_upstream_context / acc_expose_provenance` 等 flag 控制是否进入 prompt。
- **Render_prompt 改为只渲染显式变量**：模板必须显式 `{{var}}` 引用才注入字段；`## ACC Runtime Input` 追加块必须由模板显式 opt-in。
- **agent_payload 与 runtime_payload 分离**：runtime 仍可记录完整 metadata（写 input.json），但 prompt 渲染器只看 agent_payload，agent_payload 由 binding 声明过滤。
- **可量化验证**：在 workflow 模式下，未 opt-in 节点的 `input.json` 与 `resolved_prompt.md` 中**不得出现** ACC 编排 metadata 字段集 {`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`}（AC4）。原"字节级一致 prompt"目标因 standalone 路径 `input_payload` 顶层结构由用户自由决定（`acc/runner.py:47-62`），与 workflow 路径不可能字节级同构，已修订为"字段集不变量"。是否额外把 standalone 路径的用户输入也包装到 `task` 子键以追求结构同构，留作 §15 待确认。

---

## 5. Claude Code dynamic workflows 可借鉴点

> Claude Code dynamic workflows 的内部实现是公开 API 之外的黑盒；以下仅基于公开材料中的思想，不复制其内部协议或数据结构。

可借鉴的公开思想（均按"我们如何应用"重述）：

1. **Binding 显式化**——agent 看到什么由声明决定，不由"上下游碰巧产生了什么"决定。我们的对应物：DataEdge + 五种 Binding 是 graph 时声明物，runtime 不补默认值。
2. **Capability 声明 driven 的 agent-visible input**——capsule 显式声明它需要什么、能消费什么。我们的对应物：`acc_expose_upstream_context / acc_expose_provenance / acc_expose_workflow_metadata=[...]`（字段级白名单）等 capsule 级 flag。
3. **Orchestration 用脚本/配置而非引擎硬编码**——把控制流与数据组合的灵活性交回给用户。我们近期不重写 graph 引擎；远期 `scripted_orchestration` 选项作为可选高级模式（推断），不替代 graph + UI canvas。
4. **Result 寻址化与可追溯**——结果应能被稳定 ID 引用、被工具消费。我们的对应物：(run_id, node_id, port_id) → ArtifactBundle 唯一寻址，结构化 ProvenanceObject 记录 lineage。
5. **standalone 与编排模式语义同构**——同一 capsule 在两种模式下不应行为分化。我们以 AC4 作为硬约束验证。

明确**不借鉴**的部分：内部 dataflow 协议、私有 storage schema、未公开的调度算法。

---

## 6. 候选方案与 trade-off

| 方案 | 改动面 | 解决 pain1 | 解决 pain2 | 兼容性 | 落地节奏 | 终态可维护性 | 推荐度 |
|---|---|---|---|---|---|---|---|
| `minimal_increment` | 小（render_prompt + ProvenanceObject + 两个 expose flag） | 部分（prompt 透明度立即改善） | 部分（仍需 flag 维持 legacy 全量传递） | 极高 | 1–2 周 | 中（binding 解析仍分散） | 单独不够，作为破冰阶段 |
| `result_store` | 中-大（统一 ResultStore + BindingResolver） | 完整 | 完整 | 中（mixed mode 期间双读路径） | 多月 | 高 | 单独太重，作为收口阶段 |
| `scripted_orchestration` | 极大（graph 引擎降级为调度+底座） | 概念上彻底解决 | 自然成立 | 低（与 UI canvas 哲学冲突，需重做） | 长期 | 高（自由度最大） | 不近期推荐，远期可选 |
| `radical_rebuild` | 全量（抛弃 graph + inbox/outbox 协议，三层重构） | 完整 | 完整 | 极低（几乎是 breaking change） | 6+ 月 | 高（无历史包袱） | 不推荐 |

### 推荐结论

**采用 `minimal_increment` 起步、`result_store` 收口**。理由：

- ACC 现有 substrate 已 95% 就绪（`acc/domain.py` 中 ControlEdge/DataEdge/WorkflowInputBinding/NodeInputBinding；`acc/port_io.py` 中端口级 materialize；`acc/debugger.py` 中 WorkflowNodeResult；`acc/server/run_manager.py` 中并发隔离），radical_rebuild 与 scripted_orchestration 都要丢弃这套底座，ROI 不划算。
- 纯 minimal_increment 无法根治 standalone-equivalence 与并发隔离不变量（仍需 legacy 全量传递路径）。
- "渐进式收口"路线让 pain1/pain2 在三阶段内逐步消除，同时保住 `.accflow.json/.graph.json` 兼容与现网行为可回滚。

---

## 7. 推荐方案详细设计

### 7.1 六层分离

| 层 | 角色 | 形态 |
|---|---|---|
| Control flow | readiness/触发 | ControlEdge（仅 source/target/condition） |
| Data flow | agent-visible 输入唯一来源 | DataEdge + 五种 Binding |
| Data grain | 取值粒度 | Bundle / File / Field 三级 |
| Binding | 设计时声明 | NodeInputBinding / NodeOutputBinding / WorkflowInputBinding / WorkflowOutputBinding / WorkflowCallInput\|OutputBinding |
| Runtime-only metadata | 持久化与调试 | ProvenanceObject + run_manifest checkpoint + events.jsonl |
| Agent-visible input | 进入 prompt/input.json 的内容 | 默认仅显式声明字段，opt-in 字段需 capsule 声明 |

### 7.2 关键概念（轻量定义；非实现细节）

- **NodeResult**：`(run_id, node_id, port_id) → ArtifactBundle` 的唯一可寻址结果。底层落到 `runs/<run_id>/nodes/<node_id>/` 目录树（已存在，见 `acc/debugger.py:43-55`），未来由 ResultStore 统一封装查询。NodeResult 与持久化层中所有内部路径字段（`outbox_refs / artifact_refs / output_path / run_dir`）**统一存相对 `run_dir` 的相对路径**，以保证 `runs/<run_id>/` 目录可被 archive、改名、跨机回放；绝对路径只在运行时透给 agent 的 ENV（`ACC_RUN_DIR / ACC_INBOX_DIR / ACC_OUTBOX_DIR`）中现算。
- **Binding**：声明式契约，描述"本节点本端口的输入应来自哪里"。包含五种形态：
  - `NodeInputBinding`：节点内端口绑定（已存在，`acc/domain.py:218-231`）。
  - `NodeOutputBinding`：节点产物到下游 binding 的桥接形态。
  - `WorkflowInputBinding`：workflow 边界入参 → 内部节点（已存在，`acc/domain.py:83-87`）。
  - `WorkflowOutputBinding`：内部节点 → workflow 出参（aggregation 节点显式指向）。
  - `WorkflowCallInputBinding / WorkflowCallOutputBinding`：嵌套 workflow 调用边界。
  - 字段子选择：当 binding 需要从上游 NodeResult 的结构化输出中取子字段时，使用 `source_port + field_path` 二元组；`field_path` 采用受限 JSONPath 子集（仅 `.key` / `[index]` / `[*]`，不含过滤器与递归通配），保留以备未来 schema-aware autocomplete 使用。规范的最终形态留作 §15 待确认。
  - Binding 是 graph 时设计物，runtime 由 BindingResolver 解析为对 ResultStore 的查询。
- **TransferPolicy**（即 materialization）：`copy / reference / symlink` 三选一；当前 reference 仅在 workflow output binding 启用（`acc/store/__init__.py:339-348`），Phase 3 扩展到任意节点。Policy 与 binding 解耦，runtime 决策结果记入 `materialization_mode_resolved`。
  - **平台 fallback**：Windows 普通用户态默认无 `SeCreateSymbolicLinkPrivilege`，`reference / symlink` 在该平台**自动降级为 copy**，并将实际选定模式写入 `materialization_mode_resolved`，同时 emit 一条 `materialization_degraded` 事件到 `events.jsonl` 供 Workbench inspector 渲染（详见 §9.3 投影层补全）。降级不算错误。
- **Provenance**（ProvenanceObject）：runtime 元数据，结构化字段（建议形态，最终 schema 在 Phase 1 实现时迭代）：
  - `binding_applied[]`：本节点本 run 实际生效的 binding 列表（含 source_node/source_port/target_port）。
  - `upstream_lineage[]`：从根向下的因果链。
  - `materialization_mode_resolved`：实际选定的物化模式。
  - `producer_session_id / frame_id / parent_frame_id / call_depth`。
  - **完整性哈希**分两类，分别记录、不交叠：
    - `inline_value_sha256`：仅在 binding `materialization=copy` 且把字段值序列化进 `input.json` 时记录，对序列化后的字节流取 sha256；
    - `source_artifact_sha256`：在 binding 引用上游产物（`reference / symlink` 模式或 outbox 引用）时记录，**直接复用** `artifact_bundle.json.files[*].sha256`（`acc/store/__init__.py:864-877` 已有），不重新计算；多文件 outbox 端口引用时记录每个文件 sha256 数组，避免对整目录做不稳定的全量哈希。
  - 默认仅写入 ArtifactBundle 持久化层 + `events.jsonl` + `run_manifest.json`，**不进入 input.json / resolved_prompt.md**。
- **RuntimeMetadata**：广义概念，泛指所有 runtime-only 元数据；ProvenanceObject 是其中一类。
- **AgentPayload vs RuntimePayload**：`build_clean_node_input_payload` 在 Phase 2 拆分为两层：runtime_payload 写 `input.json` 并保留 provenance；agent_payload 投递到 prompt 渲染器，由 binding 声明过滤。
- **BindingResolver**（Phase 1 适配器层，Phase 3 升级为 ResultStore 客户端）：统一 binding 解析与 provenance 注入入口，将分散在 `acc/store` 与 `acc/port_io` 的逻辑收敛。
- **Fan-in 引用（aggregation 节点）**：当某个 aggregation 节点要绑定一个 `for_each` 展开后的多个实例的同名字段时，使用 `each_of:<source_node_id>.<field_path>` 命名空间（推断形态，最终语法留作 §15 待确认）。BindingResolver 解析后产出 list；下游 `aggregator` 必须接受 list 入参。这是为了避免 aggregation 节点变成"自由读上游噪声做总结"的回退路径——fan-in 仍然是显式 binding。

### 7.3 三档可见性（详见 §10）

- **默认 agent-visible**：`input.bindings_resolved` / `workflow.input` / `inbox.records` 中显式声明的字段。
- **可显式 opt-in 的 agent-visible**：`upstream_context`（仅当 `acc_receive_upstream_context=true`）、`ProvenanceSummary`（仅当 `acc_expose_provenance=true`）、单值 metadata 列表 `acc_expose_workflow_metadata=[...]`（**字段级白名单替代旧版 bool 开关**，例如 `["run_id","upstream_node_ids"]`，未列字段一律不进）。
- **永远 runtime-only**：`bundle_id` / `producer_session_id` / `events.jsonl` 流 / `__acc_control_context` 透传标记 / RunIndex 全局聚合元数据。

### 7.4 Render_prompt 重构（Phase 2 核心改动）

- 取消"模板未引用 input_json 时自动追加 `## ACC Runtime Input` JSON 块"的隐式行为（`acc/prompting.py:12-33`、`acc/runner.py:108-112`）。
- 新行为：模板必须显式 `{{var}}` 引用某字段才注入；`## ACC Runtime Input` 块由模板显式 opt-in（例如使用专用宏）。
- **Capsule 级兼容兜底**（**Phase 1 引入，Phase 2 重构 render_prompt 时强制使用**）：新增 capsule manifest 字段
  ```
  prompt_appendix_policy: "legacy_full" | "task_only" | "none"
  ```
  - `legacy_full`：保持现网行为——当模板未引用 `input_json` 时自动追加 `## ACC Runtime Input` JSON 块，内容包含全量 `input_payload`。**迁移期所有现网 capsule 默认设为此值**，避免 Phase 1 / Phase 2 改动静默使现网 capsule 失语。
  - `task_only`：自动追加块只包含 binding 解析后的 `task` 字段；不含 `node / workflow.input / upstream_context / inbox.records`。**新建 capsule scaffold 默认设为此值**。
  - `none`：永不自动追加；模板若需要任何 runtime input 必须显式 `{{ var }}`。
  - 该字段进入 `capsule_template_schema.json`，由 capsule 作者声明，避免 ACC 在不知道下游契约时强行翻转默认。
- 兼容回退：旧 capsule 无 `prompt_appendix_policy` 字段时按 `legacy_full` 解释。
- CI 加 prompt 模板审计：扫描所有 capsule 的 `prompt_template.md`，输出哪些模板隐式依赖自动追加块；该清单作为 Phase 3 默认翻转的 gating。

### 7.5 Workflow 级 binding_mode

- `legacy_full`：全量传递 upstream_context，与现网完全一致。
- `mixed`（默认）：未声明 binding 的节点走 legacy 全量传递，声明 binding 的节点走 explicit。
- `explicit_only`：未声明字段绝不可见。
- Phase 3 默认翻转为 `explicit_only`；`legacy_full` 仍保留为 capsule 级 escape hatch。

### 7.6 LegacyPassthroughBinding：兼容期 explicit 表达

为避免在 BindingResolver 内对 selector 做魔法字符串特判（如 `.legacy_full_passthrough`），把"沿用旧 upstream_context 全量传递"显式建模为 binding 的一种 **kind union**：

```
InputBinding.kind: "selector" | "legacy_passthrough"
  - selector:           普通字段路径绑定（field_path / outbox / artifact / each_of）
  - legacy_passthrough: 由 importer / mixed 模式自动注入，BindingResolver 看到此 kind 直接走旧的
                        collect_upstream_context 路径，不进入 selector 解析；selector 字段必须为空
```

理由（第一性原理）：selector 是"字段路径"这一普通概念，不应被一个不存在的字段名 `.legacy_full_passthrough` 占用；类型系统应让"legacy 兼容"成为 BindingResolver 的一条独立 dispatch 路径，而非藏在数据里。Phase 3 默认翻转后，新建 graph 不会再产生 `legacy_passthrough` binding；旧 graph 在 importer 中仍可生成。

---

## 8. Runtime 数据流

### 8.1 节点执行的输入装配（推荐方案下）

1. 调度器决定节点 N 进入可调度状态——依据 ControlEdge 拓扑 + ancestor_masks（`acc/workflow_graph.py:243-264`）。
2. BindingResolver 接受 N 的 binding 声明，按 `(run_id, source_node_id, source_port_id)` 查询 NodeResult，得到 ArtifactBundle 引用。
3. TransferPolicy 决策：根据 binding 与平台能力选择 `copy/reference/symlink`，结果写入 `materialization_mode_resolved`。底层仍由 `port_io.materialize_inbox`（`acc/port_io.py:97-158`）执行物理操作。
4. 输入装配分两层：
   - **runtime_payload** 写入 `runs/<run_id>/nodes/<node_id>/input.json`，含 `node / input / workflow.input / inbox.records / provenance`。
   - **agent_payload** 由 binding 声明过滤后投递给 prompt 渲染器；未声明字段不进 prompt。
5. `render_prompt` 仅渲染模板显式引用的变量，输出 `resolved_prompt.md`。
6. ProvenanceObject 写入 ArtifactBundle 与 `events.jsonl`；不进 input.json 的 agent-visible 部分。
7. capsule 执行；产物写入 `runs/<run_id>/nodes/<node_id>/outbox/`，构建 `outbox_manifest.json`。
8. 节点完成时原子追加 `run_manifest.completed_nodes` checkpoint（含 `node_id/port_id/materialization_mode_resolved/finalized_at`）。

### 8.2 关键不变量（运行时断言）

- BindingResolver 拒绝任何 source `run_id` ≠ 当前 `run_id` 的引用（实现 AC5/AC6）。
- `agent_payload` 中出现非 binding 声明字段直接 fail（`explicit_only` 模式）。
- ProvenanceObject 与 `run_manifest.binding_materializations` 须互相对账，缺失任一侧视为 checkpoint 不完整。

### 8.3 与现有 substrate 的对应

- `WorkbenchRunManager` 物理隔离继续工作（`acc/server/run_manager.py:36-52`）。
- `events.jsonl` 仍是 append-only 真相流（`acc/events.py:69-154`）。
- `WorkflowNodeResult / load_preserved_node_results` 升级为 ResultStore 查询的默认后端（`acc/debugger.py:43-55`、`acc/debugger.py:778-810`）。

---

## 9. Workbench 交互设计

### 9.1 RunInspector 三大新视图

- **Resolved Prompt tab**：展示节点真正注入的 `resolved_prompt.md` 全文。**注**：原"与 capsule CLI 输出做 byte-level diff"目标因 standalone 路径用户输入结构自由（`acc/runner.py:47-62`）不可达；改为做"编排 metadata 字段集"扫描（见 AC4），并在 tab 内高亮哪些段落由 binding 注入、哪些由模板自带。
- **Applied Bindings 列表**：每条 binding 的 `source_node/source_port → target_port`、`materialization_mode_resolved`、bundle_id 链接（默认隐藏 bundle_id 详情，点开展开）。**降级标识**：当某条 binding 在本 run 触发 `materialization_degraded`（如 Windows 下 `reference / symlink → copy` 自动降级），该行右侧渲染降级图标并展示原计划模式 → 实际模式。
- **Provenance toggle**：默认折叠的 ProvenanceSummary 展示——只有展开时才查看 lineage、frame_id、call_depth；默认不会污染主视图。

### 9.2 Canvas 上的视觉区分

- 沿用现有 `kind='data'|'control'` union（`web/src/types.ts:193-227`）与虚线/实线区分（`web/src/components/WorkflowViewer.tsx:3575-3622`）。
- 当 workflow 处于 `legacy_full` / `mixed` 模式时，节点角标提示"该节点走 legacy 全量传递"，引导用户迁移。
- PortInspector 增加 "本 run 实际值" 区域，调用新接口拉 `(run_id, node_id, port_id)` 对应 ArtifactBundle 摘要（取代现在仅展示拓扑的形态，`web/src/components/WorkflowViewer.tsx:2941-2995`）。
- **新建 control edge 的默认行为对话框（Phase 1 起）**：Phase 1 把 `ControlEdge.context` 默认从 `"upstream_output"` 翻转为 `"none"` 后，老用户在 Canvas 上画一条线会出现"画了线但下游 prompt 空"的体验断层。新建 control edge 时弹一个三选项确认：
  1. **仅 readiness**（新默认）：只表达"等 A 完成"，下游不消费 A 的任何字段；
  2. **readiness + legacy passthrough**：保留现网默认行为，自动生成一条 `kind=legacy_passthrough` binding（见 §7.6），适合 Phase 1 / Phase 2 期间的旧资产；
  3. **readiness + 显式 binding 编辑器**：直接进入 §9.4 Binding 编辑器配置 source_port + field_path（推荐）。
  目的：避免静默改语义；用户每次新建连线都要主动声明数据语义。

### 9.3 投影层补全

- `build_node_run_projection`（`acc/app/run_projection.py:17-34`）扩展投影 `acc_receive_upstream_context` 实际生效结果、`upstream_context_fields` 白名单、`materialization_mode_resolved`、`materialization_degraded` 事件等字段；前端据此渲染上述视图。
- 短期沿用 HTTP poll（`web/src/components/WorkflowViewer.tsx:812-869`）；WebSocket 不在本设计范围。

---

## 10. Agent 可见输入 vs runtime-only metadata 的边界

### 10.1 默认 agent-visible（无需声明）

- `node.id / node.kind / node.role`（capsule 元数据）。
- `input.static_values`（节点 spec 中显式声明的常量输入）。
- `input.bindings_resolved`（每条 DataEdge / NodeInputBinding 在本 run 的实际取值，按 target_port 组织）。
- `workflow.input`（仅 WorkflowInputBinding 显式绑定到本节点的字段）。
- `inbox.records`（仅本节点 binding 显式拉入 inbox 的文件清单及其 logical port_id）。
- `resolved_prompt.md` 中由模板显式 `{{var}}` 引用到的字段。

### 10.2 可显式 opt-in 的 agent-visible

opt-in 一律采用**字段级白名单**而非 bool 总开关，以贯彻最小披露原则。

| 字段 | 触发声明 | 说明 |
|---|---|---|
| `upstream_context` | `acc_receive_upstream_context=true` | 仅写入 input.json |
| upstream_context 字段白名单 | `acc_upstream_context_fields=[...]` | 不再全量，限定字段集 |
| `ProvenanceSummary` | `acc_expose_provenance=true` | 摘要含 source_node/source_port/materialization_mode |
| `upstream_context` 进 prompt | `acc_expose_upstream_context=true` | 与 input.json 注入解耦，模板侧另一开关 |
| 单值 metadata 列表（精细） | `acc_expose_workflow_metadata=[...]` | **替代旧版 bool 总开关**；列出要暴露的子字段，例如 `["run_id","node_id","upstream_node_ids"]`；未列字段一律不进 |
| 上游节点的 `output_summary / output_inline` | binding 中 `source_port + field_path` 显式选取 | 不再默认整 dict 追加到 prompt 末尾 |

> ENV 现状：`acc/adapters/codex_cli.py:23-31` 当前仅透出 `ACC_INBOX_DIR / ACC_OUTBOX_DIR / ACC_ENVIRONMENT_ID / ACC_NODE_ID`。`ACC_RUN_ID / ACC_RUN_DIR` 在本设计中尚未存在，将在 Phase 1 交付物里补齐（见 §13 Phase 1）。在 ENV 透出前，opt-in 表中的 `run_id` 仅经 `input.json` 注入。

### 10.3 永远 runtime-only（不向 agent 暴露）

- `ArtifactBundle.bundle_id / producer_session_id`：仅写 outbox 与 events，不进 input.json。
- `ScopeFrame.frame_id / parent_frame_id / call_depth`：仅在 EnvironmentFrame、`events.jsonl`、`run_manifest.json` 中（`acc/domain.py:321-335`、`acc/environment.py:41-51`）。
- `materialization_mode_resolved`：留在 `inbox_manifest.json` 与 ProvenanceObject。
- `inbox_manifest.json / outbox_manifest.json` 内部路径与 `source_outbox` 引用。
- `events.jsonl` 的 `event_id / 时间戳 / status` 流。
- `WorkflowCallInputBinding` 的 `__acc_control_context` 透传标记（仅 nested workflow runtime 可见）。
- RunIndex 全局聚合元数据。

### 10.4 实施约束

- 任何 runtime-only 字段进入 `input.json` 的 agent-visible 区块视为 bug；CI 加结构 lint。
- ProvenanceSummary（opt-in）≠ 完整 ProvenanceObject：前者是有限子集，避免泄漏 bundle_id 等内部寻址。

---

## 11. pause/resume、并发、审批、drill-down、final summary

### 11.1 并发 run 隔离

- `WorkbenchRunManager` 已通过独立 `runs/<run_id>` 子目录树实现物理隔离（`acc/server/run_manager.py:36-52`）。
- 设计补强：BindingResolver 在 Phase 1 加运行时断言——任何对兄弟 run 的 outbox/inbox 直接读取 fail-fast；`acc/store` + `acc/debugger` 中所有读路径在 Phase 1 审计阶段标记 `run_id` 边界。
- `events.jsonl` 仅写本 run，禁止跨 run 合并。

### 11.2 显式 checkpoint 与 pause/resume

- 现状：`load_preserved_node_results` 依赖启发式（status 文件 + 手工遍历 `runs/<run_id>/nodes/`）判定完成度（`acc/debugger.py:778-810`）；存在"部分物化完成被误判完成"的灰色区间 (推断)。
- 新协议：`run_manifest.json` 增加：
  - `completed_nodes`：节点级原子提交记录数组。
  - `binding_materializations`：每条 `(node_id, port_id, materialization_mode_resolved, finalized_at)`。
- 完成节点必须**先写 outbox_manifest.json，再原子追加 run_manifest checkpoint**；resume 时只信本 run checkpoint，不读兄弟 run。
- 长运行节点（agent/notebook）的细粒度 mid-execution 恢复点暂不在本方案范围（Phase 3 后扩展）。

### 11.3 审批 / drill-down

- 审批节点视为普通 capsule，输入由 binding 决定，输出 ArtifactBundle 含审批结果字段；下游节点通过 binding 显式选取。
- **调度结构约束（Phase 3 实现约束，非用户配置）**：当前调度循环按 topological level 用 `asyncio.gather` 一次性等所有节点完成（`acc/app/__init__.py:534-575`）；如果让一个 awaiting-approval 的节点在 level 内"原地阻塞等审批"，会**阻塞整层并发节点**，与 §11.1 "保留并发"承诺冲突。设计约束：审批节点必须**独占 level**——graph compile 阶段为它前后各插入一个 readiness barrier（pseudo control-only node），把审批前后切成三个独立 level；这样审批 wait 不影响其他分支。这是 Phase 3 引入"运行时审批 hook"时的硬约束，必须落实到 graph 编译路径，而不是让用户在 Workbench 里配置。
- drill-down：UI 通过 (run_id, node_id, port_id) 查询 ResultStore，逐节点钻入 ArtifactBundle 与 ProvenanceSummary；Inspector 提供 lineage 反向追溯。

### 11.4 Final summary 与 aggregation 节点

- 不再隐式合并末端节点输出。`workflow_output_bindings` 必须显式指向某 aggregation 节点的 port（AC7）。
- 是否需要 ACC 内置 `aggregation` capsule kind 留作 §15 待确认；当前设计只要求"用户必须声明 aggregation 节点"。
- 是否当前存在隐式合并末端节点的 codepath，需在 Phase 1 审计 `acc/app` + `acc/runtime` 的 final result 装配链确认（推断未覆盖完整 codepath）。

### 11.5 Nested workflow

- `WorkflowCallInputBinding/OutputBinding` 边界以独立 frame_id 落地，子 workflow 内部 BindingResolver 仍以子 run 的 (run_id, node_id, port_id) 寻址。
- 子 workflow 内部节点是否继承父 frame ProvenanceSummary 留作 §15 待确认。

---

## 12. 兼容 / 迁移策略

### 12.1 accflow v1/v2 → v3 normalization

- Parser 入口保留兼容：`normalize_workflow_graph` 继续把所有版本统一到 v3 内部模型；v1 中的 `edges.mapping / input_mapping` 自动 split 为 `data_edges` + 对应 `NodeInputBinding`；v2 已有 `data_edges` 直接保留。
- 新增 workflow 级 `binding_mode` flag：`legacy_full | mixed | explicit_only`，**默认 mixed**——未声明 binding 的节点走 legacy 全量传递，声明 binding 的节点走 explicit。
- 新 accflow 文件可显式声明 `binding_mode=explicit_only` 以彻底切换。

### 12.2 legacy `.graph.json`

- `legacy_graph_importer`（`acc/legacy_graph_importer.py:157-211`、`acc/legacy_graph_importer.py:396-423`）继续工作；导入时自动注入 `acc_receive_upstream_context=true` + 生成隐式 LegacyValueEdge，保持现行为；同时打 `graph.legacy=true` 标签。
- UI 与 lint 工具据此提示用户迁移到 explicit binding；Phase 3 之前不强制改写历史 `.graph.json`。

### 12.3 upstream_context 默认值翻转

- 迁移期：未声明 `acc_receive_upstream_context` 的节点 → legacy 默认 `true`（与现状一致，`acc/app/__init__.py:912-927`）；prompt 渲染层只在节点声明 `acc_expose_upstream_context=true` 时才把 upstream_context 注入 `resolved_prompt.md`；`input.json` 中保留以兼容现有 capsule 直接读 input.json 的实现。
- Phase 3：将"未声明默认"翻转为 `false`（opt-in），届时通过迁移脚本 `tools/migrate_graph_to_explicit_binding.py` 批量改写历史 accflow。

### 12.4 测试三层分层

| 层 | 标签 | 内容 | CI lane |
|---|---|---|---|
| Legacy | `@pytest.mark.legacy` | 全量传递行为锁定测试，包含 `tests/unit/test_clean_workflow_engine.py:169-198`、`tests/unit/test_clean_workflow_engine.py:254-276` | 独立 lane |
| Compat | `@pytest.mark.compat` | mixed mode 矩阵：部分节点显式 binding + 部分隐式 | 主 lane |
| Explicit | `@pytest.mark.explicit` | AC1/AC2/AC4/AC5/AC6/AC8/AC9 等核心不变量 | 主 lane |

锁定的 legacy 用例需添加注释："此行为是 legacy 兼容，不构成新 feature 合约。"

### 12.5 现网 capsule 影响

- `workflows/acc_workspace_canvas.accflow.json:29-128` 等已显式声明 9 条 data_edges 的文件，迁移成本最低（仅需将 `binding_mode` 显式设为 `explicit_only` 即可获得 AC2 不变量）。
- 已声明 `acc_receive_upstream_context=true` 的节点（如 `workflows/acc_workspace_canvas__Implementation_Flow.accflow.json:41-43`）在 Phase 2/3 仍可工作，但需配合 `acc_expose_upstream_context` 决定 prompt 行为。

---

## 13. 分阶段落地计划

### Phase 1 — Substrate hardening + Provenance 结构化（不破坏现网行为）

**目标**：把现有底座中分散的 binding/provenance 证据统一为可被未来抽象消费的结构化对象，所有变更在 mixed mode 下与现行行为完全等价。

**交付物**：
- 新增 `acc/provenance.py`，定义 ProvenanceObject（`binding_applied` / `upstream_lineage` / `materialization_mode_resolved` / `producer_session_id` / `frame_id` / `call_depth` / `inline_value_sha256` / `source_artifact_sha256`）。
- ArtifactBundle.provenance 字段升级为 ProvenanceObject（保留 dict 形态作 fallback，兼容旧持久化，对应 `acc/domain.py:142-151`）。NodeResult / ProvenanceObject 内所有路径字段统一存**相对 `run_dir`** 的相对路径，绝对路径只在 ENV 透出时现算。
- `acc/store` + `acc/port_io` 的 binding resolution 调用统一通过新增的 BindingResolver 入口（适配器层，不动现有路径）。
- `run_manifest.json` 增加 `completed_nodes / binding_materializations` checkpoint 字段，写入侧补齐。
- **新增 ENV 透出**：`acc/adapters/{base.py, codex_cli.py, claude_sdk.py, generic_cli.py}` 增加 `ACC_RUN_ID / ACC_RUN_DIR` 环境变量（当前 adapters 仅透出 `ACC_INBOX_DIR / ACC_OUTBOX_DIR / ACC_ENVIRONMENT_ID / ACC_NODE_ID`，见 `acc/adapters/codex_cli.py:23-31`）。`AgentRunRequest` 增加 `run_id / run_dir` 字段（`acc/adapters/base.py:11-31`）。
- **Capsule manifest 新增 `prompt_appendix_policy` 字段**（`schemas/capsule_template_schema.json`），默认 `legacy_full`；新建 capsule scaffold 生成 `task_only`。Phase 1 仅引入 schema + 默认值兜底，render_prompt 行为改写在 Phase 2。
- **Workbench 新建 control edge 三选项对话框**：见 §9.2，新建连线时强制选择"仅 readiness / readiness + legacy passthrough / readiness + 显式 binding"，避免静默改语义。
- 三层测试分层落地：legacy 用例打 `@pytest.mark.legacy`，新增 explicit-binding 测试集骨架（先空跑）。
- 审计现有 `acc/store` + `acc/debugger` 中所有跨 run 读路径，加 run_id 断言。

**Exit criteria**：
- 全量回归（legacy lane）通过率与 baseline 一致。
- ProvenanceObject schema 已写入 `schemas/` 并通过 doctests。
- run_manifest checkpoint 字段在并发 run 测试下不会串 run。
- 可随时回滚：新结构未替换任何 agent-visible 字段。

### Phase 2 — Prompt 渲染解耦 + agent-visible 投影 + UI 透明度

**目标**：让 capsule 作者真正能控制 prompt 与 input.json 的内容；UI 能展示 resolved_prompt 与 binding lineage；启用 `explicit_only` binding_mode（按 workflow 选择性开启）。

**交付物**：
- `render_prompt` 重构（`acc/prompting.py:12-33`、`acc/runner.py:108-112`）：模板必须显式 `{{var}}` 引用才注入字段；`## ACC Runtime Input` 追加块的内容**由 capsule manifest `prompt_appendix_policy` 决定**（见 §7.4）：`legacy_full` 维持现网行为，`task_only` 仅含 binding `task` 字段，`none` 不追加。Phase 1 已落地的字段兜底默认为 `legacy_full`，因此 Phase 2 的 render_prompt 改造对未声明 capsule 行为不变。
- `build_clean_node_input_payload`（`acc/app/node_invocation.py:78-91`）拆分为两层：runtime_payload（写 `input.json`，含 provenance）与 agent_payload（投递到 prompt 渲染器，按 binding 声明过滤）。
- 新增 `acc_expose_upstream_context / acc_expose_provenance / acc_expose_workflow_metadata=[...]`（**字段级白名单**） flag，未声明节点 prompt 中不再自动出现 upstream_context / 流程结构。
- workflow 级 `binding_mode` 字段（`legacy_full / mixed / explicit_only`），UI 提供切换。
- 前端 RunInspector 增加 `Resolved Prompt` tab + `Provenance` toggle + `Applied Bindings` 列表（衍生自 `web/src/components/WorkflowViewer.tsx:2941-2995` 现有 PortInspector），含 `materialization_degraded` 降级标识。
- 新 explicit-binding 测试矩阵全部跑通；标记 standalone-equivalence 验证用例（同一 capsule 两模式下，workflow 模式产物的编排 metadata 字段集 ∩ 顶层键 = ∅；不再以"prompt 字符串字节级 diff"为目标，原因见 AC4）。

**Exit criteria**：
- mixed mode 下 legacy + explicit 节点共存，运行结果稳定。
- 至少一个内置 demo workflow 切换到 `explicit_only` 模式并通过端到端测试。
- AC1/AC2/AC3/AC4/AC9/AC10 在 `explicit_only` 模式下的不变量测试通过。
- 回滚路径：workflow 级 `binding_mode` 可降回 `legacy_full`，UI / runtime 行为退回 Phase 1。

### Phase 3 — ResultStore 抽象 + 默认翻转 opt-in + 老 graph 自动迁移

**目标**：把 BindingResolver 升级为正式的 ResultStore 抽象，作为 binding/provenance/pause-resume/并发隔离的唯一治理点；workflow 默认从 `legacy_full` 翻转为 `explicit_only`；提供历史文件迁移工具。

**交付物**：
- `acc/result_store/` 模块：以 (run_id, node_id, port_id) 为主键的 ArtifactBundle 寻址 + reference 物化扩展到任意节点（扩展 `acc/store/__init__.py:339-348`）。
- BindingResolver 重写为 ResultStore 客户端；inbox/outbox 文件系统降级为 ResultStore 默认后端。
- Pause/resume 走 ResultStore 显式 checkpoint，删除启发式 status 判定（替代 `acc/debugger.py:778-810` 的现有路径）。
- 迁移脚本 `tools/migrate_graph_to_explicit_binding.py`：扫描 `.graph.json` 自动产出 `data_edges` + `acc_expose_*` 注解 + `binding_mode=mixed`。
- 默认 `binding_mode` 翻转为 `explicit_only`；`legacy_full` 保留为 capsule 级 escape hatch。
- AC5/AC6/AC7/AC8/AC11/AC12/AC13/AC14 不变量在默认模式下全部成立。
- **Windows reference 物化降级落地**：`reference / symlink` 在 Windows 普通用户态自动降级为 `copy`，写入 `materialization_mode_resolved`，并 emit `materialization_degraded` 事件到 `events.jsonl`；Workbench inspector 据此渲染降级图标（见 §9.1 / §9.3）。本 fallback 不抛错，仅产生事件供审计。
- **运行时审批 hook 与调度结构约束**：审批节点必须独占 level（graph compile 阶段前后插入 readiness barrier），保证 awaiting-approval 不阻塞同 level 其他节点（详见 §11.3）。
- Performance：reference 物化扩展后大文件场景 baseline benchmark（含 Windows fallback 路径基准）。

**Exit criteria**：
- 全部内置 workflows / examples 在 `explicit_only` 默认下通过。
- 并发 run + pause/resume 压力测试无串 run / 误重跑。
- 迁移脚本对 `demo_parallel.graph.json / ui_demo_graph.graph.json` 自动迁移成功。
- 回滚：单 workflow 可回退到 `mixed/legacy_full`；ResultStore 后端可降级为旧 outbox 文件直读（feature flag）。

---

## 14. 验收标准与测试建议

以下条目均为可验证不变量，每条都能落到独立测试用例。

### AC1 — Control edge 仅 readiness
- **断言**：仅有 ControlEdge、无 DataEdge 时，下游节点 `agent_payload` 中不含上游任何 `output_summary / output_inline / inbox.records` 字段。
- **测试形态**：构造 A→B 仅 control 的 graph，assert `B.input.bindings_resolved == {}` 且 `B.input.json / resolved_prompt.md` 中不出现 ACC 编排 metadata 字段集（{`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`}）。

### AC2 — Agent-visible 输入由显式 binding 唯一决定
- **断言**：任何进入 `input.bindings_resolved / workflow.input / inbox.records` 的字段必须有对应 NodeInputBinding / WorkflowInputBinding / DataEdge；未声明字段一律不可见。
- **测试形态**：构造 A→B 含一条 DataEdge（仅声明 port `x`），assert B agent_payload 仅含 `x`，B 任何依赖 `y` 的逻辑 fail。

### AC3 — Provenance 默认 runtime-only
- **断言**：`producer_session_id / bundle_id / binding_applied / call_depth / materialization_mode_resolved / parent_frame_id` 不出现在 agent 的 `input.json` 与 `resolved_prompt.md`。
- **测试形态**：扫描 input.json 与 resolved_prompt.md，assert 上述字段集合 ∩ 文本字段集 = ∅。

### AC4 — Standalone-equivalent execution
- **断言**：同一 capsule 在 standalone 与 workflow 两种模式下，**workflow 模式产生的 `input.json` 与 `resolved_prompt.md` 中不得出现 ACC 编排 metadata 字段集** {`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`} 中的任意键（除显式 opt-in 节点外）；显式 binding 写入的字段允许出现。
- **测试形态**：双模式跑同一 capsule，对 workflow 模式产物做字段集扫描，assert 编排 metadata 字段集 ∩ `input.json` 顶层键集合 = ∅；显式 binding 写入字段按 binding 列表逐项出现。
- **注**：原"prompt 文本字节级 diff"目标因 standalone 路径用户输入结构自由（`acc/runner.py:47-62`）不可达，已收敛为字段集不变量。

### AC5 — 并发 run 不共享中间状态
- **断言**：`runs/<run_id>/nodes/<node_id>/` 树相互隔离；BindingResolver 拒绝 source `run_id` ≠ 当前 `run_id` 的引用。
- **测试形态**：并发起两个 run，故意构造一个跨 run 引用，assert 运行时断言 fail-fast。

### AC6 — Pause/resume 走显式 checkpoint
- **断言**：以 `run_manifest.completed_nodes + binding_materializations` 物化状态判定是否跳过节点；禁止误用旧 run 的 outbox/inbox。
- **测试形态**：模拟节点完成 outbox 但未追加 checkpoint 的情况，assert resume 重跑该节点；模拟兄弟 run 输出存在但本 run checkpoint 缺失，assert 不读取兄弟 run。

### AC7 — Final summary 由 aggregation 节点显式产生
- **断言**：`workflow_output_bindings` 必须显式指向 aggregation 节点的 port；runtime 不再隐式合并末端节点输出。
- **测试形态**：构造仅末端节点无 aggregation 的 workflow，assert `workflow_output_bindings` 校验失败；构造声明 aggregation 节点的 workflow，assert final summary 仅来自该节点。

### AC8 — upstream_context 默认 opt-in
- **断言**：节点必须显式 `acc_receive_upstream_context=true` 或在 binding 中列出 `upstream_context_fields` 才能看到 upstream_context；未声明节点不再自动注入。
- **测试形态**：在 `binding_mode=explicit_only` 下，未声明节点的 `input.json` 与 `resolved_prompt.md` 均不含 upstream_context；声明节点按白名单注入。

### AC9 — Prompt 渲染可控
- **断言**：`render_prompt` 只暴露显式声明的模板变量，不再无条件把 `input_payload` 整体序列化追加到 prompt 末尾；`## ACC Runtime Input` 块必须由模板显式触发。
- **测试形态**：模板未引用任何 input 字段时，prompt 输出与模板原文等价；显式 opt-in `## ACC Runtime Input` 后才出现该块。

### AC10 — UI Inspector 透明
- **断言**：UI 必须能展示节点最终被注入的 prompt（`resolved_prompt.md`）+ 已应用 binding 列表 + upstream_context 内容（toggle 显示），并能追溯每条 data_edge 在本 run 的物化模式。
- **测试形态**：投影层契约测试（`acc/app/run_projection.py:17-34` 的扩展点）assert 上述字段全部存在；前端 component 测试 assert toggle 行为。

### AC11 — Legacy 文件迁移期可执行
- **断言**：legacy `.graph.json` 与 v1/v2 `.accflow.json` 在迁移期保持可执行；`legacy_graph_importer` 自动生成兼容 binding 并打 legacy 标签。
- **测试形态**：跑 `demo_parallel.graph.json / ui_demo_graph.graph.json` 端到端 happy path；assert workflow `graph.legacy=true` 标签存在。

### AC12 — 测试分层
- **断言**：legacy 全量传递行为测试单独打 `@pytest.mark.legacy` 标签并隔离；新增 explicit-binding 测试矩阵覆盖"仅可见声明字段""未声明字段不可见""pause/resume 不串 run"等核心不变量。
- **测试形态**：CI 配置审计——legacy lane 与主 lane 独立可运行；主 lane 包含至少 AC1/AC2/AC4/AC5/AC6/AC8/AC9 测试。

### AC13 — ArtifactBundle 含结构化 Provenance
- **断言**：ArtifactBundle 必须包含结构化 ProvenanceObject（带 schema 的 dataclass / Pydantic 模型），至少记录 `binding_applied / upstream_lineage / materialization_mode_resolved`，可被持久化但默认不进入 agent 输入。
- **测试形态**：序列化/反序列化往返测试；assert 字段缺失时 schema 校验 fail。

### AC14 — 节点输出寻址化
- **断言**：下游 / UI / 调试器可通过 (run_id, node_id, port_id) 唯一定位 ArtifactBundle，无需手工遍历 outbox 目录。
- **测试形态**：ResultStore 查询 API 测试，给定 (run_id, node_id, port_id) 命中唯一 bundle；assert 多 port 节点不同 port 互不干扰。

### AC15 — Capsule prompt 兼容兜底
- **断言**：capsule manifest 未声明 `prompt_appendix_policy` 时，按 `legacy_full` 解释；声明 `task_only` 时 `## ACC Runtime Input` 块只含 binding `task` 字段，不含编排 metadata；声明 `none` 时不追加。即使 Phase 2 改写 `render_prompt`，未声明字段的现网 capsule 在新版 ACC 下行为字节级等同旧版。
- **测试形态**：取若干现网 capsule（不含 `prompt_appendix_policy` 字段），在 Phase 2 / Phase 3 ACC 下跑同一 input，assert `resolved_prompt.md` 字节级等于 Phase 1 baseline；声明 `task_only` 的 capsule assert 输出不含 `node / workflow.input / upstream_context / inbox.records / __acc_control_context` 任意键。

### AC16 — 内部路径相对化
- **断言**：NodeResult / ProvenanceObject 在持久化层（`runs/<run_id>/node_results/<node_id>.json`、`run_manifest.json`、`binding_manifest.json`）中所有路径字段均为相对 `run_dir` 的相对路径；绝对路径仅出现在 ENV 透出与 inspector 渲染时。
- **测试形态**：把 `runs/<run_id>/` 目录整体改名后回放，assert ResultStore 查询、binding 解析、Provenance 渲染全部仍然成立；assert 文本扫描 `runs/<run_id>/` 下所有 JSON 不含 host-specific 绝对路径前缀。

### AC17 — 平台 fallback 可观测
- **断言**：当 binding 声明 `materialization=reference` 而平台不支持（典型场景：Windows 普通用户态无 `SeCreateSymbolicLinkPrivilege`）时，runtime 自动降级为 `copy`，写入 `materialization_mode_resolved=copy`，并 emit 一条 `materialization_degraded` 事件到 `events.jsonl`；不抛错。
- **测试形态**：mock `os.symlink` 抛 `OSError`，assert binding 仍然成功解析、`materialization_mode_resolved` 等于 `copy`、events 流中包含 `materialization_degraded` 事件、Workbench 投影中 binding 行渲染降级图标。

---

## 15. 仍需用户确认的问题

1. **upstream_context 的最终归宿**：Phase 3 翻转默认为 opt-in 后是否彻底退役，还是永久保留作为兼容/调试通道？需要用户对兼容窗口长度拍板。
2. **ProvenanceObject 是否需要稳定的对外 schema**：是否被外部工具、CI 流水线消费？还是仅作为 ACC 内部数据结构、可自由演进？此决定直接影响字段命名与版本治理策略。
3. **Final summary 由 aggregation 节点产生（AC7）**：是否需要 ACC 提供一个内置的 `aggregation` capsule 类型，还是完全留给用户自己写 capsule + `workflow_output_bindings`？
4. **`binding_mode` 的粒度选择**：放在 workflow 级还是节点级？粒度选择会显著影响 mixed 阶段的复杂度与迁移工作量。
5. **render_prompt 的破坏性改造**：是否需要给 capsule 作者一个迁移期 flag（`acc_legacy_prompt_appendix=true`），还是一次性切换？现有 prompt 模板对"自动追加 JSON 块"的依赖范围需要先做模板审计。
6. **UI 透明度上线节奏**：Phase 2 就支持 ProvenanceSummary toggle，还是延后到 Phase 3 与 default 翻转一起上线？取决于发布节奏与设计资源。
7. **同一 data_edge 是否允许多 source（fan-in concat / merge）**：现有 schema 未明确（`schemas/workflow_graph_v3_schema.json:58-105`）；如果允许，需要定义合并语义与冲突处理。
8. **Nested workflow 的 ProvenanceSummary 继承**：子 workflow 内部节点是否要继承父 frame 的 ProvenanceSummary，还是必须由子 workflow 显式重新声明？
9. **Pause/resume 异常恢复策略**：发现 outbox_manifest 缺失但 status=completed 时，应该报错回滚还是降级重跑？需要明确恢复策略。
10. **Reference 物化的 Windows fallback**：reference 模式扩展到一般 node-to-node 是否会触碰 OS 级 inode/symlink 限制（尤其 Windows 环境）？是否需要平台 fallback？需要 benchmark 决定默认值。
11. **测试三层分层的 CI 治理**：CI 资源预算如何分配？`@legacy` 是否允许失败、是否阻断主 lane？需要确定治理策略。

### 15.1 v0.2 评审新增待确认（基于第一性原理查漏补缺）

12. **standalone 路径是否要把用户输入 wrap 成 `task` 子键以达成 AC4 / AC5 的结构同构**？目前 standalone 路径（`acc/runner.py:47-62`）的 `input_payload` 顶层结构由用户自由决定，与 workflow 路径的 `{"task": ...}` 包装在结构上不可同构。AC4 已收敛为"字段集不变量"，但仍可在 CLI 层加可选 wrap 提升 UX 一致性——是否值得做？
13. **selector 语法是否统一为 `<namespace>:<jsonpath>`**？目前文档混用 `.summary`、`.structured.verdict`、`outbox:port`、`artifact:path` 四种形态。建议统一为 `field:.path / outbox:port / artifact:path / each_of:<node_id>.<path>`；是否一次性切到统一规范，还是 Phase 2 兼容混用、Phase 3 收紧？此决定影响 schema-aware autocomplete 的实现复杂度。
14. **`each_of:<for_each_node_id>.<field_path>` 的 fan-in selector 是否进 Phase 3 一等公民**？aggregation 节点接收 `for_each` 展开后的多实例同名字段时，没有该 selector 就只能让用户手列每个实例 ID，违背"显式但简洁"原则。如果引入，BindingResolver 与 Workbench Binding 编辑器都要扩展。
15. **`source_artifact_sha256` 在多文件 outbox 引用时记录什么**？当 binding selector = `outbox:research_port` 引用整个 port 目录而非单文件时，是否记录每个文件 sha256 数组（精确但占空间）、目录顺序串接哈希（紧凑但不稳定）、还是只记录 `outbox_manifest.json` 自身的 sha256（最稳定但失去文件级粒度）？此决定直接影响 `node_version_hash` 的稳定性与 pause/resume 的命中率。
16. **Windows `materialization_degraded` 事件是否需要 surface 给 capsule 作者层**？当前设计仅写入 `events.jsonl` + Workbench inspector；是否需要把降级摘要也写进 `binding_manifest.json` 以让 capsule 测试断言"我期望走 reference 但实际走了 copy"？这关乎 capsule 在不同平台测试的可观测性。

---

## 附录: 证据索引

以下为正文中引用的 `file:line`，去重排序：

- `acc/app/__init__.py:912-927`
- `acc/app/node_invocation.py:78-91`
- `acc/app/node_invocation.py:94-117`
- `acc/app/run_projection.py:17-34`
- `acc/debugger.py:43-55`
- `acc/debugger.py:771-775`
- `acc/debugger.py:778-810`
- `acc/domain.py:62-79`
- `acc/domain.py:70-73`
- `acc/domain.py:83-87`
- `acc/domain.py:142-151`
- `acc/domain.py:218-231`
- `acc/domain.py:321-335`
- `acc/environment.py:41-51`
- `acc/events.py:69-154`
- `acc/legacy_graph_importer.py:157-211`
- `acc/legacy_graph_importer.py:396-423`
- `acc/port_io.py:97-158`
- `acc/prompting.py:12-33`
- `acc/runner.py:47-62`
- `acc/runner.py:108-112`
- `acc/runtime/__init__.py:136-171`
- `acc/server/run_manager.py:36-52`
- `acc/store/__init__.py:199-206`
- `acc/store/__init__.py:339-348`
- `acc/store/__init__.py:724-739`
- `acc/store/__init__.py:745-791`
- `acc/workflow_graph.py:243-264`
- `bindings/Implementation_Flow.binding.local.json:1-9`
- `schemas/workflow_graph_v3_schema.json:58-105`
- `tests/unit/test_clean_workflow_engine.py:169-198`
- `tests/unit/test_clean_workflow_engine.py:254-276`
- `web/src/components/WorkflowViewer.tsx:812-869`
- `web/src/components/WorkflowViewer.tsx:2941-2995`
- `web/src/components/WorkflowViewer.tsx:3575-3622`
- `web/src/types.ts:193-227`
- `workflows/acc_workspace_canvas.accflow.json:29-128`
- `workflows/acc_workspace_canvas__Implementation_Flow.accflow.json:41-43`
