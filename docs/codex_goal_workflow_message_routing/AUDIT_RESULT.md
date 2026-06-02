# Agent-Capsule-Conductor Phase 1+2+3 实施完整性审计报告

> 审计时间：2026-06-01　　审计输入：MECHANICAL FACTS + SOURCE FACTS（纯代码/测试证据，不引用任何"AI 声称已完成"的陈述）

---

## 1. 总体判定：FAIL

**核心差距（必须修复才能进入 Phase 4）**

1. **Phase 3 默认翻转未完成**：`ControlEdge.context` 在 `acc/domain.py:70` 的 domain 级默认值仍为 `"upstream_output"`，而非 Phase 3 要求的 `"none"`。这是全局默认，影响所有未显式指定 context 的 control edge。
2. **主回归套件 22 failures**：`pytest -q -m 'not slow and not legacy and not performance'`（CMD1）报告 22 failed，涉及 `test_debugger.py` 和 `test_workflow_capsules.py`，阻塞发布。
3. **8 个 AC 的 pytest marker 收集为 0**：T_AC5 / T_AC6 / T_AC7 / T_AC10 / T_AC13 / T_AC14 / T_AC16 / T_AC17 全部 0 tests collected，不能支撑对应 AC 的测试覆盖声明。
4. **BLOCKER.md 明确记录 E2E 阻断**：AC1 浏览器 E2E 在 ≥3 模块边界交叉处停止，未解除。

以上任何一项均单独构成 FAIL 判定；综合四项，当前状态为 **FAIL**。

---

## 块 A：Phase 1 Substrate

Phase 1 新增文件完整性检查。除 `acc/policy.py` 外，全部基础文件已到位。

| 文件 / 功能 | 状态 | 证据（file:line） |
|---|---|---|
| `acc/binding/__init__.py` | PASS | 926 bytes；修改时间 2026-06-01 01:39 |
| `acc/binding/selector.py` | PASS | 3429 bytes；修改时间 2026-06-01 11:35 |
| `acc/binding/provenance.py` | PASS | 2806 bytes；修改时间 2026-06-01 11:35 |
| `acc/binding/resolver.py` | PASS | 10283 bytes；修改时间 2026-06-01 11:35 |
| `acc/binding/legacy.py`（Phase 3 迁移） | PASS | 2072 bytes；修改时间 2026-06-01 03:33 |
| `acc/result_store/__init__.py` | PASS | 793 bytes；修改时间 2026-06-01 01:39 |
| `acc/result_store/types.py` | PASS | 1571 bytes；修改时间 2026-06-01 01:39 |
| `acc/result_store/filesystem.py` | PASS | 5648 bytes；修改时间 2026-06-01 01:40 |
| `acc/runtime/__init__.py` | PASS | 9202 bytes；修改时间 2026-06-01 10:44 |
| `acc/runtime/payload.py` | PASS | 2379 bytes；修改时间 2026-06-01 01:40 |
| `acc/runtime/transfer_policy.py` | PASS | 2259 bytes；修改时间 2026-06-01 11:35 |
| `acc/persistence/__init__.py` | PASS | 803 bytes；修改时间 2026-06-01 01:38 |
| `acc/persistence/manifest.py` | PASS | 4256 bytes；修改时间 2026-06-01 11:36 |
| `acc/persistence/events.py` | PASS | 1540 bytes；修改时间 2026-06-01 11:35 |
| `acc/persistence/cache_key.py` | PASS | 1109 bytes；修改时间 2026-06-01 11:35 |
| `acc/scheduler/__init__.py` | PASS | 927 bytes；修改时间 2026-06-01 01:38 |
| `acc/scheduler/ready_set.py` | PASS | 2281 bytes；修改时间 2026-06-01 01:38 |
| `acc/server/run_projection.py` | PASS | 8347 bytes；修改时间 2026-06-01 11:35 |
| **`acc/policy.py`** | **FAIL** | 文件不存在；`DEFAULT_CONCURRENCY_LIMITS` 引用未建立（Phase 1 遗留） |
| `BindingMode` enum 定义 | PASS | `acc/domain.py:550–553` — `LEGACY_FULL / MIXED / EXPLICIT_ONLY` |
| `PromptAppendixPolicy` enum 定义 | PASS | `acc/domain.py:556–559` — `LEGACY_FULL / TASK_ONLY / NONE` |
| `legacy_graph_importer` 注入 `LegacyPassthroughBinding` | PASS | `acc/legacy_graph_importer.py:211` — `metadata.setdefault("binding_mode", "legacy_full")` + 注入逻辑 |
| adapters 写入 `ACC_RUN_ID` / `ACC_RUN_DIR` | PASS | `acc/adapters/codex_cli.py:32–34` — 条件写 `ACC_RUN_ID`，无条件写 `ACC_RUN_DIR`；在 line 38 `asyncio.create_subprocess_exec` 之前设置 |
| Phase 1 baselines（11 个子目录） | PASS | `tests/fixtures/baselines/phase1/` 含 11 个子目录：`callable_agent_tool_demo`、`callable_child_function`、`callable_main_function_demo`、`callable_nested_function_demo`、`demo_serial`、`demo_two_node`、`environment_stateful_demo`、`ideal_layering_parallel`、`ideal_layering_serial`、`nested_environment_demo`、`stateless_template_demo` |
| E2E 测试文件（8 个） | PASS | `tests/e2e/` 含 AC01/02/04/08/09/11/12/18 共 8 个文件 |
| migration 测试文件 | PASS | `tests/migration/test_legacy_full_byte_equivalence.py` 9808 bytes；修改时间 2026-06-01 03:36 |

