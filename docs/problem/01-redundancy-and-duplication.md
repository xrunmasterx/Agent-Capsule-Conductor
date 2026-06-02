# 冗余与重复实现

> 本文档记录 ACC 当前架构中属于 "冗余与重复实现" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 当前在多个层面存在大量"复制粘贴式"重复：从 5 行的 `write_json` 到 4 套 `copy_path`、3 个事件写入器、3 份 fake-agent 白名单，再到 4 个共享"supervisor"语义但毫无组合关系的协调器。这类重复带来三种共性损害——（1）行为漂移：相同名字下出现 `mkdir`/`ensure_ascii`/`dirs_exist_ok` 等微小但语义不等价的差异；（2）维护放大：任何一次修订必须在 N 个位置同步；（3）真理来源混淆：当多个写入器面向同一文件、多个状态视图代表同一 run 时，系统的可审计性与崩溃恢复保证开始失效。这些问题与 ACC "callable-only / 单一契约 / 轻量本地"的架构目标方向相反，是后续清理的优先目标之一。

## 详细问题清单

### 1. [CRITICAL] events.jsonl 由三个互不兼容 schema 的事件写入器同时写入

**证据**：
- `acc/store/__init__.py` (98-118) — `emit_event` 写入 `{timestamp, event_type, status, node_id, level, payload}` schema。
- `acc/persistence/events.py` — `EventsWriter` 写入 `{ts, event_type, payload}` schema（字段名 `ts` 与 `timestamp` 不一致）。
- `acc/artifact_store.py` (71-73) — `append_event` 直接写入裸 dict，无任何字段约束。

**为什么是问题**：三个写入器面向同一个 `events.jsonl` 文件，但 schema 互不兼容。任何下游消费者（UI、CLI、回放、回归）必须同时处理多种格式，否则事件会被静默丢弃，从而破坏可审计性与调试能力。

**建议**：在 `acc.persistence.events` 或 `acc.domain` 中确立单一规范事件 schema，让所有写入路径（`emit_event`、`EventsWriter`、`ArtifactStore.append_event`）产出同一格式；对外只暴露一个 `EventWriter` 接口，废弃直接写入。

**可行性 / 风险**：高强度——需要审计所有事件生产者与消费者并统一到一个 schema，已有日志会带来向后兼容问题。

**复核**：schema 碎片化是真实存在的——至少四个写入抽象（`store.emit_event`、`persistence.events.EventsWriter`、`acc/events.JsonlEventEmitter`、`core_v2_runtime.append_event`）使用不同字段命名（`ts` vs `timestamp`、`event_type` vs `type`、裸 dict vs 结构化 record）。但 critical 级别略有夸张：`EventsWriter` 与 `ArtifactStore.append_event` 实际只在测试中被调用，并未在生产路径活跃地破坏共享日志；生产主路径是 `core_v2_runtime` 自有的 `append_event`。`acc/events.py` 已经存在一个候选的规范写入器 `JsonlEventEmitter`，提示此重构可能已经在进行中。可将严重度从 critical 下调至中等：核心问题是 schema 漂移与重复抽象，而非已经发生的可审计性丢失。（confidence=medium, suggestion_feasible=false）

来源：dead-code-and-orphans / dead-code-and-orphans#10

---

### 2. [CRITICAL] Run 状态真理被拆分为 8+ 个不连通的表示

**证据**：
- `acc/run_index.py` (15-64, 145-191) — `RunSummary` / `NodeRunSummary` / `RunIndex` 是工具模块中的 Pydantic 模型；`load_run_summary` 会探测 4 个历史文件名（`run_summary.json`、`node_summary.json`、`run_record.json`、`conductor_output.json + session_manifest.json`）。
- `acc/session.py` (9-43) — `SessionManifest`（Pydantic, 36 字段）与 `domain.SessionInstance`（frozen dataclass）结构平行存在，缺少明确所有权边界。
- `acc/server/run_projection.py` 与 `acc/app/run_projection.py` (1-242 / app 版本) — 同名两个文件，server 版基于 `FilesystemResultStore + ProvenanceObject` 构建 `NodeProjectionView`；app 版基于 `NodeRunSummary` 构建 event-step 视图，关注点完全不同。
- `acc/server/run_manager.py` (31-236) — `WorkbenchRunManager` 在维护 in-memory deque + Task map 的同时存在 on-disk `run_summary.json`，RAM 与 FS 同时被视为权威。
- `acc/artifact_store.py + acc/persistence/manifest.py + acc/store/__init__.py` (62-63 / 56-86 / 98-118) — 三个独立写入器面向 `run_manifest.json` / `events.jsonl`，schema 不一致；`ArtifactStore.write_manifest` 普通写入会静默覆盖 `persistence.manifest.write_atomic` 的 checkpoint。

