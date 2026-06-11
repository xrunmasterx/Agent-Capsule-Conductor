# Codex Goal Workflow Message Routing —— IMPLEMENTATION STRATEGY

> 配套：`DESIGN.md` v0.2、`TEST_PLAN.md` (77 cases / 18 ACs)、`AUDIT_PLAN.md` (89 audit checks / 10 dimensions)。
> 仓库根：`F:/Agent-Capsule-Conductor/`；本文不含全量代码列表，仅给落地路径与 file:line 证据。
> 状态：`v0.1 — initial draft`，对齐 DESIGN.md v0.2 的 18 条 AC 与 §15 Q1–Q16 开放问题。

---

## 1. 摘要

### 1.1 核心原则（四句话）

1. **Disk-as-truth**：`runs/<run_id>/` 目录树是唯一事实源；run_manifest.json / events.jsonl / outbox_manifest.json / binding_manifest.json 互相对账，scheduler 与 BindingResolver 内存状态全部可由磁盘重建（DESIGN §11.1–§11.2，AUDIT N-005 / O-005 / O-006）。
2. **Binding-driven explicit data flow**：control edge 仅承担 readiness；任何上游 → 下游的字段流动必须由 5 种 Binding kind 中的某一条声明，未声明字段在 `binding_mode=explicit_only` 下默认不可见（DESIGN AC1 / AC2，AUDIT C-001 / C-002）。
3. **AgentPayload vs RuntimePayload split**：`runs/<run_id>/nodes/<node_id>/input.json` 含 runtime 编排 metadata，但 `resolved_prompt.md` 渲染上下文 (`AgentPayload`) 由 binding 与 `acc_expose_*` 白名单严格过滤；非 opt-in 节点不出现 ACC 编排 metadata 字段集（DESIGN AC3 / AC4，AUDIT S-001 / S-002）。
4. **Standalone-Equivalent Agent Execution**：同一 capsule 在 standalone 与 workflow 两种模式下，agent 看到的字段集恒等于 binding 列表 + capsule manifest 声明；workflow 模式产物的 `input.json` 顶层键 ∩ {`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`} = ∅（除显式 opt-in，DESIGN AC4 / §4，AUDIT C-004）。

### 1.2 改什么 / 不改什么

**保留（不重写）**：

- ControlEdge readiness 语义与 ancestor_masks 校验（`acc/workflow_graph.py:243-264`）；
- events.jsonl append-only 协议与 `iter_jsonl_events` 重放（DESIGN §2.4，原型在 `acc/events.py`）；
- capsule manifest 大致结构（`schemas/capsule_template_schema.json` 仅新增 `prompt_appendix_policy` 字段）；
- Workbench DAG 模型（前端 `WorkflowCanvasEdge` union, `web/src/types.ts:193-227`）；
- ScopeFrame / EnvironmentFrame 树形 (`acc/domain.py:124-139`) 与 `WorkbenchRunManager` 物理隔离 (`acc/server/run_manager.py:38-45`)；
- `port_io.materialize_inbox` 端口级路径解析（DESIGN §2.2 引用，逻辑在 `acc/port_io.py:97-158`）；
- `AgentRunRequest` 现有字段集（`acc/adapters/base.py:11-30`），仅追加 `run_id / run_dir`。

**重写（surgical refactor）**：

- 节点输入装配：`acc/app/node_invocation.py:78-91` 的 `build_clean_node_input_payload` 一次性把 5 段输入硬装在一起，必须拆为 `build_runtime_payload` + `build_agent_payload`（DESIGN §7.4、§8.1）。
- prompt 自动追加：`acc/prompting.py:12-33` 在模板未引用 `input_json` 时无条件追加 `## ACC Runtime Input` JSON 块的逻辑必须按 `prompt_appendix_policy` 三档分支（DESIGN AC9 / AC15，AUDIT C-009 / S-002）。
- run_manager 恢复：`acc/server/run_manager.py:191-204` 的 `_reconcile_interrupted_runs` 当前一律把 `ACTIVE_RUN_STATUSES` 标 `crashed`，必须扩展为基于 `pause_marker` 区分 `paused / crashed`，并对接 `run_manifest.completed_nodes` 显式 checkpoint（DESIGN §11.2 / AC6，AUDIT E-005 / C-006）。
- legacy importer 默认值：`acc/legacy_graph_importer.py:276-280` 的 `parse_control_context` 默认 `"upstream_output"`，Phase 3 翻转前必须先在 importer 出口侧注入 `LegacyPassthroughBinding`（DESIGN §7.6 / §12.2 / §12.3，AUDIT M-001）。
- 嵌套 workflow 输入：`acc/app/workflow_call.py:13-48` 的 `build_nested_workflow_input_payload` 在没有显式 `WorkflowCallInputBinding` 时直接把父 `upstream_context` 装进子 workflow 的 `__acc_control_context`，违反 AC18 nested isolation（AUDIT C-017）。

**与 DESIGN.md v0.2 的关系**：

- 本文不替代 DESIGN，也不重新拍 ACs；DESIGN 给"做什么、为什么"，本文给"先做哪一步、改哪个 file:line、配合哪条 T-NNN / 哪条审计 check"。
- DESIGN §13 的三阶段在本文 §6 展开为 file-level changes + per-phase exit criteria。
- DESIGN §15 Q1–Q16 在本文 §7、§8.3 给出"本阶段如何回应 / 是否推迟到 Phase 3 / 是否拍板"的对应表。

### 1.3 阅读路径

| 角色 | 推荐顺序 |
|---|---|
| executor（实施者） | §1 → §6 changes 表 → §5 重构判定表 → 附录 A 模块清单 → 附录 B 命令 |
| designer（架构 review） | §1 → §3 cross-cutting invariants → §4 模块边界 → §6 阶段切换开关位 → §7 风险 → §8 与三件套关系 |
| reviewer（codex 评分） | §3 → §4 → §5 → §6 → 附录 C CCB checkpoint |
| 维护者（看历史变更） | §2 5 大原语组 → §5 重构判定表 → 附录 A 模块清单 |

### 1.4 文档约定

- **粗体**：跨章节高亮的关键术语；首次出现时绑定到原语（§2）。
- `inline code`：仅用于 file path、identifier、命令、JSON 字段名。
- "推断"或"(inferred)"：未经直接代码勘察验证、由上下文推导出的结论；执行前需要再核。
- file:line 引用：所有正文 file:line 引用均在写作时通过 Read 工具直接验证；附录 A 模块清单中的新文件路径不带 file:line（尚未存在）。
- "Phase N 新增"标签：表示该原语 / 文件在 Phase N 阶段才落地，Phase N-1 阶段不存在或仅有骨架。

---

## 2. 第一性原理：5 大原语组

> 每个原语用表格列出 `name / 一句话定义 / inputs / outputs / invariants / current_code_location`。`current_code_location` 标 `missing` 即 Phase 1 / Phase 2 / Phase 3 新增。

### 2.1 data_plane（数据面原语）

| name | 一句话定义 | inputs | outputs | invariants | current_code_location |
|---|---|---|---|---|---|
| `ArtifactBundle` | 一次节点运行的产物快照 | `bundle_id / node_id / run_id / files / outputs / provenance` | 持久化 JSON + outbox dir | bundle_id 全局唯一；files[*].sha256 必填 | `acc/domain.py:142-151`（provenance 仍是 `dict[str, Any]`，待升级） |
| `NodeResult` | `(run_id, node_id, port_id) → ArtifactBundle` 寻址 | tuple key | typed `NodeResult` dataclass + ArtifactBundle | 路径全部 relative-to-`run_dir`（AC16） | 部分存在 (`acc/debugger.py:43-55` 的 `WorkflowNodeResult` 形态) — Phase 1 抽离为 `acc/result_store/` 新模块 |
| `NodeInputBinding` | 节点内端口绑定 | `source: DataEndpoint? / target_port / static_value? / materialization / required` | 解析后 → AgentPayload 字段 | 与 ProvenanceObject 同一原子写 | `acc/domain.py:218-224`（已有，需扩 `selector / kind` 字段） |
| `NodeOutputBinding` | 节点产物 → 下游 binding 桥接 | `source_port / target / materialization / required` | 桥接到 NodeInputBinding | 同上 | `acc/domain.py:226-231` |
| `WorkflowInputBinding` | workflow 边界入参 → 内部节点 | `source_port / target / materialization / required` | inbox manifest entry | source_port 必须在 `exposed_inputs` 内 | `acc/domain.py:82-87` |
| `WorkflowOutputBinding` | 内部节点 → workflow 出参（aggregation 节点显式指向） | `source: DataEndpoint / target_port / materialization / required` | workflow_output_bindings entry | source.node 必须是 aggregation-kind（AC7） | `acc/domain.py:90-95` |
| `WorkflowCallInputBinding` | 嵌套 workflow 调用入参边界 | `source / workflow_input / static_value / materialization` | 子 run 边界 inbox | 不得透传 `__acc_control_context`（AC18） | `acc/domain.py:235-240`；触发 `acc/app/workflow_call.py:13-48` 的需要重写 |
| `LegacyPassthroughBinding` | "沿用旧 upstream_context 全量传递"显式建模 | `kind="legacy_passthrough"` | BindingResolver dispatch 进 legacy 路径 | `selector` 字段必须为空；只能由 importer 注入 | `missing` — Phase 1 新增（DESIGN §7.6） |
| `BindingResolver` | binding → ResultStore 查询 → AgentPayload 装配 | `(run_id, node_id, binding_list)` | `BindingResolverResult{agent_payload, runtime_payload, materializations}` | 拒绝 `source_run_id != current_run_id`（AC5）；可重入 | `missing` — Phase 1 适配器层 (`acc/binding/`)，Phase 3 升级为 ResultStore client |
| `ProvenanceObject` | 结构化运行时元数据 | `binding_applied / upstream_lineage / materialization_mode_resolved / producer_session_id / frame_id / call_depth / inline_value_sha256 / source_artifact_sha256 / schema_version` | 持久化到 `node_results/<node_id>.json` + events.jsonl | 默认不入 input.json；hash 互斥（AUDIT C-016） | `missing` — Phase 1 新增 `acc/provenance.py`（DESIGN §13 Phase 1 交付物） |
| `TransferPolicy` | copy / reference / symlink 选择 + Windows fallback | `declared_mode / platform_capabilities` | `materialization_mode_resolved` + `degraded?` | Windows 无 `SeCreateSymbolicLinkPrivilege` → fallback 到 `copy` 并 emit `materialization_degraded` | reference 模式当前只在 `acc/store/__init__.py:339-348` 启用；Phase 3 扩到任意节点 |
| `InlineThreshold` | 256 KiB 决策内联 vs reference | payload bytes | bool inline | 超阈值强制 reference（AUDIT P-003） | `acc/app/node_invocation.py:11`（常量名 `MAX_UPSTREAM_CONTEXT_INLINE_BYTES = 256 * 1024`），Phase 1 抽出到 `acc/binding/thresholds.py` |
| `EachOfFanInSelector` | for_each 展开后多实例的同名字段聚合 | `each_of:<source_node_id>.<field_path>` | list（按 `instance_index` 排序） | 顺序确定（AUDIT C-018）；O(N) over arity（AUDIT P-007） | `missing` — Phase 3 一等公民（DESIGN §15.14） |
| `NamespaceSelector` ADT | 统一 selector 语法 `<namespace>:<path>`，namespace ∈ 权威 5 元 `{field, outbox, artifact, each_of, legacy}` | str | discriminated union `{FieldSelector, OutboxSelector, ArtifactSelector, EachOfSelector, LegacySelector}` | parse-validate at workflow load-time（AUDIT E-006） | `missing` — Phase 2 新增（DESIGN §15.13） |

### 2.2 control_plane（控制面原语）

