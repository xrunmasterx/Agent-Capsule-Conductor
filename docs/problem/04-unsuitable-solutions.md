# 不适配的方案

> 本文档记录 ACC 当前架构中属于 "不适配的方案" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

本类问题共 10 项（5 项 major、5 项 minor，无 critical），共性是**为某个早期约束选择的实现，在当前架构演进后已不再适配**：旧的同步 HTTP 端点未随异步 submit 通道下线、Schema/IO/校验等基础设施在多个模块独立"造轮子"、UI 同时维持 SSE 与轮询两套真值通道、测试治具与生产包混居、以及 `WorkflowAppService` API 上仍背负 7 个被立刻静默的兼容参数。这些方案违背了 ACC "轻量、本地优先、单一真值" 的架构目标，在不改变功能的前提下增加了维护面积、攻击面与认知负担。

## 详细问题清单

### 1. [MAJOR] 同步 `/run-graph` 与 `/{workflow_id}/run` 端点与 async submit 并存——长时间占用 uvicorn 工作线程

**证据**

- `acc/server/routes/workflows.py:109-126` —— `@router.post('/run-graph')` 的 `run_graph_endpoint` 调用 `WorkflowAppService(...).run_sync(graph_path, run_dir, ...)`，整轮 workflow 期间一直占线。
- `acc/server/routes/workflows.py:128-153` —— `@router.post('/run-graph/submit')` 通过 `await manager.submit(WorkbenchRunJob(...))` 立即返回，已完整覆盖前者的语义。
- `acc/app/__init__.py:128-145` —— `WorkflowAppService.run_sync = asyncio.run(self.run(...))`。
- `web/src/components/WorkflowViewer.tsx:1176` —— 真正活跃的 UI 热路径只走 `api.submitGraphRun(...)`；`api.runGraph` 在前端无任何调用方。

**为什么是问题**

FastAPI 会把同步 `def` handler 调度到 anyio threadpool（默认约 40 线程）执行，因此并不会阻塞主事件循环本身，但会在整个 workflow 运行期间持续占用一个 threadpool 线程；当并发或长时运行较多时，这些线程是 events 流、decisions、runs list 等 HTTP handler 的共享资源，仍然构成实际的资源压力。配合已经能完全替代的 async submit + 轮询 + SSE 通道，再保留同步端点等于多维护两条不被使用的代码路径，并扩大了攻击面。

**建议**

- 删除 `POST /workflows/run-graph`（前端无任何调用方，可立即下线）。
- 删除 `POST /workflows/{workflow_id}/run` 之前，需要补一个薄的 `/run-and-wait`，其实现应当是基于 submit 的 "poll-until-terminal" 而非占线运行；当前 `web/src/components/ControlPlanePanel.tsx:53` 是该端点的唯一调用方。
- `WorkflowAppService.run_sync` 仍是 CLI 与测试入口，应保留；本项只针对 HTTP 入口。

**可行性 / 风险**

低风险。`/run-graph` 可立即移除；`/{workflow_id}/run` 需要先提供薄包装以保持语义，再迁移 `ControlPlanePanel.tsx:53`，再下线。短期可先返回 410 Gone 作为过渡。

---

### 2. [MAJOR] JSON Schema 校验在 3 处被独立重复实现，错误信息格式各异

**证据**

- `acc/validation.py:13-20` —— `validate_payload(payload, schema_path)` 使用 `Draft202012Validator`，错误抛 `AccError(f'JSON Schema validation failed{location}: {exc.message}')`。
- `acc/graphops.py:32-40` —— `validate_patch(patch)` 是第二份独立实现，错误格式为 `'GraphOps patch schema validation failed{location}: {exc.message}'`，且 schema 走 `Path('schemas/graphops_patch_schema.json')` 的 CWD 相对加载。
- `acc/callable_runner.py:388-392` —— `validate_output_schema(output, schema)` 是第三份独立实现，错误格式 `'codex output.json failed schema validation: {exc.message}'`，**丢失了 JSON path**。

