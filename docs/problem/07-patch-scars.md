# 补丁伤疤

> 本文档记录 ACC 当前架构中属于 "补丁伤疤" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 中的补丁伤疤集中体现为"未走完的迁移"和"灰度遗留"：枚举里同时存在 `success` 与 `succeeded` 两个终态、节点产物以新旧两种文件名双写、save 路径常驻一个 migration 模块的 no-op 调用、关键 metadata key 用字符串拼接刻意躲避 grep。还有两处属于早期补丁未收尾——`safe_child_path` 的守卫退化为恒真表达式、生产 `CallableRegistry` 中混入了 hermetic/fake ID。这类问题单独看影响有限，但叠加后会让在线代码长期承担迁移期债务、削弱可搜索性与安全审计能力，并使外部消费者难以判断哪一份产物或字段是权威源。

## 详细问题清单

### 1. [MAJOR] `succeeded` 写盘后再被读侧归一为 `success`，重命名迁移半途而废

**证据**

- `acc/app/core_v2_runtime.py` (334) — `completed_session = SessionInstance(**{**session.__dict__, "status": "succeeded", ...})`，每个成功完成的节点都会把 `succeeded` 写入 `session_instance_manifest.json`。
- `acc/app/core_v2_runtime.py` (799, 826-827) — L799 的 failed_nodes 判断使用 `not in {"success", "succeeded"}` 同时容忍两种值；L826-827 在构建 `RunSummary` 之前把 `succeeded` 静默规范化为 `success`。
- `acc/domain.py` (37-38) — `RuntimeStatus(StrEnum)` 同一个枚举里同时声明了 `success = 'success'` 与 `succeeded = 'succeeded'`，两个语义相同的终态并存，确认这是一次未完成的重命名。

**为什么是问题**

每个成功节点都会向 manifest 写入 `succeeded`，紧接着 summary builder 又会在内存里把它改回 `success`。任何外部读取 manifest 的路径（测试、`/runs/` 路由、`run_index.load_run_summary` 等）都必须同时处理两种值，否则就会把节点错分类。`RuntimeStatus` 同时持有两个终态使得下游消费者无法明确该比对哪一个值，`inspect.py:inspect_session_instances` 这种直读 manifest 的链路也会把 `succeeded` 直接暴露给 API/CLI 调用方。

**建议**

选定 `success` 作为唯一规范值：将 L334 改写为 `success`、移除 L799 的双值守卫和 L826-827 的归一化、从 `domain.py` 中删除 `RuntimeStatus.succeeded`。已有 `runs/` 目录下的 `session_instance_manifest.json` 需要一次性迁移脚本，或保留一段过渡期的归一化逻辑直到迁移完成后再彻底删除。

**可行性 / 风险**

运行时改动范围小，仅限 `core_v2_runtime.py`。主要风险来自历史 run 目录中的旧 manifest——若读侧归一化在数据迁移完成前就被移除，旧 run 的终态显示会出错。建议先做迁移再清理读侧。

来源：`compat-and-legacy-scars#2`

---

### 2. [MAJOR] `EXECUTABLE_METADATA_KEYS` 与 `contains_legacy_workflow_field` 用字符串拼接躲避 grep

**证据**

- `acc/domain.py` (53-58) — `"input" + "_mapping"`、`"legacy" + "_value_edges"`、`"legacy" + "_passthrough"`、`"upstream" + "_context"`，四个 key 在运行期拼装出来，规避对字面量的搜索。
- `acc/graphops.py` (134-143) — `contains_legacy_workflow_field` 内的 `legacy_fields` 集合同样使用 `"input" + "_mapping"`、`"legacy" + "_value_edges"`、`"binding" + "_mode"`、`"upstream" + "_context"` 的拼接形式。两份集合不完全重合，构成了禁用 key 的第二个独立来源。

**为什么是问题**

用字符串拼接来躲避 grep 是一种开发期的"权宜之计"信号：开发者搜索 `input_mapping` 只能在 `workbench_adapter.py` 命中，无法找到 `domain.py` 与 `graphops.py` 中的权限校验，从而产生"看不见"的权限缺口。两个集合彼此独立维护，往任意一处加 key 都不会自动同步到另一处，长期会让两套校验逐步漂移。

**建议**

把拼接还原为普通字面量；按语义把两套集合分别集中到具名常量（例如 `EXECUTABLE_METADATA_KEYS` 与 `LEGACY_WORKFLOW_FIELDS`），由 `domain.py` 或一个专用 constants 模块导出，`graphops.py` 直接引用；为每个 key 加一行注释说明被禁原因。注意：两套集合并不完全相同（`domain.py` 多出 `legacy_passthrough`、`graphops.py` 多出 `binding_mode`），合并前应先审慎确认语义，必要时保持两个独立常量。

**可行性 / 风险**

零行为变更，纯粹是可读性与可审计性修复，blast radius 低。

来源：`compat-and-legacy-scars#3`

---