**为什么是问题**：架构目标明确声明"run 目录是真理来源、每次 run 由 runId 索引、UI 只是投影"。现实却存在 8+ 套表示同时共存：run 目录文件、`run_index` 的 Pydantic 模型、`WorkbenchRunManager` 的内存队列、两个 `run_projection.py`、`SessionInstance` 与 `SessionManifest` 双份、4 个历史文件名探测、3 个事件 schema。任何消费者（UI / CLI / 测试 / decisions）都必须挑一个，且内存副本可能在崩溃 / 重启时与磁盘真理产生竞态；写入路径互相覆盖，破坏了原本应当存在的原子 checkpoint。

**建议**：在 `acc/domain` 定义一个规范化的 Run aggregate（id、status、started_at、finished_at、nodes、manifests）；让 `runs/<run_id>/run_summary.json` 成为唯一持久化真理来源，且只允许通过 `persistence.manifest.write_atomic` 进行原子写入；删除 `server/run_projection.py` 重复（移入 `acc/result_store/projection.py`）；移除 `WorkbenchRunManager` 的内存队列；迁移 4 个历史文件名后删除探测逻辑；将 `SessionManifest` 折叠回 `SessionInstance`。

**可行性 / 风险**：blast radius 巨大——触及读取 run 状态的所有层。需分阶段推进：（1）`run_summary.json` 规范化并提供 `acc runs migrate` 命令；（2）删除历史文件名探测；（3）移除内存队列；（4）合并 Session 双份。每步独立可发布，总体约 2 人周。

**复核**：finding 大体真实但有夸张。真正成立的问题是：（a）`load_run_summary` 中的 4 个历史文件名探测构成隐藏读取路径；（b）三个事件写入器以不一致 schema（`type` vs `event_type`、`timestamp` vs `ts`）写入 `events.jsonl`，导致消费者静默失败；（c）`ArtifactStore.write_manifest` 的非原子普通写入若与 `write_atomic` 路径同时活跃，会产生 interleave 风险。被夸张的部分：所谓"8+ 表示"将本就分层的视图（如 `run_projection.py` 是文档化的只读投影）与真理来源混为一谈；`WorkbenchRunManager` 的内存队列被显式设计为"进程内 handle"而非权威；`SessionManifest` 与 `SessionInstance` 是不同 runtime 世代的产物。建议中"删除 `server/run_projection.py`"会破坏文档化的分层架构；"删除内存队列"忽略其用于进程内活跃 run 跟踪的合理性。事件 schema 碎片化是最具可执行性的具体问题，应作为首要焦点。建议严重度从 critical 下调至中等——真实数据丢失需要尚未被证明会出现的特定路径相交。（confidence=medium, suggestion_feasible=false）

来源：cross-cutting / cross#0

---

### 3. [CRITICAL] "Supervisor" 概念被 4 个不连通的协调器共用一个名字

**证据**：
- `acc/engine/supervisor.py` (1-end) — 纯 supervisor state 的 parser/serialiser，无 IO、无 dispatch。
- `acc/app/supervisor.py` (159-215) — `SupervisorRouter.check_dispatch_policy` + `record_dispatch` 持有调度频率 / 深度限制，使用 `supervisor_state.json` + `supervisor_plans/`。
- `acc/app/scheduler.py` (88-204) — `reconcile_wakeup_state`、`apply_recovery_level`（L1/L2/L3 恢复）、`scan_session_health` 持有完全独立的"唤醒队列 + 陈旧会话探测"职责，使用 `wakeup_queue.jsonl + state.json`。
- `acc/server/run_manager.py` (31-236) — `WorkbenchRunManager` 持有进程内 FIFO queue、并发上限、cancel-marker 协议、崩溃 reconcile，从行为上也是"supervisor"。

**为什么是问题**：四个模块各自实现某种"监督在途工作"的语义：dispatch 深度 / 重复限制（app/supervisor）、唤醒恢复 + 健康（app/scheduler）、run 队列生命周期（server/run_manager）、纯 parser（engine/supervisor）。它们使用四份独立持久化文件（`supervisor_state.json`、`supervisor_plans/`、`wakeup_queue.jsonl`、内存 deque），无共享 schema、无组合关系。一旦发生用户可见的复合故障（例如 dispatch budget 耗尽时正在做 wakeup 恢复），无法从一个地方进行推理。Core v2 "callable-only" 承诺的"单一 runtime 契约"也因此破裂。

