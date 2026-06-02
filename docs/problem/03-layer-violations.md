# 分层违规

> 本文档记录 ACC 当前架构中属于 "分层违规" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 当前的分层违规呈系统性而非偶发性：HTTP 层 (`acc/server/`) 的路由文件普遍内嵌应用层乃至持久化层逻辑，根层工具模块 (`acc/graphops.py`) 通过 deferred import 反向依赖 app 层，而 app 层运行时 (`acc/app/core_v2_runtime.py`) 又绕过 store 层直接做文件系统生命周期管理。结果是同一类关注点（事务性写入、env-policy、文件 IO、决策聚合）在多个层散落出多个独立实现，"thin server / single mutation path / store-layer ownership" 等架构契约在代码现实中已被广泛违反。这直接影响 ACC 的可测试性（非 HTTP 调用方必须拖入 FastAPI）、可演进性（磁盘布局改动需要触碰 936 行的运行时热路径）以及审计完整性（多条并行的写入路径不全部经过 GraphOps）。

## 详细问题清单

按严重度由高到低排序：critical → major → minor。

---

### [CRITICAL] 1. `acc/app/core_v2_runtime.py` 直接调用 shutil / mkdir / write_text，绕过 store 层所有权

**证据**：
- `acc/app/core_v2_runtime.py` (101-114) — `shutil.rmtree(run_dir)` 后接多个 `path.mkdir(parents=True, exist_ok=True)` 与 `event_log_path.write_text('', encoding='utf-8')`，原始的文件系统生命周期管理。
- `acc/app/core_v2_runtime.py` (272-275) — `write_json(node_dir / 'agent_payload.json', agent_payload)` 与 `write_json(node_dir / 'input.json', agent_payload)` 写入相同内容；外加 `runtime_payload.json` 与 `runtime.json` 也是同内容双写。
- `acc/app/core_v2_runtime.py` (302-303) — `write_json(node_dir / 'output.json', output)` 与 `write_json(node_dir / 'artifacts' / 'payload.json', output)` 是经典的迁移残留双写。

**为什么是问题**：`acc.app` 应当协调 use case，而非拥有文件系统生命周期。直接调用 `shutil.rmtree`、`.mkdir`、`.write_text` 与裸 JSON 写入意味着 run 目录结构的真理由 936 行的 runtime 临时定义，而不是由 `acc.store` 拥有。这导致磁盘布局无法在不动这个热路径文件的前提下演进；同时重复写入 (`agent_payload.json` / `input.json`、`output.json` / `artifacts/payload.json`) 是迁移残留，每次节点执行都在静默地 double I/O。

**建议**：将 run 目录的初始化与清理抽到 `acc/store/`（如 `store.prepare_run_dir`、`store.prepare_node_dir`），把规范文件名定义为常量。重复写入应在确认重命名迁移完成、旧文件名可下线后，合并为单次规范写入。

**可行性 / 风险**：影响面较大。`core_v2_runtime.py` 共 936 行，是所有 workflow 执行的热路径；建议分步进行：先抽 `prepare_run_dir` / `prepare_node_dir`，再单独提一个 PR 收敛重复写入。

**复核要点**：`prepare_run_dir` 在 `acc/store/__init__.py` (56-59) 已经存在，本工作不是"新建"而是"在 `core_v2_runtime.py` 中改为 import 并调用"。同理 `acc.store` 已有 canonical 的 `write_json`，文件中位于 880 行附近的本地副本是冗余实现。"critical" 级别在此处虽强但合理：936 行的热路径承担磁盘布局细节，使得磁盘结构无法在不动该文件的情况下演进。

---

### [CRITICAL] 2. `acc/server/routes/workflows.py` 在路由模块中导入 os / shutil / subprocess，业务逻辑与 HTTP 绑定耦合

**证据**：
- `acc/server/routes/workflows.py` (4-6) — `import os`、`import shutil`、`import subprocess` 出现在路由文件的顶层。
- `acc/server/routes/workflows.py` (682-692) — `open_local_folder` 内部直接 `subprocess.Popen(['open', str(path)])` / `subprocess.Popen(['xdg-open', str(path)])`，FastAPI 路由模块中直接 spawn 子进程。
- `acc/server/routes/workflows.py` (535-587) — `graph_bundle_for_accflow_save` / `write_bundle_to_directory` 实现了 staged 原子写、按子项 fanout、`shutil.rmtree` 清理 staging 目录、校验失败回滚等 50+ 行持久化编排逻辑。