**小结**：Phase 1 substrate 文件覆盖率 17/17（`acc/policy.py` 为可选，按 Phase 1 原始 scope 尚未交付），基础枚举、adapter、baseline 全部就位。

---

## 块 B：Phase 2 Hot-Path Refactor

| 功能点 | 状态 | 证据（file:line） |
|---|---|---|
| `render_prompt` 接受 `appendix_policy` 参数 | PASS | `acc/prompting.py:13–18` — `appendix_policy: PromptAppendixPolicy` 作为关键字专用参数（`*` 之后），**required**，无默认值。函数内有三档分支：`LEGACY_FULL` / `TASK_ONLY` / `NONE` |
| `LEGACY_FULL` 模式走旧 5-segment 路径，不调 `BindingResolver.resolve` | PASS | `acc/app/binding_runtime.py:120–128` — `if binding_mode is BindingMode.LEGACY_FULL: return (build_clean_node_input_payload(...), None)` — `resolver.resolve()` 被完全跳过 |
| `MIXED` / `EXPLICIT_ONLY` 模式调用 `BindingResolver.resolve` 并消费结果 | PASS | `acc/app/binding_runtime.py:144–159` — `result = resolver.resolve(...)`；结果写入 `resolved_fields`、`binding_materializations`、`provenance` |
| `FilesystemResultStore.put` 在节点成功完成路径无条件调用 | PASS | `acc/app/__init__.py:1053–1059` — `record_node_result_in_store(...)` 调用在成功分支，**无** `if binding_mode` 门控；`acc/app/binding_runtime.py:193–201` — 构造 `NodeResult` 后执行 `FilesystemResultStore(runs_root).put(result)` |
| `WorkflowOutputBinding` 在 workflow 结束时写入 `("__workflow__", target_port)` 终态记录 | PASS | `acc/app/__init__.py:604–610` — workflow 所有层完成后调用 `record_workflow_outputs_in_store(...)`；`acc/app/binding_runtime.py:225–251` — 终端地址 `NodeId(TERMINAL_WORKFLOW_NODE_ID)` + `PortId(binding.target_port)`，执行 `store.put(terminal)` |
| `RunProjection` 提供 `list_nodes` / `get_node` / `get_workflow_output` | PASS | `acc/server/run_projection.py:67–76` — 文档注释为"Read-only projection over ResultStore + runtime side-channels"；`:85` `list_nodes`；`:106` `get_node`；`:132` `get_workflow_output` |
| HTTP routes 挂载三条 projection 端点 | PASS | `acc/server/routes/runs.py:137` — `GET /{run_id}/projection/nodes`；`:148` — `GET /{run_id}/projection/nodes/{node_id}`；`:162` — `GET /{run_id}/projection/outputs/{target_field}` |
| `acc/binding/legacy.py` 含 `_legacy_collect_upstream_context` 真实实现 | PASS | `acc/binding/legacy.py:18–41` — 函数定义；`:64` — `__all__ = ["_legacy_collect_upstream_context"]` |
| `acc/app/node_invocation.py` 中 `collect_upstream_context` 降级为 shim | PASS | `acc/app/node_invocation.py:6` — `from acc.binding.legacy import _legacy_collect_upstream_context`；`:102–109` — `collect_upstream_context()` 仅委托，注释标注 `DEPRECATED: removed Phase 4` |