**建议**：在 `acc/runtime/coordinator.py`（或更合适的层）建立一个统一协调器，拥有所有在途状态：dispatch 预算、深度、递归、wakeup 队列、recovery level、run 队列生命周期；以单一 `supervisor_state.json`（per run）通过 `persistence.manifest.write_atomic` 持久化。`SupervisorRouter`、`scan_session_health`、`apply_recovery_level`、`WorkbenchRunManager` 收敛为该 Coordinator 的方法；`engine/supervisor.py` 保留纯 parser 职责。这样 4 份独立 state 文件收敛为 1 份，系统也有了唯一一处可以回答"这个 run 还能继续吗"。

**可行性 / 风险**：大型重构——涉及 CLI、server、runtime。建议分阶段：（1）先合并 `app/supervisor` 与 `app/scheduler`（同处 app 层、共享恢复语义）；（2）按 layer-violations#9 把 `WorkbenchRunManager` 移入 `acc/app/`；（3）最后统一 state 文件。已有测试可指导迁移；保持 `engine/supervisor.py` 的纯函数定位不变。

**复核**：在途状态被分裂为 3-4 个互不组合的持久化契约属实——代码确实未在任一处把它们组合起来，复合故障真的无法从单一位置推理。但 finding 也有过度陈述：（1）"共用一个名字"在一半组件上不成立——`scheduler.py` 与 `run_manager.py` 并不使用 supervisor 之名；（2）建议把统一协调器放入 `acc/runtime/`，但 AGENTS.md rule 8 将 `acc.runtime` 限定为"进程 / workspace 执行策略"，与 dispatch 预算 / 唤醒队列 / run 生命周期无关，按既定层契约属层违规；（3）合并 state 文件会把"append-only 带 coalescing 的 wakeup_queue.jsonl"、"可变调用图的 supervisor_state.json"、"终态摘要 run_summary.json"等不同语义强行混入一份 schema，反而纠缠；（4）AGENTS.md rule 4 明确告诫"保持 ACC 轻量与本地优先"，对一个 local-first 工具做跨 CLI/server/runtime 的 Coordinator 重构是不成比例的。建议严重度从 critical 下调至中等：碎片化是真实的设计气味，但模块在各自层内是自洽的，实际上互不干扰；建议方案如直接落地会违反层不变量，需先重审层模型才可推进。（confidence=medium, suggestion_feasible=false）

来源：cross-cutting / cross#1

---

### 4. [MAJOR] `write_json` 在 6 个模块中各自实现

**证据**：
- `acc/store/__init__.py` (27-32) — 规范实现：`mkdir(parents=True, exist_ok=True)` + `json.dumps(ensure_ascii=False, indent=2, sort_keys=True)`。
- `acc/environment.py` (70-75) — 与 `store/__init__.py:27` 字节级相同；该模块明明已 import `acc.utils.load_json`，却仍自带 `write_json`。
- `acc/callable_runner.py` (442-447) — 与规范完全一致的私有副本，未导入 store 中的规范实现。
- `acc/app/core_v2_runtime.py` (880-885) — 第四份 module-level 私有副本。
- `acc/run_index.py` (360-367) — 用 deferred `import json` 的 `json_dumps` 实现，无 `mkdir`，与规范不一致。
- `acc/artifact_store.py` (79-81) — `@staticmethod` 形式，缺少 `mkdir` 与 `ensure_ascii=False` 两处行为差异。

**为什么是问题**：6 份分裂副本累积出沉默的行为差异（是否 `mkdir`、是否 `ensure_ascii`、是否 deferred import）。任何一次对排序 / 缩进的修订必须在 6 处同步；规范版本是 `acc/store/__init__.py:write_json` 但没有任何机制强制使用。

**建议**：删除全部 5 份私有副本，统一改用 `from acc.store import write_json`；`artifact_store.py` 中保留 staticmethod 外壳即可，让其变成对 `acc.store.write_json` 的薄封装。

**可行性 / 风险**：约 6 个文件 / 12 个调用点的机械替换。`artifact_store.py` 缺失的 `mkdir` 是行为差异，需要专门确认其调用点是否已经在外部保证目录存在；其余调用点都接受规范签名。