| name | 一句话定义 | inputs | outputs | invariants | current_code_location |
|---|---|---|---|---|---|
| `ControlEdge` | 仅表达 readiness | `source / target / condition / context` | scheduler readiness 状态机更新 | 新代码不读 `context` 字段；Phase 3 默认 `"none"` | `acc/domain.py:62-66`（`context: ControlContextMode = "upstream_output"`，Phase 1 仅文档化为 deprecated，Phase 3 翻转默认值） |
| `ReadySetComputer` | O(E+V) per level 计算下一批可调度节点 | `graph + completed_nodes` | `ready_set: set[NodeId]` | 复杂度严格 O(E+V)，禁止 O(V²)（AUDIT P-001） | 当前 `topological_levels` (`acc/workflow_graph.py:44, 53`) 是预计算 levels，未做增量；Phase 1 抽出至 `acc/scheduler/ready_set.py` |
| `LevelScheduler` | 当前实现：按 topological level 用 `asyncio.gather` 一次性等所有节点 | `levels / max_concurrency` | level-by-level 完成 | 单层 fan-in 阻塞所有（DESIGN §11.3 已识别）；Phase 1 不动 | `acc/app/__init__.py:534-575` |
| `DAGScheduler` | Phase 2/3 演进形态：完成即调度下一就绪节点，不再 level-block | `graph / completed_nodes / max_concurrency` | per-node 调度事件 | 同 ReadySetComputer 复杂度；ApprovalBarrier 可独占 level | `missing` — Phase 2/3 新增 `acc/scheduler/dag_scheduler.py` |
| `ApprovalBarrier` | 监控独占 level，graph compile 阶段插入 readiness barrier | `graph + approval_node_ids` | 改写后的 graph（含 barrier 伪节点） | 审批 wait 不阻塞同 level 其他分支（DESIGN §11.3） | `missing` — Phase 3 新增 `acc/scheduler/approval_barrier.py` |
| `FailureMode` | `fail_fast / continue / retry` 三选一 | NodeStatus | workflow_status 转移 | 终态进入 `success / failed / cancelled`；与 `ConcurrencyPolicy` permit 释放对账（AUDIT N-001） | `acc/workflow_graph.py:25`（`DEFAULT_POLICY = {"failure_mode": "fail_fast", "max_concurrency": 1}`） |
| `MaxConcurrencyPolicy` | per-workflow level 内并发上限 | int | `asyncio.Semaphore` | `max_concurrency=1` 不再硬编码默认（AUDIT M-007） | `acc/workflow_graph.py:25` + `acc/app/__init__.py:529, 544`；Phase 1 改为可配置 |
| `PartialAggregate` | strict / best_effort 聚合策略 | `EachOfFanInSelector` 解析结果 | aggregator 入参 | strict 任一失败抛 `AggregationFailedError`（AUDIT E-007） | `missing` — Phase 3 新增 `acc/runtime/partial_aggregate.py` |
| `CancelSignal` | level boundary 轮询取消标记 | `cancel_marker` 文件存在性 | scheduler 早退 | 仅 level boundary，不抢占运行中节点（AUDIT N-006） | `acc/server/run_manager.py:206-211`（`_write_cancel_marker / _cancel_marker`） |

### 2.3 persistence（持久化原语）

| name | 一句话定义 | inputs | outputs | invariants | current_code_location |
|---|---|---|---|---|---|
| `runs/<run_id>/` 目录契约 | 单 run 全部事实源 | run_id | dir tree (`nodes/`, `events.jsonl`, `run_manifest.json`, `outbox/`, `cancel_requested?`, `pause_marker?`) | 跨 run 不共享文件（AC5） | `acc/server/run_manager.py:38-45`（`runs_root` 与 `max_active_runs`） |
| `run_manifest.json` | run 级状态、节点 checkpoint、binding 物化记录 | sequential append | `{run_id, status, completed_nodes[], binding_materializations[]}` | 原子写（temp+rename，AUDIT E-004 / O-005）；串行写（AUDIT N-005） | 部分存在 (`acc/server/run_manager.py:122-156` 的 `RunSummary` 模型不含 `completed_nodes/binding_materializations`)，Phase 1 扩字段 |
| `completed_nodes` | 节点级原子提交记录 | `(node_id, finalized_at, materialization_records)` | run_manifest 数组追加 | 必须先写 outbox_manifest 后追加 checkpoint（DESIGN §11.2） | `missing` — Phase 1 新增 |
| `binding_materializations` | 每条 `(node_id, port_id, materialization_mode_resolved, finalized_at, hash)` | per-binding | run_manifest 数组追加 | 与 ProvenanceObject 同原子写（DESIGN AC13） | `missing` — Phase 1 新增 |
| `events.jsonl` | append-only 真相流 | `(event_id, ts, run_id, node_id?, frame_id?, kind, payload)` | 文件追加 | 仅写本 run；trace IDs 完备（AUDIT O-008） | 现存 `acc/events.py:69-154`；Phase 1 仅新增事件 kind |
| `outbox_manifest.json` | per-port 文件清单 + sha256 | port_id → files | JSON | files[*].sha256 必填，被 ProvenanceObject `source_artifact_sha256` 复用（DESIGN §7.2） | `acc/store/__init__.py:864-877` 已有 |
| `NodeCacheKey` | node 复算键 | `sha256(capsule_id + capsule_version + ordered binding_inputs_sha256)` | hex digest | 用于 pause/resume skip 决策；与 `completed_nodes` checkpoint 配套（AC6） | `missing` — Phase 1 新增 `acc/persistence/cache_key.py`（pause/resume *consumer* 仍 Phase 3） |
| 原子写 helper | `tempfile + os.replace` | path + payload | atomic write | `partial JSON` 永不持久化；rename 失败抛错（AUDIT E-004） | 部分存在（`acc/run_index.py` 的 `write_json`）；Phase 1 全 reviewer 替换 |
| `CrashedRecovery` | 当前：把 `ACTIVE_RUN_STATUSES` 一律改成 `crashed` | runs_root 扫描 | 状态翻转 | 不区分真正 crashed vs 用户主动 paused | `acc/server/run_manager.py:191-204`（`_reconcile_interrupted_runs`） |
| `PauseResume` | Phase 3 演进：基于 `pause_marker` + `completed_nodes` 显式恢复 | runs_root 扫描 | resume 跳过已完成节点 | checkpoint 缺失则重跑（AC6） | `missing` — Phase 3 替换 `_reconcile_interrupted_runs`（AUDIT E-005） |

### 2.4 identity（身份原语）

| name | 一句话定义 | inputs | outputs | invariants | current_code_location |
|---|---|---|---|---|---|
| `RunId` | run 唯一 ID | str | NewType('RunId', str) | 中央 `validate_run_id` 校验（AUDIT T-005） | 当前裸 `str`（`acc/domain.py:127` `EnvironmentFrame.run_id: str`），Phase 1 改 NewType |
| `NodeId` | 节点唯一 ID | str | NewType | 同上 | `acc/domain.py:62` `ControlEdge.source: str`，Phase 1 改 NewType |
| `PortId` | 端口唯一 ID | str | NewType | 同上 | `acc/domain.py:71` `DataEndpoint.port: str`，Phase 1 改 NewType |
| `FrameId` | scope_frame 唯一 ID | str | NewType | 同上 | `acc/domain.py:137-138` `scope_frame_id / parent_scope_frame_id` |
| `call_depth` | 嵌套深度 | int | int | `RecursionPolicy.max_depth` 上限（推断：递归 guard 见 `acc/domain.py:266-272`） | `acc/domain.py:139`（`call_depth: int = 0`） |
| `invoking_workflow_call_id` | 嵌套调用边界标识 | str | NewType | nested workflow lineage 重建依赖（AUDIT O-006） | `missing` — Phase 1 新增（per DESIGN §7.2） |
| `ProvenanceSchemaVersion` | ProvenanceObject 字段 schema 版本号 | str (semver) | str | Phase 1 `internal-may-break` / Phase 3 `frozen public` | `missing` — Phase 1 加 `schema_version` 字段，Phase 3 冻结 |
| capsule compound key | `(capsule_id, capsule_version)` | tuple | hashable key | 同 capsule_id 不同版本视作不同实体；Cache key 必须包含 version | 部分（`acc/registry.py` 当前以 capsule_id 为主键，Phase 3 与 NodeCacheKey 联动） |

### 2.5 visibility（可见性原语）

| name | 一句话定义 | inputs | outputs | invariants | current_code_location |
|---|---|---|---|---|---|
| `AgentPayload` | 真正进入 prompt 渲染 + agent 可读区域 | `BindingResolverResult` 过滤后 | TypedDict / dataclass | 顶层键 ⊂ binding-declared keys ∪ ExposeMetadataFlag whitelist；非 opt-in 不含 ACC 编排 metadata（AC4） | `missing` — Phase 2 新增 `acc/runtime/payload.py` |
| `RuntimePayload` | 写 input.json 的全量 metadata（含 provenance） | binding + runtime metadata | TypedDict / dataclass | 永不被 prompt 渲染器读（DESIGN §7.4） | 现状由 `build_clean_node_input_payload` 直接产出，Phase 2 拆分 |
| `PromptAppendixPolicy` | `legacy_full / task_only / none` 三档 | capsule manifest 字段 | Enum | 未声明 → 兜底 `legacy_full`（AC15）；新建 capsule 默认 `task_only`（DESIGN §7.4） | `missing` — Phase 1 schema + 兜底默认值，Phase 2 接通 render_prompt（AUDIT T-008） |
| `BindingMode` | `legacy_full / mixed / explicit_only` 三档 | workflow-level | Enum | Phase 3 默认翻转为 `explicit_only`（DESIGN §12.3） | `missing` — Phase 2 新增（AUDIT T-008） |
| `ExposeMetadataFlag` whitelist | `acc_expose_workflow_metadata=[...]` 字段级白名单 | list[str] | allow-list | 空 list = zero exposure；不支持 deny-list（AUDIT S-006） | `missing` — Phase 2 新增（替代旧版 bool 总开关，DESIGN §10.2） |
| ENV 透出（现存） | adapter 透出给 capsule 进程的环境变量 | adapter 入参 | `os.environ` 增量 | 三 adapter 一致（AUDIT S-003） | 现状仅 `ACC_INBOX_DIR / ACC_OUTBOX_DIR / ACC_ENVIRONMENT_ID / ACC_NODE_ID`，见 `acc/adapters/codex_cli.py:23-31` |
| ENV 透出（Phase 1 新增） | `ACC_RUN_ID / ACC_RUN_DIR` | `AgentRunRequest.run_id / run_dir` | 三 adapter 一致补齐 | 不写 `input.json` 顶层；仅 ENV（DESIGN §10.2 注） | `missing` — Phase 1 新增 `AgentRunRequest.run_id / run_dir` 字段（`acc/adapters/base.py:11-30`） |
| `StandaloneEquivalentExecution` | AC4 不变量 | capsule + binding | 字段集等价（不是字节等价） | workflow 模式产物的 input.json 顶层键 ∩ {`node`, `workflow.input`, `upstream_context`, `inbox.records`, `__acc_control_context`} = ∅（非 opt-in） | `missing` — 由 BindingResolver + AgentPayload 构造保证；T-050 / C-004 验证 |

---

## 3. 跨原语不变量（cross-cutting invariants）

> 这些不变量跨多个原语，破坏其中任一条都需要触发审计 critical 上线门。