**为什么是问题**：`acc.server` 应是薄薄的 HTTP 翻译层。子进程拉起 (`open_local_folder`)、staged 原子多文件写 (`write_bundle_to_directory`)、校验失败回滚 (~200 行：`validate_workflow_save_path`、`graph_payload_for_runtime`、`graph_payload_for_accflow_save`、`graph_bundle_for_accflow_save`、`save_graph`) 都是应用层关注点；它们目前无法在不引入 FastAPI 的前提下被测试、复用，或被 CLI 调用。

**建议**：将 `open_local_folder` 移到 `acc/utils.py` 或 `acc/tools/`；将整个 save pipeline (`save_graph` 至 `replace_workflow_file`) 抽到 `acc/app/` 中新的 `WorkflowPersistenceService`，或扩展现有 `WorkflowAppService`。路由变成 5 行的 delegate。`subprocess.Popen` 替换为可独立测试的平台工具。

**可行性 / 风险**：表面积较大——`workflows.py` 共 705 行。建议拆两个 PR：(1) 移走 `open_local_folder` 与 subprocess 用法（无 FastAPI 依赖，单文件 PR）；(2) save pipeline 抽到 `acc/app/` 时需要解开与 `Request` 的耦合——`project_root: Path` 改为显式参数而非从 `request` 提取，会触及路由调用点但不存在阻断性 invariant。`acc/app/` 已有 staged 文件写的范例 (`template_bundle.py`)，本次迁移与既有架构一致。

---

### [CRITICAL] 3. GraphOps 实际存在至少 4 条 mutation 路径，破坏 layered 化的写入约束

**证据**：
- `acc/graphops.py` (33, 177-188) — `validate_patch` 通过 CWD 相对路径加载 schema；`dry_run_supervisor_proposal` 内部使用 `from acc.app.supervisor import proposal_to_graphops_patch` 这一 deferred import——根层模块隐式依赖 app 层。
- `acc/app/supervisor.py` (159-215) — `proposal_to_graphops_patch` 是一条住在 app 层而非 graphops 层的并行 proposal→patch 路径，supervisor 提案绕开 `graphops.py` 的公共 API。
- `acc/server/routes/decisions.py` (38-161) — `run_decision_items` + `graphops_decision_items` 在路由中直接实现了约 120 行的决策聚合：读 run index、对失败严重度做分类、构造 graphops 提案条目（注：决策聚合是只读查询，并非真正的 mutation 路径，参见复核要点）。
- `acc/server/routes/workflows.py` (430-632) — `save_graph` + `graph_payload_for_runtime` + `graph_bundle_for_accflow_save` 自带 write→validate→rollback，完全不经过 graphops。
- `acc/server/routes/callables.py` (79-112) — `save_agent_callable` 自带写入-校验-回滚的事务模式，是第三条独立的写入路径。

**为什么是问题**：架构文档主张 GraphOps 是 LLM 生成式 mutation 的统一入口（proposal → validate → dry-run → human approve）。代码现实中存在多条并行写入：(1) `graphops.py` 本体；(2) supervisor 提案通过 `app/supervisor.proposal_to_graphops_patch`，并通过 `graphops.py:183` 的 deferred import 反向依赖 app 层；(3) accflow save 在 `routes/workflows.py` 中自带 validate / rollback；(4) agent YAML save 在 `routes/callables.py` 中自带 validate / rollback。其中 (2) 是确认的层级违规——根层模块通过 deferred import 升向 app 层。

**建议**：将 `dry_run_supervisor_proposal` 中对 `acc.app.supervisor` 的 deferred import 解决，方法是把 `proposal_to_graphops_patch` 直接搬到 `acc/graphops.py` 内部或新建 `acc/graphops_supervisor.py` 适配模块，使根层不再反向依赖 app 层。`validate_patch` 的 CWD 相对 schema 路径同步修复（见后文 `validate_patch` 条目）。

**可行性 / 风险**：解 deferred import 是机械操作，影响面极小。**复核明确指出**：原始建议中"将所有写入统一到 MutationService 并强制 human approval"超出了实际 invariant 范畴——AGENTS.md / CURRENT_ARCHITECTURE.md / FIRST_PRINCIPLES_ANALYSIS.md 中并未声明 "GraphOps is the only sanctioned mutation path"；human-driven Workbench save (`save_graph`、`save_agent_callable`) 在设计上就不属于 LLM 提案流，强行套 approval gate 会与 "Keep ACC lightweight and local-first" invariant 冲突。`decisions.py` 中的两个函数是只读的 dashboard 查询而非 mutation。本条目的可执行结论收敛为：**消除 graphops.py:183 的反向依赖 + 修复 schema 路径**，其余仅作为现状记录。