**复核**：duplication 已逐文件确认。四个副本（store / environment / callable_runner / core_v2_runtime）字节级相同；两个副本有差异：`run_index.py` 缺少 `mkdir` 与 `ensure_ascii`（真实差异、有真实风险）；`artifact_store.py` 缺 `mkdir`（被 `prepare()` 缓解）与 `ensure_ascii`（真实差异）。迁移要点：（1）`run_index.py` 的 `mkdir` 缺失是潜在 bug，`runs_root/"index.json"` 路径假设父目录已存在，切到规范实现会安全地补齐；（2）`artifact_store.py` 缺 `ensure_ascii` 意味着输出 JSON 中非 ASCII 当前会被转义，切到规范会改变序列化（一般良性但需告知）；（3）静态方法外壳可改为单行委托，无需实例状态。AGENTS.md 也未对此设置不变量。整体低风险。（confidence=high, suggestion_feasible=true）

来源：redundancy-and-duplication / redundancy-and-duplication#0

---

### 5. [MAJOR] Hermetic fake-agent ID 列表在 `callable_registry` 与 `callable_refs` 中重复，且成员不一致

**证据**：
- `acc/callable_registry.py` (76-86) — `refs.update({('tool_class','fake_producer'), ('tool_class','fake'), ('tool_class','merge'), ('tool_class','fail'), ('agent_class','generic_fake_agent'), ('agent_class','fake-agent.generic')})`。
- `acc/app/callable_refs.py` (11-17) — `HERMETIC_CALLABLE_REFS`：包含 `fake_producer`、`merge`、`fake`、`generic_fake_agent`、以及 `('agent_class','generic_cli')` —— 真实 production adapter 名混入了 test fake 集合。
- `acc/migration/graph_importer.py` (184-193) — `_known_agent_id` 检查 `'generic_fake_agent'`、`'fake-agent.generic'`；`_known_tool_id` 检查 `'fake_producer'`、`'fake'`、`'merge'`、`'fail'` —— 第三份独立硬编码枚举。

**为什么是问题**：同一个"fake-agent IDs"概念有 3 份独立枚举，且成员之间存在不易察觉的差异：`callable_registry` 含 `fail` 与 `fake-agent.generic`，`callable_refs` 缺；`callable_refs` 反而把真实 production adapter `generic_cli` 混入 hermetic-only 集合，污染了"测试专用"语义。新增任意 fake agent 必须改 3 处。

**建议**：在 `acc/testing/fake_refs.py` 定义唯一的 `HERMETIC_CALLABLE_REFS`，让 `callable_registry.ref_keys()` 与 `callable_refs.HERMETIC_CALLABLE_REFS` 都从该处导入；从 hermetic 集合中移除 `('agent_class','generic_cli')`，因为它是 production adapter，不属于 test fake。

**可行性 / 风险**：中等工作量——需要新增一个轻量 `acc/testing/` 包或共享常量模块。最大决定不在机械迁移，而是必须明确"hermetic 集合"的真实语义（特别是 `generic_cli` 是否保留）。

**复核**：三处 duplication 全部确认。成员差异真实：`callable_registry` 持有 `fail` 与 `fake-agent.generic`，而 `HERMETIC_CALLABLE_REFS` 缺；`HERMETIC_CALLABLE_REFS` 持有 `generic_cli`，但它是真实 `GenericCliAdapter`，不属于 fake-only 集合。一个细节：`discover_known_callable_refs()` 实际是把 `HERMETIC_CALLABLE_REFS` 与 `callable_registry.ref_keys()` 做并集而非互斥替代；但 `HERMETIC_CALLABLE_REFS` 也存在被独立使用的路径（`callable_registry=None` 时），所以遗漏成员仍有后果。`graph_importer` 中的函数完全独立，且其作用偏 normalization 而非枚举，因此它的合并需要单独决定 fallback 行为。建议方案（共享 `acc/testing/fake_refs.py`）可行，主决策是规范成员（尤其 `generic_cli` 应该被移除）。（confidence=high, suggestion_feasible=true）

来源：redundancy-and-duplication / redundancy-and-duplication#5

---

### 6. [MAJOR] `copy_path` 实现 4 份，path-safety 与 `dirs_exist_ok` 行为分裂

**证据**：
- `acc/store/__init__.py` (69-77) — 含 `safe_child_path(target, target.parent)`（其守护语义对 target 为平凡真，参见 patch-scar），`shutil.copytree(source, target)` 不带 `dirs_exist_ok`。
- `acc/port_io.py` (171-178) — `target.parent.mkdir(...)`、`shutil.copytree(source, target, dirs_exist_ok=True)`，无 `safe_child_path` 守护。
- `acc/artifact_store.py` (83-89) — `@staticmethod _copy_path`，`dirs_exist_ok=True`，无 path 守护，方法名也不同（前缀下划线）。
- `acc/environment.py` (298 附近) — `copy_behavior_path` 又是一个用于 behavior snapshot 的近似副本，无共享 primitive。