| # | 不变量 | 涉及原语 | 关联 AC / 审计 |
|---|---|---|---|
| X-1 | 每个 BindingResolver 输出必须与 ProvenanceObject 在**同一原子写**中落盘到 `node_results/<node_id>.json` 与 `run_manifest.binding_materializations`；不允许 binding 已写 而 provenance 未写 | BindingResolver / ProvenanceObject / 原子写 helper / run_manifest | AC13 / AC6 / AUDIT E-004 / O-005 |
| X-2 | `AgentPayload` 顶层 keys ∩ `{node, workflow.input, upstream_context, inbox.records, __acc_control_context}` = ∅（非 opt-in 节点） | AgentPayload / BindingResolver / ExposeMetadataFlag | AC4 / AUDIT C-004 / S-001 |
| X-3 | BindingResolver 解析的每条 selector 必须满足 `source_run_id == current_run_id`，否则抛 `CrossRunReferenceError` | BindingResolver / RunId / NamespaceSelector | AC5 / AUDIT C-005 / S-004 |
| X-4 | ProvenanceObject 的 `inline_value_sha256` 与 `source_artifact_sha256` 互斥（恰一非空） | ProvenanceObject / TransferPolicy | DESIGN §7.2 / AUDIT C-016 |
| X-5 | 持久化到 `runs/<run_id>/*.json` 的所有路径字段必须是 relative-to-`run_dir`；绝对路径仅出现在 ENV 透出与 inspector 渲染瞬时拼接 | NodeResult / ProvenanceObject / outbox_manifest / 原子写 helper | AC16 / AUDIT S-005 |
| X-6 | `materialization_mode_resolved` 与 declared mode 不一致时，必须 emit `materialization_degraded` 事件且写入 `binding_materializations` 行 | TransferPolicy / events.jsonl / run_manifest | AC17 / AUDIT O-003 / E-003 |
| X-7 | run_manifest checkpoint 必须**先写 outbox_manifest.json，再原子追加 `completed_nodes`**；resume 时仅以 `completed_nodes` 决定是否跳过 | run_manifest / outbox_manifest / PauseResume | AC6 / AUDIT C-006 / E-005 |
| X-8 | capsule manifest 未声明 `prompt_appendix_policy` → runtime 兜底 `legacy_full`；loader 不得静默写入缺省值（保留缺省语义即 legacy） | PromptAppendixPolicy / capsule loader | AC15 / AUDIT M-003 |

### 3.1 不变量执行点

每条不变量必须在以下三个层面落地：(1) 类型签名（mypy --strict 编译期）；(2) 运行时断言（fail-fast，不静默吞错）；(3) 端到端测试（TEST_PLAN.md T-NNN）。下表给出每条 X-N 的三层落地。

| # | 类型签名落地 | 运行时断言落地 | 端到端测试 |
|---|---|---|---|
| X-1 | `BindingResolverResult` 含 `provenance: ProvenanceObject` 必填字段 | `acc/persistence/run_manifest.py` 的 `append_completed_node` 同时写两条 record；缺一抛 `IncompleteCheckpointError` | T-052 / T-040 |
| X-2 | `AgentPayload` TypedDict + `_FORBIDDEN_TOP_LEVEL_KEYS` frozenset 编译期 assert | `acc/runtime/payload.py::build_agent_payload` 装配后扫描 `keys & _FORBIDDEN`；非空抛 `AgentPayloadLeakError` | T-021 / T-050 / T-070 |
| X-3 | `RunId` NewType + selector 解析返回 `Selector(source_run_id: RunId, ...)` | `acc/binding/resolver.py::_assert_same_run` 在 ResultStore 查询前校验 | T-029 / T-044 / T-051 / T-076 |
| X-4 | ProvenanceObject `__post_init__` 校验互斥 | 序列化前再次 assert（防止字段被外部 mutate） | T-007 (unit XOR check on ProvenanceObject construction) + T-046 (property: 100% mutex across [0, 1 MiB]) |
| X-5 | `RelativePath` NewType（推断）+ atomic_write helper 签名 | `acc/persistence/atomic_write.py::write_json_relative` 扫描 payload 内所有路径字符串 | T-062 |
| X-6 | `MaterializationResolved` dataclass 含 `degraded: bool` | `acc/runtime/transfer_policy.py::resolve` 在 fallback 分支统一 emit | T-063 / T-072 |
| X-7 | `RunManifestCheckpoint` 序列化顺序 freeze | `acc/persistence/run_manifest.py::commit_node` 的两步原子写有显式断言 | T-008 / T-019 / T-052 |
| X-8 | `PromptAppendixPolicy` Enum + `default_when_missing()` helper | capsule loader 不写默认值；render_prompt 调用前 resolve | T-061 |

---

## 4. 模块边界与依赖方向

> 8 层目标拓扑（Phase 1 抽骨架，Phase 2 接通 prompt 解耦，Phase 3 换核 ResultStore）。`acc/binding/`、`acc/result_store/`、`acc/runtime/`、`acc/persistence/`、`acc/scheduler/` 为 Phase 1/2/3 新增；其余为现有路径。

### 4.1 8 层职责与依赖矩阵

| layer | responsibility | allowed_inbound（被谁 import） | allowed_outbound（可以 import 谁） | forbidden_dependencies |
|---|---|---|---|---|
| `acc/binding/` | binding 类型、selector parser、BindingResolver（适配器层） | `acc/result_store/`、`acc/runtime/`、`acc/app/`、`acc/server/`（仅通过公共 API） | `acc/domain`、`acc/persistence/`、`acc/result_store/`、stdlib | `acc.server` / `acc.app` / `acc.cli` / `acc.scheduler` / `acc.runtime` / `acc.adapters` / `fastapi` / `typer` / `subprocess` |
| `acc/result_store/` | `(run_id, node_id, port_id) → ArtifactBundle / NodeResult` 寻址 + cache | `acc/binding/`、`acc/runtime/`、`acc/app/`、`acc/server/`、`acc/scheduler/` | `acc/domain`、`acc/persistence/` | `acc.server` / `acc.cli` / `acc.app` / `fastapi` / `typer` |
| `acc/runtime/` | frame / fan_out / partial_aggregate / approval / payload / transfer_policy | `acc/app/`、`acc/scheduler/` | `acc/domain`、`acc/binding/`、`acc/result_store/` | `acc.app` / `acc.cli` / `acc.server` / `acc.store` |
| `acc/persistence/` | run_manifest writer / events writer / atomic write / NodeCacheKey | `acc/binding/`、`acc/result_store/`、`acc/scheduler/`、`acc/server/` | `acc/domain`、stdlib | `acc.app` / `acc.cli` / `acc.server` 公共 API 之外的内部 |
| `acc/scheduler/` | ReadySetComputer / DAGScheduler / ApprovalBarrier | `acc/app/`、`acc/server/` | `acc/domain`、`acc/binding/`、`acc/persistence/`、`acc/runtime/` | `fastapi` / `typer` |
| `acc/adapters/` | codex_cli / claude_sdk / generic_cli + base | `acc/app/`、`acc/server/` | `acc/domain`、`acc/persistence/`（events 写） | `acc.app` / `acc.server` 私有 API |
| `acc/app/` | workflow execution、node invocation、prompt 渲染编排 | `acc/server/`、`acc/cli` | 上面所有 layer 的公共 API | — |
| `acc/server/` | Workbench HTTP / run_manager / projection | `acc/cli`、外部 client | `acc/app/`、`acc/persistence/` 公共 API | 不得跨过 `acc/app/` 直读 binding 内部 |

### 4.2 强制规则（自动化执行）

- 用 `import-linter` contract（新增 `.importlinter`）+ 扩展 `tests/architecture/test_import_boundaries.py` 自动化执行下列规则（AUDIT L-001..L-008）：
  - **R1**：`acc/binding/` 是纯函数模块，不得 import `acc.server` / `acc.app` / `acc.cli` / `acc.scheduler` / `acc.runtime` / `acc.adapters` / `fastapi` / `typer`。
  - **R2**：`acc/result_store/` 不得 import `acc.server` / `acc.cli` / `acc.app` / `fastapi` / `typer`。
  - **R3**：`acc/runtime/` 不得 import `acc.app` / `acc.cli` / `acc.server` / `acc.store` / `fastapi` / `typer`。
  - **R4**：`acc/domain.py` 与 `acc/engine/` 保持纯：禁用 FS/process 原语（`open` / `read_text` / `write_text` / `mkdir` / `unlink` / `copy2` / `copytree` / `subprocess.run` / `Popen`）。当前已有 AST 扫描 `tests/architecture/test_import_boundaries.py:95-110`（推断），扩展覆盖新模块。
  - **R5**：`acc/adapters/*` 不得 import `acc.app` / `acc.server`；`AgentRuntimeEnv` 装配仅在 adapter base 层。
  - **R6**：`schemas/` 仅含 JSON 文件；不得引入 Python（AUDIT L-007）。
  - **R7**：`acc/server/run_projection.py` 扩展层只消费 ResultStore / RunManifest 公共读 API，不触及 BindingResolver 内部（AUDIT L-008，人工 review）。

### 4.3 Architecture test 落地

新增 `tests/architecture/test_import_boundaries.py` 套件至少包含：

1. `test_binding_layer_pure`：`acc/binding/` 子树 AST 扫描，断言不 import 上述 R1 列表中的任一模块。
2. `test_result_store_layer_pure`：同上，针对 R2。
3. `test_runtime_layer_pure`：同上，针对 R3（包含 `fastapi` / `typer` 检查）。
4. `test_domain_no_fs_primitives`：扩展现有 `tests/architecture/test_import_boundaries.py:95-110` AST 扫描覆盖 `acc/binding/`、`acc/result_store/`、`acc/runtime/`、`acc/persistence/`、`acc/provenance.py`。
5. `test_adapter_layer_pure`：扫描 `acc/adapters/*` 不 import `acc.app` / `acc.server`。
6. `test_schemas_dir_no_py`：`find schemas -name '*.py'` 应为空（AUDIT L-007）。

### 4.4 公共 API 入口

为避免内部实现细节泄漏给上层（特别是避免 `acc/server/` 直接 import `acc/binding/resolver.py` 这种内部模块），每个新模块 `__init__.py` 显式 re-export 公共 API；其余模块视为内部。下表给出 Phase 1 的最小公共面。

| 模块 | 公共 API（Phase 1） | 内部（不可被外部 import） |
|---|---|---|
| `acc/binding/` | `BindingResolver`, `BindingResolverResult`, `LegacyPassthroughBinding`, `InlineThreshold`, `BindingResolutionError`, `CrossRunReferenceError`, `SelectorParseError`, `MissingNodeResultError` | `_internal_resolve_field_selector`, `_legacy_dispatch`, `_inline_decision` |
| `acc/result_store/` | `ResultStore`, `NodeResult`, `query`, `put`, `list_by_run` | `_in_memory_cache`, `_evict_strategy` |
| `acc/runtime/` | `AgentPayload`, `RuntimePayload`, `TransferPolicy`, `MaterializationResolved`, `Frame` | `_compose_layers`, `_normalize_*` |
| `acc/persistence/` | `RunManifestWriter`, `EventsWriter`, `atomic_write_json`, `NodeCacheKey` | `_temp_path_strategy`, `_lock_registry` |
| `acc/scheduler/` | `ReadySetComputer`, `compute_ready_set`, `Level`, `LevelIndex` | `_topological_internals` |
| `acc/provenance.py` | `ProvenanceObject`, `ProvenanceSchemaVersion` | `_validate_hash_mutual_exclusion` |

**约束**：上层模块只能 `from acc.binding import BindingResolver`，不允许 `from acc.binding.resolver import _internal_resolve_field_selector`。这一约束由 `import-linter` 的 `forbidden` contract + ruff `_*` 私有名约定共同维持（AUDIT L-001..L-008）。

---

## 5. 重构 vs 补丁判定表

> 每个目标给出 `verdict ∈ {patch, refactor, leave_alone, new_module}`，附 `reason`、关联 AC、关联 T-NNN（来自 TEST_PLAN）。

### 5.1 现有路径