**为什么是问题**

三份 `Draft202012Validator` 包装、三种错误信息格式：调用方无法用统一方式编程判定校验失败，测试需要分别 pattern-match 三种字符串。`callable_runner.validate_output_schema` 丢失 JSON path，定位困难；`graphops.validate_patch` 又把 CWD 相对的 schema 路径写死在校验器里，从非项目根目录调用（例如某些测试 fixture 切到 tmpdir）会直接 FileNotFoundError。

**建议**

- 集中到一个 `acc/validation.py:validate_against_schema(payload, schema_payload, *, context: str)`，返回统一的 `ValidationIssue` 列表与统一格式的 `AccError`。
- Schema 在模块导入期通过 `importlib.resources` 一次性加载为常量，避免运行时 CWD 相对路径。

**可行性 / 风险**

低风险。三处调用点全部不在热路径，迁移是机械性的。

---

### 3. [MAJOR] 自制 JSONL wakeup 队列 + double-read reconcile，单文件原子 rewrite 即可替代

**证据**

- `acc/app/scheduler.py:88-117` —— `reconcile_wakeup_state` 在 L93-100 与 L101-114 两次 `queue_path.read_text()`，分别收集 `consumed_ids` 与过滤 `pending`，每次调用做两次完整文件 IO。
- `acc/app/scheduler.py:120-138` —— `enqueue_wakeup` 一次逻辑入队中：调 `load_wakeup_state` → 改 in-memory `pending` → 写 `_state_path` → `_append_jsonl` → 又 `reconcile_wakeup_state`，三次写、两次读。
- `acc/app/scheduler.py:141-155` —— `claim_next_ready` 同样：reconcile → sort → 把 `raw['status']='consumed'` → 再 `_append_jsonl` 追加一条 `consumed` 行 → 再 reconcile。文件随 traffic 线性增长。

**为什么是问题**

每个 run 的 wakeup mailbox 量级 < 100 条，却用了 append-only JSONL + 单独 `state.json` snapshot 的事件溯源方案；消费通过追加一条 `status=consumed` 的"反向行"实现，文件不会自动收缩，而每次 enqueue/claim 还要做 2-3 次读 + 2 次写。一个 load → mutate → atomic write 的 list 重写就完全够用。

**建议**

- 改为单个 `wakeup_queue.json`（`{pending: [...], claimed: [...]}`），enqueue / claim 走 load → mutate → tempfile + `os.replace` 模式。
- 注：`persistence/manifest.write_atomic` 是绑定到 `RunManifest` 的，不是通用工具，scheduler 需要自己写一层薄的原子写或直接 inline `os.replace` 模式。
- 删除 `_append_jsonl` 与双文件结构。

**可行性 / 风险**

中等风险。需保留 enqueue 时的 coalesce 语义（在 L124-133 已经是 in-memory dict 操作，迁移无障碍）和崩溃安全（依赖 `os.replace` 原子语义）。`tests/test_wakeup_queue.py` 校验的是行为而非磁盘格式，迁移不需修改测试。

---

### 4. [MAJOR] UI 上 SSE 与递归 `setTimeout` 轮询同时承担"运行真值"，两套通道竞争

**证据**

- `web/src/components/WorkflowViewer.tsx:1080-1136` —— `pollRunUntilTerminal` 是一个 `runWorkflowGraph` 内部闭包，使用 `window.setTimeout` 递归；间隔在 1000ms / 2500ms 之间切换，依赖 `selectedRunId === ...` 的判断，但 `selectedRunId` 是闭包捕获的，用户中途切换任务后值已陈旧。
- `web/src/components/WorkflowViewer.tsx:527-560` —— SSE 流独立挂载，`onSummary` 也写 `summary` + `status`；但 run state 真正驱动来自 polling，SSE 只承担 log delta 与一些"摘要提示"。

**为什么是问题**