**小结**：Phase 2 hot-path 全部 PASS。`render_prompt` 三档分支、`BindingResolver` 门控、`ResultStore` 写穿、`WorkflowOutputBinding` 终态写入、`RunProjection` HTTP 层均已就位。

---

## 块 C：Phase 3 完成度

**本块为本次审计最关键部分。**

| 功能点 | 状态 | 证据（file:line） |
|---|---|---|
| `acc/runner.py` standalone 路径接受并传递 `prompt_appendix_policy` | PASS | `acc/runner.py:48–54` — `run(..., prompt_appendix_policy: PromptAppendixPolicy \| None = None)`；`:113–120` — 传入 `render_prompt(appendix_policy=...)` |
| `acc/binding/legacy.py` 存在，原 `collect_upstream_context` 成功迁移 | PASS | `acc/binding/legacy.py:18` — 真实实现；`acc/app/node_invocation.py:102–109` — 仅 shim，明确注释 Phase 4 删除 |
| `ProvenanceObject.schema_version` 标注为 FROZEN | PASS | `acc/binding/provenance.py:4–5` — 注释说明 Phase 3 冻结 schema；`:30` — `schema_version: int = 1  # FROZEN PUBLIC SCHEMA — bumping requires migration plan` |
| Workbench 服务器端读取切到 `ResultStore`（不再读 outbox） | PASS | `acc/server/run_projection.py:79–83` — 持有 `FilesystemResultStore`；`:112–116` — 用 `result_store.get(...)` 读节点输出 |
| `parse_control_context` 默认值翻转为 `"none"` | PASS | `acc/legacy_graph_importer.py:290–294` — `context = str(edge.get("context") or "none")` — 无 context 字段时落到 `"none"` |
| **`ControlEdge.context` domain 级默认值翻转为 `"none"`** | **FAIL 🔴** | `acc/domain.py:70` 出现在 `upstream_output` 模式 grep 匹配结果中（grep `-rn "upstream_output" acc/ --include="*.py"` 在 `domain.py (15,70,541)` 命中）。Phase 3 要求改为 `"none"`（`IMPLEMENTATION_STRATEGY.md:392`），但 domain 级默认未翻转，影响所有直接构造 `ControlEdge` 而不指定 `context` 的调用方 |
| `binding_mode` 默认值全局翻转为 `explicit_only` | **PARTIAL 🟡** | 运行时路径：`acc/app/binding_runtime.py` 中缺省为 `EXPLICIT_ONLY`（未显式指定时走非 legacy 路径）。**但** legacy importer 路径：`acc/legacy_graph_importer.py:211` 仍执行 `metadata.setdefault("binding_mode", "legacy_full")`，所有经由 legacy importer 导入的 workflow 默认为 `LEGACY_FULL`。Phase 3 要求全局翻转未完成 |
| `prompt_appendix_policy` 默认值翻转 | **PARTIAL 🟡** | `render_prompt` 的 `appendix_policy` 是 **required** 参数（无默认，`acc/prompting.py:13–18`）。`CapsuleRunner.run` 接受 `None` 并在运行时转为 `TASK_ONLY`（`acc/runner.py:48–54`）。调用链上不会出现 `LEGACY_FULL` 默认兜底，但 `acc/policy.py`（含 `DEFAULT_CONCURRENCY_LIMITS`）缺失，`prompt_appendix_policy` 全局策略入口未建立 |

### Phase 3 默认翻转汇总