| target | verdict | reason | 关联 AC | 关联 T-NNN |
|---|---|---|---|---|
| `acc/domain.py:62-66` (`ControlEdge`) | **patch** | 保留 `context` 字段以兼容 legacy；Phase 3 默认从 `"upstream_output"` 翻转为 `"none"`；新增 `# DEPRECATED:` 注释 | AC1 / AC11 | T-047 / T-057 |
| `acc/domain.py:75-95` (`DataEdge` / `WorkflowInputBinding` / `WorkflowOutputBinding`) | **patch** | 已存在；Phase 1 增 `kind: "selector"` 字段以引入 union 形态 | AC2 | T-001 / T-048 |
| `acc/domain.py:142-151` (`ArtifactBundle.provenance`) | **patch** | `provenance: dict[str, Any]` 升级为 `ProvenanceObject`，保留 dict fallback 兼容旧持久化 | AC13 | T-059 |
| `acc/domain.py:218-248` (`NodeInputBinding` / `NodeOutputBinding` / `WorkflowCallInputBinding` / `WorkflowCallOutputBinding`) | **patch** | 已存在；Phase 1 增 `kind` 字段 + `LegacyPassthroughBinding` union | AC2 / AC11 / AC18 | T-001 / T-002 / T-024 / T-057 |
| `acc/runner.py:47-62` (standalone `CapsuleRunner.run` 入口) | **leave_alone** | standalone 路径正确；§15.12（DESIGN）尚未拍板是否 wrap `{"task": ...}`；不动以避免 breaking change | AC4 | T-021 / T-050 |
| `acc/runner.py:108-112` (调用 `render_prompt`) | **leave_alone** | 仅触发 render_prompt；render_prompt 自身在 Phase 2 重构后此处行为自动改变 | AC9 | T-055 |
| `acc/app/node_invocation.py:11` (`MAX_UPSTREAM_CONTEXT_INLINE_BYTES`) | **patch** | 抽到 `acc/binding/thresholds.py` 的 `InlineThreshold` 常量，BindingResolver / TransferPolicy 共用（AUDIT MN-002） | AC2 | T-018 |
| `acc/app/node_invocation.py:78-91` (`build_clean_node_input_payload`) | **refactor** | 当前 5 段输入 (`node / input / workflow.input / upstream_context / inbox.records`) 硬装一起，与 AgentPayload vs RuntimePayload split 冲突；Phase 2 拆为 `build_runtime_payload` + `build_agent_payload`；旧函数 Phase 3 删除（AUDIT MN-005） | AC2 / AC4 / AC8 | T-002 / T-048 / T-050 / T-054 |
| `acc/app/node_invocation.py:94-117` (`collect_upstream_context`) | **refactor** | control edge 仍承担"附带上游 output 全量"的语义，违反 AC1；Phase 2 起 `binding_mode=explicit_only` 时不再调用，仅在 `legacy_full / mixed` lane 走该路径；Phase 3 移至 `acc/binding/legacy.py` 作 deprecated shim（参见 §6.3） | AC1 / AC8 | T-017 / T-047 / T-054 |
| `acc/prompting.py:12-33` (`render_prompt`) | **refactor** | `if "input_json" in template_text` 判定 + 无条件 append `## ACC Runtime Input` JSON 块违反 AC9；Phase 2 改为按 `prompt_appendix_policy` 三档分支；StrictUndefined 保留 | AC9 / AC15 | T-055 / T-061 |
| `acc/server/run_manager.py:191-204` (`_reconcile_interrupted_runs`) | **patch** | 当前一律标 `crashed`，无法区分 paused；Phase 3 patch 为基于 `pause_marker` 区分 `paused / crashed`，并对接 `run_manifest.completed_nodes`（AUDIT E-005） | AC6 | T-052 |
| `acc/workflow_graph.py:25` (`DEFAULT_POLICY`) | **patch** | `max_concurrency=1` 太死；Phase 1 暴露为可配置；Phase 3 提高默认值；与 `acc/legacy_graph_importer.py:22` 同名常量合并到一处（AUDIT M-007） | — | — |
| `acc/workflow_graph.py:243-264` (`validate_data_edges`) | **patch** | 校验逻辑保留；Phase 3 增 ApprovalBarrier 插入 + cycle 列名（AUDIT C-014） | AC1 | T-047 / T-053 |
| `acc/app/__init__.py:528-575` (level scheduler) | **patch** | 当前 `asyncio.gather` 一次性等所有 level 节点；Phase 1 不动；Phase 3 演进为 `DAGScheduler`，与 ApprovalBarrier 配合 | AC6 | T-019 / T-052 |
| `acc/app/__init__.py:912-927` (legacy capsule 分支) | **patch** | 当前在 `acc_receive_upstream_context=true` 时注入 upstream_context 到 input.json；Phase 2 起改走 ExposeMetadataFlag 白名单；Phase 3 加 `# DEPRECATED:` 注释（AUDIT M-004） | AC8 | T-018 / T-054 |
| `acc/app/workflow_call.py:13-48` (`build_nested_workflow_input_payload`) | **refactor** | 当前在没有显式 `WorkflowCallInputBinding` 时直接把父 `upstream_context` 装进 `__acc_control_context`，违反 AC18 nested isolation；Phase 1 起优先走 `build_explicit_nested_workflow_input_payload`（已在 :51-60），Phase 3 删除 fallback 路径 | AC18 | T-024 / T-067 |
| `acc/legacy_graph_importer.py:276-280` (`parse_control_context` 默认 `"upstream_output"`) | **patch** | Phase 1 importer 在 `context="upstream_output"` 时同时注入 `LegacyPassthroughBinding`；Phase 3 importer 不再翻转默认值，但所有路径已被 binding 模型覆盖 | AC11 / AC1 | T-057 |
| `acc/adapters/codex_cli.py:23-31` (env vars) | **patch** | 当前仅透出 `ACC_INBOX_DIR / ACC_OUTBOX_DIR / ACC_ENVIRONMENT_ID / ACC_NODE_ID`；Phase 1 增 `ACC_RUN_ID / ACC_RUN_DIR`；同步改 `claude_sdk.py / generic_cli.py / base.py:11-30`（AUDIT S-003） | AC4 / AC10 | T-021 / T-056 |
| `acc/adapters/base.py:11-30` (`AgentRunRequest`) | **patch** | 增 `run_id: RunId` / `run_dir: Path` 字段（推断字段位置） | AC4 | T-021 |
| `acc/store/__init__.py:339-348` (reference 物化只在 workflow output binding 启用) | **patch** | Phase 3 扩展到任意 node-to-node binding；Phase 1/2 不动 | AC17 | T-063 |
| `tests/unit/test_clean_workflow_engine.py:169-198, 254-276` (锁定全量传递) | **patch** | Phase 1 打 `@pytest.mark.legacy` 标签 + 注释"此行为是 legacy 兼容，不构成新 feature 合约"；移到 legacy lane | AC11 / AC12 | T-057 / T-058 |

### 5.2 新增模块（new_module）

| target | verdict | reason | 关联 AC | 关联 T-NNN |
|---|---|---|---|---|
| `acc/binding/` (`__init__.py`、`resolver.py`、`selector.py`、`thresholds.py`、`legacy.py`) | **new_module** | binding 类型、selector parser、BindingResolver；适配器层 Phase 1，Phase 3 升级为 ResultStore client | AC1 / AC2 / AC5 | T-001..T-016 |
| `acc/result_store/` (`__init__.py`、`store.py`、`cache.py`) | **new_module** | `(run_id, node_id, port_id) → ArtifactBundle / NodeResult` 寻址 + in-memory cache | AC14 | T-060 |
| `acc/runtime/` (`payload.py`、`fan_out.py`、`partial_aggregate.py`、`approval.py`、`transfer_policy.py`、`frame.py`) | **new_module** | 统一 frame / fan_out / partial_aggregate / approval / payload / transfer_policy；不依赖 acc.app / acc.server | AC4 / AC7 / AC17 | T-050 / T-053 / T-063 |
| `acc/persistence/` (`run_manifest.py`、`events_writer.py`、`atomic_write.py`、`cache_key.py`) | **new_module** | 从 `acc/server/run_manager.py:122-204` + `acc/run_index.py` 抽出来；run_manifest writer / events writer / atomic write / NodeCacheKey | AC6 / AC13 / AC16 | T-052 / T-059 / T-062 |
| `acc/scheduler/` (`ready_set.py`、`dag_scheduler.py`、`approval_barrier.py`) | **new_module** | ReadySetComputer / DAGScheduler / ApprovalBarrier；Phase 1 抽 ReadySetComputer 骨架，Phase 3 接通 DAGScheduler + ApprovalBarrier | AC6 / DESIGN §11.3 | T-052 / T-068 |
| `acc/provenance.py` | **new_module** | ProvenanceObject 定义 + schema_version + 序列化/反序列化（AUDIT T-001） | AC13 | T-059 / T-074 |
| `tools/migrate_graph_to_explicit_binding.py` | **new_module** | Phase 3 扫描 `.graph.json` 自动产出 `data_edges` + `acc_expose_*` + `binding_mode=mixed` | AC11 | T-057 / T-072 |
| `tests/architecture/test_import_boundaries.py` (扩展) | **patch** | 扩 R1..R7 contract（AUDIT L-001..L-008） | — | — |

---

## 6. 三阶段落地计划

> 每阶段：goal（1-2 句）、changes 表格（≥6 行）、exit_criteria（≥4 条）、回滚条件。

### 6.1 Phase 1：兼容垫层（AC1–AC7）

**goal**：抽出 `acc/binding/`、`acc/result_store/`、`acc/runtime/`、`acc/persistence/`、`acc/scheduler/` 五个新模块的骨架与公共 API；workflow 默认 `binding_mode=mixed`，capsule 默认 `prompt_appendix_policy=legacy_full`，所有现有 `.accflow.json` 行为字节级不变。

**changes**：

| target file path | kind | description |
|---|---|---|
| `acc/binding/__init__.py`、`resolver.py`、`selector.py`、`thresholds.py`、`legacy.py` | new_file | 适配器层 BindingResolver；selector parse；InlineThreshold 抽出（替代 `acc/app/node_invocation.py:11`）；LegacyPassthroughBinding 实现 |
| `acc/result_store/__init__.py`、`store.py`、`cache.py` | new_file | NodeResult 寻址；`(run_id, node_id, port_id)` 主键查询；in-memory cache by run_id |
| `acc/persistence/run_manifest.py`、`events_writer.py`、`atomic_write.py`、`cache_key.py` | new_file | run_manifest writer 增 `completed_nodes` / `binding_materializations`；原子写（temp+rename）；events writer 复用 `acc/events.py`；NodeCacheKey 纯函数（consumer 仍 Phase 3） |
| `acc/provenance.py` | new_file | ProvenanceObject frozen dataclass + `schema_version="1-internal-may-break"`；hash 互斥校验 |
| `acc/runtime/frame.py`、`payload.py` 骨架 | new_file | frame helpers；payload 公共类型签名（实现留 Phase 2） |
| `acc/scheduler/ready_set.py` 骨架 | new_file | ReadySetComputer 实现 + O(E+V) 单测；Phase 1 不接通 DAGScheduler |
| `acc/domain.py:142-151` | patch | ArtifactBundle.provenance 字段类型 `dict[str, Any]` 升级支持 ProvenanceObject + dict fallback |
| `acc/domain.py:218-248` | patch | 5 binding kinds 加 `kind: BindingKind` 字段 + `LegacyPassthroughBinding` union 类型导出 |
| `acc/adapters/base.py:11-30` | patch | `AgentRunRequest` 增 `run_id: str / run_dir: Path` 字段 |
| `acc/adapters/codex_cli.py:23-31`、`claude_sdk.py`、`generic_cli.py` | patch | 三 adapter 一致补 `ACC_RUN_ID = request.run_id` / `ACC_RUN_DIR = str(request.run_dir)` |
| `schemas/capsule_template_schema.json` | patch | 增 `prompt_appendix_policy: enum["legacy_full","task_only","none"]`，缺省解释为 `legacy_full` |
| `acc/legacy_graph_importer.py:276-280` | patch | importer 在 `context="upstream_output"` 时同时注入 `LegacyPassthroughBinding`；标 `graph.legacy=true` |
| `acc/workflow_graph.py:25`、`acc/legacy_graph_importer.py:22` | patch | `DEFAULT_POLICY` 合并到一处 (`acc/policy.py` 推断) + 暴露 `max_concurrency` 配置 |
| `tests/architecture/test_import_boundaries.py` | patch | 扩 R1..R7 import-linter contract |
| `tests/unit/test_clean_workflow_engine.py:169-198, 254-276` | patch | 打 `@pytest.mark.legacy` + 注释；移到 legacy lane |
| `.importlinter` | new_file | layer boundary contract |
| `tests/fixtures/baselines/phase1/*.json` | new_file | Phase 1 黄金基线，供 AC15 byte-equal 验证 |