**为什么是问题**：4 份副本对应 3 套行为剖面：（1）store 有路径守护无 `dirs_exist_ok`；（2）port_io 有 `dirs_exist_ok` 无守护；（3）artifact_store 无守护、有 `dirs_exist_ok`。任意调用方挑错副本都会得到不同语义（合并 vs 替换）。

**建议**：合并到 `acc/store/__init__.py` 的单一签名，例如 `copy_path(source, target, *, dirs_exist_ok=False, check_path_escape=True)`；同时把 `safe_child_path(target, target.parent)` 这条平凡守护（见 patch-scar）替换为基于真实根目录的检查。

**可行性 / 风险**：中等工作量。`dirs_exist_ok` 语义差异（合并 vs 替换）是真实行为分裂，合并前必须审计调用方以保证不静默改变结果。

**复核**：duplication 真实，存在至少四个分歧维度：（a）`copytree(dirs_exist_ok=...)`；（b）拷贝前是否 `rmtree`；（c）`source==target` 是否短路；（d）文件分支中 `mkdir` 顺序。任何调用方挑错副本，目录目标会得到 merge / replace 不同语义。finding 略夸大了"安全风险"——所谓平凡守护是针对 `target`（不是 `source`）的，因此对源端构造的 `..` 路径无防护，store 与 port_io 在该维度上同样暴露。整合方向正确：单一 `copy_path(source, target, *, dirs_exist_ok=False, check_path_escape=True)` 加上基于真实根目录的检查。中等工作量评估合理——`dirs_exist_ok` 语义差异是必须保留的真实行为分裂。`store/__init__.py` 中 "rmtree before copy" 的设计可能是该调用方的有意约定（保证 clean overwrite），合并前需检查。（confidence=high, suggestion_feasible=true）

来源：redundancy-and-duplication / redundancy-and-duplication#7

---

### 7. [MAJOR] `write_json` 重复实现（六份副本，伴随真实分歧）

**证据**：
- `acc/store/__init__.py` (27-32) — 规范实现，含 `mkdir` + 排序 + UTF-8。
- `acc/callable_runner.py` (442-447) — 与规范一致的副本。
- `acc/app/core_v2_runtime.py` (880-885) — 与规范一致的副本。
- `acc/environment.py` (70-75) — 与规范一致的副本。
- `acc/run_index.py` (360-367) — 使用 deferred `json` import，行为偏离规范。
- `acc/runtime/__init__.py` (94) — 第六份副本。

**为什么是问题**：同一个 5 行 helper 出现 6 次实现。任何一次对规范实现的修订（增加 encoding 错误处理、改 indent、改 sort_keys）都必须在 6 处同步，否则一定有副本会漂移。

**建议**：把所有 `write_json` 调用统一到 `acc.store.write_json`；在合并前必须先验证 6 份副本的行为是否一致。

**可行性 / 风险**：中等工作量——改动 6 处 import 并验证调用方对共享版本的行为依赖。已经一致的副本风险很低；不一致的副本（`run_index.py`、`artifact_store.py`）需要单独决策。

**复核**：findings 真实但用词需修正。"6 份副本均一致"不准确——`acc/run_index.py:360-367` 有真实差异（无 `mkdir`、无 `ensure_ascii=False`），`acc/artifact_store.py`（finding 未列出的第 7 份副本）也有相似分歧。"合并前先验证一致性"不是模板告诫，而是必要步骤。把 5 行 helper 评为 major 偏重，但已经发生的漂移确实印证了维护风险。整合可行：5 份一致副本可安全替换为 `acc.store.write_json` 的 import；`run_index.py` 与 `artifact_store.py` 需要明确决策——`run_index.py` 的调用方推测无需 `mkdir`，且可能有意保留非 ASCII 转义，盲目合并会静默改变行为。（confidence=high, suggestion_feasible=true）

来源：dead-code-and-orphans / dead-code-and-orphans#6

---

### 8. [MAJOR] `copy_path` 重复实现（4 份，含发散行为）

**证据**：
- `acc/store/__init__.py` (69-77) — 含 `safe_child_path` 守护，拷贝前 `rmtree` target。
- `acc/port_io.py` (171-178) — 无 `safe_child_path` 守护，使用 `dirs_exist_ok=True`，并在 `source==target` 时跳过。
- `acc/environment.py` (298) — `copy_behavior_path`，第三份实现（observation 阶段未深入审阅，但已确认）。
- `acc/artifact_store.py` (84-89) — `_copy_path`，使用 `dirs_exist_ok=True`，无守护，文件分支才 `mkdir`。