---

### [MAJOR] 4. `acc/graphops.py` 的 `validate_patch` 在调用时按 CWD 相对路径加载 schema

**证据**：
- `acc/graphops.py` (33) — `schema = load_json(Path("schemas/graphops_patch_schema.json"))`，每次调用都按进程 CWD 解析裸相对路径。
- `acc/graphops.py` (32) — `def validate_patch(patch: dict[str, Any]) -> None:`，签名看上去是纯函数（dict in，无返回），但函数体里藏了磁盘 IO。

**为什么是问题**：graphops 应该是纯粹的 patch-engine 工具。任何不在项目根目录运行的调用方都会以 silent `FileNotFoundError` 失败，包括从子目录运行的测试套件，以及任何 cwd 不同的程序化调用方。同时 IO 是隐藏的：函数签名暗示纯函数。

**建议**：在模块加载阶段一次性载入 schema，路径锚定到文件位置而非 CWD：`Path(__file__).parent.parent / 'schemas' / 'graphops_patch_schema.json'`。或者把已编译的 validator 放成模块级常量（如 `_PATCH_SCHEMA = load_json(...)`)，同时消除每调用一次就读盘一次的开销。或者让函数把 schema 当成参数接收，使其变得可平凡测试。

**可行性 / 风险**：零 callee 影响——`validate_patch` 是内部 helper。唯一风险是 schema 文件必须存在于锚定路径，而它已经在那里。"层级违规"标签略不精确，本质是看似纯函数中的 CWD 相对 IO 副作用，但问题与方案都是稳的。

---

### [MAJOR] 5. `acc/graphops.py` 的 `dry_run_supervisor_proposal` 通过 deferred import 反向依赖 `acc.app.supervisor`

**证据**：
- `acc/graphops.py` (183-184) — `from acc.app.supervisor import proposal_to_graphops_patch` 与 `from acc.engine.supervisor import parse_dynamic_invocation_proposal`，被 defer 到函数体内以避免模块级循环导入。
- `acc/graphops.py` (177-188) — `def dry_run_supervisor_proposal(proposal, *, target_path, semantic=False)` 看上去是根层工具，运行时却拉起整个 app 层。

**为什么是问题**：`graphops.py` 住在根层（与 `acc/app/` 平级），看似是任何层都能安全 import 的低层工具。Deferred import 隐藏了它在运行时其实拉入 `acc.app.supervisor`，进而拉入 `acc.app.invocation`、`acc.callable_registry` 等等。任何 import graphops 的模块都获得了对完整 app 层的隐式传递依赖，分层契约因此瓦解。

**建议**：把 `dry_run_supervisor_proposal` 从 `graphops.py` 搬到 `acc/app/supervisor.py`（或新建 `acc/app/graphops_bridge.py`）。`graphops.py` 只导出纯 patch 操作（`validate_patch`、`dry_run_patch`、`apply_patch_request`）。

**可行性 / 风险**：复核更正——外部调用方并不是 `acc/server/routes/graphops.py`，而是 `tests/unit/test_graphops_supervisor_proposal.py`。迁移成本仍然极小（一处测试 import 更新），可行性结论不变，无行为变化。

---

### [MAJOR] 6. `acc/server/routes/runs.py` 内嵌二进制 log reader 与完整的 JSONL event-merge 子系统

**证据**：
- `acc/server/routes/runs.py` (247-282) — `read_node_log_delta(run_dir, run_id, node_id, stream, *, offset, limit)`，35 行的二进制文件读取，含 seek+chunk read 与字节偏移跟踪。
- `acc/server/routes/runs.py` (329-386) — `read_jsonl_tolerant`、`read_run_events_with_nested`、`annotate_nested_event`、`event_sort_key`、`parse_jsonl_event`，共 58 行纯事件日志合并逻辑，无 HTTP 依赖。

**为什么是问题**：`read_node_log_delta` 既被 SSE 流式 handler (L163) 调用，也被一个独立 HTTP 路由调用——是承重的跨关注点逻辑，被困在路由模块里。`read_run_events_with_nested` 合并并按时间排序 parent / child run 目录的事件，是复杂的 domain 逻辑，目前无法在不引入 FastAPI 的前提下被测试或复用。任何 CLI 或测试工具想看到同样的事件视图，都必须重复实现。

**建议**：将 `read_node_log_delta` 移到 `acc/app/`（或 `acc/persistence/`），签名为 `read_node_log_delta(run_dir, node_id, stream, offset, limit)`。将 `read_jsonl_tolerant` / `read_run_events_with_nested` 移到 `acc/app/run_projection.py`——事件日志读取已经住在那里。路由变成调用这些函数并序列化为 HTTP 的薄包装。