**exit_criteria**：

> *Source of truth = TEST_PLAN.md §11 phase exits; this section MUST mirror.*

1. P1-exit-1：见 TEST_PLAN §11 `phase1_exit` (T-006 / T-007 / T-008 / ...) — unit + integration 主轨用例 covering AC1–AC7 / AC11–AC14 入口（详见 `TEST_PLAN.md` §3 矩阵）。
2. legacy lane 全量回归通过率与 Phase 0 baseline 一致；主 lane mypy --strict、ruff、import-linter 全绿。
3. `AUDIT_PLAN.md` Phase 1 自动化覆盖率 ≥ 80%（71/89，详见 AUDIT_PLAN §1.4）；critical 条目 0 项遗留。
4. ProvenanceObject schema 已写入 `schemas/`，doctest 通过；run_manifest 并发 run 测试不串 run（AUDIT C-005 / N-005）。
5. `ACC_RUN_ID / ACC_RUN_DIR` 在三 adapter 一致暴露，无 stray `ACC_*`（AUDIT S-003）。

**回滚条件**：

- 若 Phase 1 引入的 `LegacyPassthroughBinding` 注入导致 `demo_parallel.graph.json` / `ui_demo_graph.graph.json` 行为漂移（输出字段集 ≠ Phase 0 baseline），降级方案是把 `legacy_passthrough` kind 改为 `kind="legacy_silent_dispatch"` —— BindingResolver 看到此 kind 时**完全跳过 binding 解析**，直接走老 `collect_upstream_context` 路径；用户视角行为字节级一致，仅审计标签变化。
- 若 ProvenanceObject schema 引发并发 run 序列化竞态（推断风险），降级为 `dict[str, Any]` 暂存 + 另起 sidecar `provenance.json` 文件；`run_manifest.binding_materializations` 仅写 hash。

**Phase 1 内部 PR 顺序（推荐）**：

1. **PR-1.1**：`acc/persistence/atomic_write.py` + `acc/persistence/run_manifest.py` 骨架（仅新增，不替换调用方）。前置：无。 verify by：`pytest tests/unit/test_run_manifest.py::test_atomic_write_rollback_on_rename_failure`（AUDIT E-004）。
2. **PR-1.2**：`acc/provenance.py` + `schemas/provenance_schema.json`（schema 落地，schema_version="1-internal-may-break"）。前置：无。verify by：`pytest tests/unit/test_provenance.py::test_T_AC13_schema_roundtrip_and_reject`。
3. **PR-1.3**：`acc/result_store/` 骨架 + `tests/unit/test_result_store.py`。前置：PR-1.2。verify by：`pytest tests/unit/test_result_store.py::test_T_AC14_addressable_lookup`（AUDIT C-012）。
4. **PR-1.4**：`acc/binding/{thresholds.py, legacy.py, resolver.py}` 骨架 + LegacyPassthroughBinding 类型；适配器层入口（不替换 `acc/app/node_invocation.py`）。前置：PR-1.3。
5. **PR-1.5**：`acc/domain.py` 5 binding kinds 加 `kind` 字段；`acc/legacy_graph_importer.py:276-280` 注入 `LegacyPassthroughBinding`。前置：PR-1.4。verify by：`pytest -m T_AC11 tests/integration/test_legacy_graph_importer.py::test_legacy_passthrough_injected`。
6. **PR-1.6**：`acc/adapters/base.py:11-30` 增 `run_id / run_dir`；三 adapter 一致补 `ACC_RUN_ID / ACC_RUN_DIR`。前置：无。verify by：`pytest tests/unit/test_adapter_env_contract.py::test_uniform_six_var_set`。
7. **PR-1.7**：`schemas/capsule_template_schema.json` 增 `prompt_appendix_policy` 字段 + capsule loader 兜底默认 `legacy_full`（不动 render_prompt）。前置：无。verify by：`pytest -m T_AC15 tests/unit/test_capsule_manifest_loader.py::test_missing_field_runtime_default_legacy`。
8. **PR-1.8**：`tests/architecture/test_import_boundaries.py` 扩 R1..R7 contract + `.importlinter` 配置。前置：PR-1.1..PR-1.4 全合。verify by：`lint-imports --config .importlinter`。
9. **PR-1.9**：`acc/scheduler/ready_set.py` ReadySetComputer 骨架 + `tests/unit/test_scheduler.py::test_ready_set_complexity`（AUDIT P-001）。前置：无。
10. **PR-1.10**：`acc/policy.py` 集中 `DEFAULT_POLICY`（合并 `acc/workflow_graph.py:25` 与 `acc/legacy_graph_importer.py:22`）。前置：PR-1.5。verify by：grep + `pytest tests/architecture/test_no_duplicate_default_policy.py`。
11. **PR-1.11**：legacy 用例打 `@pytest.mark.legacy` + 注释（`tests/unit/test_clean_workflow_engine.py:169-198, 254-276`）。前置：无。verify by：`pytest -m "not legacy"` 主 lane 不再跑这两条。
12. **PR-1.12**：黄金基线生成脚本 + `tests/fixtures/baselines/phase1/*.json`（AC15 baseline 用）。前置：PR-1.7。verify by：`pytest tests/migration/test_phase1_baseline.py::test_baseline_generation`。
13. **PR-1.13**：`acc/persistence/cache_key.py` —— `NodeCacheKey = sha256(capsule_id + capsule_version + ordered binding_inputs_sha256)` 纯函数实现（pause/resume *consumer* 仍在 Phase 3 接通）。前置：PR-1.1。verify by：`pytest tests/unit/test_cache_key.py::test_cache_key_determinism_and_ordering`。

每个 PR 独立可合、独立 reviewer 评分；CCB Plan Review 在 PR-1.1 启动前完成一次（覆盖 Phase 1 整体），Code Review 每 PR 一次（AUDIT_PLAN §4.5）。

### 6.2 Phase 2：prompt 解耦 + Workbench（AC8–AC12）

**goal**：`render_prompt` 按 `PromptAppendixPolicy` 切分；引入 `binding_mode=mixed`（已默认）/ `binding_mode=explicit_only`（新增 opt-in）；Workbench 接入 ResultStore 投影展示 `Resolved Prompt` / `Applied Bindings` / `Provenance` toggle。

**changes**：

| target file path | kind | description |
|---|---|---|
| `acc/prompting.py:12-33` | refactor | render_prompt 按 `prompt_appendix_policy` 三档分支；`legacy_full` 维持现网；`task_only` 仅 binding `task` 字段；`none` 不追加 |
| `acc/app/node_invocation.py:78-91` | refactor | 拆 `build_runtime_payload` + `build_agent_payload`；后者按 binding 列表 + ExposeMetadataFlag whitelist 过滤；保留旧函数为兼容入口（Phase 3 删除） |
| `acc/runtime/payload.py` | new_file | `AgentPayload` / `RuntimePayload` TypedDict + 装配 helpers（AUDIT T-003） |
| `acc/runtime/transfer_policy.py` | new_file | TransferPolicy enum + Windows fallback（reference→symlink→copy）+ `materialization_degraded` 事件 emit |
| `schemas/workflow_graph_v3_schema.json` | patch | 增 workflow 级 `binding_mode: enum["legacy_full","mixed","explicit_only"]` |
| `schemas/capsule_template_schema.json` | patch | 增 `acc_expose_workflow_metadata: array<string>` 字段级白名单 |
| `acc/binding/selector.py` | patch | `NamespaceSelector` ADT 接入 parse-validate at workflow load-time |
| `acc/server/run_projection.py:17-34` (推断) | refactor | 投影 `acc_receive_upstream_context` / `acc_upstream_context_fields` / `materialization_mode_resolved` / `materialization_degraded` 事件 |
| `web/src/components/WorkflowViewer.tsx:2941-2995` | refactor | PortInspector 增 "本 run 实际值" 区域 + Applied Bindings 列表 + Provenance toggle |
| `web/src/components/WorkflowViewer.tsx`（新建 control edge 入口） | patch | 新建 control edge 弹三选项对话框（DESIGN §9.2）：仅 readiness / readiness + legacy passthrough / readiness + 显式 binding |
| `tests/e2e/test_acNN_*.py` | new_file | T-054..T-058 主轨 e2e |
| `tests/integration/test_explicit_binding_matrix.py` | new_file | mixed mode 矩阵：部分节点显式 + 部分隐式 |
| `tests/integration/test_legacy_byte_equivalence.py` | new_file | AC15 黄金基线对比 Phase 1（T-061） |

**exit_criteria**：

> *Source of truth = TEST_PLAN.md §11 phase exits; this section MUST mirror.*

1. P2-exit-1：见 TEST_PLAN §11 `phase2_exit` — mixed mode 下 legacy + explicit 节点共存运行结果稳定。
2. 至少一个内置 demo workflow（如 `acc_workspace_canvas.accflow.json`，已显式声明 9 条 data_edges，DESIGN §2.6）切换到 `binding_mode=explicit_only` 并 e2e 通过。
3. AC1 / AC2 / AC3 / AC4 / AC9 / AC10 / AC15 在 `explicit_only` 模式下不变量测试通过；`AUDIT_PLAN.md` Phase 2 自动化覆盖率 ≥ 88%。
4. Workbench RunInspector 投影上线 Resolved Prompt tab + Applied Bindings 列表 + Provenance toggle + materialization_degraded 降级图标（AC10）。
5. 主 lane mypy --strict 全绿；`acc/runtime/`、`acc/binding/`、`acc/result_store/` 公共 API 不含 `Any`（AUDIT T-001..T-008）。

**回滚条件**：

- workflow 级 `binding_mode` 可降回 `legacy_full`；`render_prompt` 行为按 `prompt_appendix_policy=legacy_full` 退回 Phase 1。
- 若 Workbench 投影性能退化（推断：HTTP poll 1–2.5s 间隔，`web/src/components/WorkflowViewer.tsx:812-869`），临时把 Provenance toggle 默认折叠 + lazy fetch；不影响 runtime。

### 6.3 Phase 3：ResultStore 上线 + 默认翻转 + legacy 退役（AC13–AC17）

**goal**：`binding_mode` 默认从 `mixed` 翻转为 `explicit_only`；ProvenanceObject schema_version 升为 `1-frozen-public`；`legacy_graph_importer` 默认 `context` 仍为 `"upstream_output"` 但配 `LegacyPassthroughBinding`，新建 graph 默认 `"none"`；capsule 新建 scaffold 默认 `prompt_appendix_policy=task_only`；reference 物化扩展到任意节点；DAGScheduler + ApprovalBarrier 接通。

**changes**：

| target file path | kind | description |
|---|---|---|
| `acc/binding/resolver.py` | refactor | BindingResolver gains ResultStore-backed dispatch in Phase 3 (already permitted by layer contract); inbox/outbox 文件系统降级为 ResultStore 默认后端 |
| `acc/result_store/store.py` | refactor | 接通 reference 物化扩展（替代 `acc/store/__init__.py:339-348`） |
| `acc/server/run_manager.py:191-204` | patch | `_reconcile_interrupted_runs` 改为基于 `pause_marker` 区分 `paused / crashed`；对接 `run_manifest.completed_nodes`（AUDIT E-005） |
| `acc/persistence/cache_key.py` | (Phase 1 implemented) | NodeCacheKey 纯函数已在 Phase 1 落地（PR-1.13）；Phase 3 仅接通 pause/resume *consumer* 端（参见 `_reconcile_interrupted_runs` 改造） |
| `acc/scheduler/dag_scheduler.py`、`approval_barrier.py` | new_file | DAGScheduler（替换 `acc/app/__init__.py:534-575` level scheduler）；ApprovalBarrier 在 graph compile 阶段插入 readiness barrier |
| `acc/runtime/partial_aggregate.py` | new_file | strict / best_effort + EachOfFanInSelector 一等公民 |
| `acc/binding/each_of.py` | new_file | `each_of:<node_id>.<field_path>` selector 实现 |
| `acc/legacy_graph_importer.py:276-280` | patch | importer 不再翻转默认；新建 graph 默认 `"none"` |
| `acc/domain.py:62-66` | patch | `ControlEdge.context` 默认 `"upstream_output"` 改为 `"none"`；加 `# DEPRECATED:` 注释 |
| `schemas/workflow_graph_v3_schema.json` | patch | 默认 `binding_mode=explicit_only`；旧文件不写默认值时自动按 `legacy_full` 加载（向后兼容） |
| `acc/provenance.py` | patch | `schema_version="1-frozen-public"`；冻结字段集；变更需 `schema_version` bump |
| `tools/migrate_graph_to_explicit_binding.py` | new_file | 扫描 `.graph.json` 自动迁移到 `data_edges + acc_expose_* + binding_mode=mixed`（幂等） |
| `acc/app/node_invocation.py:94-117` | move | `collect_upstream_context` Phase 3 从 `acc/app/node_invocation.py:94-117` move 到 `acc/binding/legacy.py` 作为 private helper `_legacy_collect_upstream_context`，仅可由 `LegacyPassthroughBinding.dispatch` 调用 |
| `acc/app/__init__.py:912-927` | patch | legacy capsule 分支加 `# DEPRECATED:` 注释；保留兼容 |
| `tests/performance/test_*_perf.py` | new_file | reference 物化大文件 / 16 并发 / 嵌套深度 / Windows fallback baseline |