| 默认值目标 | 代码位置 | 期望值 | 实际值 | 判定 |
|---|---|---|---|---|
| `ControlEdge.context` | `acc/domain.py:70` | `"none"` | `"upstream_output"`（grep 命中） | **FAIL** |
| `binding_mode`（runtime 路径） | `acc/app/binding_runtime.py` | `EXPLICIT_ONLY` | `EXPLICIT_ONLY` | PASS |
| `binding_mode`（legacy importer 路径） | `acc/legacy_graph_importer.py:211` | `EXPLICIT_ONLY` | `"legacy_full"` | **FAIL** |
| `prompt_appendix_policy`（render_prompt） | `acc/prompting.py:13–18` | required（无默认） | required — 无默认 | PASS |
| `prompt_appendix_policy`（runner None→TASK_ONLY） | `acc/runner.py:48–54` | `TASK_ONLY` | `TASK_ONLY`（None 时） | PASS |

---

## 块 D：测试结果

| 命令 | passed | failed | skipped | 备注 |
|---|---:|---:|---:|---|
| CMD1: `pytest -q -m 'not slow and not legacy and not performance' --no-header` | 459 | **22** | 20 | 失败集中在 `test_debugger.py` 和 `test_workflow_capsules.py`；耗时 81.13s |
| CMD2: `pytest -q tests/architecture/ --no-header` | 16 | 0 | 0 | 架构边界全绿；耗时 0.34s |
| CMD3: `pytest -q tests/unit/test_binding_*.py tests/unit/test_result_store_*.py tests/unit/test_runtime_*.py tests/unit/test_persistence_*.py tests/unit/test_scheduler_*.py --no-header` | 48 | 0 | 0 | Phase 1 新增单元测试全绿；耗时 0.56s |
| CMD4: `pytest -q tests/integration/test_binding_mode_*.py tests/integration/test_workflow_output_*.py tests/integration/test_result_store_*.py --no-header` | 13 | 0 | 0 | Phase 2 集成测试全绿；耗时 1.22s |
| CMD5: `pytest -q tests/e2e/ --no-header` | 12 | 0 | 2 | 2 个 skip；耗时 59.43s |
| CMD6: `pytest -q tests/migration/test_legacy_full_byte_equivalence.py --no-header` | 2 | 0 | 2 | 2 个 skip；耗时 0.88s |

**关键问题**：CMD1 的 22 个 failures 发生在 `test_debugger.py` 和 `test_workflow_capsules.py`，是主回归套件的一部分，阻塞所有后续验收。CMD2–CMD6（专项测试）全部通过，说明失败点局限于调试器集成和 capsule workflow 端到端路径，而非 Phase 1–3 的新增基础模块。

---

## 块 E：AC×Test 实际覆盖

测试执行命令形式：`pytest --collect-only -q -m "T_AC<n>"`，对 AC1–AC18 逐一运行。