**可行性 / 风险**：中等工作量。`read_node_log_delta` 在文件内有两处调用，更新简单。事件合并函数当前只在本文件被使用，迁移是机械的。`acc/app/run_projection.py` 已经承载类似的事件读取 (`iter_jsonl_events`)，是天然落点。

---

### [MAJOR] 7. `acc/server/routes/interactions.py` 在路由 handler 中编排 3 步流程（answer → emit event → enqueue wakeup）

**证据**：
- `acc/server/routes/interactions.py` (72-91) — `updated = answer_interaction(...)`，紧接着 `emit_event(run_dir / 'workflow_events.jsonl', ...)`，然后 `enqueue_wakeup(run_dir, new_wakeup_request(...))`，三个协调副作用挤在同一个路由 handler 里。
- `acc/server/routes/interactions.py` (15, 18) — `from acc.app.scheduler import enqueue_wakeup, new_wakeup_request` 与 `from acc.store import emit_event`，路由直接 import 并编排 app + store 原语。

**为什么是问题**：任何非 HTTP 调用方（CLI、测试、后台任务）想要"回答一次 interaction"都必须复刻这个 3 步序列（answer + emit + wakeup），否则会丢失副作用。这条协调契约应该在 `acc/app/interactions.py` 中表达为单个 `answer_and_notify()` 方法，而不是被劈成三段、靠路由层 import 临时拼起来。

**建议**：在 `acc/app/interactions.py` 中加 `answer_and_notify(run_dir, interaction_id, answer)`，由它依次调用 `answer_interaction`、`emit_event`、`enqueue_wakeup`。路由 handler 变成 3 行调用 + HTTP 响应。整个流程从此可在不引 FastAPI 的前提下测试。

**可行性 / 风险**：低风险。单点调用。三个 import 已在同一文件内，整合直接。复核额外发现：当前 `emit_event` 调用在 `*` 之后传入了第三个位置参数 `f"workflow_{run_id}"`，会在运行时抛 `TypeError`——这反而进一步证明"完整 3 步流程当前无法脱离 FastAPI 测试"的论点。修复时 `run_id` 需作为参数显式传入 `answer_and_notify`，或从 `answer_interaction` 返回的 `updated.run_id` 中派生。

---

### [MAJOR] 8. `acc/server/run_manager.py` 是无 HTTP 依赖的完整异步 job scheduler，应属 `acc/app/`

**证据**：
- `acc/server/run_manager.py` (1-13) — `import asyncio, os` 以及来自 `acc.run_index`、`acc.session`、`acc.utils` 的 import，**零** FastAPI import；无 HTTP 关注点。
- `acc/server/run_manager.py` (31-236) — `class WorkbenchRunManager`：FIFO 队列、`asyncio.Lock`、并发上限、cancel-marker 协议、崩溃恢复、run summary 写入、index 重建。206 行纯应用层编排。
- `acc/server/context.py` (9, 42-48) — `from acc.server.run_manager import WorkbenchRunManager` 与 `def get_workbench_run_manager(request: Request)`，是该 manager 唯一被 wired 进 HTTP state 的地方。

**为什么是问题**：`WorkbenchRunManager` 包装 `WorkflowAppService` 并管理 run 生命周期，零 HTTP 依赖。把它放在 `acc/server/` 意味着任何 CLI、测试、后台 worker 想用都得拖 HTTP 层。唯一与 HTTP 相关的代码是 `context.py` 中的实例化。

**建议**：把 `WorkbenchRunManager` 移到 `acc/app/run_manager.py`。`acc/server/context.py::get_workbench_run_manager` 保留为薄薄的 factory：从 `Request` 读 `project_root`，委托给 app 层类。无行为变化。

**可行性 / 风险**：低风险。无 HTTP import。移动文件需要更新 `acc/server/context.py:9` 与 `tests/unit/test_workbench_run_manager.py:9` 两处 import。

**复核要点**：架构错位是真的，建议方案是低风险的清理工作。但需要更正 impact 表述：当前位置**并不阻止**非 HTTP 使用（测试就能调用），所以严重度应在 minor / moderate 区间，本质是清洁度 / 约定违规而非功能阻断。**注意**：交叉视角下另有观点指出 AGENTS.md "Workbench Async Run Model" 章节将该 manager 显式描述为 "server-scoped"——若该陈述属实则本条目应作废。开发者在动手前应先确认 AGENTS.md 中是否真的存在这一 invariant，再决定是否迁移。