架构上 `runs/<run_id>` 才是真值，通过 index 轮询。SSE 同时再写一份 summary/status，等于让两条网络通道同时声称是真值；任何 UI 消费方都要处理两路状态。再加上 `setTimeout` 闭包捕获 `selectedRunId` 的陈旧值，构成一个真实的 stale-closure 缺陷：用户切换任务后，旧 poll 仍以为自己仍是当前选中。

**建议**

- 让 SSE 退回到"日志 delta 通道"的角色，不再写 summary/status；run state 由对 `runs/{id}/run_summary.json` 的固定节奏轮询独占。或反过来：用 SSE 投递完整的 `run_summary` diff，并彻底移除 polling。
- 二选一即可，但不能同时存在。
- 闭包问题用 ref（而非 closure capture）传 `selectedRunId`，配合 `useEffect` + `AbortController` 单 tick (1500 ms) 即可。
- 日志尾部仍可走 HTTP range-fetch，无需复用 SSE 多路复用。

**可行性 / 风险**

中等风险。SSE 已是 best-effort，移除 summary 写入不会回退正确性；闭包修复（改用 ref）属于平凡变更。改动局限在 `WorkflowViewer.tsx`。

---

### 5. [MAJOR] UI demo 与 node 目录解析逻辑里硬编码了一个 Windows 绝对路径

**证据**

- `web/src/components/WorkflowViewer.tsx:375` —— `const ROOT_WORKSPACE = 'F:\\UE5_Project_A';`，纯字面量、不走任何 binding/env。
- `web/src/components/WorkflowViewer.tsx:8185-8189` —— `directoryForNode` 引用 `ROOT_WORKSPACE`，结果会被 task store 写入 localStorage，在 macOS / Linux / 其他开发者的盘符下都会带着这个绝对路径。

**为什么是问题**

宣称 local-first 的 workbench 应当从当前 `EnvironmentBinding`（服务端已经通过 `/workflows/{id}/binding` 暴露）读取 `workspace_root`。把某位开发者的具体盘符路径写死在前端代码里，是典型的"对一个特定环境适配"的方案：换台机器、换操作系统、CI 上立刻不工作。

**建议**

- 删除 `ROOT_WORKSPACE`，从 `workflowBinding` 查询拿 `workspace_root`，通过 React context 注入到 `directoryForNode`。
- 由于 binding 是异步加载的，`directoryForNode` 在 binding 未到达时应返回占位值或空串，由 `bindingDirectory()` 渲染层兜底，而不是用一个伪值占位。
- Demo 数据中的所有绝对路径应改为相对路径（如 `./demo`）或留空。

**可行性 / 风险**

低风险。binding API 已经接好（`workflowBindings` query），共 ~6 处读取站点，替换是一次机械替换。

---

### 6. [MINOR] `load_run_summary` 同时探测 4 代历史文件名，而不是收敛到一个权威 schema

**证据**

- `acc/run_index.py:145-191` —— 顺序探测 `run_summary.json` → `node_summary.json` → `run_record.json` → `conductor_output.json` + `session_manifest.json`，4 种历史格式同时存活。
- `acc/run_index.py:168-177` —— 第三个分支直接从 `run_record` dict 构造 `RunSummary`，是函数里的第三条独立 schema 推导路径。

**为什么是问题**

run-dir 的 schema 对一个 local-first 系统而言就是公开 ABI。同一份读取逻辑维护 4 代格式：每次 index rebuild 受最慢的 probe 拖累，函数内部分支膨胀。**注意**：调用方拿到的始终是 `RunSummary` 类型，并不会真的拿到原始 4 种 shape，因此"消费方需要防御性 flatten"这个点是过度描述；真正的负担在于读取侧本身的复杂度。

**建议**（**注意：当前并不可直接落地**）