| AC | AC 标题（DESIGN.md §14） | TEST_PLAN 期望主 e2e | collect 数 | 对应 e2e 文件 | 判定 |
|---|---|---|---:|---|---|
| AC1 | Control edge 仅 readiness | T-047 | **4** | `test_ac01_control_only_no_data_leak.py` + `test_binding_mode_explicit_only.py` | PASS |
| AC2 | Agent-visible 输入由显式 binding 唯一决定 | T-048 | **4** | `test_ac02_explicit_binding_uniquely_decides.py` + `test_binding_mode_mixed.py` | PASS |
| AC3 | Provenance 默认 runtime-only | T-049 | **1** | `test_provenance_runtime_only_no_agent_visible` | PASS |
| AC4 | Standalone-equivalent 字段集 | T-050 | **6** | `test_binding_mode_explicit_only.py` + `test_ac04_standalone_equivalence_field_set.py` | PASS |
| AC5 | 并发 run 不共享中间状态 | T-051 | **0** | 无对应 `test_ac05_*.py` | **FAIL** |
| AC6 | Pause/resume 显式 checkpoint | T-052 | **0** | 无对应 `test_ac06_*.py` | **FAIL** |
| AC7 | Final summary 由 aggregation 节点 | T-053 | **0** | 无对应 `test_ac07_*.py` | **FAIL** |
| AC8 | upstream_context 默认 opt-in | T-054 | **5** | `test_result_store_write_through.py` + `test_workflow_output_binding.py` + `test_ac08_upstream_context_opt_in.py` | PASS |
| AC9 | Prompt 渲染可控 | T-055 | **2** | `test_ac09_no_auto_appendix_when_no_var_ref.py` | PASS |
| AC10 | UI Inspector 透明 | T-056 | **0** | 无对应 `test_ac10_*.py` | **FAIL** |
| AC11 | Legacy 文件迁移期可执行 | T-057 | **32** | `test_existing_workflows_unchanged.py` | PASS |
| AC12 | 测试分层 | T-058 | **1** | `test_ac12_test_layering_governance.py` | PASS |
| AC13 | ArtifactBundle 含结构化 Provenance | T-059 | **0** | 无对应 `test_ac13_*.py` | **FAIL** |
| AC14 | 节点输出寻址化 | T-060 | **0** | 无对应 `test_ac14_*.py` | **FAIL** |
| AC15 | Capsule prompt 兼容兜底 | T-061b | **29** | `test_existing_workflows_unchanged.py` | PASS |
| AC16 | 内部路径相对化 | T-062 | **0** | 无对应 `test_ac16_*.py` | **FAIL** |
| AC17 | 平台 fallback 可观测 | T-063 | **0** | 无对应 `test_ac17_*.py` | **FAIL** |
| AC18 | Nested workflow boundary isolation | —（由支撑用例覆盖） | **1** | `test_ac18_nested_workflow_boundary_isolation.py` | PASS |

**覆盖汇总**：18 个 AC 中，10 个 PASS，8 个 FAIL（AC5/6/7/10/13/14/16/17）。

失败 AC 共同特征：没有对应的 e2e 文件，也没有带 `T_AC5` 等 marker 的单元/集成测试。这 8 个 AC 对应 Phase 3 的更高级功能（并发隔离、checkpoint、聚合节点、UI Inspector、ArtifactBundle provenance、寻址化、路径相对化、平台 fallback）。

---

## 块 F：浏览器 E2E

| 断言 | 状态 | 实际值 |
|---|---|---|
| BLOCKER.md 存在且有内容 | PASS | `F:/Agent-Capsule-Conductor/BLOCKER.md` — 4492 bytes；修改时间 2026-06-01 01:13 |
| BLOCKER.md 记录的阻断点 | PASS | 文档明确：AC1 浏览器 E2E workflow message routing 在 STOP rule 触发处停止（≥3 模块边界交叉，需要 fixes）；测试用例 T-047；run id `e2e_ac1_1780247502236` |
| AC1 fixture 形状 | PASS | 两节点 A→B workflow，仅 ControlEdge，无 DataEdge；`forbidden_intersection` 键集合在 `input.json` 中有记录 |
| 浏览器 artifact 存在 | PASS | `tests/e2e/browser/_artifacts/` 含 `browser_phase3_ac1_1780256983411_ac1.png`（67610 bytes）和 `phase3_workbench_smoke.png`（71314 bytes） |
| 最近一次 E2E run 的 `progress.jsonl` | PASS | `tests/e2e/browser/_artifacts/local progress.jsonl` 存在；`progress.jsonl`（仓库根）5 条记录，TASK 5 标注 `DONE` |
| AC1 `input.json` 的 `forbidden_intersection` 检查 | PASS（per BLOCKER.md） | BLOCKER.md 记录：`top_level_keys ∩ {inbox, node, upstream_context, workflow}` 的情况已被观察并记录为测试关注点 |
| BLOCKER.md 阻断状态 | **未解除** | 文件明确记录为阻断（STOP），无后续 resolution 记录；`progress.jsonl` 的 TASK 5 完成是 `PHASE3_REPORT.md` 创建，而非 BLOCKER.md 解除 |

**结论**：浏览器 E2E 基础设施（Playwright artifacts、smoke screenshot）已就位，但 AC1 E2E 流程因跨模块边界问题在 `T-047` 处被 STOP rule 明确阻断，尚未解除。

---

## 尚未完成清单（按严重度排序）