---

### [MAJOR] 9. `acc/server/routes/decisions.py` 在路由内实现完整的决策聚合 domain 模型（约 120 行业务逻辑）

**证据**：
- `acc/server/routes/decisions.py` (38-97) — `def run_decision_items(project_root, *, limit)`：查询 run index、对 run / node 失败严重度做分类、构造结构化的 evidence 与 action 列表。60 行 domain 逻辑住在路由文件里。
- `acc/server/routes/decisions.py` (100-161) — `def graphops_decision_items(project_root, *, limit)`：扫描 `graphops/*.json` patches 并构造 action 结构。再加 60 行应用层逻辑。

**为什么是问题**：`GET /decisions` 的端点本质上是一个 `DecisionService` 的单行包装。任何 CLI 命令或批处理任务想要相同的决策摘要，要么 re-import `acc.server.routes.decisions`，要么复刻逻辑。路由文件持有 decision payload schema 的真理——这是 domain 关注点。

**建议**：把 `run_decision_items` 与 `graphops_decision_items` 抽到 `acc/app/decisions.py`，作为 `DecisionService` 类或模块。路由变成 `return DecisionService(project_root).get(limit=limit)`。HTTP 层只把结果映射到 JSON 响应。

**可行性 / 风险**：低风险，单点调用，无行为变化。

**复核要点**：(1) "约 120 行" 是低估——把所有 helpers 都算上接近 200 行应用逻辑，问题反而更强。(2) "任何 CLI 必须 re-import 路由" 目前是假设性的——grep 确认当前无 CLI 或批处理消费这条逻辑。结构性违规真实存在，但今天没有具体的复用痛点；这是架构卫生问题而非运行时缺陷。(3) 落地路径具体：把 6 个非路由函数（`run_decision_items`、`graphops_decision_items`、`base_run_item`、`run_evidence`、`node_evidence`、`decision_counts`、`artifact_url`）移到 `acc/app/decisions.py`，更新路由的单点 import 即可。

---

### [MAJOR] 10. `acc/server/routes/callables.py` 在路由 handler 中实现 write-validate-rollback 事务逻辑

**证据**：
- `acc/server/routes/callables.py` (79-112) — `save_agent_callable`：读取旧内容、写临时文件、替换、通过 `CallableRegistry` 解析类，异常时还原旧内容——完整的写入-校验-回滚事务发生在路由 helper 中。
- `acc/server/routes/callables.py` (92, 95-98, 107) — `previous = path.read_text(...)`、`temp_path.write_text(yaml.safe_dump(...))`、`path.write_text(previous, ...)`，server 层中的裸文件系统操作。

**为什么是问题**：write→validate→rollback 是应用层逻辑，不属于 HTTP 绑定。任何 CLI 命令或测试想保存 agent callable，要么复刻这个 rollback 序列，要么走 HTTP 层。这条逻辑应在 `acc/app/` 或 `acc/control_plane`。

**建议**：把 `save_agent_callable` 移到 `acc/control_plane.py`（已经处理 callable inspection）或 `acc/app/`，签名为 `save_agent_callable_file(project_root, callable_id, payload, *, overwrite)`，抛 `AccError` 而非 `HTTPException`。路由变成 3 行调用 + `HTTPException` 翻译。

**可行性 / 风险**：低风险。该函数是路由 helper 而非路由 handler，移动不改 HTTP 表面。两个调用点都在同一文件中。完整修复还应连带处理同文件中的 `agent_callable_path` (143-148) 与 `validate_callable_id` (138-140)——它们也直接抛 `HTTPException`，否则迁移不彻底；但不必阻塞主迁移。

---

### [MAJOR] 11. `acc/fake_agents.py` 与 `acc/scaffold_runtime.py` 等测试夹具入口被打包进生产 package

**证据**：
- `acc/fake_agents.py` (10-63) — 子进程入口 (`if __name__ == '__main__': main()`)，被以 `python -m acc.fake_agents <echo|fake>` 调用，提供测试夹具 agent 模式。
- `acc/scaffold_runtime.py` (9-107) — 子进程入口，被以 `python -m acc.scaffold_runtime` 调用，为 output schema 生成 scaffolded artifacts。
- `acc/file_source_tool.py` (33-141) — 第三个子进程入口，被以 `python -m acc.file_source_tool` 调用，根据 secret-path 过滤 manifest 工作区源文件。
- `tests/unit/test_generic_cli_adapter.py` (30) — 通过 subprocess 调 `acc.fake_agents`：`['-m', 'acc.fake_agents', 'echo']`。