`node_summary.json`、`run_record.json`、`conductor_output.json`、`session_manifest.json` **并不是无人写入的旧产物**：`ArtifactStore`、`core_v2_runtime`、`write_node_summary` 等运行时路径仍在主动写它们。直接做"一次性迁移 + 删除 fallback" 会破坏正在运行的写入路径。要收敛 schema，先得把 4 个产物的写入端逐一审计，决定哪些保留、哪些可整合，再让读取端只看一个 canonical 文件。

**可行性 / 风险**

实际不低于中等：不是单纯的读取侧 cleanup，需要先做写入侧重构。本项保持 minor 严重度，但建议明确记录"目前不可直接迁移"。

---

### 7. [MINOR] 测试治具子进程入口（`fake_agents`、`scaffold_runtime`、`file_source_tool`）与生产包混居

**证据**

- `acc/fake_agents.py:1-63` —— 通过 `python -m acc.fake_agents` 调用的测试子进程，但作为 `acc` 包的一部分对外发布。
- `acc/scaffold_runtime.py:1-107` —— 仅作为 worker 子进程使用，无库级调用方，却与 `domain.py`、`schemas.py` 同居一层。
- `acc/app/callable_refs.py:11-17` —— `HERMETIC_CALLABLE_REFS` 把 `('agent_class', 'generic_fake_agent')` 等假身份与真实的 `('agent_class', 'generic_cli')` 写死在同一个集合里。
- `acc/callable_registry.py:78-86` —— `ref_keys()` 同时对外暴露 `'fake_producer'`、`'fake'`、`'merge'`、`'fail'`、`'generic_fake_agent'`、`'fake-agent.generic'` 等测试身份，作为生产 registry 的边界。

**为什么是问题**

"轻量 + 可作为生产物分发" 意味着测试治具不应被打进 wheel。当前 `pip install acc` 会让下游一并得到 `python -m acc.fake_agents` 入口和一个把 `fake_producer` 视为合法 callable 的 registry。

**建议**

- `fake_agents.py`、`scaffold_runtime.py` 移到 `tests/fixtures/` 或 `acc/testing/`（明确 opt-in 的子包）。`test_generic_cli_adapter.py:30` 是 `python -m acc.fake_agents` 的现存调用方；由于 `pythonpath = ["."]` 已配置，迁到 `python -m tests.fixtures.fake_agents` 是机械替换。
- `file_source_tool.py` 自身有正经的安全逻辑且被旧 capsule YAML 作为真实 callable 引用——它放在 `acc/` 根目录确实不当，但归类为"测试治具"是误判，更合适的去处是 `acc/tools/` 或 `acc/builtins/`。
- 删除 `HERMETIC_CALLABLE_REFS` 与 `ref_keys()` 中硬编码的 fake 身份，改由测试 conftest 通过 `CallableRegistry.with_extras(extras)` 之类的注入钩子注入。
- 注意 `acc/app/core_v2_runtime.py` 内部的 hermetic 节点 dispatch 也内嵌了对 fake 身份的分支，仅清理校验边界并不彻底，需要一并整理运行时分支。

**可行性 / 风险**

中等。机械层面（move + import 修复）容易，但 hermetic dispatch 在 runtime 上还有内嵌分支，需要一并审计。

---

### 8. [MINOR] `graphops.validate_patch` 用 CWD 相对路径加载 schema——库函数的错误抽象

**证据**

- `acc/graphops.py:33` —— `schema = load_json(Path('schemas/graphops_patch_schema.json'))`，bare 相对 Path，运行时按 CWD 解析。

**为什么是问题**

任何从非项目根目录启动的调用方（uvicorn 从其他目录起、pytest `--rootdir` 调整后、daemon 启动）都会静默 FileNotFoundError。Schema 是构建期静态资源，用运行期 CWD 相对路径加载是不适配的方案。

**建议（注意：原始建议不直接可行）**

直觉上的修法是 `importlib.resources.files('acc') / 'schemas/graphops_patch_schema.json'` + 模块级常量缓存。但当前 `schemas/` 在项目根（`F:/Agent-Capsule-Conductor/schemas/`）而非 `acc/` 包内，要让 `importlib.resources` 工作需要：

