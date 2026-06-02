# Phase 3 Completion Report

## 结论

Phase 3 的可执行目标已经完成：当前 workflow message routing 的默认路径已经从“隐式全量上游上下文”收敛到显式 binding 优先，旧格式和 legacy 行为通过显式 `legacy_full` 或 importer 兼容路径保留。

本次没有修改以下四个契约文档：`DESIGN.md`、`TEST_PLAN.md`、`IMPLEMENTATION_STRATEGY.md`、`AUDIT_PLAN.md`。

## AC 覆盖

当前落地的是 Phase 2/3 已执行 e2e 子集，不声明覆盖全部 AC01-AC18。

| AC | Marker | 证据 |
| --- | --- | --- |
| AC01 | `T_AC01` | `tests/e2e/test_ac01_control_only_no_data_leak.py:24`, `tests/e2e/test_ac01_control_only_no_data_leak.py:52` |
| AC02 | `T_AC02` | `tests/e2e/test_ac02_explicit_binding_uniquely_decides.py:33`, `tests/e2e/test_ac02_explicit_binding_uniquely_decides.py:95` |
| AC04 | `T_AC04` | `tests/e2e/test_ac04_standalone_equivalence_field_set.py:38`, `tests/e2e/test_ac04_standalone_equivalence_field_set.py:81` |
| AC08 | `T_AC08` | `tests/e2e/test_ac08_upstream_context_opt_in.py:25` |
| AC09 | `T_AC09` | `tests/e2e/test_ac09_no_auto_appendix_when_no_var_ref.py:17` |
| AC11 | `T_AC11` | `tests/e2e/test_ac11_legacy_byte_equivalence.py:19` |
| AC12 | `T_AC12` | `tests/e2e/test_ac12_test_layering_governance.py:11`, `tests/e2e/test_ac12_test_layering_governance.py:23` |
| AC18 | `T_AC18` | `tests/e2e/test_ac18_nested_workflow_boundary_isolation.py:15` |

## 默认值翻转影响

1. `binding_mode`：缺省 workflow metadata 现在解析为 `BindingMode.EXPLICIT_ONLY`，未知值仍回退到 `LEGACY_FULL` 作为兼容逃生口，见 `acc/app/binding_runtime.py:54`。
2. `prompt_appendix_policy`：缺省 workflow/capsule prompt appendix 现在解析为 `PromptAppendixPolicy.TASK_ONLY`，未知值仍回退到 `LEGACY_FULL`，见 `acc/app/binding_runtime.py:70` 与 `acc/runner.py:934`。
3. legacy `.graph.json` import：导入后的 template 会显式写入 `metadata.binding_mode = "legacy_full"`，避免旧图在新默认值下改变语义，见 `acc/legacy_graph_importer.py:209`。
4. `parse_control_context`：计划文本里提到的 `"explicit_only"` 不是当前 `ControlEdge.context` 的合法枚举。代码中合法值只有 `"upstream_output"` 和 `"none"`，因此 Phase 3 实际把缺省值翻为 `"none"`，见 `acc/legacy_graph_importer.py:288`。
5. 示例 `.accflow.json`：会依赖旧语义的示例 workflow 已显式声明 `metadata.binding_mode = "legacy_full"`，包括 `callable_*`、`environment_stateful_demo`、`nested_environment_demo`、`stateless_template_demo`、`ideal_layering_*`。

## 主要修改

- 新增 Phase 3 e2e：AC08/AC09/AC11/AC12/AC18，覆盖显式 upstream context opt-in、prompt appendix 默认不泄漏、legacy fixture 可执行、marker governance、nested boundary isolation。
- 新增 baseline freeze 工具：`scripts/freeze_phase1_baselines.py:21` 定义输出根目录，`scripts/freeze_phase1_baselines.py:118` 提供 CLI 入口，`scripts/freeze_phase1_baselines.py:120` 支持 `--clean`。
- `CapsuleRunner.run` 支持调用方显式传入 `prompt_appendix_policy`，避免 workflow 层只能依赖 capsule metadata，见 `acc/runner.py:54` 与 `acc/runner.py:117`。
- 旧的 `collect_upstream_context` 迁入 `acc/binding/legacy.py:18`，app 层只保留 R-7 rollback shim，见 `acc/app/node_invocation.py:102`。
- provenance public schema 固定为 version 1，后续 bump 需要 migration plan，见 `acc/binding/provenance.py:30`。
- legacy byte-equivalence 测试补充 `output_bytes` canonicalization，避免临时目录长度变成快照契约，见 `tests/migration/test_legacy_full_byte_equivalence.py:82` 与 `tests/migration/test_legacy_full_byte_equivalence.py:115`。

## Browser E2E 对比

旧 blocker 记录在 `tests/e2e/browser/_artifacts/progress.jsonl`：

- `status = fail_blocking`
- `forbidden_intersection = ["inbox", "node", "upstream_context", "workflow"]`
- `upstream_context_count = 1`
- `has_output_summary = true`
- `has_output_inline = true`

Phase 3 复测走 Workbench 的实际代理路径：

- 页面：`http://127.0.0.1:5173`
- API：`/api/workflows/run-graph`
- fixture：`tests/fixtures/redesign/ac01_control_only.accflow.json`
- run dir：`runs/browser_phase3_ac1_1780256983411`
- B 节点 `input.json`：`{}`
- forbidden intersection：`[]`
- console errors：`0`
- failed requests：`0`
- screenshot：`tests/e2e/browser/_artifacts/browser_phase3_ac1_1780256983411_ac1.png`

这说明旧 AC1 blocker 的核心泄漏路径已经消失：control edge 缺省不会把上游 output、inbox 或 runtime control context 注入下游 agent-visible input。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `.venv/Scripts/python.exe -m pytest -x -q --no-header -m "not slow and not legacy and not performance"` | `485 passed, 14 skipped` |
| `.venv/Scripts/python.exe -m pytest tests/e2e/ -v` | `14 passed` |
| `.venv/Scripts/python.exe -m pytest tests/migration/ -v` | `5 passed, 2 skipped` |
| `.venv/Scripts/python.exe -m pytest tests/architecture/ -v` | `16 passed` |
| Playwright Workbench/API AC1 check | API `200`, B input `{}`, forbidden intersection `[]` |

运行中仍有 pytest warnings，主要来自现有 marker 注册/collection 相关警告；本轮未把 warning cleanup 作为 Phase 3 修改范围。

## Deferred Q3 / Q12

`DESIGN.md` §15 的两个问题仍按原结论延后，不在 Phase 3 扩范围：

- Q3：内置 `aggregation` capsule 类型延后到 Phase 4；当前仍使用用户 capsule 加 `workflow_output_bindings` 表达 final summary。
- Q12：standalone 路径是否把用户输入 wrap 为 `{"task": ...}` 延后到 Phase 4；当前 AC4 仍以“编排 metadata 字段集不变量”为验证目标，而不是强制 standalone/workflow 顶层结构字节同构。

## 风险边界

- `uv run` 在当前机器上会尝试更新被锁定的 `.venv/Scripts/acc.exe`，因此本轮验证统一使用 `.venv/Scripts/python.exe -m pytest`。
- 当前报告只说明已执行的 Phase 2/3 e2e 子集，不等价于所有未来 AC 都已有端到端覆盖。
- 旧 `.graph.json` 的语义保留依赖 importer 显式写入 `legacy_full`；如果未来绕过 importer 直接构造 template，需要同样明确 metadata 或接受新默认 `explicit_only`。