**为什么是问题**：测试夹具住在生产 `acc/` package 中，会被打包进发行版。它们是 subprocess workers，不是 library 模块，应该住在独立的 `acc/tools/` / `acc/workers/` / `tests/tools/` 目录，明确表达"非可 import 的公共 API"。

**建议**：依据"开发期工具 vs 生产基础设施工具"的归属，把这些文件移到 `acc/tools/` 或 `tests/fixtures/`。更新测试文件中的 import。保留 `if __name__ == '__main__': main()` 入口，但从生产 package 公共接口中移除。

**可行性 / 风险**：复核结论 `suggestion_feasible=false`，理由如下：
- **三文件实际定位差异显著**，不应一锅端：
  - `fake_agents.py`：纯测试夹具，仅 `tests/unit/test_generic_cli_adapter.py` 与 `docs/historical/legacy_capsules` 引用，移到 `tests/fixtures/` 合理。
  - `scaffold_runtime.py`：grep 未发现任何测试或生产引用，更接近"死代码"而非"测试夹具"，移动或删除均可，但不应被标记为 test fixture。
  - `file_source_tool.py`：在 `docs/historical/legacy_capsules/root_capsules/file-source.local/capsule.yaml` 中以 `python -m acc.file_source_tool` 被定义；测试也直接 `from acc import file_source_tool`。归类为"测试夹具"具有争议。
- **隐藏副作用**：legacy capsule YAML 通过 `-m acc.*` 引用模块路径，移动会破坏所有 capsule 模板对这些路径的引用，迁移成本超出"更新 import"。
- 核心观察（生产 package 表面被污染）属实，但严重度对一个无明确公共 API 契约的 CLI 工具而言被高估，且建议的迁移路径低估了 capsule YAML 的牵连。

---

### [MAJOR] 12. "Thin server" 承诺在每一个路由模块都已破裂——是模式而非例外

**证据**：
- `acc/server/routes/workflows.py` (430-632, 109-153, 361-380) — 705 行的文件持有完整的 save / compile pipeline (`validate_workflow_save_path`、`write_bundle_to_directory`、`resolve_bundle_workflow_refs`、`graph_bundle_for_accflow_save`、`save_graph`)，外加 2 个同步阻塞型 run 端点与 async submit 并存。
- `acc/server/routes/decisions.py` + `acc/server/routes/runs.py` (38-161 / 247-386) — `decisions.py`：120 行决策聚合 domain 模型在路由内；`runs.py`：二进制 log reader (`read_node_log_delta`，约 35 行) + JSONL event-merge 子系统 (`read_run_events_with_nested` 与 4 个 helper，约 55 行)。
- `acc/server/routes/callables.py` + `acc/server/routes/interactions.py` (79-112 / 74-88) — `callables.py`：路由 handler 内的 agent YAML write-validate-rollback；`interactions.py`：3 步编排（answer + emit_event + enqueue_wakeup）内联在路由中。
- `acc/server/run_manager.py` + `acc/server/context.py` (31-236 / 101-132) — `run_manager.py`：246 行的进程内 scheduler，零 HTTP 依赖，包装 `WorkflowAppService`；`context.py`：`read_safe_text_file` + `infer_artifact_type` 是 domain I/O 函数，被困在 FastAPI helper 旁。

**为什么是问题**：架构文档称 server 是 "a thin HTTP translation layer"。现实是每个路由模块（workflows、decisions、runs、callables、interactions）都拥有相当数量的应用逻辑，外加 `context.py` 拥有 artifact I/O，`run_manager.py` 是完整的 async scheduler。模式一致：每加一个特性，对应的 app 层服务不存在，于是路由直接持有逻辑。结果是任何非 HTTP 调用方（CLI、测试、批处理 worker、未来的 MCP 层）都无法在不引入 FastAPI 的前提下复用。"thin" 承诺不是某一个文件的偶然违反，而是结构性地缺席于整个 server 层。

**建议**：为每条违规架起对应的 app 层服务：`acc/app/workflow_persistence.py`（save_graph + bundle compilation）、`acc/app/decisions.py`（DecisionService）、`acc/app/run_events.py`（log delta + event merge）、`acc/app/callables.py`（save_agent_callable）、`acc/app/interactions.py.answer_and_notify()`、`acc/app/artifacts.py`（read_safe_text_file）。每个路由变成 5-10 行：parse request → 调 service → AccError 翻译为 HTTPException。再加一条 CI lint，当 `acc/server/routes/*.py` 超过 N 行或 import os/shutil/subprocess 时 fail。

