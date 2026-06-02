# 兼容代码与遗留痕迹

> 本文档记录 ACC 当前架构中属于 "兼容代码与遗留痕迹" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 在 Core v2 迁移过程中留下了大量"半完成"状态的兼容痕迹：V1/V2 binding 类型并存且 V2 仅作为 orphan 暴露、`.accflow.json` 反序列化器对多种历史 schema 进行 dual-accept、`run_index` 同时探测四代落盘格式、运行时与 summary 之间存在 `success`/`succeeded` 双终态、`core_v2_*` 命名前缀本身成为永久性"对照 v1"的语义负债。AGENTS.md 宣称"callable-only — 无 legacy fallback"，但实际上 legacy 仅在路径层被拒绝，在 in-memory 反序列化层被静默接收；其中部分接收点已被严格的 engine 入口屏蔽，但仍残存大量"防御性死代码"，对可读性、可审计性与未来重构形成持续阻力。这些痕迹绝大多数不是运行期 bug，而是架构清晰度与"轻量"目标的稀释。

## 详细问题清单

### 1. [CRITICAL] V1 binding types 是引擎活跃类型，V2 types 是 orphan 脚手架

**证据**：
- `acc/domain.py` (604-613) — 注释明确 "preserved verbatim for backward compatibility with the current .accflow.json runtime"。`NodeInputBinding` / `WorkflowCallInputBinding` / `WorkflowOutputBinding` / `WorkflowInputBinding` / `NodeOutputBinding` 五个 V1 类型与各自的 V2 对应物并存，没有任何移除时间表。
- `acc/engine/__init__.py` (20-34, 306-482) — Engine 在每次 `parse_core_v2_node_input_binding` / `parse_workflow_call_input_bindings` 调用中导入并构造 V1 类型；`engine/__init__.py` 与 `engine/workflow_validation.py` 从不导入 `NodeInputBindingV2` 等 V2 类型。
- `acc/domain.py` (327-343) — `NodeInvocationSpec.input_bindings: list[NodeInputBinding]` 仍使用 V1 — 主 spec 类型未迁移到 V2，使 V2 在 spec-driven 调用图中结构性不可达。

**为什么是问题**：V2 binding 迁移被声明为 "additive / Phase 1 only"，但 Phase 2（将 `NodeInvocationSpec` 切到 V2）从未到来。V2 类型作为公开导出存在却零调用点，给团队制造"迁移正在进行"的错觉。这并非运行期 bug — V2 类型在 spec 调用图中不可达，不会"静默绕过"engine 校验 — 真正的代价是开发者认知混乱与无意义的 API 表面积。

**建议**：要么完成迁移（更新 `NodeInvocationSpec` 字段、engine 解析器、`workbench_adapter`、迁移落盘 `.accflow.json`），要么删除 V2 类型与 `BindingResolver` 直至 Phase 2 真正排期。不要让 aspirational types 长期作为 live exports。

**可行性 / 风险**：删除路径低 blast radius — V2 类型零运行调用点，安全。完成迁移路径为 medium 复杂度，需要触及 spec、engine、workbench_adapter，并对落盘文件做迁移；其中 `workflows/6.accflow.json` 等仍使用 V1 input_bindings 格式，落盘迁移是最难的一步。优先选删除路径。

来源：compat-and-legacy-scars / compat-and-legacy-scars#0

---

### 2. [CRITICAL] Live `.accflow.json` 使用 `from`/`to` 边键 — 规范序列化即遗留格式

**证据**：
- `acc/domain.py` (670-678) — `workflow_function_template_to_dict` 将控制边序列化为 `{"from": edge.source, "to": edge.target}`；规范 writer 写出的就是历史命名。
- `acc/domain.py` (1050-1057) — `_control_edge_from_dict` 优先读 `source`/`target`，回退到 `from`/`to`。但 writer 在 L672 始终写 `from`/`to`，意味着 reader 中的 `source`/`target` 主分支是死代码 — 没有任何 writer 或 live 文件会喂入 `source`/`target` 形态的控制边。
- `workflows/6.accflow.json` (5, 10, 15) — 实际落盘：control_edges 全部为 `{"from": "...", "to": "..."}`；`workflows/` 下五个 live `.accflow.json` 全部如此。

**为什么是问题**：reader 的 `source`/`target` 主分支永远不会被触发，是真正的不可达死代码。dual-accept shim 长期生存只因没人删，但严格说不是数据错误 — 因此严重度其实更接近 major 级，未达 critical 风险。本条之所以仍归 critical，是因为它处于反序列化主入口，混淆了"什么是 canonical"。需注意：`normalize_data_edge` 与 `_data_edge_from_dict` 双方都用 `source`/`target`，控制边和数据边采用不同键名是有意的、双侧一致的设计，并非不匹配。