### 3. [MAJOR] `acc/store/__init__.py:62-63` —— `safe_child_path` 守卫永远恒真

**证据**

- `acc/store/__init__.py` (62-66) — `safe_child_path(path, root)` 通过 `path` 是否在 `root.parents` 中判断；而 `copy_path` 的调用形式是 `safe_child_path(target, target.parent)`——任何路径都必然是其自身父目录的子节点，守卫总是通过。
- `acc/port_io.py` (171-178) — `port_io.copy_path` 完全没有守卫。

**为什么是问题**

`safe_child_path` 在 `store.copy_path` 中的实际使用形式让该守卫退化为恒真表达式，提供零安全收益。这种"看似有防护、实际无防护"的安全反模式，往往说明守卫从未被真实测试覆盖过；当后续有人误信它存在时会做出错误的安全假设。

**建议**

把 `store.__init__.copy_path` 中的 `safe_child_path(target, target.parent)` 替换为有意义的 anchor（例如 `safe_child_path(target, workspace_root)`），调用点按需要把合法 root 作为参数传入；同步审视 `port_io.copy_path` 的语义是否需要补齐相同守卫。

**可行性 / 风险**

中等。难点在于明确"合法 root"的语义——可能需要在调用点参数化。需要补充负向测试覆盖恒真退化不会再次出现。补充一点：`port_io.copy_path` 由于 target 形如 `outbox_dir / source.name`，而 `Path.name` 不能包含路径分隔符，因此当前实际不构成可被利用的目录穿越，但对称地补齐守卫仍有审计价值。

来源：`dead-code-and-orphans#9`

---

### 4. [MAJOR] `acc/callable_registry.py` —— 测试 fixture ID 与生产 adapter 同表登记

**证据**

- `acc/callable_registry.py` (78-86) — `ref_keys()` 中硬编码了一批 hermetic-only callable ID：`fake_producer`、`fake`、`merge`、`fail`、`generic_fake_agent`、`fake-agent.generic`，与生产 adapter 名混在同一个返回集合里。
- `acc/app/callable_refs.py` (11-17) — `HERMETIC_CALLABLE_REFS` 也包含 `('agent_class', 'generic_cli')`，把真实 adapter 名混入"test-fake"集合。

**为什么是问题**

测试 fixture 风格的 ID 与真实 adapter 名出现在同一个生产侧注册表里，让消费者无法仅从 `ref_keys()` 区分"我能在生产 graph 里安全使用哪些 callable"。`generic_cli` 同时出现在生产 adapter 与 hermetic 集合中，这种重叠会让 hermetic 校验逻辑产生歧义。需要补充的事实是：这些 fake 并非孤立测试残留——`acc/app/core_v2_runtime.py:682-706` 与 `acc/migration/graph_importer.py:185-191` 都会在运行时显式分发到这些 ID，这是有意的"in-process hermetic 执行模式"。问题不在于它们被使用，而在于它们没有被收敛为一个共享的 hermetic abstraction，导致校验、运行时分发、迁移导入三处各自维护一份内联清单。

**建议**

抽取统一的 `HermeticCallableSet` abstraction（例如集中到 `callable_refs.py` 或新建模块），让 `CallableRegistry.ref_keys()`、`core_v2_runtime` 的 in-process 分发分支、`graph_importer` 的迁移映射全部从同一份清单读取；生产 adapter 与 hermetic adapter 在文档与 API 表面上保持清晰分层。

**可行性 / 风险**

中等偏高。仅把 fake 从 `ref_keys()` 移走是不够的——会留下校验放行而运行时仍写死分发的"split-brain"状态。完整修复需要同时改造三个 callsite，体量超过单点修补，需作为独立小型迁移项目处理。

来源：`dead-code-and-orphans#14`

---

### 5. [MINOR] `agent_payload.json` 与 `input.json` 写入完全相同的内容（`runtime_payload.json` 与 `runtime.json` 同此）

**证据**

- `acc/app/core_v2_runtime.py` (272-275) — `write_json(node_dir / 'agent_payload.json', agent_payload)` 与 `write_json(node_dir / 'input.json', agent_payload)`、`write_json(node_dir / 'runtime_payload.json', runtime_payload)` 与 `write_json(node_dir / 'runtime.json', runtime_payload)` 四次写入，实则两份数据。
- `acc/app/core_v2_runtime.py` (302-303) — `write_json(node_dir / 'output.json', output)` 与 `write_json(node_dir / 'artifacts' / 'payload.json', output)`，构成第三对内容相同的双写。
- `acc/callable_runner.py` (44-45) — `write_json(run_dir / 'agent_payload.json', input_payload)` 与 `write_json(run_dir / 'input.json', input_payload)`，旧 callable runner 链路里也存在同样的双写，证实这是迁移残留。

**为什么是问题**

三对双写各自把"旧文件名 + 新文件名"同时落盘：`agent_payload.json` vs `input.json`、`runtime_payload.json` vs `runtime.json`、`artifacts/payload.json` vs `output.json`。这不仅放大磁盘 IO，还制造两份"权威拷贝"——一旦某次写入中途失败，两个文件就可能不一致；后续若有人改动只更新其中一份，老消费者会读到陈旧数据。