**可行性 / 风险**：每个路由可独立迁移——从最小的 `callables.py`（约 35 行抽取量）开始建立 pattern，然后 `decisions.py` / `runs.py` 事件合并，最后 `workflows.py` save pipeline（影响面最大）。CI lint 是最便宜的 forcing function，先加上能立刻"止血"。

**复核要点（重要修正）**：
- `run_manager.py` **不是违规**。AGENTS.md §Workbench Async Run Model 显式将 `WorkbenchRunManager` 描述为 "server-scoped"，是有意架构而非偶发分层。把它移到 `acc/app/run_manager.py` 反而会破坏 invariant。**应从违规清单中删除**，这与上文条目 8 的复核观点保持一致——动手前先确认该 invariant 的现状。
- `interactions.py` 的路由 handler 已基本 thin，3 步序列其实是 3 行对已有 app 层 / store 服务的调用，`answer_and_notify` 抽取属于可选润色。
- `context.py::read_safe_text_file` 自身抛 `HTTPException`，按设计就是 server 关注点，不算被困的 domain 逻辑。
- 真正确认的违规是 4 条：`workflows.py`、`decisions.py`、`runs.py`、`callables.py`。
- 抽取路径上的 `HTTPException` 依赖：`workflow_persistence` 的 `validate_workflow_save_path` (454, 455) 在 pipeline 深处抛 `HTTPException`，需要在 save chain 全程替换为 `AccError`，影响面中等。

---

### [MINOR] 13. `acc/server/context.py` 持有 `read_safe_text_file` 与 `infer_artifact_type`——HTTP context 模块中的 domain I/O

**证据**：
- `acc/server/context.py` (101-132) — `def read_safe_text_file(project_root, path_value)` 与 `def infer_artifact_type(path)`：文件读取 + MIME 推断 + size limit 强制，签名中无 FastAPI `Request`。
- `acc/server/context.py` (7) — `from fastapi import HTTPException, Request`：文件名义上 FastAPI 耦合，但上述两个函数无 HTTP 参数。

**为什么是问题**：`context.py` 被路由 import 用以提供 FastAPI helper（`get_project_root`、`configured_project_dir`）。把 artifact I/O 也塞进来，意味着 `acc/server/routes/artifacts.py` 调用 `context.read_safe_text_file`——`context` 因此成了事实上的 artifact service。CLI 工具或测试想做安全 artifact 读取，必须 import 一个 FastAPI 耦合的模块。

**建议**：把 `read_safe_text_file` 与 `infer_artifact_type` 移到 `acc/app/`（如 `acc/app/artifacts.py`）。路由委托给 app 函数，并在边界把 `AccError` 翻译为 `HTTPException`。

**可行性 / 风险**：低风险。函数小且自包含，在 `artifacts.py` 中只有一个调用点。

**复核要点**：
- 结构观察正确，但 finding 高估了实际危害——"CLI 必须 import FastAPI" 这一痛点已经被 `acc/control_plane.py::read_artifact_payload`（抛 `AccError`，无 FastAPI）解决；并不存在缺乏 domain-layer 等价物的真问题。
- `infer_artifact_type` 已经有**三个**独立实现：`server/context.py`、`control_plane.py`、`environment.py`。`control_plane.py` 与 `context.py` 完全一致（markdown / json / log / patch / text），`environment.py` 则多了 "directory" 并把默认值由 "text" 改为 "file"。如果只搬到 `acc/app/artifacts.py`，会变成第四份拷贝并加剧重复，除非同时合并已有的三份并对齐 "directory" / "file" 的差异。
- 建议方案在路由侧的 `AccError → HTTPException` 翻译模式已在 `routes/callables.py`、`routes/workflows.py` 等处存在。
- 严重度保持 minor 合理，本质是代码卫生而非功能缺口。

---

### [MINOR] 14. `acc/callable_runner.py` 在调用时读 `os.environ`——主机环境策略应归属 `acc.runtime`

**证据**：
- `acc/callable_runner.py` (159-163) — `def acc_run_mode() -> str: value = os.getenv('ACC_RUN_MODE', HERMETIC_RUN_MODE).strip().lower()`，直接读主机 env。
- `acc/callable_runner.py` (166-171) — `def external_agent_execution_enabled() -> bool: return os.getenv('ACC_ENABLE_EXTERNAL_AGENT_EXECUTION', '').strip().lower() in {...}`，第二个 env 读取。
- `acc/app/__init__.py` (327-332) — `def external_agent_execution_enabled() -> bool: ...`，与上一条**实现完全一致**的副本。

