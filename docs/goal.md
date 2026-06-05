# ACC docs/problem 修复 Goal

目标：修复 `F:\Agent-Capsule-Conductor\docs\problem` 中所有经过复核的问题，使 ACC 收敛到当前 `AGENTS.md` / `docs/CURRENT_ARCHITECTURE.md` 描述的 Core v2 callable-only 架构。

本 goal 的重点不是“一次性大重构”，而是建立问题账本、逐条复核、分批修复、逐条验证。完成标准不是“改了很多代码”，而是 `docs/problem` 中每条有效 finding 都有明确状态、代码证据、修复记录和验证结果。

## 必须先读

从这些文件开始，不要盲目加载所有历史 goal 包：

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`
- `docs/problem/README.md`
- `docs/problem/01-redundancy-and-duplication.md`
- `docs/problem/02-compat-and-legacy-scars.md`
- `docs/problem/03-layer-violations.md`
- `docs/problem/04-unsuitable-solutions.md`
- `docs/problem/05-performance-issues.md`
- `docs/problem/06-complexity-hotspots.md`
- `docs/problem/07-patch-scars.md`
- `docs/problem/08-dead-code-and-orphans.md`

只有在涉及 callable runtime 细节时再读：

- `docs/codex_goal_callable_semantics/DESIGN.md`
- `docs/codex_goal_callable_semantics/DOMAIN_MODEL.md`
- `docs/codex_goal_callable_semantics/EXECUTION_BOUNDARIES.md`
- `docs/codex_goal_callable_semantics/QUALITY_REPORT.md`

只有在涉及 Workbench UI 时再读：

- `docs/codex_goal_visual_workbench_ux_refactor/DESIGN.md`
- `docs/codex_goal_visual_workbench_ux_refactor/SPEC.md`
- `docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md`

## 架构优先级

如果文档之间冲突，按这个顺序裁决：

1. `AGENTS.md`
2. `docs/CURRENT_ARCHITECTURE.md`
3. `docs/problem/*.md`
4. `docs/refactor_core_v2/*`
5. 本 goal 的 phase 标签

如果某个修复需要改变 `AGENTS.md` 或 `docs/CURRENT_ARCHITECTURE.md` 的现行契约，必须在同一批修改里同步更新契约文档、代码和测试。禁止只改代码不改契约，也禁止只改契约不改行为。

## 硬性约束

1. 先运行 `git status --short`。当前工作树可能有用户生成的未跟踪文件，例如 `progress.jsonl`、`tests/e2e/`、`web/test-results/`、`workflows/task_canvas_*.accflow.json`、`workflows/browserfix*.accflow.json`。不要擅自删除、移动、格式化或把它们当作 active product examples，除非本次修复明确需要并已确认其角色。
2. 每条 finding 必须先按当前代码重新验证。`docs/problem` 是高质量输入，但不是免验证事实。如果 finding 已过期，标记为 `stale` 并给出代码证据。
3. 不允许恢复 legacy runtime、compatibility registry、old graph runner、old capsule execution path 或 hidden fallback。
4. Legacy 输入只能出现在 raw migration parser、explicit rejection tests、historical docs/fixtures 中。
5. `acc.domain` 和 `acc.engine` 必须保持纯净：不做 filesystem IO、不读 host env、不 import server/UI、不 spawn subprocess。
6. `acc.store` 负责 filesystem manifests、run dirs、inbox/outbox、artifacts、path protection。
7. `acc.runtime` 负责 process/workspace execution policy。
8. `acc.app` 负责跨 `engine` / `store` / `runtime` 的 use-case coordination。
9. `acc.server` 必须是 thin API layer：只做 request parsing、service call、HTTP error translation，不承载业务编排、文件事务、subprocess 或复杂 event merge。
10. `web/` 只能是 Workbench projection，不能成为 runtime truth。
11. 不添加 database、cloud backend、distributed worker、marketplace、SaaS surface、team permission system。
12. 不实现自定义 LLM reasoning loop 或 tool-calling loop。ACC 只负责 execution boundaries、manifests、inputs、outputs、artifacts、failure classification。
13. 默认测试必须 hermetic，不依赖真实 Codex/Claude/Cursor/Gemini/Hermes、网络、浏览器凭证、云服务或付费外部服务。
14. Machine-readable CLI 契约不能回归：`acc run ... --emit-conductor-json` 和 `acc workflow run ... --emit-json` 的 stdout 必须各自 exactly one JSON object，日志只能进 stderr 或文件。

## 临时资产删除授权

用户已明确说明：当前 workflow、Workbench 节点、agent/tool template 等用于功能测试的临时资产没有投入生产，可以删除丢弃，下一轮需要时可以重新制造。

这个前提会改变后续修复计划：对产品面上的临时 `workflows/*.accflow.json`、测试期 agent/tool templates、Workbench 生成节点资产，不再默认按“可能是用户生产资产”保守保留。只要先用 `git status --short` 和 `rg` 确认它们不是 schema、migration fixture、explicit rejection test、historical evidence、仍被测试引用的 checked-in example 或当前 CLI/API 契约的一部分，就可以把它们作为 cleanup 的删除对象。

这个授权不允许跳过架构约束：删除资产后仍必须更新发现逻辑、测试、文档和 `docs/problem/RESOLUTION_MATRIX.md`。不得因此恢复 legacy runtime、old graph runner、compatibility registry、hidden fallback，也不得把 legacy 语义塞回 `raw` 或 `metadata.legacy_*`。

## 问题账本

在修改产品代码前，创建或更新 `docs/problem/RESOLUTION_MATRIX.md`。

账本必须覆盖以下文件中的每条有效 finding：

- `01-redundancy-and-duplication.md`：12 条
- `02-compat-and-legacy-scars.md`：8 条
- `03-layer-violations.md`：14 条
- `04-unsuitable-solutions.md`：10 条
- `05-performance-issues.md`：9 条
- `06-complexity-hotspots.md`：3 条
- `07-patch-scars.md`：6 条
- `08-dead-code-and-orphans.md`：8 条

每条记录必须包含：

- problem file
- finding id
- 当前代码证据，含文件路径和行号
- 状态：`fixed` / `stale` / `deferred-with-reason` / `blocked-with-evidence`
- 最小修复策略
- 实际修改文件
- 验证命令
- 残余风险

`deferred-with-reason` 只允许用于需要 ADR、profiling、契约变更或超出本批风险边界的问题，不能作为逃避修复的默认状态。`blocked-with-evidence` 必须写明失败命令、错误证据和缺失条件。

## 执行顺序

按 `docs/problem/README.md` 的风险顺序推进：先做低风险高收益清理，再做结构性收敛，最后做高风险设计/性能/复杂度问题。

每一批都应小步提交式推进：先验证当前代码事实，再做最小修改，再跑 focused tests，最后更新 resolution matrix。不要把多个无关类别混进同一批。

### Phase 0：基线与分类

目标：确认当前仓库状态和问题账本。

必须做：

- `git status --short`
- 建立或更新 `docs/problem/RESOLUTION_MATRIX.md`
- 尝试运行：
  - `uv run pytest -q`
  - `uv run ruff check .`

如果基线失败，不要假装通过。记录失败命令、关键错误和受影响范围。后续每批修复仍需跑与本批相关的 focused tests。

### Phase 1：死代码与补丁伤疤

优先处理 `08-dead-code-and-orphans.md` 与 `07-patch-scars.md` 中局部可证伪的问题。

允许先删除的对象：

- full-repo `rg` 确认无 product importer 的 orphan module
- 只在测试中引用且语义已漂移的 schema-drift tombstone
- 明确的 no-op migration wrapper

不能先删除的对象：

- active product path 仍调用的旧能力
- CLI/API 仍暴露且需要迁移调用方的入口
- Workbench 或 server 仍依赖的兼容端点

重点修复：

- `acc/batch.py` / `acc batch-run` 这类 raise-only fake capability
- debugger rerun/fork stub：删除或保留明确拒绝路径，但不能伪装成可用能力
- `succeeded` 写盘再由读侧归一为 `success` 的半迁移；规范状态应使用 `success`
- `save_graph` 常驻 migration no-op
- `EXECUTABLE_METADATA_KEYS` / legacy key 用字符串拼接躲避 grep 的补丁伤疤
- 无生产读者的重复 payload 双写
- `safe_child_path` 恒真守卫；修复前必须先明确合法 root 语义并补测试

### Phase 2：Legacy 与兼容边界下线

处理 `02-compat-and-legacy-scars.md`。

目标：

- `.graph.json` 是 import-only 或 explicit rejection，不能成为 runnable workflow
- `*.accflow.json` 直接解析为 `WorkflowFunctionTemplate`
- legacy 字段不能影响 product runtime
- migration 只能把 raw legacy document 转为 canonical Core v2 输出

重点修复：

- 删除 `node_invocations` dict fallback
- 删除 `source` / `target` legacy edge 主分支，除非当前 canonical fixtures 仍需迁移
- 删除 `input_ports` dual-format shim，除非当前 canonical schema 尚未统一
- 审计并收敛 `load_run_summary` 对多代 run dir 格式的探测；需要历史数据时先提供 migration 或标为 historical-only
- 解决 V1/V2 binding 类型分裂。若需要架构决策，先写 ADR 或在账本中标为 `deferred-with-reason`，禁止用 `raw` 或 `metadata.legacy_*` 继续偷渡语义

### Phase 3：单一真理源与重复实现收敛

处理 `01-redundancy-and-duplication.md`，并合并处理 `04-unsuitable-solutions.md` 中基础设施重复项。

重点修复：

- `events.jsonl` 多写入器、多 schema：收敛到唯一 event schema 与 writer/store primitive
- run 状态 truth：明确 `RunRecord`、`run_summary.json`、events、index、UI projection 的职责，不能让多个表示都自称权威
- `write_json` 重复实现：收敛到 store/runtime 边界上合理的唯一 primitive
- `copy_path` 重复实现：收敛 path safety、`dirs_exist_ok`、file/dir 行为
- JSON Schema validation wrapper 重复：统一错误格式和 schema 定位方式
- hermetic fake callable set 与 production callable registry 分离，避免测试 fixture ID 污染生产 registry
- “Supervisor” 命名冲突先做职责审计，再决定是否合并；不要因为名字相同就强行合并

注意：`docs/problem/README.md` 已排除 `acc/server/run_projection.py` 与 `acc/app/run_projection.py` “同名即放错层”的结论。不要强行合并这两个模块。

### Phase 4：分层违规修复

处理 `03-layer-violations.md`。

重点修复：

- 消除 `acc/graphops.py` 对 `acc.app.supervisor` 的 deferred import；把 app 相关 bridge 移到 `acc.app`
- `graphops.validate_patch` 不得用 CWD 相对路径找 schema；改用模块路径或 package resources
- `acc/server/routes/*.py` 中的 filesystem transaction、subprocess、复杂 JSONL merge、业务聚合逻辑下沉到 `acc.app` 或 `acc.store`
- `acc/app/core_v2_runtime.py` 中 run/node 目录初始化、写文件、复制文件等生命周期操作迁移到 `acc.store` primitive
- host env 读取和执行策略收敛到 `acc.runtime`
- route 层保持 thin wrapper：request -> app service -> response / HTTPException

`WorkbenchRunManager` 是当前 `AGENTS.md` 背书的 server-scoped lightweight manager。不要未经契约更新就把它迁移为目录扫描 worker 或 distributed worker。

### Phase 5：Workbench/API run 模型

处理 `04-unsuitable-solutions.md` 中 API 与 UI 真值通道问题。

目标：

- Workbench 新行为优先使用 async submit + run-scoped projection
- 多个 task/run 必须按 `run_id` 和 `task_id` 独立建模
- UI state 只能是 projection，run dirs、summaries、events、artifacts 才是 evidence truth

重要冲突处理：

- 当前 `AGENTS.md` 与 `docs/CURRENT_ARCHITECTURE.md` 都说 `/api/workflows/run-graph` 仍是 synchronous compatibility endpoint。
- 因此不要直接删除 `/api/workflows/run-graph`。
- 若确实要删除或改变该端点，必须同一批更新 `AGENTS.md`、`docs/CURRENT_ARCHITECTURE.md`、server route、web caller、tests。
- 否则只允许把 Workbench active path 迁到 `/api/workflows/run-graph/submit`，并把同步端点限制为兼容路径。

重点修复：

- UI 上 SSE 与 polling 双通道竞争；明确一个 projection 通道，另一个下线或降为辅助
- stale closure / terminal polling 不停的问题
- hardcoded Windows absolute path，例如 `F:\UE5_Project_A`
- `WorkflowAppService` 中被立即静默的兼容参数；删除前必须确认 CLI/server caller 已迁移

### Phase 6：性能问题

处理 `05-performance-issues.md`。

性能修复必须说明瓶颈类型、影响路径和验证方式。不要把“代码更少”“pass 更少”“抽象更少”默认等价于性能更好。

优先顺序：

1. 修复 SSE async generator 内同步阻塞 IO。这是会让并发客户端互相拖累的路径。
2. 修复热路径 repeated glob + JSON parse：`find_graph_path`、workflow catalog、nested workflow resolution、run index rebuild/list/show。
3. 修复局部重复 IO / 重复序列化：wakeup queue double-read、event append 每次重复打开文件、同一 value 重复 JSON serialize、重复读取 output。

可以使用轻量策略：

- filename-first lookup
- sidecar index
- request/run lifecycle read-only context
- mtime cache
- 预序列化 bytes 复用

不要引入 database、daemon、distributed worker 或复杂缓存系统。

### Phase 7：复杂度热点与 Policy 收口

处理 `06-complexity-hotspots.md`。

优先：

- Policy 类型收口。先删除明显 dead policy，再为剩余 policy precedence 写 ADR 或等价说明。
- `execute_core_v2_node` 行为不变拆分。建议拆成：准备输入/证据、执行 callable、提交结果/失败记录。

约束：

- complexity-only refactor 必须 test-backed，不改变行为。
- Policy 合并不要和 server route 抽取、legacy 删除混在同一批。
- `write_core_v2_run_summary` 的 stat 优化不应单独立项，除非 profiling 或相邻重构证明值得做。

## Core v2 不可变原则

产品 runtime path 只能消费这些当前架构概念：

- `AgentClassTemplate`
- `ToolClassTemplate`
- `WorkflowFunctionTemplate`
- `NodeInvocationSpec`
- `FunctionInvocation`
- `ScopeFrame`
- `SessionInstance`
- `ArtifactBundle`
- `RunRecord`
- `EventRecord`
- `FailureRecord`
- `ResultStore`
- `GraphOps Control Plane`

禁止在 product runtime path 中使用：

- `NodeSpec`
- `WorkflowTemplate`
- `NodeSpec.raw`
- `CapsuleSpec`
- `CapsuleRegistry`
- `CapsuleRunner`
- `CallableKind.legacy_capsule`
- `BindingMode`
- `LegacyPassthroughBinding`
- `legacy_full`
- `mixed binding mode`
- `legacy_capsule_id`
- `input_mapping`
- `legacy_value_edges`
- `upstream_context`
- `.graph.json` runnable workflow
- old `WorkflowGraph` as runtime object
- old workflow graph schema as active schema
- old workflow run schema as active schema
- `node_runs/`
- `workflow_graph.json` as source of truth
- `ACC_USE_CALLABLE_DISPATCH`
- `run_legacy_graph_template`
- `run_workflow_template_instance(WorkflowTemplate, ...)`
- `execute_legacy_capsule_node`
- `is_legacy_capsule_node`
- `resolve_legacy_node_input`
- `resolve_legacy_value_edge`
- `fill_legacy_upstream_context_fields`
- `mirror_legacy_node_run`
- `write_legacy_run_compatibility_files`

允许 legacy 命中位置：

- `acc.migration.*`：raw legacy input parser / migration provenance only
- `tests/migration/*`
- explicit rejection tests
- `tests/fixtures/legacy/*`
- historical docs / archived fixtures

这些位置不得参与 default discovery、default run、Workbench list、server list 或 active examples。

## 删除策略

active product path：

1. 先替换产品调用点。
2. 增加 Core v2 replacement tests。
3. 增加 legacy rejection / migration tests。
4. 删除旧代码。
5. 删除或迁移旧测试。
6. 跑搜索门禁和验证。

zero-import tombstone：

1. 先 `rg` 全仓确认无 product caller。
2. 确认测试引用是历史/拒绝路径还是误导性依赖。
3. 删除 orphan 或迁移到 historical fixture。
4. 更新测试。
5. 跑 focused tests。

如果新模型表达不了旧能力，禁止把旧字段塞进 `raw` 或 `metadata.legacy_*`。正确处理是：暂停该 finding，记录缺失语义，扩展 canonical model 和 validation，再继续迁移。

## 验证要求

每批修改至少运行最小 meaningful tests。最终必须尝试：

```bash
uv run pytest -q
uv run ruff check .
```

改 server/API/workflow 行为时，运行相关后端测试，例如：

```bash
uv run pytest tests/server tests/unit tests/integration -q
```

可以缩小到 focused tests，但最终报告必须说明为什么足够。

改 CLI 时，优先运行当前存在的 CLI integration tests。当前仓库可能没有 `tests/cli/`，不要把缺失目录当作失败；缺覆盖时新增 focused tests 或在报告中明确未覆盖风险。

改 Workbench 时运行：

```bash
cd web
npm run test -- --run
npm run build
```

改 browser-facing behavior 时，尽量跑 browser journey 并记录截图、console errors、network errors、report path。如果 browser tooling 不可用，明确说明缺口并保持 hermetic tests 通过。

## 搜索门禁

最终运行：

```bash
rg -n "NodeSpec|WorkflowTemplate|node\\.raw|legacy_capsule|legacy_full|LegacyPassthroughBinding|BindingMode|input_mapping|legacy_value_edges|legacy_compatibility|mirror_legacy_node_run|execute_legacy_capsule_node|CapsuleSpec|CapsuleRegistry|CapsuleRunner|ACC_USE_CALLABLE_DISPATCH|upstream_context|workflow_graph\\.json|node_runs" acc -g "*.py"
```

预期：

- `acc.migration.*` 允许 raw parser / provenance 命中。
- explicit rejection code 允许命中。
- product runtime path 不允许命中。

最终还要运行：

```bash
rg -n "capsule_id|\\.graph\\.json|workflow_graph_schema|workflow_run_schema|node_run_summary_schema|session_manifest_schema" acc schemas examples tests -g "*.py" -g "*.json" -g "*.yaml"
```

预期：

- active product code 无 runtime usage。
- active examples 无 legacy runnable asset。
- schemas 中无 active old runtime schema。
- tests 中 legacy 命中只在 migration、explicit rejection、historical fixtures。

如果搜索仍有命中，不要简单删除。逐条分类为：

- product bug to fix
- migration raw input only
- explicit rejection test only
- historical fixture only
- stale term in docs/comments requiring cleanup

分类结果必须写入 `docs/problem/RESOLUTION_MATRIX.md`。

## 最终报告

最终响应必须包含：

- 修复了哪些 problem 类别
- 每类的本质问题和最小修改路径
- 每条 finding 在 resolution matrix 中的状态统计
- 关键代码路径变化
- 运行了哪些验证命令
- 哪些命令失败及失败证据
- 哪些 finding 被 `stale` / `deferred-with-reason` / `blocked-with-evidence`
- 剩余架构风险

不要声称运行了未实际运行的测试。不要把猜测写成事实。

## 下一轮 Goal Prompt

```text
/goal 请在 F:\Agent-Capsule-Conductor 中继续按 AGENTS.md、docs/CURRENT_ARCHITECTURE.md、docs/goal.md 和 docs/problem/RESOLUTION_MATRIX.md 执行，目标是利用“临时 workflow / Workbench 节点 / agent/tool template 资产可以删除丢弃”的新前提，继续关闭 docs/problem 中剩余 deferred-with-reason 的有效 findings。

执行前必须先读取：
- AGENTS.md
- docs/goal.md
- docs/problem/RESOLUTION_MATRIX.md
- docs/problem/README.md
- 与本批要修复类别对应的 docs/problem/*.md

先运行并记录：
- git status --short
- rg --files workflows examples callables tests docs | rg "(\.accflow\.json|\.graph\.json|\.codex\.yaml|\.generic\.yaml|template|fixture)"

新前提：
1. 我明确确认当前 workflow、Workbench 节点、agent/tool template 这些功能测试期资产没有投入生产，可以删除丢弃，下一次需要时可以重新生成。
2. 因此，不要再因为“可能是用户生产资产”而保守保留这些临时资产。
3. 但仍不能删除 schemas、migration raw input parser、explicit rejection tests、tests/fixtures/legacy、docs/historical evidence，除非你先证明它们不是迁移/拒绝/历史证据并同步更新测试。
4. 不要恢复 legacy runtime、compatibility registry、old graph runner、old capsule execution path 或 hidden fallback。

下一批优先顺序：
1. 先清理产品发现面和 active asset surface：workflows/、callables/agents/、examples/workflows/ 中经复核只是功能测试的 workflow / agent templates；删除或迁移后，确保 CLI discovery、server list、Workbench list 不再依赖临时资产。
2. 再修 fake/hermetic callable 与 production registry 混杂的问题，建立或收敛到明确的 hermetic test callable set，关闭 RESOLUTION_MATRIX 中 01#5、07#4、03#11、04#7 相关项中可本批解决的部分。
3. 再处理低风险 helper 收敛：adapter write_jsonl / ACC_* env injection / filename-first workflow lookup / wakeup queue double-read / safe_child_path root contract。每个子批都要先看代码事实，再最小修改。
4. 最后才碰 route-thinning、events schema、run truth、V1/V2 binding ADR、execute_core_v2_node 拆分等高风险项；如果不能在本批安全完成，继续保留 deferred-with-reason，但必须写清为什么仍需要 ADR、migration、profiling 或独立风险批次。

账本要求：
- 更新 docs/problem/RESOLUTION_MATRIX.md。
- 每条被本批触及的 finding 必须有当前代码证据、状态、最小修复策略、修改文件、验证命令和残余风险。
- 状态只能是 fixed、stale、deferred-with-reason、blocked-with-evidence。
- 对删除的临时资产，记录删除前的搜索证据和删除后的 discovery/runtime 验证。

验证要求：
- 每个子批运行最小 meaningful tests。
- 改 server/API/workflow 行为时至少运行相关 tests/server、tests/unit 或 tests/integration focused tests。
- 改 Workbench 时运行：
  cd web
  npm run test -- --run
  npm run build
- 最终尝试：
  uv run pytest -q
  uv run ruff check .
- 最终运行 docs/goal.md 的两个搜索门禁，并把命中分类写入 RESOLUTION_MATRIX。

最终报告必须说明：
- 这次因为“临时资产可删除”改变了哪些原本 deferred 的判断。
- 删除了哪些 workflow / agent/tool template / example surface，为什么它们不是生产契约。
- 每类 finding 的状态统计。
- 运行了哪些验证命令，哪些失败，失败证据是什么。
- 仍然 deferred 的架构风险是什么，为什么不能在本批安全解决。
```