**建议**

按文件用途确认规范名（survey 中倾向 `input.json` / `runtime.json` / `output.json`），仅写规范文件；为旧消费者提供一个版本周期的 symlink 或 deprecation warning。需要特别注意：`agent_payload.json` 与 `input.json` 当前都有真实生产消费者（`generic_cli.py:26` 把 `input.json` 通过 `ACC_INPUT_PATH` 传给外部 CLI；`core_v2_runtime.py:247` 与 `callable_runner.py:414` 把 `agent_payload.json` 写入 session/runtime manifest；`run_index.py:225` 则更偏好 `input.json`），它们不是同名冗余，而是不同子系统读取同一份数据时使用了不同名字。`runtime_payload.json` 与 `artifacts/payload.json` 各自只在测试断言中出现，没有生产读者，这两对是最干净的合并候选。

**可行性 / 风险**

中等。`runtime_payload.json` 与 `artifacts/payload.json` 可优先合并；`agent_payload.json` ↔ `input.json` 的合并需要协调 adapter、manifest、`run_index`、外部 CLI 契约（`ACC_INPUT_PATH`），不是单点改动可以收尾的。

来源：`redundancy-and-duplication#9`

---

### 6. [MINOR] `save_graph` 始终经由 `accflow_path_from_legacy_graph_path`，把迁移逻辑嵌进在线 save 路径

**证据**

- `acc/server/routes/workflows.py` (477-478) — `def save_graph(path, graph, request)` 中 `accflow_path = accflow_path_from_legacy_graph_path(path)`，每次保存（包括 `.accflow.json` 的新建/更新）都要经过迁移路径解析。
- `acc/migration/graph_importer.py` (10-12) — `accflow_path_from_legacy_graph_path` 只在 `path.name.endswith('.graph.json')` 时把后缀改写为 `.accflow.json`；对正常 `.accflow.json` 输入这是 no-op。但函数从 `acc.migration` 导入，使得迁移模块出现在在线 save 热路径上。
- `acc/server/routes/workflows.py` (24) — `from acc.migration.graph_importer import accflow_path_from_legacy_graph_path`，在 server 路由模块加载期就引入了 migration 模块。

**为什么是问题**

server 的在线 save endpoint 在编译期就依赖 `acc.migration`。如果 migration 模块在未来被裁掉或重构，`save_graph` 会被静默打断。函数对所有当前调用方都是 no-op——`workflow_storage_path` 已在上游硬过滤非 `.accflow.json` 输入并返回 HTTP 400，到 `save_graph` 时路径必然已经是 `.accflow.json`。这一层"legacy-aware"路径解析只剩下名字本身在暗示历史负担。

**建议**

把 `save_graph` 中的 `accflow_path_from_legacy_graph_path(path)` 直接替换为 `path`，并删除 routes 文件中对 `acc.migration` 的导入。如果未来确实需要 `.graph.json` 输入触发 save 期迁移，应在 CLI migration 命令里显式处理，而不是让 server save endpoint 兜底。

**可行性 / 风险**

低。函数对所有在线调用都是 no-op，移除调用与 import 之后用既有 round-trip 测试即可验证；甚至额外获得一个好处——理论上的"既非 `.graph.json` 也非 `.accflow.json`"输入将不再被静默改写后缀，而是更早地命中 `workflow_storage_path` 的 400。

来源：`compat-and-legacy-scars#8`

## 整体建议

清理顺序建议从"风险低、收益直接"的两个 MINOR 起步：补丁伤疤的最小阻力路径是先消除 `save_graph` 的 migration 依赖（问题 6），再合并那两对没有生产读者的双写文件（问题 5 的 `runtime_payload.json` 与 `artifacts/payload.json`）。这两步基本是 mechanical change，不会触动外部契约，可以快速缩小迁移残留面积。

接着处理"重命名半途而废"类问题（问题 1、问题 5 中的 `agent_payload.json` ↔ `input.json` 这一对）。这两者应作为同一类工作统筹推进——核心模式都是"写盘的旧名 + 读侧的新名"，需要的是一次配套的：定义规范名 → 读侧统一指向规范名 → 一次性数据迁移脚本 → 写侧只写规范名 → 删除归一化逻辑。把它们捏成一组治理可避免反复审视 manifest 与 runs 目录。

最后处理"语义需要重新设计"的问题：`safe_child_path` 守卫的修复（问题 3）必须先回答"合法 root 是什么"才能动手；测试 fixture ID 与生产 registry 的混合（问题 4）则需要抽取 `HermeticCallableSet` abstraction 并改造三个 callsite，体量近似一次小型迁移；字符串拼接躲避 grep（问题 2）虽然零行为变更，但合并两套集合前需要确认两边的语义差异，建议作为独立 review item 安排。这三项不适合批量合入，每一项都应有独立的设计审视。