**为什么是问题**：`acc.runtime` 应当拥有进程 / 工作区执行策略。在 `acc/callable_runner.py`（根层）与 `acc/app/__init__.py`（app 层）两处读取 `os.environ` 来决定执行 mode，把 env-policy 关注点散落到两层，并出现重复实现。任何想控制执行 mode 的测试都需要 patch 两个独立的 `os.getenv` 调用点。

**建议**：在 `acc/runtime/__init__.py`（或新建 `acc/runtime/policy.py`）中定义 `acc_run_mode()` 与 feature flag 读取；所有调用方（`callable_runner.py`、`acc/app/__init__.py`、`acc/app/scheduler.py`）从这里 import；删除重复副本。

**可行性 / 风险**：低风险。机械合并。`acc/runtime` 已经存在并有 `__init__.py`。注意点：测试套件需要 patch 单一权威位置。

**复核要点**：
- `acc_run_mode()` 实际只在 `callable_runner.py` 中定义，被 `acc/app/core_v2_runtime.py` 与 `acc/server/routes/health.py` 直接 import——`callable_runner` 在事实上已经在扮演 policy hub。
- 将 env-policy 加入 `acc/runtime/__init__.py` 时需要快速 import-cycle 检查（`callable_runner` 当前 import `acc.domain` 与 `acc.runtime.payload` 而非 `acc.runtime.__init__`）。
- 测试中已有 patch `acc.callable_runner.external_agent_execution_enabled` 或 `acc.app.external_agent_execution_enabled` 的位置，需要更新到统一权威位置——这是具体且有限的成本。
- `acc/app/__init__.py` 还有 `use_submit_validate()` 与 `use_supervisor()`，是同样的 `os.getenv` 反模式，是 finding 未提及但同时存在的清理候选。

---

## 整体建议

**优先级一：先关层级倒挂的"反向依赖"。** 最高优先项是消除 `acc/graphops.py:183` 中 `from acc.app.supervisor import proposal_to_graphops_patch` 的 deferred import，因为它让根层模块向 app 层反向依赖，破坏了整个分层契约。把 `dry_run_supervisor_proposal` 整体迁移到 `acc/app/supervisor.py` 或新建 `acc/app/graphops_bridge.py` 即可终结这条违规，影响面只有一处测试 import。同样属于这一波的还有 `validate_patch` 的 CWD 相对 schema 路径——锚定到 `Path(__file__)` 后变成模块级常量，零 callee 影响。

**优先级二：批量"下沉"路由内的应用逻辑。** 路由层违规高度同质（`workflows.py`、`decisions.py`、`runs.py`、`callables.py`、`interactions.py`），可以按一个固定 pattern 推进：(1) 在 `acc/app/` 中建立对应服务（`workflow_persistence.py`、`decisions.py`、`run_events.py`、`callables.py`、`interactions.answer_and_notify`）；(2) 路由变成 5-10 行的 thin wrapper，做 request 解析与 `AccError → HTTPException` 翻译；(3) 加一条 CI lint：`acc/server/routes/*.py` 不准 import `os` / `shutil` / `subprocess`，文件超过 N 行 fail。建议从最小的 `callables.py`（约 35 行抽取量）入手建立 pattern，再做 `decisions.py` 与 `runs.py` 事件合并，最后处理 `workflows.py` save pipeline（最大 blast radius）。**注意**：动 `WorkbenchRunManager` 之前先确认 AGENTS.md 中 "Workbench Async Run Model" 是否将其约定为 server-scoped——若属实则不应迁移。

**优先级三：清理重复实现与边界外溢。** `core_v2_runtime.py` 直接调用 `shutil.rmtree` / `mkdir` / `write_text` 与重复写入（`agent_payload.json` / `input.json`、`output.json` / `artifacts/payload.json`）建议拆两个 PR：先把 run / node 目录初始化迁到 `acc.store`（`prepare_run_dir` 已存在，本次只是改成调用），再单独提一个 PR 收敛重复写入。环境策略读 (`acc_run_mode`、`external_agent_execution_enabled` 等) 收敛到 `acc/runtime/policy.py`，连同 `acc/app/__init__.py` 中的 `use_submit_validate` / `use_supervisor` 一并合并。`infer_artifact_type` 的三处独立实现需要先对齐 "directory" / "file" 与 "text" 的语义差异，再统一到一处，避免直接搬到 `acc/app/artifacts.py` 反而创造第四份副本。测试夹具入口（`fake_agents.py` 等）的迁移需先逐文件确认其真实角色（纯测试 / 死代码 / 历史 capsule 工具）以及 legacy capsule YAML 中 `-m acc.*` 引用的牵连，再决定是否动。