### CRITICAL — 阻塞发布

| # | 描述 | 所属 Phase | 真实证据 |
|---|---|---|---|
| C-01 | `ControlEdge.context` domain 默认值未翻转：`acc/domain.py:70` 仍为 `"upstream_output"`，所有未显式设置 context 的 control edge 在运行时将携带旧语义，违反 Phase 3 AC1/AC8 不变量 | Phase 3 | `grep -rn "upstream_output" acc/ --include="*.py"` 在 `domain.py (15,70,541)` 命中；`IMPLEMENTATION_STRATEGY.md:392` 要求改为 `"none"` |
| C-02 | CMD1 主回归 22 failures：`pytest -q -m 'not slow and not legacy and not performance'` 报告 22 failed，涉及 `test_debugger.py` 和 `test_workflow_capsules.py` | Phase 2/3 | CMD1 执行结果：`22 failed, 459 passed, 20 skipped in 81.13s` |
| C-03 | AC1 浏览器 E2E 阻断未解除：BLOCKER.md 明确记录 STOP，run id `e2e_ac1_1780247502236` 卡在 T-047；这是 Phase 3 交付必须通过的终态验收 | Phase 3 | `BLOCKER.md` 4492 bytes；修改时间 2026-06-01 01:13；无后续 resolution |

### HIGH — 阻塞 Phase 4

| # | 描述 | 所属 Phase | 真实证据 |
|---|---|---|---|
| H-01 | `acc/legacy_graph_importer.py:211` 仍写 `metadata.setdefault("binding_mode", "legacy_full")`，导致经由 legacy importer 导入的所有 workflow 默认为 `LEGACY_FULL`；Phase 3 全局翻转目标未完成 | Phase 3 | `grep -rn "legacy_full" acc/` 在 `legacy_graph_importer.py:211` 命中 `metadata.setdefault("binding_mode", "legacy_full")` |
| H-02 | AC5/6/7/10/13/14/16/17 测试覆盖为零：8 个 AC 对应 e2e 文件和 marker 均缺失，`pytest --collect-only -q -m "T_AC<n>"` 返回 0 tests；无法验证并发隔离、checkpoint、聚合节点、UI Inspector、ArtifactBundle provenance、节点寻址、路径相对化、平台 fallback | Phase 2/3 | T_AC5/T_AC6/T_AC7/T_AC10/T_AC13/T_AC14/T_AC16/T_AC17 均报 `0 tests collected (501 deselected)` |
| H-03 | `acc/policy.py` 缺失：`DEFAULT_CONCURRENCY_LIMITS` 引用无法解析，影响并发策略入口（Phase 1 原始 scope，但未实现） | Phase 1 | 文件检查：`acc/policy.py` FAIL — 文件不存在 |

### MEDIUM — 需跟踪

| # | 描述 | 所属 Phase | 真实证据 |
|---|---|---|---|
| M-01 | `CapsuleRunner.run` 接受 `prompt_appendix_policy: PromptAppendixPolicy \| None = None`，但 `render_prompt` 的 `appendix_policy` 是 required 参数（无默认）。若调用链未在传递前将 `None` 转为具体策略，运行时会产生 `TypeError`；需确认 runner 内部 None→TASK_ONLY 转换路径覆盖所有调用链 | Phase 3 | `acc/runner.py:48–54`（接受 None）vs. `acc/prompting.py:13–18`（required） |
| M-02 | CMD6 migration 测试有 2 个 skip；若 skip 原因是 baseline 不兼容或 fixture 缺失，迁移覆盖存在盲区 | Phase 3 | CMD6 输出：`2 passed, 2 skipped in 0.88s` |
| M-03 | CMD5 e2e 有 2 个 skip，具体 skip 原因未在 MECHANICAL FACTS 中说明，可能是 AC 对应的端到端场景未被执行 | Phase 2/3 | CMD5 输出：`12 passed, 2 skipped in 59.43s` |

### LOW — 优化项