**建议**：删除 `_control_edge_from_dict` 中的 `source`/`target` 主分支（或反转优先级让 `from`/`to` 为主），并补一条用 live 文件加载的回归测试。无需迁移落盘文件，因为落盘已是 `from`/`to`。无需重新审视 data edge 一侧。

**可行性 / 风险**：低 blast radius，纯死代码删除。

来源：compat-and-legacy-scars / compat-and-legacy-scars#1

---

### 3. [CRITICAL] 路径层"拒绝 legacy"是表演 — in-memory 接收点散布多处

**证据**：
- `acc/domain.py` (53-79, 711-713, 1052-1057, 1097-1105) — `EXECUTABLE_METADATA_KEYS` 用字符串拼接（`'input'+'_mapping'`）规避 grep；`workflow_function_template_from_dict` 接收 `node_invocations` 字典（旧 `.graph.json` 格式）；`_control_edge_from_dict` 同时接收 `source/target` 与 `from/to`；`_node_ports_from_dict` 同时接收 `ports.inputs` 与 `input_ports`。
- `acc/domain.py` (33-47, 604-653) — `RuntimeStatus` 同时承载 `success` 与 `succeeded`：runtime 写 `succeeded`，summary 归一回 `success`。V1 binding 类型 "preserved verbatim for backward compat"，V2 类型并未接入 `NodeInvocationSpec`。
- `acc/run_index.py` (145-191) — `load_run_summary` 探测 4 个 legacy 文件名，三代落盘 schema 同时存活。
- `acc/migration/capsule_compat.py` + `acc/migration/graph_importer.py` — `capsule_compat.py` 已死但仍随生产包发布；`save_graph` 始终走 `accflow_path_from_legacy_graph_path`，即便所有 caller 已传入 `.accflow.json`。
- `acc/server/routes/runs.py` (97-108) — `get_run_events` 捕获 404 并对 `ui_workflow_` 前缀的 run_id 特殊返回空事件，是字符串前缀级补丁，绕过 index 静默注册失败的根因。

**为什么是问题**：AGENTS.md 声明 Core v2 "callable-only — 无 legacy fallback"。在路径层（`reject_legacy_graph_path`）确实拒绝 legacy，但 dual-format shim、`succeeded` 双终态、字符串拼接的 metadata key、死的 `capsule_compat`、`ui_workflow_` 前缀补丁等，反映出该 invariant 仅在一个边界点被强制，其他位置则被轻易绕过。需特别澄清：原断言"workbench_adapter 与 server route 通过传 dict 能激活 legacy 分支"对生产路径不成立 — `workbench_adapter` 实际调用 `acc/engine/__init__.py:parse_workflow_function_template`，该函数严格要求 `nodes` 为非空 list 并通过 `reject_core_v2_unknown_fields` 拒绝未知字段，不会回退到 `node_invocations`。`domain.py` 中接收 legacy 的辅助反序列化器仅被 `test_core_v2_serialization.py` 单测调用。因此真实问题是"防御性死代码 + 可审计性破坏 + 双终态状态字符串"，而非生产解析路径的 silent bypass — 严重度应当下调到接近 major。

**建议**：分项小步推进，每条独立可上线：
1. 一次性 `acc migrate` 将所有 `.accflow.json` 重写为 canonical（去 `node_invocations` dict、去 `source`/`target` 控制边键、去 `input_ports` list）。
2. 删除 `domain.py` 反序列化器中的 dual-format shim。
3. runtime 直接写 `success`，移除 `RuntimeStatus.succeeded` 与 summary 归一层。
4. 将 `EXECUTABLE_METADATA_KEYS` 改回普通字符串字面量并附行内注释解释每个键被拒原因。
5. 删除 `capsule_compat.py`。
6. 在 V1/V2 binding 中明确选一方，删除另一方（需要 ADR）。
7. 一次性迁移 run 目录，移除 4 选 1 的 legacy filename probe 中的 3 个。
8. 在 indexer 层修复 UI 触发的 run，移除 `ui_workflow_` 前缀守卫。
另加一条 CI：加载 `workflows/` 下全部 `.accflow.json` 并断言只含 canonical 键。

**可行性 / 风险**：第 (3)(4)(5)(7) 条独立、低风险，应优先。(1)+(2) 是杠杆最大的组合，能解锁 `run_index`、`workbench_adapter`、deserializer 的简化。(6) 最具争议，需 ADR 决断。