**exit_criteria**：

> *Source of truth = TEST_PLAN.md §11 phase exits; this section MUST mirror.*

1. P3-exit-1：见 TEST_PLAN §11 `phase3_exit` — 全部内置 workflows / examples 在 `explicit_only` 默认下端到端通过。
2. `AUDIT_PLAN.md` Phase 3 自动化覆盖率 ≥ 92%；critical / high 条目 0 项遗留。
3. 并发 run + pause/resume 压力测试（≥10 个 run × ≥30s 持续）无串 run / 误重跑（AUDIT C-005 / C-006 / N-003）。
4. 迁移脚本对 `demo_parallel.graph.json / ui_demo_graph.graph.json` 自动迁移成功且幂等（AUDIT M-006）。
5. Windows fallback 端到端验证：`reference / symlink → copy` 自动降级 + `materialization_degraded` 事件 + Workbench 降级图标（AC17 / AUDIT O-003）。
6. ProvenanceObject schema_version 从 `1-internal-may-break` 升为 `1-frozen-public`，并对外发布兼容矩阵。

**回滚条件**：

- 单 workflow 可回退到 `binding_mode=mixed / legacy_full`；ResultStore 后端可降级为旧 outbox 文件直读（feature flag `ACC_USE_LEGACY_OUTBOX_BACKEND=1`）。
- DAGScheduler 性能不达标（< 1×LevelScheduler）时临时回退；ApprovalBarrier 通过 graph compile 阶段开关关闭。

### 6.4 阶段间依赖关系（不可跳阶段）

| 上游阶段 | 必须先满足 | 下游阶段 |
|---|---|---|
| Phase 1 → Phase 2 | (a) `LegacyPassthroughBinding` 已注入 importer；(b) `prompt_appendix_policy` schema 已落地；(c) `ACC_RUN_ID / ACC_RUN_DIR` 已透出；(d) `acc/binding/` `acc/result_store/` `acc/runtime/` `acc/persistence/` `acc/scheduler/` 五个新模块的公共 API 稳定 | 才能开 Phase 2 |
| Phase 2 → Phase 3 | (a) `binding_mode=explicit_only` 在至少一个内置 demo 上 e2e 通过；(b) Workbench `Resolved Prompt` / `Applied Bindings` / `Provenance toggle` 上线；(c) AC15 黄金基线对比通过；(d) `NamespaceSelector` ADT 已统一 | 才能开 Phase 3 |
| Phase 3 → 上线 | (a) 全部内置 workflows / examples 在 `explicit_only` 默认下端到端通过；(b) 迁移脚本对历史 `.graph.json` 幂等；(c) Windows fallback 端到端验证；(d) ProvenanceObject schema 冻结 | 才能切默认 |

跳阶段会引入两类风险：(1) Phase 2 改 `render_prompt` 但 Phase 1 没透出 `prompt_appendix_policy`，会让现网 capsule 直接失语（AC15 违反）；(2) Phase 3 翻转默认 `binding_mode` 但 Phase 2 没把 `Workbench` 投影上线，会让用户在 UI 看不到 "为什么我的 prompt 突然空了"。本文不允许跳阶段。

### 6.5 阶段切换的开关位

每个阶段的"翻转点"必须由单一配置位控制（AUDIT M-008），便于回滚：

| 阶段 | 翻转点 | 开关位 | 默认 | 回滚 |
|---|---|---|---|---|
| Phase 1 enable | importer 注入 `LegacyPassthroughBinding` | `acc/legacy_graph_importer.py` 模块级 flag `INJECT_LEGACY_PASSTHROUGH` | `True` | 改 `False` 退回老路径 |
| Phase 1 enable | `ACC_RUN_ID / ACC_RUN_DIR` 透出 | adapter `request.run_id is not None` 判定 | 全 capsule | 在 `AgentRunRequest` 构造侧不传 |
| Phase 2 enable | `render_prompt` 三档分支 | capsule manifest `prompt_appendix_policy` 字段 | `legacy_full`（兜底） | 删除字段或显式置 `legacy_full` |
| Phase 2 enable | `binding_mode=explicit_only` | workflow 文件 `policies.binding_mode` | 单 workflow opt-in（默认 `mixed`） | 改 `mixed` 或 `legacy_full` |
| Phase 3 enable | `binding_mode` 默认翻转 | workflow loader 默认值（`schemas/workflow_graph_v3_schema.json`） | `explicit_only` | schema 改 `mixed` 或 workflow 显式声明 `legacy_full` |
| Phase 3 enable | reference 物化扩展 | `acc/result_store/store.py::REFERENCE_EXTENDED` 模块级 flag | `True` | 改 `False` 退回 `acc/store/__init__.py:339-348` 的旧路径 |
| Phase 3 enable | DAGScheduler | `acc/policy.py::SCHEDULER_KIND` | `"dag"` | 改 `"level"` 退回 LevelScheduler |
| Phase 3 enable | `_reconcile_interrupted_runs` PauseResume | `acc/server/run_manager.py::RECONCILE_KIND` | `"pause_aware"` | 改 `"crashed_only"` 退回 Phase 1 行为 |

每个开关位都是原子的（true/false 或 enum），单点切换；CI 在每次 PR 合并后自动重启所有 lane 验证两种状态都不退化（AUDIT M-008）。

---

## 7. 风险与缓解

> ≥6 条风险。每条：`risk / likelihood / impact / mitigation / 关联 §15 待确认项`。

| # | risk | likelihood | impact | mitigation | 关联 §15 |
|---|---|---|---|---|---|
| R-1 | legacy fixture 字节级等价不可达 —— Phase 1/2 改动后旧 capsule 在新版 ACC 下 `resolved_prompt.md` 不再字节等同 | high | high — 退化用户信任、阻断主 lane | (a) DESIGN AC4 已收敛为"字段集不变量"代替 byte diff；(b) AC15 引入 `prompt_appendix_policy` 兜底 `legacy_full`，确保未声明字段的 capsule 在 Phase 2 后行为字节级等同 Phase 1 baseline；(c) `tests/fixtures/baselines/phase1/*.json` 黄金基线由 T-061 自动验证 | Q5 / Q12 |
| R-2 | Windows reference materialization 失败 —— 普通用户态无 `SeCreateSymbolicLinkPrivilege`，导致 binding 解析抛错 | medium | high — Windows 用户全员阻断 | (a) TransferPolicy 自动 fallback 到 `copy` 并 emit `materialization_degraded` 事件（AC17）；(b) `materialization_mode_resolved` 字段记录实际模式，Workbench inspector 渲染降级图标；(c) AUDIT E-003 强制 `OSError` 精确 catch，禁止 `BaseException`；(d) Phase 3 增 Windows fallback baseline benchmark | Q10 / Q16 |
| R-3 | ProvenanceObject schema 演进破坏 resume —— Phase 1/2/3 之间 schema 变化导致旧 run_manifest 反序列化失败 | medium | high — 用户已运行的 run 失去恢复能力 | (a) `schema_version` 字段 + 兼容矩阵；Phase 1 标 `1-internal-may-break`，Phase 3 升 `1-frozen-public`；(b) 反序列化 fallback：缺字段按默认值补；不识别字段忽略并写 warning；(c) Phase 3 之前 ProvenanceObject 不暴露给外部消费者 | Q2 |
| R-4 | ApprovalBarrier 与 `asyncio.gather` 不兼容 —— 当前 level scheduler `acc/app/__init__.py:534-575` 一次性 gather 整个 level，审批节点原地阻塞会 stall 同 level 其他节点 | medium | medium — 审批 UX 退化，与 §11.1 "保留并发"承诺冲突 | (a) graph compile 阶段插入 readiness barrier 把审批前后切成三个独立 level（DESIGN §11.3）；(b) Phase 3 演进到 DAGScheduler 后 ApprovalBarrier 升级为 first-class；(c) AUDIT N-002 验证审批独占其 topological level | Q9 |
| R-5 | 嵌套 workflow 的 `__acc_control_context` 泄漏 —— `acc/app/workflow_call.py:33-47` 在没有显式 `WorkflowCallInputBinding` 时把父 `upstream_context` 装进子 workflow，违反 AC18 nested isolation | high | critical — 子 workflow 拿到父的全量上下文，泄漏面任意大 | (a) Phase 1 起优先走 `build_explicit_nested_workflow_input_payload`（已在 :51-60 存在）；(b) Phase 3 删除 fallback 路径；(c) AUDIT C-017 / S-007 critical 条目守住 `binding_mode=explicit_only` 下未绑定数据被拒；(d) Workbench 在子 workflow 节点提示"该节点未声明 WorkflowCallInputBinding，将走 legacy 全量传递" | Q8 |
| R-6 | `DEFAULT_POLICY max_concurrency=1` 影响多租户 —— `acc/workflow_graph.py:25` 当前默认串行，无法发挥并发能力 | medium | medium — 多 run 吞吐受限 | (a) Phase 1 暴露为 workflow 级 `policies.max_concurrency` 配置；(b) Phase 3 提高默认值（per DESIGN §11.1.1 / `acc/policy.py:DEFAULT_CONCURRENCY_LIMITS`）；(c) AUDIT P-005 验证 16 并发节点相对 1 并发 baseline 时间增长 < 5% | Q11 |
| R-7 | `LegacyPassthroughBinding` 注入对老 `.accflow.json` 的兼容裂痕 —— importer 注入与现网 capsule 期望的 `upstream_context` 字段集不完全等同 | high | medium — Phase 1 阶段灰度时部分 capsule 出现字段缺失 | (a) `LegacyPassthroughBinding` 在 BindingResolver 的 dispatch 路径直接调用 `_legacy_collect_upstream_context`（`acc/binding/legacy.py`，Phase 3 destination），不进 selector 解析（DESIGN §7.6），保证字段集恒等；(b) AUDIT M-001 / M-002 黄金基线对比；(c) 回滚方案见 §6.1 — 改为 `kind="legacy_silent_dispatch"` | Q12 |
| R-8 | Selector 语法歧义 —— 文档混用 `.summary` / `.structured.verdict` / `outbox:port` / `artifact:path` 四种形态，BindingResolver 实现易引入 magic-string 特判 | medium | medium — Workbench 编辑器无法做 schema-aware autocomplete | (a) Phase 2 统一为 `<namespace>:<path>` 格式（field / outbox / artifact / each_of / legacy）；(b) NamespaceSelector ADT discriminated union + `assert_never` 强制穷举（AUDIT T-004）；(c) parse 在 workflow load-time 拒绝未知 namespace（AUDIT E-006） | Q13 |
| R-9 | EachOfFanInSelector 顺序不确定 —— fan-out 完成顺序与解析顺序不一致，下游 aggregator 拿到非 deterministic list | low | medium — 测试不稳定、回放不一致 | (a) 按 `instance_index` 排序，与完成顺序无关（AUDIT C-018）；(b) replay 测试覆盖；(c) 文档明确"fan-in 仍是显式 binding，aggregator 必须接受 list 入参" | Q14 |
| R-10 | `source_artifact_sha256` 多文件粒度未定 —— binding selector = `outbox:research_port` 引用整个 port 目录时，记录每个文件 sha256 数组占空间，记录目录顺序串接哈希不稳定 | medium | low | (a) Phase 1 默认记录每个文件 sha256 数组（精确）；(b) Phase 3 视 NodeCacheKey 命中率决定是否引入 `outbox_manifest.json` 自身 sha256 作为聚合（DESIGN §15.15）；(c) 占空间问题通过 events.jsonl 离线压缩缓解 | Q15 |