**为什么是问题**：4 份实现行为微妙不同：是否做路径安全守护、对已有 target 的处理（`rmtree` vs `dirs_exist_ok` vs 跳过）、`source==target` 短路与否。这种发散既是维护负担，也曾被误读为安全差异（详见复核）。

**建议**：在 `acc.store`（或 `acc.utils`）建立规范 `copy_path`，参数化各分歧维度（如 `allow_overwrite`、`allow_same_source`），其余副本委托过去。无论是否合并，`safe_child_path(target, target.parent)` 这条平凡守护都应当先单独修复。

**可行性 / 风险**：中等工作量——需要识别每个调用点使用了哪种变体并参数化覆盖。路径守护 bug（`safe_child_path(target, target.parent)`）应即刻修复，与合并解耦。

**复核**：finding 真实，但定性需修正：把 port_io 缺失守护描述为"安全风险"并不成立，因为 store 中那条守护本身永远不会触发（`safe_child_path(target, target.parent)` 恒真）。换言之，4 份副本在路径安全维度上是平等地"无防护"，分歧仅是行为差异而非安全差异——但这反而让 store 的副本带有"虚假安全感"。合并建议与立即修复守护 bug 都是有效结论。`artifact_store.py:_copy_path` 还有一个细节：仅在文件分支调用 `target.parent.mkdir`，目录分支不 mkdir——这一点要在合并接口中显式刻画。（confidence=high, suggestion_feasible=true）

来源：dead-code-and-orphans / dead-code-and-orphans#7

---

### 9. [MAJOR] "Callable" 抽象被打散在 6+ 文件，且伴随 3 份独立的 fake-agent 枚举

**证据**：
- `acc/callable_runner.py` 与 `acc/callable_registry.py` (1-448 / 78-86) — `callable_runner` 是 dispatch 引擎，居于 root 但与 `acc/app/core_v2_runtime.py` 强耦合；`callable_registry.ref_keys()` 在 production registry 中硬编码 hermetic-only IDs（`fake_producer`、`fake`、`merge`、`fail`、`generic_fake_agent`、`fake-agent.generic`）。
- `acc/app/callable_refs.py` (11-17) — `HERMETIC_CALLABLE_REFS`，第二份独立枚举，且包含 `('agent_class','generic_cli')`——真实 production adapter 混入了 test-fake 集合。
- `acc/migration/graph_importer.py` (184-193) — `_known_agent_id` / `_known_tool_id`，第三份独立 fake-agent 白名单，用于 legacy migration。
- `acc/binding/resolver.py` (1-113) — Phase-3 残骸：未在 `acc/binding/__init__.py` 导出，包含两处 runtime 崩溃点（`ProvenanceObject` 不存在的 kwargs；`OutboxSelector.node_id` 不存在的属性）；视觉上像"已实现"。
- `acc/migration/capsule_compat.py` 与 `acc/fake_agents.py` (1-103 / 1-63) — `capsule_compat.py` 是从未被调用的 dead module；`fake_agents.py` 是可通过 `python -m acc.fake_agents` 调用的 subprocess 测试夹具，却被放在 production package 中。

**为什么是问题**：Core v2 的核心抽象就是"callable"，但它被分散在 6+ 文件外加生产包内的测试夹具；3 份 fake-agent 枚举互相成员不一致，且其中一份把真实 adapter `generic_cli` 混入；`binding/resolver.py` 是首次调用即崩溃的 Phase-3 残骸但视觉上像已实现。"Callable 抽象"本质上不是一个抽象，而是无单一所有权的若干注册表的联邦。

**建议**：建立 `acc/callable/` 子包统一拥有：`callable/registry.py`（生产注册表）、`callable/runner.py`（dispatch）、`callable/refs.py`（规范 refs）。将 `fake_agents.py`、`scaffold_runtime.py`、`file_source_tool.py` 移入 `acc/testing/`（明确 opt-in）。在 `acc/testing/fake_refs.py` 中集中定义 `HERMETIC_CALLABLE_REFS`，registry 仅在显式 hermetic 标志下导入；移除 `('agent_class','generic_cli')`。删除 `acc/binding/resolver.py` 与 `acc/migration/capsule_compat.py`。`callable_registry.ref_keys` 改为仅在 hermetic 模式下调用 testing 模块。

**可行性 / 风险**：机械重构，整体风险很低：多数移动是文件级的，import 重定向容易。最高 ROI 的第一步是把 `HERMETIC_CALLABLE_REFS` 抽到唯一来源、由 test conftest 注入——立即清掉 production registry 中的 test fixture 泄漏。删除 `binding/resolver.py` 与 `capsule_compat.py` 零风险（无引用）。`acc/callable/` 子包重命名可延后。