1. 把 35+ 份 schema 物理迁移到 `acc/schemas/`；
2. 修复 `acc/` 内所有 CWD-相对引用以及测试中的相对路径（`test_callable_schema.py` 引用了 7 份、`test_graphops_patch_validation.py:43` 走 `examples/graphops/...` 等）；
3. 在 `pyproject.toml` 加 `[tool.setuptools.package-data]`。

工作量并非"一处路径、一处读取"。一个更小的过渡方案是先用 `Path(__file__).parent.parent / "schemas/graphops_patch_schema.json"` 替代 CWD 相对路径，仅消除 CWD 依赖，不做大规模迁移。

**可行性 / 风险**

整个仓库以 `repo_root() = Path.cwd()` 为隐含前提，这是架构层面的设计选择，不是 `validate_patch` 一处的孤立 bug。本项保持 minor，但应明确：完整修法是仓库级重构。

---

### 9. [MINOR] `write_json` 重复 6+ 份、`copy_path` 重复 3+ 份——基础工具被反复重造

**证据**

- `acc/store/__init__.py:27-32` —— canonical 版本 `write_json`，含 `parent.mkdir`、`ensure_ascii=False`、`indent=2`、`sort_keys=True`。
- `acc/callable_runner.py:442-447` —— 第二份完全相同实现。
- `acc/app/core_v2_runtime.py:880-885` —— 第三份完全相同实现。
- `acc/environment.py:70-75` —— 第四份。
- `acc/run_index.py:360-367` —— 第五份，转发到独立 `json_dumps`，**默认参数与 canonical 不一致（丢失 `ensure_ascii=False`、不做 mkdir）**。
- `acc/runtime/__init__.py:94` —— 第六份。
- `acc/store/__init__.py:69-77` —— `copy_path` canonical 版本，含 `safe_child_path` 守卫。
- `acc/port_io.py:171-178` —— 第二份 `copy_path`，**故意不带 `safe_child_path` 守卫**（用于从外部源路径拷贝，非项目根受限场景）。

**为什么是问题**

"轻量、可审计" 的代码库里 7 份 `write_json` + 3 份 `copy_path` 是维护伤疤：一处加固原子写、fsync 或敏感字段脱敏，必须记得改全部副本。当前已经存在静默分歧（`ensure_ascii`、是否 mkdir、是否做 path traversal 校验）。

**建议**

- 将 `acc/store/__init__.py` 的 `write_json` / `copy_path` 升级为唯一 canonical 版本；run-dir 写入路线尽量统一走 `acc/persistence/manifest.write_atomic`。
- 各副本替换为 `from acc.store import write_json, copy_path`。
- `port_io.copy_path` 不带守卫是有意为之，应作为参数（如 `copy_path(..., enforce_within=...)`）保留语义，而非盲目统一。
- `run_index.write_json` 与 `artifact_store.write_json` 丢 `ensure_ascii=False` 是潜在分歧，迁移前需检查调用方是否依赖 ASCII 转义后的格式。
- 加 `import-linter` 规则禁止重复定义。

**可行性 / 风险**

低。机械重构，每个副本调用半径都局限在自己模块内；上述两个分歧版本需逐个验证后再统一。

---

### 10. [MINOR] `WorkflowAppService` API 携带 7 个被立即静默的兼容参数——错误的 API 边界

**证据**

- `acc/app/__init__.py:92-117` —— `async def run(self, workflow_path, run_dir, *, workspace, binding_path, input_payload, inherited_workspace, inherited_ephemeral, parent_invocation_id, parent_scope_frame_id, call_depth, node_executor, should_cancel)`，紧接着 `_ = (binding_path, inherited_workspace, inherited_ephemeral, parent_invocation_id, parent_scope_frame_id, call_depth, node_executor)` 把其中 7 个参数立刻静默。
- `acc/app/__init__.py:259-284` —— `run_clean_workflow_template` 复制了同一份 7 参数列表与同样的 `_ = (...)` 收尾。
- `acc/app/__init__.py:60-72` —— `WorkflowAppService.__init__` 接受 `registry=` kwarg、忽略它（`self.registry = None`），再把它转给 `resolve_callable_registry` 那里再被静默一次。