来源：cross-cutting / cross#3

---

### 4. [MAJOR] `acc/run_index.py:load_run_summary` 探测四代落盘格式且无迁移路径

**证据**：
- `acc/run_index.py` (145-191) — 按顺序探测：`run_summary.json`（当前格式）→ `node_summary.json`（Phase 1 legacy）→ `run_record.json`（pre-Phase-1）→ `conductor_output.json` + `session_manifest.json`（pre-Core-v2）。
- `acc/run_index.py` (161-177) — `run_record.json` 路径直接 inline 反序列化为 `RunSummary`。
- `acc/run_index.py` (179-191) — `conductor_output.json` + `session_manifest.json` 走 `build_node_summary` 重建摘要。

**为什么是问题**：三代 on-disk schema 同时活在 reader 中且没有合并它们的迁移路径。需澄清两点先前误述：(1) 该处实际是分支顺序探测，不是带 "Probe order" 注释块的代码；(2) `build_node_summary` 仅服务于最古老的 pre-Core-v2 那一支，前三种 schema 直接 inline 反序列化、与 `build_node_summary` 无关 — 因此移除前 3 个探测分支并不会"解锁 `build_node_summary` 的简化"。

性能影响微弱：probe 在第一击中后短路，现代 run（`run_summary.json`）只需 1 次 `stat()`；只有古老 run 目录会承担最多 5 次 fs check（注意是 5 次而非 4 次，第 4 类要检查两个文件）。真实成本是认知与维护负担，不是 IO。

**建议**：增加一次性迁移脚本（或 `acc migrate-runs` 显式命令），将 `run_record.json` / `node_summary.json` / `conductor_output.json` 的 run 目录就地转换为 `run_summary.json`。迁移确认完成后从 `load_run_summary` 删除三个 legacy probe。

**可行性 / 风险**：medium effort — 迁移脚本本身简单，字段映射在 L168-177 / L184-191 已经显式给出。风险点是迁移期间旧格式 run 仍可能出现，建议保留 compat probe 直到迁移确认完成。

来源：redundancy-and-duplication / redundancy-and-duplication#14

---

### 5. [MAJOR] `node_invocations` dict fallback 让旧 `.graph.json` 内存格式继续存活

**证据**：
- `acc/domain.py` (702-713) — `workflow_function_template_from_dict`：若 `payload.get('nodes')` 非 list，回退到 `legacy_nodes_payload = payload.get('node_invocations')` — 旧 `.graph.json` dict-keyed 格式。`workflows/` 下 live `.accflow.json` 全部不使用此格式。
- `acc/domain.py` (710-713) — 变量名直接叫 `legacy_nodes_payload`；该分支若两种格式都缺，会 raise `AccError`，意味着只要 caller 喂入旧 dict，就会进入 legacy 分支。
- `acc/app/core_v2_loader.py` (9, 31-33) — `LEGACY_GRAPH_SUFFIX = '.graph' + '.json'`（自身就是规避 grep 的字符串拼接）；`reject_legacy_graph_path` 在路径层拒绝 `.graph.json`。

**为什么是问题**：路径层守卫给人"旧格式已被全面阻止"的错觉，但 `domain.py` 反序列化器内部仍接受。真实暴露面比原断言要小：生产 caller（`workbench_adapter`、server route）走的是 `acc/engine/__init__.py:parse_workflow_function_template`，不会进入 `domain.py` 的这条 fallback；该 fallback 实际仅被 `test_core_v2_serialization.py` 单测访问，且测试也从未真正触发它。这是一处"将迁移逻辑嵌入 pure types 反序列化器"的契约破坏 + 真正的死代码，但不是 in-memory bypass 漏洞。

**建议**：从 `workflow_function_template_from_dict` 中移除 `node_invocations` fallback；如仍需迁移逻辑，让其归位到 `acc/migration/graph_importer.py`。同时把 `LEGACY_GRAPH_SUFFIX` 改回普通字符串字面量。

**可行性 / 风险**：低 blast radius — 删除前确认无 fixture 走 dict 分支即可。

来源：compat-and-legacy-scars / compat-and-legacy-scars#4

---

### 6. [MAJOR] `_node_ports_from_dict` dual-format shim：`ports.inputs` dict 与 `input_ports` list 同时被运行期接受