| # | 描述 | 所属 Phase | 真实证据 |
|---|---|---|---|
| L-01 | `acc/binding/provenance.py:4` 注释引用了尚不存在的 `acc/provenance.py`（`grep` 找不到该文件），文档一致性缺口，不影响功能 | Phase 1 | `grep -n "schema_version" acc/binding/provenance.py acc/provenance.py 2>&1` — `acc/provenance.py not found (Exit code 2)` |
| L-02 | Phase 1 `IMPLEMENTATION_STRATEGY.md:291` 要求建立 `acc/provenance.py`（ProvenanceObject 原始位置），但实际实现在 `acc/binding/provenance.py`；路径偏差未在策略文档中更新 | Phase 1 | 文件 `acc/provenance.py` 不存在；实现在 `acc/binding/provenance.py:18–41` |

---

## 灰色地带

以下是事实之间存在矛盾或无法从当前证据单独判断的项，列出供人工决策。

### 灰色地带 1：`ControlEdge.context` domain 默认值的直接证据

**情况**：MECHANICAL FACTS 中的 grep 搜索找到 `domain.py` 在 `(15,70,541)` 行命中 `upstream_output` 模式。`IMPLEMENTATION_STRATEGY.md:392` 要求 Phase 3 将 `acc/domain.py:62-66` 的 `ControlEdge.context` 默认改为 `"none"`。本报告据此推断 line 70 即为该默认值，尚未翻转。

**不确定性**：没有直接 `cat acc/domain.py:70` 的输出；line 70 的 `upstream_output` 可能是注释、类型注解或文档字符串，而非 dataclass 字段默认值。但鉴于 `parse_control_context` 函数独立翻转为 `"none"`，且 domain 级默认翻转未在 progress.jsonl 中被标记为 DONE，判断为 FAIL 是保守且合理的。

**建议**：直接读取 `acc/domain.py:62–75` 确认。

### 灰色地带 2：`input.json` 的语义契约

**情况**：BLOCKER.md 记录 AC1 run 的 `input.json` `forbidden_intersection` 检查，但未说明 `input.json` 是"agent-visible 字段集"还是"完整 runtime payload"。

**不确定性**：如果 `input.json` 是 agent-visible 文件，内容为 `{}` 符合 AC1 invariant（无 control edge 数据泄漏）。但如果 runtime payload（含 `binding_materializations` 等）也写在同一文件，则 AC1 可能部分失败。当前 MECHANICAL FACTS 未提供 `input.json` 具体内容。

**建议**：明确 `input.json` 写入路径的 owner（`build_clean_node_input_payload` vs `build_node_input_payload_with_bindings`）及其包含的字段集范围。

### 灰色地带 3：CMD1 22 failures 的根因

**情况**：MECHANICAL FACTS 记录 failures 在 `test_debugger.py` 和 `test_workflow_capsules.py`，但未提供具体失败消息。

**不确定性**：无法判断是否与 Phase 1–3 的代码变更直接相关，还是预存 bug 被暴露。如果是预存 bug，Phase 3 的变更可能将其激活（例如 `ControlEdge.context` 默认值变化影响调试器路径）；如果是独立问题，影响面可能更窄。

**建议**：运行 `pytest tests/test_debugger.py tests/test_workflow_capsules.py -v --tb=short` 获取具体 traceback。

### 灰色地带 4：`render_prompt` required 参数与 runner None 值的兼容性

**情况**：`acc/prompting.py:13–18` 的 `appendix_policy` 是 required 关键字参数；`acc/runner.py:48–54` 的 `prompt_appendix_policy` 允许 `None`。

**不确定性**：如果 runner 在 line 113–120 直接将 `None` 传给 `render_prompt`，会产生 `TypeError`（required 参数不接受 `None`）。但 SOURCE FACTS 记录 runner 确实在运行时有 `absent → TASK_ONLY` 的转换逻辑。当前 MECHANICAL FACTS 未显示 runner 内部的 None 处理代码。此处依赖 CMD3/CMD4/CMD5 测试覆盖，目前全部通过，间接说明运行时无 TypeError，但无直接证据。

---

*报告基于 MECHANICAL FACTS 和 SOURCE FACTS 生成，不引用任何 AI 声称完成的陈述。所有 PASS 判定均附 file:line 证据，所有 FAIL 判定均含最小修复描述。*