---

## 8. 与 DESIGN.md v0.2 / TEST_PLAN.md / AUDIT_PLAN.md 的关系

### 8.1 supersede / 补充关系

- **supersede**：none。本文不替代 DESIGN.md 任何章节；DESIGN 仍是 ground truth。
- **补充**：
  - DESIGN §13 三阶段在本文 §6 展开为 file-level changes + per-phase exit criteria；
  - DESIGN §7.1 六层分离在本文 §2 展开为 5 大原语组（data_plane / control_plane / persistence / identity / visibility）+ §3 cross-cutting invariants；
  - DESIGN §7.6 LegacyPassthroughBinding 在本文 §6.1 给出 importer 注入路径与回滚方案；
  - DESIGN §11.3 审批 + 调度结构约束在本文 R-4 / §6.3 给出 graph compile 阶段插入 readiness barrier 的具体落点。

### 8.2 与 §15 Q1–Q16 的对应

| § | 问题 | 本文回应 |
|---|---|---|
| Q1 | upstream_context 的最终归宿 | Phase 3 翻转默认为 opt-in；`LegacyPassthroughBinding` 永久保留作为兼容 escape hatch；不彻底退役。 |
| Q2 | ProvenanceObject 是否需要稳定对外 schema | `schema_version` 字段：Phase 1 `1-internal-may-break`，Phase 3 `1-frozen-public`；推迟到 Phase 3 拍板对外消费。 |
| Q3 | 是否需要内置 `aggregation` capsule kind | **推迟**到 Phase 3 末或 Phase 4；当前设计仅要求"用户必须显式声明 aggregation 节点"（AC7）；EachOfFanInSelector 落地后再评估。 |
| Q4 | `binding_mode` 粒度（workflow vs node） | **拍板**：workflow 级；node 级粒度通过 `binding_mode=mixed` + per-node binding 声明等价表达；避免双重维度爆炸。 |
| Q5 | render_prompt 破坏性改造是否需要迁移期 flag | **拍板**：通过 `prompt_appendix_policy=legacy_full` 兜底兜尾，capsule 不需要单独 flag；新建 capsule scaffold 默认 `task_only`。 |
| Q6 | UI 透明度上线节奏 | **拍板**：Phase 2 上线 ProvenanceSummary toggle + Resolved Prompt tab + Applied Bindings 列表；Phase 3 加 materialization_degraded 降级图标。 |
| Q7 | 同一 data_edge 是否允许多 source（fan-in concat / merge） | **推迟到 Phase 3**：当前设计禁止；`each_of:<node_id>.<path>` selector 是显式 fan-in 路径；多 source merge 留给 aggregation capsule。 |
| Q8 | Nested workflow 的 ProvenanceSummary 继承 | **部分回应**：子 workflow 内部节点必须由子 workflow 显式重新声明；父 frame ProvenanceSummary 通过 `events.jsonl` lineage 链可重建（AUDIT O-006）。Phase 3 拍板。 |
| Q9 | Pause/resume 异常恢复策略 | **拍板**：outbox 缺失但 status=completed 时降级重跑该节点；优先信 `run_manifest.completed_nodes` checkpoint，不信 outbox 单独存在性；AUDIT E-004 / E-005 守。 |
| Q10 | Reference 物化的 Windows fallback | **拍板**：自动 fallback 到 `copy` + emit `materialization_degraded` 事件；非异常路径（AC17 / R-2）。 |
| Q11 | 测试三层分层的 CI 治理 | **拍板**：legacy lane 失败阻断（gating，与 AUDIT_PLAN §3.3 收敛一致）；perf lane nightly。 |
| Q12 | standalone wrap `{"task": ...}` | **不拍板**：保持现状（`acc/runner.py:47-62` 用户自由结构），AC4 收敛为"字段集不变量"已足够；CLI 层可选 wrap 留作 Phase 4 UX 改进。 |
| Q13 | selector 语法是否统一为 `<namespace>:<path>` | **拍板**：Phase 2 统一切到 `field: / outbox: / artifact: / each_of: / legacy:` 五 namespace；Phase 3 收紧（不再允许裸 `.path`）。 |
| Q14 | EachOfFanInSelector 是否一等公民 | **拍板**：Phase 3 一等公民；BindingResolver + Workbench 编辑器同步扩展。 |
| Q15 | `source_artifact_sha256` 多文件粒度 | **部分回应**：Phase 1 默认记录每个文件 sha256 数组；Phase 3 视 NodeCacheKey 命中率决定是否引入聚合（R-10）。 |
| Q16 | Windows `materialization_degraded` 事件是否 surface 给 capsule 作者 | **部分回应**：Phase 3 写入 `binding_manifest.json` 行（不仅 events.jsonl），让 capsule 测试可断言"我期望走 reference 但实际走了 copy"。 |

### 8.3 本文与 TEST_PLAN.md 的接口

- 每条 §5 / §6 changes 关联可验证的 T-NNN 用例；具体映射见 §5 表格 "关联 T-NNN" 列。
- TEST_PLAN.md §3 AC × Test 矩阵保持权威；本文不重述。
- 新模块 `acc/binding/` / `acc/result_store/` / `acc/runtime/` / `acc/persistence/` / `acc/scheduler/` 各自配套 `tests/unit/test_<module>.py`，命名规范遵循 TEST_PLAN.md §2.1。

### 8.4 本文与 AUDIT_PLAN.md 的接口

- 每条 §5 / §6 changes 关联 audit dimension：具体映射见下表。
- AUDIT_PLAN.md §2 89 条 check 保持权威；本文 §3 cross-cutting invariants 是 AUDIT critical 条目的子集，不重新计数。

| 本文章节 | 主要审计 dimension | 代表 check |
|---|---|---|
| §2.1 data_plane | correctness / type_safety | C-002 / T-002 |
| §2.2 control_plane | concurrency / correctness | N-001 / C-014 |
| §2.3 persistence | observability / error_handling | O-005 / E-004 / E-005 |
| §2.4 identity | type_safety | T-005 |
| §2.5 visibility | security | S-001 / S-002 / S-003 |
| §3 cross-cutting | correctness / security | X-1..X-8 ↔ AUDIT critical |
| §4 模块边界 | layering | L-001..L-008 |
| §5 重构判定 | maintainability | MN-001..MN-009 |
| §6.1 Phase 1 | migration | M-001 / M-003 / M-007 |
| §6.2 Phase 2 | observability / security | O-007 / S-002 |
| §6.3 Phase 3 | performance / migration | P-001 / P-004 / M-006 / M-008 |

### 8.5 三件套差异对照（避免重复造轮子）

| 关注点 | DESIGN.md v0.2 | TEST_PLAN.md | AUDIT_PLAN.md | 本文 IMPLEMENTATION_STRATEGY.md |
|---|---|---|---|---|
| 改什么、为什么 | 主答 | 不答 | 不答 | 不答（仅引用 DESIGN） |
| 怎么验证 | 给 18 条 AC | 主答（77 cases） | 不答 | 不答（仅引用 T-NNN） |
| 代码层级 / 类型 / 并发的硬规约 | 部分（§7、§8） | 不答 | 主答（89 checks） | 引用并落到 changes 表 |
| 先做哪一步、改哪个 file | 部分（§13 阶段） | 不答 | 不答 | **主答** |
| 5 大原语组定义 | 部分（§7.2） | 不答 | 不答 | **主答**（§2） |
| Phase 切换开关位 | 不答 | 不答 | 不答 | **主答**（§6.5） |
| 与 §15 开放问题的对应 | 提出 | 不答 | 不答 | **主答**（§8.2） |

> 上表的目的：当 reviewer / executor 翻文档时，第一时间知道"这个问题应该去哪一份找"，避免在四份文档间反复跳跃。

### 8.6 文档维护节奏

- DESIGN.md v0.2 → v0.3：当 §15 Q1–Q16 中的某个开放问题被本文拍板，并经过 Plan Review 投票，DESIGN 升小版本号，本文 §8.2 同步更新。
- TEST_PLAN.md：当 changes 表新增 file 时，TEST_PLAN 同步增 T-NNN；本文不直接改 TEST_PLAN，由 executor 在对应 PR 同步。
- AUDIT_PLAN.md：当 changes 表新增 file 时，AUDIT 在对应 dimension 增 check；同 PR 同步。
- 本文 IMPLEMENTATION_STRATEGY.md：每个 Phase 退出后，更新 §6 exit_criteria 实际命中状态、§7 risks 闭环情况、§8.2 §15 拍板进度。

---

## 附录 A: 模块文件清单（增量）

> 按目录树展示 Phase 1/2/3 新增文件；每个文件一句话职责。