**证据**：
- `acc/domain.py` (1093-1105) — `_node_ports_from_dict`：若 `payload.get('ports')` 是 dict → 读 `ports.inputs` / `ports.outputs`；否则回退 `payload.get('input_ports')` / `payload.get('output_ports')`。两种不兼容的 port 表达同时存在于热反序列化路径。
- `workflows/acc_workspace_canvas.accflow.json` — live 落盘格式：`node['ports'] = {'inputs': {...}, 'outputs': {...}}` — 全部使用新 dict 格式；`input_ports` / `output_ports` 在所有 live 文件中都不存在。
- `acc/app/workbench_adapter.py` (515, 635-636) — L515：`if 'input_ports' in node or 'output_ports' in node` — workbench_adapter 在 canonicalize 阶段仍检查 legacy list 格式。L635-636：`ports_from_value(node.get('input_ports'), ...)` — 编译流水线读旧格式。

**为什么是问题**：`input_ports` / `output_ports` 这种 list-of-dicts 旧格式在 `workbench_adapter` 的 draft → canonical 流水线中作为中间表示流转，但它会在写入 `domain.py` 反序列化器之前被转成 canonical。也就是说：`domain.py` 的 fallback 在当前 pipeline 中是防御性死代码，不是活路径；真正的风险是若来自外部/导入的 workflow 文件携带旧格式，反序列化器会静默接受而非 fail-fast。原断言"legacy 在编译流水线中仍流通"对外部 reader 不构成威胁。

**建议**：删除 `_node_ports_from_dict` 中 L1102-1104 的 else fallback，让 `domain.py` 仅接受 canonical 格式。删除前确认无 fixture / 外部数据源依赖旧格式；`workbench_adapter` 内部的过渡使用属于 adapter 的私有契约，无需改动。

**可行性 / 风险**：low — 落盘 43 个 `.accflow.json` 全部使用新格式，删除 fallback 不会破坏任何已有数据。

来源：compat-and-legacy-scars / compat-and-legacy-scars#5

---

### 7. [MAJOR] 两条同步阻塞 run 接口仍在生产 server，其中一条被 UI 持续调用

**证据**：
- `acc/server/routes/workflows.py` (109-125) — `POST /workflows/run-graph`：同步、阻塞 Uvicorn worker 整个 run 期。直接 `WorkflowAppService(...).run_sync(...)`，无 async queue，无 deprecation 标记。
- `acc/server/routes/workflows.py` (361-380) — `POST /workflows/{workflow_id}/run`：第二条同步阻塞接口，同样直接调 `run_sync`。
- `web/src/components/ControlPlanePanel.tsx` (52-55) — `api.runWorkflow(selectedWorkflow.workflow_id, runDir)` — 活跃 UI 调用 `/{workflow_id}/run` 同步端点。这是 live 的 ControlPlanePanel，不是测试。

**为什么是问题**：在异步 Uvicorn 上做同步阻塞 run 会饿死 event loop（一个 workflow 可能持续数分钟），任何并发请求都会被 stall。异步 submit 路径（`run-graph/submit`）已存在并是 `WorkflowViewer` 使用的 canonical 路径；`/{workflow_id}/run` 之所以仍活着，仅因为 `ControlPlanePanel` 没有跟随迁移。

**建议**：将 `ControlPlanePanel.tsx` 切到 `api.submitGraphRun`（或新增 `/workflows/{id}/submit`）+ 轮询完成。当无 UI 组件调用同步端点后，给两条同步 route 加 deprecation header，再删除。`WorkflowAppService.run_sync` 本身仅 `cli.py` 仍需要，可保留为非 server utility。

**可行性 / 风险**：medium — `ControlPlanePanel` 是 debug/control 工具，UX 影响小；`WorkbenchRunManager` 已有可复用的 async 轮询模式。删除 route 前需审计是否有外部 / CLI integration 依赖该同步契约。

来源：compat-and-legacy-scars / compat-and-legacy-scars#6

---

### 8. [MAJOR] "Core v2" 命名 + V1/V2 binding 分裂将 dual-version 心智模型固化进结构

**证据**：
- `acc/app/core_v2_runtime.py` + `acc/app/core_v2_loader.py` — 模块名带 `v2` 后缀；函数：`validate_core_v2_workflow_function`、`validate_core_v2_node_invocation`、`write_core_v2_run_summary`、`run_core_v2_workflow_path`、`execute_core_v2_node`、`execute_core_v2_callable` 等，公开符号中至少 8 处携带 `core_v2_`。
- `acc/domain.py` (604-653, 327-343) — 5 个 V1 binding 类型 "preserved verbatim for backward compat"；5 个 V2 类型已声明，但 `NodeInvocationSpec.input_bindings` 与 `workflow_call_input_bindings` 仍引用 V1 — V2 在 spec 主干上是 orphan。另有 3 个 alias（`WorkflowCallBinding`、`WorkflowReturnBinding`、`InputBinding`）叠加第三层命名。
- `acc/domain.py` (33-47) — `RuntimeStatus` 同时声明 `success` 与 `succeeded`：runtime 写一种，summary builder 归一为另一种。同一逻辑结果两种终态字符串。