**为什么是问题**

一个薄协调层暴露 9 个参数其中 7 个是死的，是设计上的烟雾：类型检查与 IDE 调用方会以为这些参数生效，测试可以传入毫无效果的值，reviewer 看不出哪些是承重的。"轻量"应表现为更小的边界，而不是更大的边界。

**建议（注意：`binding_path` 不可直接删除）**

- `inherited_workspace`、`inherited_ephemeral`、`parent_invocation_id`、`parent_scope_frame_id`、`call_depth`、`node_executor` 这六个在调用方层面均无活跃消费者，可较安全地删除。
- **`binding_path` 是有真实调用方的**：
  - `acc/cli.py:511-515` —— CLI 通过 `--binding` flag 把 `binding_path=binding` 传给 `WorkflowAppService().run_sync(...)`，再被传到 `self.run(...)`（L128-144）。
  - `acc/server/routes/workflows.py:116-121, 372-377, 147` —— 多个服务路由解析出真实的 binding 路径并传入 `run_sync(binding_path=binding_path, ...)`。
  调用方传入的是真实路径，但服务实现把它丢弃。直接删除 `binding_path` 会立即破坏 CLI `--binding` 与 server payload 中 `binding_path` 字段的语义。正确做法是先决定：要么把 `binding_path` 真正接入实现（让 binding 生效），要么显式废弃 `--binding` CLI 与对应 server 字段后再删除参数。
- `__init__` 的 `registry=` 已经无人使用且明确忽略，可直接删除。

**可行性 / 风险**

混合：6 个参数低风险；`binding_path` 必须先解决 CLI 与 server 的入口面，再考虑删参。

## 整体建议

清理优先级建议如下：

**P0（先做，低风险且收益直接）**

- 问题 5（硬编码 `F:\\UE5_Project_A`）：阻塞跨机器/跨 OS 使用，binding API 已就绪，可直接修。
- 问题 1 中的 `/run-graph`：前端零调用方，可立即移除。
- 问题 2（JSON Schema 三套包装）与问题 9（`write_json` / `copy_path` 重复）：纯机械重构，低风险且能为后续加固（原子写、敏感字段脱敏、`importlib.resources` 等）打地基。

**P1（中等风险，需小心保语义）**

- 问题 3（wakeup 队列）：先用 `os.replace` 重写，对照现有 `tests/test_wakeup_queue.py` 验收。
- 问题 4（UI SSE/polling 双通道 + stale closure）：先以 ref 修闭包 bug，再二选一收敛真值通道。
- 问题 1 中的 `/{workflow_id}/run`：先补 poll-until-terminal 包装，再迁移 `ControlPlanePanel.tsx:53`。
- 问题 7（测试治具混居）：物理迁移容易，但 hermetic dispatch 内嵌分支需一并审计。

**P2（受架构层面约束，先暂缓或与更大重构合并）**

- 问题 6（4 代 run-dir 格式并存）：读取侧不能单独收敛，必须先审计 4 个产物的写入端。
- 问题 8（`graphops` schema CWD 相对路径）：彻底修法是仓库级 `schemas/` 物理迁移；过渡可先用 `__file__`-相对替换 CWD 相对，作为最小修。
- 问题 10 中的 `binding_path`：要么补实现，要么显式下线 CLI/server 入口，再删参；其余 6 个参数与 `registry=` 可与 P1 一同清理。

在批量清理时，问题 2 与问题 9 可合并为同一波"基础工具/校验收敛"PR；问题 1 与问题 4 可合并为"前后端真值通道收敛"工作；问题 6、8、10 因涉及架构层面假设，应留作专项讨论而非夹带在常规清理中。