```
acc/
├── binding/                          # Phase 1 — 适配器层 BindingResolver
│   ├── __init__.py                   # 公共 API 出口（BindingResolver, NamespaceSelector, etc.）
│   ├── resolver.py                   # BindingResolver.resolve(node_id, run_id) → BindingResolverResult
│   ├── selector.py                   # NamespaceSelector ADT + parse-validate (Phase 2 接通)
│   ├── thresholds.py                 # InlineThreshold = 256 KiB（替代 acc/app/node_invocation.py:11）
│   ├── legacy.py                     # LegacyPassthroughBinding 实现 + dispatch 路径
│   └── each_of.py                    # Phase 3 — EachOfFanInSelector 一等公民
├── result_store/                     # Phase 1 — NodeResult 寻址 + cache
│   ├── __init__.py                   # 公共 API（query / put / list_by_run）
│   ├── store.py                      # 实现：(run_id, node_id, port_id) → ArtifactBundle
│   └── cache.py                      # in-memory cache by run_id
├── runtime/                          # Phase 1/2/3 — 统一 frame / fan_out / partial_aggregate / approval / payload / transfer_policy
│   ├── __init__.py
│   ├── frame.py                      # Phase 1 — frame helpers（从 acc/environment.py 抽出）
│   ├── payload.py                    # Phase 2 — AgentPayload / RuntimePayload TypedDict + 装配
│   ├── transfer_policy.py            # Phase 2 — copy/reference/symlink + Windows fallback
│   ├── partial_aggregate.py          # Phase 3 — strict / best_effort
│   └── approval.py                   # Phase 3 — Approval hook（与 ApprovalBarrier 配合）
├── persistence/                      # Phase 1 — run_manifest / events / atomic_write / cache_key
│   ├── __init__.py
│   ├── run_manifest.py               # writer 增 completed_nodes / binding_materializations
│   ├── events_writer.py              # 复用 acc/events.py + 新事件 kind
│   ├── atomic_write.py               # tempfile + os.replace helper
│   └── cache_key.py                  # Phase 1 — NodeCacheKey (consumer 仍 Phase 3)
├── scheduler/                        # Phase 1/3 — ReadySetComputer / DAGScheduler / ApprovalBarrier
│   ├── __init__.py
│   ├── ready_set.py                  # Phase 1 — ReadySetComputer O(E+V)
│   ├── dag_scheduler.py              # Phase 3 — 替换 acc/app/__init__.py:534-575 level scheduler
│   └── approval_barrier.py           # Phase 3 — graph compile 阶段插入 readiness barrier
├── provenance.py                     # Phase 1 — ProvenanceObject frozen dataclass + schema_version
└── policy.py                         # Phase 1 — DEFAULT_POLICY 集中（合并 acc/workflow_graph.py:25 与 acc/legacy_graph_importer.py:22）

tools/
└── migrate_graph_to_explicit_binding.py  # Phase 3 — 扫描 .graph.json 自动迁移（幂等）

tests/
├── architecture/
│   └── test_import_boundaries.py     # Phase 1 — 扩 R1..R7 contract
├── unit/
│   ├── test_binding_resolver.py      # Phase 1
│   ├── test_result_store.py          # Phase 1
│   ├── test_provenance.py            # Phase 1
│   ├── test_run_manifest.py          # Phase 1
│   ├── test_selector_parser.py       # Phase 2
│   ├── test_prompting.py             # Phase 2 — render_prompt 三档
│   ├── test_payload_split.py         # Phase 2 — AgentPayload vs RuntimePayload
│   └── test_each_of_selector.py      # Phase 3
├── integration/
│   ├── test_explicit_binding_matrix.py   # Phase 2
│   ├── test_provenance_isolation.py      # Phase 2
│   ├── test_standalone_equivalence.py    # Phase 2
│   ├── test_legacy_byte_equivalence.py   # Phase 2
│   ├── test_pause_resume.py              # Phase 3
│   ├── test_concurrent_runs_isolation.py # Phase 3
│   ├── test_aggregation_and_fan_in.py    # Phase 3
│   ├── test_nested_workflow_isolation.py # Phase 3
│   ├── test_windows_fallback.py          # Phase 3
│   ├── test_inline_threshold.py          # Phase 2
│   ├── test_path_relativity.py           # Phase 1
│   ├── test_approval_barrier.py          # Phase 3
│   └── test_migration_script.py          # Phase 3
├── property/
│   ├── test_hash_mutual_exclusion.py     # Phase 1
│   ├── test_path_relativity_property.py  # Phase 1
│   └── test_each_of_order.py             # Phase 3
├── e2e/
│   └── test_acNN_*.py                # Phase 1/2/3 — 17 个主轨用例（每个 AC 一条）
├── migration/
│   └── test_phase{1,2,3}_baseline.py # Phase 1/2/3 — Phase 间字节级兼容
├── performance/
│   ├── test_ready_set_benchmark.py   # Phase 3
│   ├── test_concurrency_overhead.py  # Phase 3
│   ├── test_inline_threshold_perf.py # Phase 2
│   └── test_windows_fallback_perf.py # Phase 3
├── security/
│   ├── test_cross_run_reject.py      # Phase 1
│   ├── test_no_absolute_paths.py     # Phase 1
│   ├── test_expose_metadata_whitelist.py  # Phase 2
│   ├── test_explicit_only_unbound_data_rejected.py  # Phase 2
│   └── test_provenance_field_scan.py # Phase 2
└── fixtures/
    ├── baselines/
    │   ├── phase1/                   # Phase 1 黄金基线（.json，AC15 byte-equal）
    │   ├── phase2/
    │   └── phase3/
    └── capsules/                     # 轻量测试 capsule（不启动子进程）

schemas/
├── capsule_template_schema.json      # Phase 1 — 增 prompt_appendix_policy / acc_expose_workflow_metadata
└── workflow_graph_v3_schema.json     # Phase 2 — 增 binding_mode

.importlinter                          # Phase 1 — layer boundary contract
```

---

## 附录 B: 命令清单

> 用于本地开发与 CI；命令在仓库根 `F:/Agent-Capsule-Conductor/` 执行。

```bash
# 类型检查（Phase 1 必须全绿；Phase 2/3 范围扩展）
mypy --strict acc/binding/ acc/result_store/ acc/runtime/ acc/persistence/ acc/provenance.py acc/domain.py

# 代码风格 + lint
ruff check acc/ tests/
ruff format --check acc/ tests/
ruff check --select D acc/binding/ acc/result_store/ acc/provenance.py    # docstring 规范（AUDIT MN-004）

# 层级边界 contract（AUDIT L-001..L-008）
lint-imports --config import-linter.ini
# 等同于：
python -m importlinter --config .importlinter

# 主 lane 测试（AUDIT M-005：legacy lane 阻断已收敛）
pytest -m "not slow and not legacy" --cov=acc --cov-fail-under=80
pytest -m "not slow and not legacy" --strict-markers --maxfail=1

# legacy lane —— 隔离运行
pytest -m legacy --maxfail=1

# performance lane —— nightly only（AUDIT P-001 / P-005 / P-006 / P-007）
pytest -m performance --benchmark-only --benchmark-compare-fail=mean:5%

# 单 AC 主轨 e2e（TEST_PLAN.md 命名规范）
pytest -m e2e -k acNN                # NN ∈ 01..17

# 架构测试
pytest tests/architecture/ -v

# 安全扫描（Phase 2 起）
bandit -r acc/ -ll

# 死代码扫描（Phase 3 起，AUDIT MN-005）
vulture acc/ --min-confidence 80

# 黄金基线对比（AC15）
pytest tests/integration/test_legacy_byte_equivalence.py::test_T_AC11_AC15_golden_baseline

# 路径相对化扫描（AC16 / AUDIT S-005）
pytest tests/integration/test_path_relativity.py::test_no_absolute_paths_in_persisted_json

# Adapter ENV 一致性（AUDIT S-003）
pytest tests/unit/test_adapter_env_contract.py::test_uniform_six_var_set

# Windows fallback（AC17，需 Windows runner 或 mock）
pytest tests/integration/test_windows_fallback.py -v

# 完整门禁（CI main lane）
pytest -m "not legacy" --maxfail=1 \
  && mypy --strict acc/ \
  && ruff check acc/ tests/ \
  && lint-imports --config .importlinter
```

---

## 附录 C: 与 CCB peer review 对接的 checkpoint

> 对接 `~/.claude-internal/rules/ccb-collaboration.md` 的 Peer Review Framework（designer/reviewer/executor/inspiration 角色）。

### C.1 触发点

| 触发点 | 触发时机 | tag | 内容 |
|---|---|---|---|
| Plan Review (Phase 1) | Phase 1 设计完成 → 写代码前 | `[PLAN REVIEW REQUEST]` | 完整 IMPLEMENTATION_STRATEGY.md + DESIGN.md v0.2 + AUDIT_PLAN.md §6 上线门 |
| Plan Review (Phase 2) | Phase 1 退出 → Phase 2 设计提案 | `[PLAN REVIEW REQUEST]` | Phase 2 changes 表 + 影响 AC 列表 + binding_mode 切换路径 |
| Plan Review (Phase 3) | Phase 2 退出 → Phase 3 设计提案 | `[PLAN REVIEW REQUEST]` | Phase 3 changes 表 + 默认翻转影响面分析 + 迁移脚本 spec |
| Code Review (per PR) | 每个 PR 合并前 | `[CODE REVIEW REQUEST]` | `git diff` between `--- CHANGES START/END ---` + Self-Check 清单（AUDIT_PLAN §4.3） |

### C.2 评分维度（来自 AUDIT_PLAN）

CCB reviewer（codex）按下列维度打分（10 分制）：

| dimension | 来源 | 备注 |
|---|---|---|
| `correctness` | AUDIT §2.1 | AC1–AC18 covering |
| `layering` | AUDIT §2.2 | import-linter contract 符合度 |
| `type_safety` | AUDIT §2.3 | mypy --strict 通过率 |
| `error_handling` | AUDIT §2.4 | 命名异常分类 + 原子写 |
| `concurrency` | AUDIT §2.5 | permit 释放 + 跨 run 隔离 |
| `security` | AUDIT §2.6 | AgentPayload 字段集 + ENV |
| `performance` | AUDIT §2.7 | ReadySet 复杂度 + InlineThreshold |
| `migration` | AUDIT §2.8 | LegacyPassthroughBinding + AC11/AC15 |
| `observability` | AUDIT §2.9 | events.jsonl 完备 + lineage 重建 |
| `maintainability` | AUDIT §2.10 | DEFAULT_PORT_ID 单点 + DEPRECATED 注释 |

### C.3 通过门槛

- **Pass**：overall ≥ 7.0 AND 无单维度 ≤ 3。
- **Fail handling**：fix issues from response → re-submit；max 3 rounds。
- **3 round failure**：升级到 designer + 人工 reviewer 联合裁决（来自 AUDIT_PLAN §4.5）。

### C.4 Self-Check 清单复用

executor 在 PR description 必填 AUDIT_PLAN §4.3 self-check（节选）：

```
## Self-Check
- [ ] mypy --strict passes on changed modules
- [ ] ruff check + format clean
- [ ] import-linter contract unchanged or extended (no forbidden imports)
- [ ] pytest main lane green; @legacy lane unchanged
- [ ] AC coverage: PR claims to satisfy AC ___ ; T-NNN added/updated: ___
- [ ] No new absolute path written into runs/<run_id>/*.json (AC16)
- [ ] No new agent-visible field bypasses BindingResolver (AC2)
- [ ] No magic literal "main" introduced (uses DEFAULT_PORT_ID)
- [ ] No new bare `except:` or non-typed exception leak
- [ ] If touching adapter env: ACC_RUN_ID + ACC_RUN_DIR uniformly set
- [ ] If touching ProvenanceObject: schema_version label preserved
- [ ] If renaming: LSP refs all updated (no broken imports)
- [ ] Manual review items (if applicable) called out: ___
```

### C.5 Inspiration 角色用途

DESIGN §9 Workbench UX、§7.6 LegacyPassthroughBinding kind 命名、`prompt_appendix_policy` 三档命名等设计性命名问题，可走 inspiration（gemini）参考；结论必经 designer 判断（推断：参考 `~/.claude-internal/rules/ccb-collaboration.md` 的 inspiration 不可靠原则）。

### C.6 Plan Review 提交模板

每次 Plan Review 提交按下列模板（沿用 `ccb-collaboration.md` 约定）：

```
[PLAN REVIEW REQUEST]

Phase: <Phase 1 | Phase 2 | Phase 3>
Scope: <changes 表行号或 PR 列表>

--- PLAN START ---
（粘贴本文 §6 对应 phase changes 表 + exit_criteria + 回滚条件）
--- PLAN END ---

Self-review against AUDIT dimensions:
  - correctness: <已覆盖 AC list>
  - layering: <import-linter contract 已扩展>
  - type_safety: <mypy --strict 范围已声明>
  - error_handling: <命名异常已枚举>
  - concurrency: <并发不变量已列举>
  - security: <字段集 / ENV / 路径相关性已扫描>
  - performance: <SLO baseline 已声明>
  - migration: <legacy 兼容路径已声明>
  - observability: <events.jsonl 新事件 kind 已列举>
  - maintainability: <DEPRECATED 注释 + 单点常量已确认>

Open questions for reviewer:
  - <列出 §15 中本阶段拍板的 Q-N + 推迟的 Q-N>
```

### C.7 Code Review 提交模板

```
[CODE REVIEW REQUEST]

PR: <PR 编号 + 标题>
Phase: <对应阶段>
Affected files: <file paths>

--- CHANGES START ---
（粘贴 git diff，或 gh pr diff 输出）
--- CHANGES END ---

Self-Check（AUDIT_PLAN §4.3 节选）:
  - [ ] mypy --strict passes on changed modules
  - [ ] ruff check + format clean
  - [ ] import-linter contract unchanged or extended
  - [ ] pytest main lane green; @legacy lane unchanged
  - [ ] AC coverage: PR claims to satisfy AC ___ ; T-NNN added/updated: ___
  - [ ] No new absolute path written into runs/<run_id>/*.json (AC16)
  - [ ] No new agent-visible field bypasses BindingResolver (AC2)
```

reviewer 在 5 工作日内返回 JSON：

```
{
  "scores": {
    "correctness": 8.0,
    "layering": 9.0,
    ...
  },
  "overall": 8.4,
  "must_fix": [...],
  "nice_to_have": [...],
  "decision": "pass" | "fail" | "block"
}
```

---

> **完。** 本文 v0.1 与 DESIGN.md v0.2 / TEST_PLAN.md / AUDIT_PLAN.md 对齐；下一步交 reviewer 走 `[PLAN REVIEW REQUEST]` 第一轮评分。