**为什么是问题**：AGENTS.md 写 "callable-only (Core v2) — 无 legacy fallback"。但 "Core v2" 这个名字本身意味着"还有一个 v1 在对照"，且它被硬编码进 8+ 公开符号、每个 CLI 命令、每条 route handler、每个测试名。V1/V2 binding 拆分被声明为 "additive / Phase 1"，但 Phase 2（迁移 `NodeInvocationSpec`）从未到来：V2 类型公开但未接入主 spec，V1 是引擎活类型，3 个 alias 又叠了一层名字漂移。补充准确性：V2 binding 类型并非完全 dead — `acc/binding/resolver.py:BindingResolver` 在 selector 解析路径上确实使用 `NodeInputBindingV2`，但它是与 `NodeInvocationSpec` 平行的另一套调用图。"V2 orphan" 的描述在 spec 层面准确，在 BindingResolver 层面不成立。`v2` 后缀只要还在公开符号中，就在每一次代码引用处持续广告"还有一个 v1"。

**建议**：选定 deprecation deadline。要么 (a) 完成 Phase 2：迁移 `NodeInvocationSpec` 到 V2、更新 engine 解析器、迁移落盘 `.accflow.json`，删除 V1 类型与 alias，再 `core_v2_*` → `core_*`；要么 (b) 承认 V2 已死：删除 V2 binding 类型与 alias，再做同样的 rename。同时丢弃 `RuntimeStatus.succeeded`，runtime 直接写 `success`。

**可行性 / 风险**：两步重构。Step 1（V1 vs V2 取舍）需 ADR。Step 2（rename）机械 — `sed -i 's/core_v2_/core_/'` — 但触及 CLI/server/tests/UI 文案，应作单一原子提交。`success`/`succeeded` 修复独立、零风险，可作为先行 precursor。

来源：cross-cutting / cross#6

---

## 整体建议

**优先级 P0（独立、低风险、立即可做）**：runtime 直接写 `success` 并删除 `RuntimeStatus.succeeded` 归一层（条 #3.3、#8 的子项）；将 `EXECUTABLE_METADATA_KEYS` 与 `LEGACY_GRAPH_SUFFIX` 等字符串拼接还原为普通字面量（条 #3.4、#5）；删除 `acc/migration/capsule_compat.py`（条 #3.5）；删除 `_control_edge_from_dict` 的 `source`/`target` 主分支与 `_node_ports_from_dict` 的 `input_ports` else 分支（条 #2、#6）；删除 `workflow_function_template_from_dict` 的 `node_invocations` fallback（条 #5）。这些子项各自局部可证伪、不依赖跨模块协调，宜批量打包成"反序列化器死代码清扫"提交。

**优先级 P1（一次性迁移 + 后续删除）**：用 `acc migrate-runs` 一次性把 `run_record.json` / `node_summary.json` / `conductor_output.json` 类型的 run 目录转为 `run_summary.json`，再从 `load_run_summary` 删除三个 legacy probe（条 #4）；用 `acc migrate` 做一轮 `.accflow.json` canonical 重写并加 CI 断言（条 #3.1、#3.2）；将 `ControlPlanePanel.tsx` 切到 async submit + 轮询，然后删除两条同步 run 端点（条 #7）。这一组解锁 `run_index` 与 server route 的清晰化。

**优先级 P2（需要 ADR 的架构决断）**：在 V1 与 V2 binding 之间选定一方（条 #1、#8）。若选 V2，需迁移 `NodeInvocationSpec` 字段、engine 解析器、`workbench_adapter` 与落盘 `.accflow.json`；若选 V1（事实上的 live 类型），需删除 V2 类型、`BindingResolver` 中的 V2 路径与 3 个 alias。任一方向决定后，再做机械 rename `core_v2_*` → `core_*`，以解除"对照 v1"的永久语义负担。这一步是清理 ACC 兼容痕迹的终点，但应作为一个独立、不与上述清扫混合的提交序列。

整体上，P0 几乎全部是"删除"操作，移除不会扩大的死代码可立即让 `domain.py` 与 `run_index.py` 显著瘦身；P1 的迁移命令是中等成本但收益最高的杠杆点；P2 是真正决定 ACC 是否还在背负 "Core v2 vs v1" 的关键分叉，应单独立项并以 ADR 收尾。