**复核**：5 项子claim 全部以代码证据确认：（1）三份独立 fake-ID 枚举的成员差异真实存在——`("tool_class","fail")` 出现在 registry 与 graph_importer 但不在 callable_refs；`("agent_class","generic_cli")` 出现在 callable_refs 却是 production adapter；（2）`HERMETIC_CALLABLE_REFS` 中的 `generic_cli` 在 production 中实际路由到 `GenericCliAdapter()`，并非 fake；（3）`binding/resolver.py` 既是 dead 又会在首次调用崩溃——`ProvenanceObject` 构造与 `OutboxSelector.node_id` 访问都会 raise；（4）`capsule_compat.py` 在 Python 端零调用；（5）`fake_agents.py` 仅供测试使用。建议三段都成立：（a）抽取唯一 `HERMETIC_CALLABLE_REFS` 并由 conftest 注入；（b）删除两个 dead 模块零风险；（c）`acc/callable/` 重命名是最高成本步骤，可延后。最直接的清理收益是把 `('agent_class','generic_cli')` 从 hermetic 集合中移除——production 已通过 `AgentAdapterDispatcher` 处理它，本就不需要进入 fake 集合。轻微夸张点：`callable_registry.py` 与 `callable_runner.py` 仍具备清晰生产路径所有权，"无单一所有权"主要适用于 hermetic ID 泄漏与 dead 模块。（confidence=high, suggestion_feasible=true）

来源：cross-cutting / cross#4

---

### 10. [MINOR] `write_jsonl` / `write_event` 在三个 adapter 中各自定义且几乎相同

**证据**：
- `acc/adapters/codex_cli.py` (225-227) — `def write_jsonl(path, payload: dict) -> None: ...`。
- `acc/adapters/claude_sdk.py` (83-85) — 与 `codex_cli.py:225-227` 字符级相同。
- `acc/adapters/generic_cli.py` (145-147) — `write_event(request, payload)`：同样 3 行逻辑，签名改为接受 `request` 并通过 `request.events_log_path` 派生 path。

**为什么是问题**：3 份 3 行 helper 的私有副本，名称与签名略不同；任何未来变更（例如增加 `ensure_ascii=False`）必须在 3 处同步并存在漂移风险。

**建议**：在 `acc/adapters/utils.py` 或 `acc/adapters/base.py` 中抽取共享 `write_jsonl(path, payload)`；`generic_cli.write_event` 改为对它的薄封装。

**可行性 / 风险**：低风险——仅影响三个 adapter 文件，可独立完成。

**复核**：duplication 真实。`codex_cli` 与 `claude_sdk` 字符级相同，仅类型注解 `dict` vs `dict[str, Any]` 略有差异；`generic_cli.write_event` 仅在内部从 `request.events_log_path` 派生 path 而非接受参数。在 `acc/adapters/base.py`（已定义 `AgentRunRequest`、被所有 adapter 引用）中抽取 `write_jsonl(path, payload)` 容易且低风险；`generic_cli.write_event` 可保留为 `write_event(request, payload) -> write_jsonl(request.events_log_path, payload)` 的薄封装，调用方 API 不变。唯一需要权衡：`base.py` 当前无 `json` import 与工具函数，新增工具函数是轻度风格变化但不违反架构；亦可放入新的 `acc/adapters/utils.py` 完全隔离关注点。（confidence=high, suggestion_feasible=true）

来源：redundancy-and-duplication / redundancy-and-duplication#1

---

### 11. [MINOR] `ACC_*` 环境变量注入在 `codex_cli` 与 `generic_cli` 之间逐行复制

**证据**：
- `acc/adapters/codex_cli.py` (31-40) — 5 段条件注入：`ACC_INBOX_DIR`、`ACC_OUTBOX_DIR`、`ACC_ENVIRONMENT_ID`、`ACC_NODE_ID`、`ACC_RUN_ID`。
- `acc/adapters/generic_cli.py` (35-45) — 与上述 5 段条件注入逐字相同。

**为什么是问题**：每新增一个 `ACC_*` 变量必须在两个 adapter 中同步修改。两份目前的唯一差异是 `codex_cli` 在 L40 无条件设置 `ACC_RUN_DIR`，而 `generic_cli` 在初始 dict（L28）中加入 —— 这种细节差异极易静默漂移。

**建议**：在 `acc/adapters/base.py` 抽取 `build_shared_acc_env(request)`，返回公共条件 KV dict；每个 adapter 在自己的 `env` 上 `update`。`ClaudeSdkAdapter` 不启动子进程，可跳过。

**可行性 / 风险**：纯机械重构，无行为变化。

**复核**：finding 成立。5 段 `ACC_*` 条件注入是两个 adapter 之间的逐字复制，已通过直接读文件确认；行号引用相对于实际略偏 1 行，不影响结论。建议方案——在 `base.py` 抽取 `build_shared_acc_env(request)` 返回公共条件 KV dict——是干净的机械重构，无行为变化、无不变量破坏，`claude_sdk.py`（已确认不启动子进程）可正确跳过。迁移成本极小（两个调用点）。（confidence=high, suggestion_feasible=true）

来源：redundancy-and-duplication / redundancy-and-duplication#2

---

### 12. [MINOR] `acc/app/core_v2_runtime.py` 中的私有 `write_json` —— 同一 store primitive 的第 5 份副本

**证据**：
- `acc/app/core_v2_runtime.py` (880-885) — `def write_json(path: Path, payload: Any) -> None: path.parent.mkdir(...); path.write_text(json.dumps(...))` 私有副本。
- `acc/store/__init__.py` (27-32) — 与之相同的规范实现已经存在于 `acc.store`。

**为什么是问题**：5 份独立副本（`store/__init__.py`、`environment.py`、`run_index.py`、`callable_runner.py`、`core_v2_runtime.py`）必然在边界行为（`sort_keys`、`ensure_ascii`、`mkdir` 选项）上漂移；任何调用方 import 错副本都会得到不同输出格式。

**建议**：删除全部私有副本，统一 `from acc.store import write_json`；通过 `grep "def write_json"` 兜底确认无残留副本。

**可行性 / 风险**：trivial 机械改动。唯一风险是某些调用方依赖不同的 `sort_keys` / `ensure_ascii` 默认值——合并前需对每份副本的标志位做对齐检查。

**复核**：finding 成立，但有一处轻微不准：把 `run_index.py` 列为"相同副本"之一，但其实 `run_index.py:write_json` 已经存在分歧（无 `ensure_ascii=False`、无 `mkdir`）；同时 finding 漏列了 `acc/runtime/__init__.py` 中的另一份相同副本。这些都不削弱核心结论——`core_v2_runtime.py:write_json` 与规范 `acc.store.write_json` 字节级相同，是真正的私有重复。建议（改用 `acc.store` import）对 4 份相同副本是机械且安全的；feasibility caveat（"合并前对齐每份副本的 flag"）特别适用于 `run_index.py` 与 `artifact_store.py`，不能盲目替换，需先确认调用方对 `ensure_ascii` 与 `mkdir` 的预期。（confidence=high, suggestion_feasible=true）

来源：layer-violations / layer-violations#5

---

## 整体建议

**第一优先级（事件 schema 与 hermetic 集合）**：先治理"会污染共享真理来源"的两条线索——（a）`events.jsonl` 多写入器多 schema 的统一（finding 1），收敛到一个规范 `EventWriter` 接口与 schema；（b）`HERMETIC_CALLABLE_REFS` / `callable_registry` / `graph_importer` 三份 fake-agent 枚举的合并（finding 5、9 共同结论），并立即移除 `('agent_class','generic_cli')` 这条 production adapter 误入测试集合的污染。两者都是低风险 / 高 ROI，且能解锁后续清理。

**第二优先级（store primitive 收敛）**：批量处理 `write_json`（finding 4、7、12）与 `copy_path`（finding 6、8）。这两类问题在结构上同质——都是 5-10 行的 store helper 被复制 4-6 次、并在边界（`mkdir` / `ensure_ascii` / `dirs_exist_ok`）出现真实分歧。建议作为一次集中清理：先对齐规范实现（在 `acc/store/__init__.py` 中），再逐文件替换 import；过程中顺手把 patch-scar 中那条"`safe_child_path(target, target.parent)` 永远为真"的平凡守护一并修掉。

**第三优先级（结构性合并，需慎重推进）**：finding 2（run 状态 8+ 表示）与 finding 3（4 个 supervisor）是真实的设计气味，但触及层模型与跨进程协议。建议保留为长期清理目标，不要一次重构推完——优先做内部审计（哪些表示真的承担"权威"职责）、把建议方案与 AGENTS.md 的层契约对齐后再分阶段推进；近期可先做"可降风险的子步骤"（如删除 `load_run_summary` 中的历史文件名探测、合并 `app/supervisor` 与 `app/scheduler`），把 critical 级问题逐步降级。
