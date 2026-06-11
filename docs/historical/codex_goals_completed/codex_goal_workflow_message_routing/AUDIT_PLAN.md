# AUDIT_PLAN.md — Workflow Message Routing 重构审计方案

> **Scope**：本文件是 `docs/codex_goal_workflow_message_routing/DESIGN.md` v0.2 提出的 "Binding-First Result Store with Layered Provenance" 三阶段重构（Phase 1–3）的代码审计计划。它与 `TEST_PLAN.md`（接受性用例 T-AC1 ~ T-AC17）互补：测试回答 **"现网行为是否满足契约"**，审计回答 **"代码是否在层次、类型、并发、安全、可维护等多维度上守得住契约"**。
>
> **Status**：`v0.1 — initial draft`，对齐 RECON / PRIMITIVES / REFACTOR-STRATEGY 三份输入。
>
> **Audience**：ACC 维护者（designer / reviewer / executor）、Workbench 前端工程师、CI 治理负责人、CCB peer review 流程的 codex reviewer。

---

## 1. 摘要

### 1.1 目标

把 DESIGN.md §14 的 18 条接受性条款（AC1–AC18）和 §15 的 16 条开放问题（Q1–Q16）拆解为 **≥45 条可执行审计 check**，按 10 个维度分组、四级严重度分级，并给出自动化工具栈、人工 review 流程、上线门和 CCB peer review 对接方案。

### 1.2 十个审计维度

| Dimension | 关注点 | DESIGN 锚点 | Check 数 |
|---|---|---|---|
| `correctness` | AC1–AC18 + 边界用例（empty fan-out / cycle / missing artifact / hash mutual exclusion） | §14 全部 | 18 |
| `layering` | 8 层 boundary 守护（`acc/binding`、`acc/result_store`、`acc/runtime`、`acc/persistence`、`acc/scheduler`、`acc/adapters`、`acc/app`、`acc/server`） | §13、boundaries 表 | 11 |
| `type_safety` | mypy --strict 全量过；ProvenanceObject / Binding / Selector / Identity / TransferPolicy 全部 typed | §7.1、§7.2、Q13 | 8 |
| `error_handling` | 命名异常（BindingResolutionError / CrossRunReferenceError / SelectorParseError / MissingNodeResultError / ArityMismatchError / AggregationFailedError）、原子写、reconciler 分类 | §11.2、§11.4 | 7 |
| `concurrency` | permit 释放、ApprovalBarrier 独占 level、跨 run 隔离、gather 异常聚合、RunManifest 串行写 | §11.1、§11.3 | 8 |
| `security` | AC3 默认 deny、ENV uniformity、cross-run 拒绝、相对路径、whitelist allow-list-only、Workbench 警示 | §10、AC3、AC5、AC10、AC16 | 8 |
| `performance` | ReadySet O(E+V)、ResultStore 缓存、InlineThreshold=256 KiB、Windows fallback 顺序、并发开销 | §11、Q10 | 7 |
| `migration` | LegacyPassthroughBinding 注入、AC11 + AC15 字节级、capsule 回退、@legacy lane、迁移脚本幂等 | §12、AC11、AC15 | 8 |
| `observability` | events.jsonl 完备、binding_resolved / materialization_degraded / pause / resume 事件、Workbench AC10 投影 | §10、AC10、AC17 | 8 |
| `maintainability` | DEFAULT_PORT_ID、InlineThreshold、`# DEPRECATED:` 标注、死代码清理、命名一致性 | smell §1–§7 | 9 |
| **合计** | | | **92** |

> **解读**：92 条覆盖 DESIGN.md 的全部 AC 与策略性 risks；平均每个 AC 大致映射到 5 条审计（AC + 多维度补强），即"测试 1 条覆盖正向语义，审计 4–5 条覆盖 negative space + 抗腐化"。

### 1.3 严重度分级

| Severity | 含义 | 上线门策略 |
|---|---|---|
| `critical` | 违反任一条即视为阻断上线，且必须在阶段退出准则中显式覆盖（PR 不可合并） | 0 项允许遗留 |
| `high` | 下一阶段开始前必须修复，否则不得开新阶段；当前阶段可在 issue 跟踪下临时合并，但需标 `tech-debt-must-fix-by-<phase>` | 0 项 open（已合 Phase 退出） |
| `medium` | 跟踪型债务，不阻断阶段切换，但需在 12 周内闭环；周报上汇总未闭项 | ≤ 5 项 open |
| `low` | nice-to-have，不阻塞任何门 | 不限 |

### 1.4 自动化覆盖率目标

| Phase | 自动化条目占比 | 备注 |
|---|---|---|
| Phase 1 退出 | ≥ 80%（74/92） | 工具链就绪：mypy、ruff、pytest、import-linter、coverage |
| Phase 2 退出 | ≥ 88%（82/92） | 加 hypothesis property test、bandit、pytest-benchmark |
| Phase 3 退出 | ≥ 92%（90/92） | 加 vulture（dead code）、front-end component test |
| 永久人工 | 2 项（lineage replay、workspace write_lock 调用面 review） | 由 reviewer 角色每阶段必走一次 |

> **不可自动化的 2 项明列**：`observability` 1 项（O-006 lineage 链可重放，需人类判断 events.jsonl 重建链路完整性）、`concurrency` 1 项（N-008 workspace write_lock 调用面 review，需人工核查锁获取站点）。其余原本被标 *manual* 的 5 项（L-008 / S-008 / M-004 / M-008 / P-002）已通过 P-018 重新分类为自动化（import-linter / vitest component test / CI grep / unit cache-hit assertion）。

### 1.5 文档结构总览

§2 列出全部 92 条 check（按维度组织）；§3 自动化工具栈；§4 人工 review 流程；§5 AC 验收与审计的关系；§6 上线门；§7 与 CCB peer review 对接（如何把本清单作为 codex Rubric 输入）。

---

## 2. 各维度审计 checklist

> **格式**：每条包含 `check / severity / automated / tool_or_method`，并尽可能引用 `T-NNN`（来自 TEST_PLAN.md）以建立审计 ↔ 测试映射关系。

### 2.1 Correctness（18 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| C-001 | **AC1**：仅 ControlEdge 连接 A→B（无 DataEdge）时，B 的 `agent_payload` 不含 A 的 `output_summary` / `output_inline` / `inbox.records`。 | critical | true | `pytest tests/integration/test_explicit_binding_matrix.py::test_T_AC1_control_only_no_data_leak` |
| C-002 | **AC2**：`AgentPayload` 的每个 key 必须能追踪到一个 declared NodeInputBinding/WorkflowInputBinding/DataEdge 或 ExposeMetadataFlag whitelist；orphan key 在 `binding_mode=explicit_only` 下 fail-fast。 | critical | true | `pytest -m T_AC2` + `BindingResolver.assemble_agent_payload` 内部 assertion |
| C-003 | **AC3**：`ProvenanceObject` 字段集合 `{producer_session_id, bundle_id, binding_applied, call_depth, materialization_mode_resolved, parent_frame_id, invoking_workflow_call_id}` 与 `keys(input.json)` 交集为空，与 `tokens(resolved_prompt.md)` 交集也为空（非 opt-in 节点）。 | critical | true | `pytest tests/integration/test_provenance_isolation.py::test_T_AC3_field_set_scan` |
| C-004 | **AC4**：workflow 模式下 `AgentPayload` top-level keys 与 `{node, workflow.input, upstream_context, inbox.records, __acc_control_context}` 交集为空（非 opt-in 节点）；声明的 binding 字段允许出现。 | critical | true | `pytest tests/integration/test_standalone_equivalence.py::test_T_AC4_field_set_invariant` |
| C-005 | **AC5**：`BindingResolver` 对每条 selector 强制断言 `source_run_id == current_run_id`；并发 run 之间 NodeResult 不可见。 | critical | true | `pytest tests/integration/test_pause_resume.py::test_T_AC5_cross_run_reject` + concurrent two-run race |
| C-006 | **AC6**：pause/resume 时 skip 决策依赖 `run_manifest.completed_nodes` + `binding_materializations` checkpoint；checkpoint 缺失则即使 outbox 文件存在也重跑。 | critical | true | `pytest tests/integration/test_pause_resume.py::test_T_AC6_torn_write_rerun` |
| C-007 | **AC7**：`workflow_output_bindings.source.node_id` 必须指向 aggregation-kind 节点；runtime 禁止"末端节点 = workflow output"的隐式推断。 | high | true | `pytest tests/integration/test_aggregation_and_fan_in.py::test_T_AC7_explicit_aggregation` + workflow validator unit test |
| C-008 | **AC8**：`binding_mode=explicit_only` 下，节点看到 `upstream_context` 当且仅当 `acc_expose_upstream_context=true` 或 `acc_expose_workflow_metadata` 列出；默认 deny。 | high | true | `pytest -m T_AC8` + AgentPayload 装配断言 |
| C-009 | **AC9**：`render_prompt` 默认不自动追加 `input_payload`；模板若不引用任何 `{{var}}`，渲染输出与模板源相等（byte-equal）。 | high | true | `pytest tests/unit/test_prompting.py::test_T_AC9_no_auto_appendix_when_no_var_ref` |
| C-010 | **AC11 + AC15**：capsule 无 `prompt_appendix_policy` + workflow 默认 `binding_mode=mixed` 时，`resolved_prompt.md` 与 Phase-1 baseline 字节级相等。 | high | true | `pytest tests/integration/test_legacy_byte_equivalence.py::test_T_AC11_AC15_golden_baseline` |
| C-011 | **AC13**：`ProvenanceObject` schema validation：每个持久化对象 round-trip 通过；缺失必填字段抛 schema 错误。 | high | true | `pytest tests/unit/test_provenance.py::test_T_AC13_schema_roundtrip_and_reject` |
| C-012 | **AC14**：`ResultStore` 查询 `(run_id, node_id, port_id)` 命中唯一 ArtifactBundle；多端口节点不互相干扰。 | high | true | `pytest tests/unit/test_result_store.py::test_T_AC14_addressable_lookup` |
| C-013 | 边界：empty fan-out（arity 0）下游 aggregator 看到 `[]` 而非异常；PartialAggregate=strict 默认仍允许该退化。 | medium | true | `pytest tests/integration/test_aggregation_and_fan_in.py::test_fan_out_arity_zero` |
| C-014 | 边界：ControlEdge 出现环路时 graph compile 阶段 fail，并列出 cycle 中的 node id；不允许 runtime 才报错。 | high | true | `pytest tests/unit/test_workflow_graph.py::test_cycle_rejection_lists_nodes` |
| C-015 | 边界：referenced ArtifactBundle 在解析与读取之间被删除时，抛出命名 `BindingResolutionError`，不是裸 `FileNotFoundError` / `KeyError`。 | high | true | `pytest tests/unit/test_binding_resolver.py::test_artifact_disappears_typed_error` |
| C-016 | hash class 互斥：每条 `BindingMaterializationRecord` 中 `inline_value_sha256` 与 `source_artifact_sha256` 恰好一个非空。 | high | true | schema 约束 + `pytest tests/unit/test_provenance.py::test_hash_mutual_exclusion` |
| C-017 | **AC18**：`WorkflowCallInputBinding` 边界，nested workflow 仅看到显式 binding 命名的字段；parent 的 `upstream_context` 默认不跨界。 | critical | true | `pytest -m T_AC18 tests/integration/test_nested_workflow_isolation.py` |
| C-018 | `EachOfFanInSelector` 顺序：返回 list 按 `instance_index` 排序，与完成顺序无关；replay 顺序一致。 | medium | true | `pytest tests/integration/test_aggregation_and_fan_in.py::test_each_of_deterministic_order` |

### 2.2 Layering（11 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| L-001 | `acc/binding/`（BindingResolver + selector）禁止 import `acc.server` / `acc.cli` / `acc.app` / `acc.scheduler` / `acc.runtime` / `acc.adapters` / `fastapi` / `typer`。 | critical | true | `import-linter` contract + `tests/architecture/test_import_boundaries.py` 扩展 |
| L-002 | `acc/result_store/` 禁止 import `acc.server` / `acc.cli` / `acc.app` / `fastapi` / `typer`；只允许入向依赖 `acc.domain` / `acc.persistence` / `acc.binding`。 | critical | true | `import-linter` contract |
| L-003 | `acc/provenance.py`（Phase 3 may relocate to `acc/binding/provenance.py`）禁止 import `acc.store` / `acc.app` / `acc.server` / `acc.runner` / `fastapi` / `typer` / `subprocess`。 | high | true | `import-linter` + AST 扫描 in `tests/architecture` |
| L-004 | `acc/runtime/`（frame / fan_out / partial_aggregate / approval / payload / transfer_policy）禁止 import `acc.app` / `acc.cli` / `acc.server` / `acc.store`；FastAPI 与 Typer 严禁。 | high | true | `import-linter` 扩展 |
| L-005 | `acc/domain.py` 与 `acc/engine/` 保持纯：禁用 FS/process 原语（`open` / `read_text` / `write_text` / `mkdir` / `unlink` / `copy2` / `copytree` / `subprocess.run` / `Popen`）。 | critical | true | 现有 AST 扫描 `tests/architecture/test_import_boundaries.py:95-110` 扩展覆盖新模块 |
| L-006 | Adapter 模块（`acc/adapters/*`）禁止 import `acc.app` / `acc.server`；`AgentRuntimeEnv` 装配仅在 adapter base 层。 | high | true | `import-linter` contract |
| L-007 | `schemas/` 仅 JSON：`capsule_template_schema.json` 与 `workflow_graph_v3_schema.json` 不得引入 Python 文件。 | low | true | manual review + `find schemas -name '*.py'` 应为空 |
| L-008 | Workbench projection 层（`acc/server/run_projection.py` 扩展）只消费 ResultStore / RunManifest 公共读 API，不触及 BindingResolver 内部。 | medium | true | `import-linter` contract or AST scan: `run_projection.py` imports only `acc.result_store` / `acc.persistence` 公共 re-exports |
| L-009 | `acc/persistence/` 禁止 import `acc.server` / `acc.app` / `acc.cli` / `acc.runtime` / `fastapi` / `typer`（persistence purity）。 | high | true | `import-linter` contract |
| L-010 | `acc/scheduler/` 禁止 import `acc.app` / `acc.cli` / `acc.server` / `fastapi` / `typer`（scheduler purity）。 | high | true | `import-linter` contract |
| L-011 | `acc/app/*` 仅可 import 各下层 `__init__.py` 公共导出；禁止下划线开头符号（app private-symbol ban）；私有符号清单来自 STRATEGY public_api L221-L226。 | medium | true | 自定义 AST scan in `tests/architecture/` |

### 2.3 Type Safety（8 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| T-001 | `ProvenanceObject` 是 frozen dataclass（或 Pydantic model），全部字段类型显式；不得使用 `Any` 或 `dict[str, Any]`。 | critical | true | `mypy --strict acc/provenance.py` |
| T-002 | `NodeInputBinding` / `NodeOutputBinding` / `WorkflowInputBinding` / `WorkflowOutputBinding` / `WorkflowCallInputBinding` / `LegacyPassthroughBinding` 全部具备 typed selector 和 materialization；不得用 `Any`。 | critical | true | `mypy --strict acc/domain.py` |
| T-003 | `BindingResolver.resolve(node_id, run_id) -> BindingResolverResult` 全链 typed；`AgentPayload` 与 `RuntimePayload` 是 TypedDict 或 dataclass，不得是裸 dict。 | high | true | `mypy --strict acc/binding/` |
| T-004 | `NamespaceSelector` ADT 暴露 `parse(str) -> Selector`，discriminated union `{FieldSelector, OutboxSelector, ArtifactSelector, EachOfSelector}`；mypy 在 dispatch 上做穷举检查。 | high | true | `mypy --strict` + `assert_never` sentinel in resolver dispatch |
| T-005 | `RunId` / `NodeId` / `PortId` / `FrameId` / `InvokingWorkflowCallId` 使用 `NewType` 别名（或 branded types）+ 中央校验函数；裸 `str` 不得传入 expects 这些类型的签名。 | high | true | `mypy --strict` + grep `: str` 在 identity-typed 签名 |
| T-006 | `TransferPolicy` 是 `Enum`（不是 `Literal[str]`）；`materialization_mode_resolved` 字段使用同一 Enum。 | medium | true | `mypy --strict` + isinstance 检查 in tests |
| T-007 | `acc/result_store/` 的公共 API 返回值不含 `Any`；查询返回 typed `NodeResult` dataclass，路径字段标注为 relative-path 别名。 | high | true | `mypy --strict acc/result_store/ --disallow-any-generics` |
| T-008 | `BindingMode` 与 `PromptAppendixPolicy` 是 `Enum`，不是裸 string；capsule / workflow 加载器在 load-time 完成 parse-validate。 | medium | true | `mypy --strict` + JSON schema enum 约束 |

### 2.4 Error Handling（7 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| E-001 | `acc/binding/` / `acc/result_store/` / `acc/runtime/` / `acc/persistence/` 中不得出现裸 `except:` 或不带 re-raise/logging 的 `except Exception:`。 | high | true | `ruff E722` + 自定义 AST lint |
| E-002 | BindingResolver 失败路径使用命名异常：`BindingResolutionError` / `CrossRunReferenceError` / `SelectorParseError` / `MissingNodeResultError` / `ArityMismatchError` —— 每个带唯一错误码。 | high | true | manual review + grep `class .*\(AccError\)` |
| E-003 | TransferPolicy fallback（Windows reference→copy on `OSError`）只 catch 具体 `OSError`，不得 catch `BaseException`；`degraded=true` 在返回前已记录、event 已发出。 | high | true | `pytest tests/integration/test_windows_fallback.py::test_only_oserror_caught` |
| E-004 | RunManifest 原子写：使用 temp-file + rename；rename 失败时旧版本保留，并显式抛错 —— partial JSON 永不持久化。 | critical | true | `pytest tests/unit/test_run_manifest.py::test_atomic_write_rollback_on_rename_failure` |
| E-005 | CrashReconciler 通过 `pause_marker` 区分 crashed vs paused；缺 `pause_marker` 且非终态 → 判 crashed；不得静默地把 paused 改成 crashed。 | critical | true | `pytest tests/unit/test_run_manager.py::test_reconciler_distinguishes_paused` |
| E-006 | Selector grammar parser 在 workflow load-time 拒绝未知 namespace（如 `legacy:` / 裸 `.path`），错误带行/列信息；不得延后到 binding 解析时。 | medium | true | `pytest tests/unit/test_selector_parser.py::test_malformed_at_load_time` |
| E-007 | EachOfFanInSelector readiness：在 `PartialAggregate=strict` 下任一 upstream 失败时抛单一 typed `AggregationFailedError`，并附失败 indices。 | medium | true | `pytest tests/integration/test_aggregation_and_fan_in.py::test_strict_failure_propagation` |

### 2.5 Concurrency（8 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| N-001 | `ConcurrencyPolicy` permit 在所有终态 NodeStatus 转移（success / failed / cancelled / skipped）+ 异常路径释放，永不泄漏。 | critical | true | `pytest tests/unit/test_scheduler.py::test_permit_release_on_all_terminal_paths` + permit-counter 断言 |
| N-002 | `ApprovalBarrier` 独占其 topological level：激活期间同 level 无其他节点执行 —— 通过 events.jsonl 的 timestamp 交错验证。 | high | true | `pytest tests/integration/test_approval_barrier.py::test_level_monopoly_via_event_timeline` |
| N-003 | Per-run 隔离：同一 workflow 的两个并发 run 不共享 scheduler / permit 状态；取消 A 不影响 B（**T-AC8**）。 | critical | true | `pytest -m T_AC8 tests/integration/test_concurrent_runs_isolation.py` |
| N-004 | `asyncio.gather` fan-in 收集每分支异常（`return_exceptions=True` 或显式 per-task try/except）；单分支失败不孤立未完成兄弟。 | high | true | `pytest tests/unit/test_clean_workflow_engine.py::test_fan_in_failure_does_not_orphan_siblings` |
| N-005 | RunManifest 写串行化（per run_id 一个 writer）；并发 `CompletedNodeRecord` append 通过 per-run async lock 或原子-rename merge 合并。 | high | true | `pytest tests/unit/test_run_manifest.py::test_concurrent_node_finish_no_record_loss` |
| N-006 | CancelSignal 仅在 level boundary 轮询；运行中节点不被中段抢占；`cancel_requested` marker 幂等。 | medium | true | `pytest tests/integration/test_cancel_during_running.py::test_no_mid_node_preemption` |
| N-007 | BindingResolver 可重入：同一 `(run_id, node_id)` 两次解析产生相同 `binding_manifest` 行（重试幂等）。 | medium | true | `pytest tests/unit/test_binding_resolver.py::test_double_resolve_idempotent` |
| N-008 | Workspace `write_lock` per `environment_id`：同一 env 内任何文件写入前必先获取该 lock。 | high | false | manual review of `acc/app/__init__.py:528,560` 锁获取站点 |

### 2.6 Security（8 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| S-001 | `AgentPayload` 字段集扫描：provenance 字段、`FrameId` / `CallDepth` / `InvokingWorkflowCallId` 永不出现在 agent-visible `input.json` 或 `resolved_prompt.md`（**AC3**）。 | critical | true | `pytest -m T_AC3` + 全 runs/<run_id>/nodes/* 扫描 |
| S-002 | `PromptAppendixPolicy=task_only` 排除 orchestration metadata（`{node, workflow.input, upstream_context, inbox.records, __acc_control_context}`）出现在自动 appendix 块中。 | high | true | `pytest -m T_AC15 tests/unit/test_prompting.py::test_task_only_excludes_orchestration_metadata` |
| S-003 | ENV 泄漏审计：`ACC_RUN_ID` / `ACC_RUN_DIR` / `ACC_INBOX_DIR` / `ACC_OUTBOX_DIR` / `ACC_ENVIRONMENT_ID` / `ACC_NODE_ID` 在 codex_cli / claude_sdk / generic_cli 三 adapter 一致；不得有额外 stray `ACC_*`。 | high | true | `pytest tests/unit/test_adapter_env_contract.py::test_uniform_six_var_set` + `os.environ.copy()` 路径 review |
| S-004 | 跨 run 读禁止：BindingResolver 任何 `source_run_id != current_run_id` 抛 `CrossRunReferenceError`；不得静默退化为空结果。 | critical | true | `pytest -m T_AC5` + 断言 log 扫描 |
| S-005 | 持久化 JSON（`run_manifest.json` / `binding_manifest.json` / `input.json` / `outbox_manifest.json`）禁出现绝对路径；只允许 relative-to-`run_dir`（**AC16**）。 | high | true | `pytest tests/integration/test_path_relativity.py::test_no_absolute_paths_in_persisted_json` 扫描 runs/<run_id>/ 全部 JSON |
| S-006 | `ExposeMetadataFlag` whitelist 只支持 allow-list；空 list = zero exposure；不支持 deny-list 语义。 | medium | true | `pytest tests/unit/test_expose_metadata_flag.py::test_empty_whitelist_zero_exposure` |
| S-007 | capsule manifest 不能通过 `expose_*` flag 绕过 `BindingMode=explicit_only` 的 binding-required 规则；flags 仅影响 orchestration metadata，不影响未绑定 upstream 数据。 | high | true | `pytest tests/integration/test_explicit_only_unbound_data_rejected.py` |
| S-008 | Workbench projection 在节点上任何 `acc_expose_*=true` 时显示可见警示 banner（**AC10**）。 | medium | true | front-end component test (vitest) gates the visual; manual UX review reduces to optional |

### 2.7 Performance（7 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| P-001 | ReadySet 计算最坏 O(E + V) per level；不得 O(V²) over node count；使用 `acc/workflow_graph.py:375-404` 预算的 ancestor mask。 | high | true | `pytest tests/perf/test_ready_set_benchmark.py` 1000-node graph + `pytest-benchmark` 阈值 |
| P-002 | BindingResolver 不重复读盘 NodeResult；in-memory ResultStore cache by `(run_id, node_id, port_id)`，同 run 多 binding 复用。 | medium | true | unit test: cache-hit counter assertion (`pytest tests/unit/test_result_store.py::test_cache_hit_counter`) |
| P-003 | InlineThreshold=256 KiB 强制执行：payload > threshold 必须 `TransferPolicy=reference`（或 platform fallback 到 copy）；BindingResolver 强制 coerce 并通过 `materialization_mode_resolved` 记录。 | high | true | `pytest tests/integration/test_inline_threshold.py::test_payload_over_threshold_forces_reference` |
| P-004 | TransferPolicy on Windows 优先级：reference → symlink → copy（无 SeCreateSymbolicLinkPrivilege 时）；非 Windows：按 declared preference。 | medium | true | `pytest tests/integration/test_windows_fallback.py::test_preference_order_with_mocked_env` |
| P-005 | Per-level `asyncio.gather` 扩展性：16 并发节点（CC parity 默认）相对 1 并发 baseline 时间增长 < 5%（semaphore 开销）。 | medium | true | `pytest-benchmark` mock `execute_clean_node` + concurrency=1 vs 16 比率 |
| P-006 | RunManifest 原子写不对整个 `run_dir` 做 fsync；只 fsync temp file + rename；per-node checkpoint < 5 ms。 | low | true | `pytest-benchmark` on RunManifest writer |
| P-007 | `EachOfFanInSelector` 解析 O(N) over fan-out arity，不是 O(N×M) over total node 数。 | medium | true | `pytest-benchmark` arity=100 fan-out |

### 2.8 Migration（8 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| M-001 | Legacy `ControlEdge.context='upstream_output'` 在 `legacy_graph_importer` 自动注入 `LegacyPassthroughBinding`；importer 标记 `graph.legacy=true`。 | critical | true | `pytest -m T_AC11 tests/integration/test_legacy_graph_importer.py::test_legacy_passthrough_injected` |
| M-002 | `binding_mode=legacy_full` 保持与 Phase-1 baseline 字节级 `input.json` 字段集相同（**AC11**）。 | critical | true | `pytest tests/integration/test_legacy_byte_equivalence.py::test_T_AC11_golden_diff_against_phase1` |
| M-003 | capsule manifest 无 `prompt_appendix_policy` 字段时 runtime 解释为 `legacy_full`；loader 不得静默写入缺省值（保留缺省即 legacy）。 | high | true | `pytest -m T_AC15 tests/unit/test_capsule_manifest_loader.py::test_missing_field_runtime_default_legacy` |
| M-004 | Legacy 字段 `acc_receive_upstream_context` 与 `acc_upstream_context_fields` 在迁移期保持可用；`acc/app/__init__.py:912-916, 1379-1391` 标 `# DEPRECATED:` 注释指明 legacy lane only。 | high | true | CI: `grep '#DEPRECATED' acc/app/__init__.py:912-916,1379-1391` markers |
| M-005 | Legacy lane 测试打 `@pytest.mark.legacy`，独立 CI lane 运行（**AC12** 治理项）；主 lane 至少包含 AC1/AC2/AC4/AC5/AC6/AC8/AC9。 | high | true | CI 配置审计 + `pytest --markers` 检查 |
| M-006 | Phase 3 的 `tools/migrate_graph_to_explicit_binding.py` 输出确定：扫描 `.graph.json` 产生 `data_edges` + `acc_expose_*` + `binding_mode=mixed`，重复运行幂等。 | medium | true | `pytest tests/integration/test_migration_script.py::test_idempotency` + golden-output diff |
| M-007 | `DEFAULT_POLICY` 重复（`acc/workflow_graph.py:25` 与 `acc/legacy_graph_importer.py:22`）合并为一处；翻转 `max_concurrency` 默认只改一处。 | medium | true | grep + dead-import 扫描 |
| M-008 | Phase 3 默认翻转（`binding_mode=explicit_only`）由单一配置开关控制；回退到 `mixed` 不需要 schema 变更。 | high | true | CI: grep default `binding_mode` literal, count == 1 |

### 2.9 Observability（8 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| O-001 | `events.jsonl` 为每个执行节点 emit `node_scheduled` / `node_started` / `node_finished`；缺一即测试失败。 | high | true | `pytest tests/unit/test_events.py::test_event_completeness_per_node` 扫描 `events.jsonl` |
| O-002 | `events.jsonl` 为 `binding_manifest.json` 中每条 binding emit `binding_resolved`（1:1 对应）。 | medium | true | `pytest tests/unit/test_events.py::test_binding_resolved_count_match` |
| O-003 | `events.jsonl` 在 `materialization_mode_resolved` 与 declared 不同时 emit `materialization_degraded`（**AC17**）。 | high | true | `pytest -m T_AC17 tests/integration/test_windows_fallback.py::test_event_emitted_on_degradation` |
| O-004 | `events.jsonl` 在 `ApprovalBarrier` 暂停 / 恢复时 emit `run_paused` / `run_resumed`；进程重启后 resume 可正确 replay。 | medium | true | `pytest tests/integration/test_pause_resume.py::test_event_replay_after_restart` |
| O-005 | RunManifest 写原子（temp+rename）；并发读取者永不见 torn JSON。 | critical | true | `pytest tests/unit/test_run_manifest.py::test_concurrent_reader_torn_jail` 1000 次写循环 + reader thread |
| O-006 | `ProvenanceObject` lineage 链（`parent_frame_id`, `invoking_workflow_call_id`, `call_depth`）只用 `events.jsonl` 即可重建 —— 无需 in-memory 状态。 | medium | false | manual review + replay tool spike |
| O-007 | Workbench RunInspector projection 暴露 Resolved Prompt + Applied Bindings + ProvenanceSummary toggle + materialization_degraded badge（**AC10**）。 | high | true | front-end component test for AC10 + `acc/server/run_projection.py` 契约测试 |
| O-008 | Trace IDs（`run_id`, `node_id`, `frame_id`）出现在每条 event line —— 无 event 缺失身份上下文。 | medium | true | `pytest tests/unit/test_events.py::test_event_schema_validator` |

### 2.10 Maintainability（9 条）

| # | check | severity | automated | tool_or_method |
|---|---|---|---|---|
| MN-001 | 默认端口名 `"main"` 集中为 `acc/domain.py` 中的 `DEFAULT_PORT_ID` 常量；24 处分散字面量已替换。 | medium | true | `grep '"main"' acc/` 限于 1 处定义 |
| MN-002 | `MAX_UPSTREAM_CONTEXT_INLINE_BYTES`（`acc/app/node_invocation.py:11`）迁至专用 `InlineThreshold` 模块；BindingResolver 与 TransferPolicy 共享同一常量。 | medium | true | grep 重复定义扫描 |
| MN-003 | 弃用的 `ControlEdge.context` 字段携带 `# DEPRECATED: legacy compat only, use LegacyPassthroughBinding for new code` 注释（`acc/domain.py:11,66`）。 | low | true | grep `# DEPRECATED` + AST docstring 扫描 |
| MN-004 | `acc/binding/` / `acc/result_store/` / `acc/provenance.py` 公共 API 每个导出类与函数有 docstring；`ruff` D-rules 通过。 | low | true | `ruff --select D acc/binding/ acc/result_store/ acc/provenance.py` |
| MN-005 | 重构产生的死代码清理：`acc/app/node_invocation.py` 旧 `build_clean_node_input_payload` + `collect_upstream_context` + `collect_workflow_input_context` 在 BindingResolver 上线后移除；无孤儿 helper。 | medium | true | `vulture acc/` + 限于 refactor scope 的 manual review |
| MN-006 | 重复 `__acc_control_context` magic-key 检查（`acc/app/node_invocation.py:169-170` + `acc/app/workflow_call.py`）合并到单一 helper 或 typed-binding 迁移后整体移除。 | medium | true | `grep '__acc_control_context' acc/` 限于 1 处定义 |
| MN-007 | 重复的 `summarize_upstream_output`（`acc/app/workflow_call.py:160-165` vs `acc/app/node_invocation.py:149-154`）合并到单一 location。 | low | true | grep + LSP `findReferences` |
| MN-008 | 命名一致性：`ProvenanceObject` 字段名与 DESIGN §7.2 字面相符（`producer_session_id` / `frame_id` / `parent_frame_id` / `call_depth` / `invoking_workflow_call_id` / `inline_value_sha256` / `source_artifact_sha256` / `materialization_mode_resolved` / `binding_applied` / `upstream_lineage`）；无 legacy alias。Cross-ref: DESIGN §7.2 (post-patch P-001 includes the `invoking_workflow_call_id` field). | low | true | schema 字段名 diff vs DESIGN.md |
| MN-009 | rename sweep：`WorkflowNodeResult`（debugger event 类，`acc/debugger.py:44`）改名为如 `WorkflowNodeTraceEvent`，避免与新 `NodeResult` 原语冲突。 | medium | true | grep + LSP rename + import-test pass |

---

## 3. 自动化工具栈

### 3.1 静态分析

| 工具 | 用途 | 命令 | 阶段就绪 |
|---|---|---|---|
| `mypy --strict` | 类型安全（T-001 ~ T-008） | `python -m mypy --strict acc/binding acc/result_store acc/runtime acc/persistence acc/provenance.py acc/domain.py` | Phase 1 |
| `ruff` | lint + format + 部分代码味道（E722 等） | `python -m ruff check acc/ tests/` + `python -m ruff format --check acc/ tests/` | Phase 1 |
| `ruff --select D` | docstring 规范（MN-004） | `python -m ruff check --select D acc/binding/ acc/result_store/ acc/provenance.py` | Phase 1 |
| `import-linter` | layer boundary（L-001 ~ L-006） | `python -m importlinter --config .importlinter` | Phase 1（新增 contract 文件 `.importlinter`） |
| `bandit` | 安全扫描（S-005 路径泄漏辅助） | `python -m bandit -r acc/ -ll` | Phase 2 |
| `vulture` | 死代码（MN-005） | `python -m vulture acc/ --min-confidence 80` | Phase 2 |

### 3.2 运行时验证

| 工具 | 用途 | 命令 |
|---|---|---|
| `pytest` | 单元 / 集成 / 架构测试主入口 | `pytest -q --strict-markers` |
| `pytest -m legacy` | legacy lane（M-005） | `pytest -m legacy --maxfail=1` |
| `pytest -m "not legacy"` | 主 lane | `pytest -m "not legacy" --maxfail=1` |
| `pytest --cov` | 覆盖率（目标 ≥ 85% on `acc/binding`, `acc/result_store`, `acc/persistence`） | `pytest --cov=acc.binding --cov=acc.result_store --cov=acc.persistence --cov-fail-under=85` |
| `hypothesis` | property-based test（C-016 hash 互斥、C-018 fan-in 顺序、N-007 可重入） | 嵌入对应 `tests/unit/test_*.py` 中作为 `@given(...)` |
| `pytest-benchmark` | 性能（P-001 / P-005 / P-006 / P-007） | `pytest tests/perf/ --benchmark-only --benchmark-compare-fail=mean:5%` |

### 3.3 CI 编排

CI 分两条 lane：

```
main lane:    pytest -m "not legacy"  &&  mypy --strict  &&  import-linter  &&  ruff check
legacy lane:  pytest -m legacy
perf lane:    pytest tests/perf --benchmark-only  (nightly only)
```

**门禁**：main lane 任一失败 → PR 不可合；legacy lane 失败 → 阻断（不再是 advisory，按 Q11 已收敛为 gating）；perf lane 是 nightly，回归阈值 mean+5% 触发告警，不阻断 PR。

### 3.4 工具版本固定

| 工具 | 推荐版本 | 备注 |
|---|---|---|
| Python | 3.11+ | 与 ACC 主代码一致 |
| pytest | ≥ 8.2.0 | 已在 `pyproject.toml` 固定 |
| mypy | ≥ 1.10 | strict 模式稳定 |
| ruff | ≥ 0.5 | format 子命令稳定 |
| import-linter | ≥ 2.0 | 支持 `forbidden` + `independence` contract |
| hypothesis | ≥ 6.100 | strategy combinator 稳定 |
| pytest-benchmark | ≥ 4.0 | `--benchmark-compare-fail` 支持 |

---

## 4. 人工 review 流程

> **目的**：补齐 2 项不可自动化条目（N-008 / O-006）+ 任何 PR 涉及 critical 维度的设计性变更。其余原本 *manual* 的 5 项（L-008 / S-008 / M-004 / M-008 / P-002）已由 P-018 自动化覆盖。

### 4.1 Reviewer 角色矩阵

| 角色 | 来源 | 职责 |
|---|---|---|
| `designer` | claude（CCB） | 主审：架构合理性 + AC 对齐 + 维度覆盖 |
| `reviewer` | codex（CCB） | 评分门：按 §7 Rubric 给出 dimension 分；overall ≥ 7.0 + 单项 > 3 |
| `executor` | claude | 实现 + 自查清单（PR description 必填 §4.3 self-check） |
| `inspiration` | gemini | 仅在 UX / 文档表达上提供参考，**结论必经 designer 判断** |
| 人工 reviewer | ACC 维护者 | 不可自动化条目逐条签字 |

### 4.2 Review 范围 / 触发条件

按 PR 触及的层级定 review 范围：

| PR 改动 | 必走 review |
|---|---|
| `acc/binding/` 公共 API 变更 | designer + reviewer + 人工 reviewer |
| `acc/result_store/` 公共 API 变更 | designer + reviewer + 人工 reviewer |
| 触及 critical 条目（C-001 ~ C-006、C-014、C-017、L-001、L-002、L-005、T-001、T-002、E-004、E-005、N-001、N-003、S-001、S-004、O-005、M-001、M-002） | designer + reviewer + 人工 reviewer |
| 触及 high 条目 | designer + reviewer |
| 仅 medium / low | designer 自审，PR 描述包含 §4.3 self-check 即可 |
| Workbench 前端 | designer + 人工 UX reviewer（覆盖 S-008、O-007） |
| Migration 工具（`tools/migrate_graph_to_explicit_binding.py`） | designer + reviewer + 人工 reviewer（覆盖 M-006、M-008） |

### 4.3 PR Self-check 清单（executor 在 PR description 必填）

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

### 4.4 Sign-off 标准

- **critical 条目**：reviewer 给该维度评分 ≥ 7（10 分制），人工 reviewer 显式书面签字（`reviewed-by: <handle>`）。
- **high 条目**：reviewer 给该维度评分 ≥ 6；如评 ≤ 6，必须列出 follow-up issue（with `tech-debt-must-fix-by-<phase>` 标签）。
- **medium / low**：reviewer 评分 ≥ 5 即可合并。

### 4.5 多轮触发条件

按 CCB Peer Review Framework：

- 第 1 轮 reviewer 反馈 → executor 修复 → 重新提交。
- 单次反馈包含 ≥ 1 critical 维度评分 ≤ 3 的条目 → 必走第 2 轮。
- 累计 3 轮未达 pass 标准（overall ≥ 7.0 且单项 > 3） → 升级到 designer + 人工 reviewer 联合裁决，给出"接受 / 降级 / 拒绝"明确决议。

---

## 5. AC 验收 vs 审计的关系

### 5.1 测试 vs 审计的分工

| 关注点 | TEST_PLAN（T-AC1 ~ T-AC17） | AUDIT_PLAN（本文件） |
|---|---|---|
| 现网行为是否满足 AC | ✅ 主回答 | ❌（只在 §2.1 correctness 复用 T-NNN 编号） |
| 代码层级是否守住 | ❌ | ✅ §2.2 layering 8 条 |
| 类型签名是否退化 | ❌ | ✅ §2.3 type_safety 8 条 |
| 异常分类是否清晰 | ❌（仅看错误是否抛出） | ✅ §2.4 error_handling 7 条 |
| 并发原语 / permit 是否泄漏 | 部分（仅看可见行为） | ✅ §2.5 concurrency 8 条 |
| 字段 / ENV / 路径是否泄漏 | 部分（仅看 AC3 / AC16 直接断言） | ✅ §2.6 security 8 条 |
| 性能基线 / 阈值 | ❌ | ✅ §2.7 performance 7 条 |
| Phase 间 byte-level 退化 | 部分（AC11/AC15 黄金文件） | ✅ §2.8 migration 8 条 |
| 事件流完备性 | 部分（AC10 投影） | ✅ §2.9 observability 8 条 |
| 代码味道 / 死代码 / 命名 | ❌ | ✅ §2.10 maintainability 9 条 |

### 5.2 测试之外，审计补的是什么？

按维度逐一回答：

1. **`layering`（L-001 ~ L-008）**：测试只看运行时行为，不看 import graph；审计用 `import-linter` + AST 扫描守住"binding 不依赖 server"等结构性不变量，避免重构期意外耦合反弹（recon: smell #1 god function 的形成本质是层级缺失）。
2. **`type_safety`（T-001 ~ T-008）**：测试不能保证 `Any` 不蔓延；审计用 `mypy --strict` 守住 ProvenanceObject、Selector ADT、Identity NewType 的硬约束，把 DESIGN §7.1 的字段表落地为编译期检查。
3. **`error_handling`（E-001 ~ E-007）**：测试只能看到"是否抛错"，不能看到"是否抛了正确的命名错"；审计强制命名 5 类异常 + 唯一错误码，使运维侧告警可分类。
4. **`concurrency`（N-001 ~ N-008）**：除 N-003（AC8 直接对应）外，permit 释放、ApprovalBarrier 独占、写串行化等只能通过白盒断言验证，测试无法穷尽。
5. **`security`（S-005 / S-007 / S-008）**：路径相对化、whitelist allow-list-only、Workbench 警示是结构性约束，测试只能采样验证，审计要求每条持久化 JSON 全量扫描。
6. **`performance`（P-001 ~ P-007）**：AC 不约束性能；审计补充 ReadySet 复杂度、InlineThreshold 强制、Windows fallback 顺序、并发基线等运维侧底线。
7. **`migration`（M-003 / M-004 / M-007 / M-008）**：测试只能验"迁移后能跑"，审计要看"配置开关单点、duplicate 是否消除、rollback 路径是否完整"等结构属性。
8. **`observability`（O-002 / O-006 / O-008）**：测试只看关键事件存在；审计要求 1:1 对应、lineage 可纯事件流重建、trace ID 完备 —— 这些是事后排障的前提。
9. **`maintainability`（MN 全部）**：测试不看代码风格；审计强制 DEFAULT_PORT_ID、InlineThreshold 单一定义、`# DEPRECATED:` 标注，避免技术债复发。

### 5.3 AC ↔ 审计映射表（关键 AC）

| AC | 测试用例 | 审计 check 补强 |
|---|---|---|
| AC1（control 仅 readiness） | T-AC1 → C-001 | L-001（binding 层不依赖 app）、MN-006（magic key 清理） |
| AC2（agent input 由 binding 唯一决定） | T-AC2 → C-002 | T-002 / T-003（binding 类型化）、E-002（命名异常）、S-001（默认 deny） |
| AC3（provenance runtime-only） | T-AC3 → C-003 | T-001（ProvenanceObject typed）、S-001（字段集扫描）、O-006（lineage 重建） |
| AC4（standalone-equivalent） | T-AC4 → C-004 | M-002（byte-level baseline）、L-008（projection 不绕过） |
| AC5（cross-run 隔离） | T-AC5 → C-005 | E-002（CrossRunReferenceError 命名）、N-003（per-run permit 隔离）、S-004（reject 不静默） |
| AC6（pause/resume checkpoint） | T-AC6 → C-006 | E-004（atomic write）、E-005（reconciler 区分 paused）、N-005（manifest 串行写） |
| AC7（aggregation 显式） | T-AC7 → C-007 | T-008（PromptAppendixPolicy enum）、M-008（默认 flip 单点） |
| AC8（upstream_context opt-in） | T-AC8 → C-008 | S-006（whitelist allow-list-only）、N-003（隔离） |
| AC9（prompt 可控） | T-AC9 → C-009 | S-002（task_only 排除 metadata）、MN-003（context DEPRECATED 注释） |
| AC10（UI 透明） | T-AC10 → O-007 | L-008（projection 不绕过）、S-008（警示 banner）、MN-009（命名冲突 rename） |
| AC11（legacy 兼容） | T-AC11 → C-010 + M-001 + M-002 | M-004（DEPRECATED 注释）、M-005（@legacy lane） |
| AC12（测试分层） | 治理 / CI 配置 | M-005（CI lane 分离） |
| AC13（结构化 provenance） | T-AC13 → C-011 | T-001（mypy strict）、E-001（无裸 except） |
| AC14（NodeResult 寻址） | T-AC14 → C-012 | T-007（result_store typed）、L-002（result_store 边界） |
| AC15（capsule 兼容兜底） | T-AC15 → C-010 + M-003 | S-002（task_only 严格）、O-005（atomic write） |
| AC16（路径相对化） | T-AC16 路径扫描 | S-005（持久化 JSON 全扫）、L-005（domain/engine 纯净） |
| AC17（fallback 可观测） | T-AC17 → O-003 | E-003（OSError 精确捕获）、P-004（fallback 顺序） |

---

## 6. 上线门

### 6.1 总闸（任何阶段合并到 main）

| 项 | 通过条件 |
|---|---|
| critical 条目 open | **0** |
| high 条目 open | 当前阶段 ≤ 5（带 `tech-debt-must-fix-by-<phase>` 标签）；下一阶段开始前 = 0 |
| medium 条目 open | ≤ 5 |
| 自动化条目通过率 | ≥ 阶段目标（P1: 80% / P2: 88% / P3: 92%） |
| CI main lane | 全绿 |
| CI legacy lane | 全绿（gating） |
| `mypy --strict` | 0 error |
| `import-linter` | 0 violation |
| `pytest --cov` on `acc/binding`+`acc/result_store`+`acc/persistence` | ≥ 85% |
| `ruff check` + `ruff format --check` | 0 issue |

### 6.2 阶段退出门

#### Phase 1 退出

- 所有 P1 范围 critical 项关闭：T-001（ProvenanceObject typed）、T-002（binding dataclass typed）、L-001 ~ L-005（边界）、E-004（atomic write）、E-005（reconciler）、O-005（atomic JSON）、M-001 / M-002（legacy 兼容）。
- T-AC11 + T-AC13 + T-AC16 全绿。
- `acc/binding/` / `acc/persistence/` / `acc/provenance.py` 单元测试覆盖率 ≥ 85%。
- `import-linter` 新增 binding/persistence/runtime layer contracts；扫描 0 违规。
- ENV uniformity（S-003）：三 adapter ACC_RUN_ID + ACC_RUN_DIR 集成测试通过。
- `tests/unit/test_design_acceptance_skeleton.py` 已建立 AC1-AC18 placeholder；P1 范围 unskip。

#### Phase 2 退出

- 所有 P2 范围 critical 项关闭：C-001 ~ C-005（AC1/AC2/AC3/AC4/AC5）、C-009（AC9）、C-010（AC11+AC15）、C-017（AC18）、N-001 / N-003（permit / 隔离）、S-001（field-set 扫描）。
- 主 lane 包含 AC1/AC2/AC4/AC5/AC6/AC8/AC9 用例；`@legacy` lane 单独跑。
- Workbench RunInspector 上线（O-007 + S-008）：Resolved Prompt + Provenance toggle + Applied Bindings + degradation badge。
- `acc/app/node_invocation.py` 旧 `build_clean_node_input_payload` / `collect_upstream_context` / `collect_workflow_input_context` 删除（MN-005）；vulture 通过。
- `__acc_control_context` magic key 仅在 @legacy 路径存在（MN-006 通过）。

#### Phase 3 退出

- 所有 P3 范围 critical 项关闭：C-005 / C-006 / C-007 / C-012（AC5/AC6/AC7/AC14）、O-003（AC17）、E-003（OSError 精确）、M-001 / M-006 / M-008（migration）。
- 默认翻转后 main lane 全绿；@legacy lane 仍全绿（rollback 路径有效）。
- `ProvenanceObject` schema_version 升 frozen-public（T-001 锁定）。
- 并发数字默认（max_concurrent_nodes_per_run=16 / max_total_nodes_per_run=1000 / max_active_runs=8）落地；P-005 性能门通过。
- `phase3_exit_q_resolution`：DESIGN §15 Q1–Q16 按下表 disposition 在对应 phase 收敛；TEST_PLAN ship_gate **references AUDIT phase3_exit_q_resolution** 为单一真理源；DESIGN §15 每条 Q 加 `{decided, deferred-phase-4, internal-may-evolve}` tag。

  | Q | exit_phase | expected disposition |
  |---|------------|---------------------|
  | Q1 | 3 | decided |
  | Q2 | 3 | decided |
  | Q3 | 4 | deferred-with-rationale |
  | Q4 | 3 | decided |
  | Q5 | 3 | decided |
  | Q6 | 3 | decided |
  | Q7 | 4 | deferred-with-rationale |
  | Q8 | 3 | partial-with-rationale |
  | Q9 | 3 | decided |
  | Q10 | 3 | decided |
  | Q11 | 3 | decided |
  | Q12 | 4 | deferred-with-rationale |
  | Q13 | 3 | decided |
  | Q14 | 3 | decided |
  | Q15 | 3 | partial-with-rationale |
  | Q16 | 3 | partial-with-rationale |

- `tools/migrate_graph_to_explicit_binding.py` 在 `examples/workflows/demo_*.graph.json` 上幂等（M-006）。

### 6.3 紧急回滚门

任何阶段上线后 24 小时内若发现：

- AC1/AC2/AC3/AC4/AC5/AC12 被违反（critical correctness 倒退） → 立即 rollback 到上一阶段 binary。
- 主 lane 失败率 > 5% → 立即 rollback。
- 任何用户 .accflow.json / .graph.json 在 `binding_mode=legacy_full` 下不可执行 → 立即 rollback（违反 AC11 byte-level guarantee）。

回滚机制：每个 Phase 退出版本固定 git tag（`audit-phase1`, `audit-phase2`, `audit-phase3`）；回滚仅需 `git checkout <tag>` + 重新部署，schema 兼容（DESIGN §13 强制保证）。

---

## 7. 与 CCB peer review 的对接

> **背景**：本仓库的 CCB（Claude Collaboration Bridge）规则把 `designer`（claude）与 `reviewer`（codex）作为 peer review 双角色。Plan Review 与 Code Review 两个 checkpoint 必须经过 reviewer 评分（Rubrics）。本节说明如何把本审计清单作为 codex 的 Rubric 输入。

### 7.1 Plan Review Checkpoint

时机：DESIGN.md 修订完成、tasks.md 拆分前（每个 Phase 之前）。

**designer 通过 `/ask codex` 发送内容**：

```
[PLAN REVIEW REQUEST]
--- PLAN START ---
<DESIGN.md vNN diff or 全文（<5k 行）+ tasks.md 草案>
--- PLAN END ---

Rubric: 使用 docs/codex_goal_workflow_message_routing/AUDIT_PLAN.md §2 的 10 维度作为评分维度
分数尺度：1-10（10 = perfect）
对每个维度给出：
  - score (1-10)
  - top 1-3 risks（引用 §2.x 的 check 编号 C-NNN / L-NNN / ... ）
  - 建议（可执行）

要求：
- 在 PLAN 与本文件 §2 不一致时，明确指出哪条 check 被遗漏 / 弱化
- 任一维度 score ≤ 3 视为 fail（需第 2 轮）
- overall < 7.0 视为 fail
```

**designer 处理 reviewer JSON 返回**：

- pass（overall ≥ 7.0 且最低维度 > 3）→ 进入实现，任何 high+ 风险写入 tasks.md。
- fail → 修订 PLAN，re-submit；最多 3 轮，仍 fail 则升级到联合裁决（§4.5）。

### 7.2 Code Review Checkpoint

时机：每个 Phase 内每批改动完成、报告 done 之前。

**designer 通过 `/ask codex` 发送内容**：

```
[CODE REVIEW REQUEST]
--- CHANGES START ---
<git diff origin/main..HEAD on branch>
--- CHANGES END ---

Rubric: docs/codex_goal_workflow_message_routing/AUDIT_PLAN.md §2 全 92 条
- 对每条 check 标注 pass / fail / not_applicable
- fail 必须引用 diff 行号 + 给出修复建议
- 关注矩阵：本批改动主要影响哪些维度（参照 §6.2 阶段退出门）
- AC 映射：本批 PR 声明覆盖 AC ___ → reviewer 验证 §5.3 表格中对应 check 是否全 pass

要求 JSON 返回：
{
  "scores": {dimension: 1-10},
  "overall": float,
  "checks": [{id: "C-001", status: "pass|fail|n/a", note: "..."}, ...],
  "blocking": [check ids],   // 任一项 = critical fail 即 blocking
  "follow_ups": [...]        // high 但当前可合并
}
```

### 7.3 把审计清单作为 Rubric 的好处

1. **可量化**：92 条 check 每条 pass/fail，reviewer 给分有客观锚点，不再凭印象。
2. **抗 reviewer drift**：reviewer 每轮看同一份清单，不会因关注点漂移漏检 critical（如 ENV uniformity、relative path）。
3. **AC ↔ check 映射明确**：§5.3 直接对应表使 PR description 中的 AC 声明可被 reviewer 反查。
4. **门禁可机检**：blocking ids 由 reviewer 输出后，CI 可用机器解析（grep `"blocking": \[`）阻断合并。
5. **多轮收敛快**：每轮反馈定位到具体 check id，executor 修复有明确锚点，比"看注释凭感觉改"快 30-50%。

### 7.4 与 inspiration（gemini）的边界

`inspiration` 仅在 UX / 文档风格 / 命名（如 ProvenanceObject 字段名是否更易读）等创造性议题上参考；**任何审计 check 的 pass/fail 决策不得交由 inspiration**（CCB 规则：inspiration 不可靠，never blindly follow）。具体：

- C-NNN / E-NNN / N-NNN / S-NNN 等结构性条目：**只由 reviewer (codex) + 人工 reviewer 决定**。
- MN-NNN（命名 / 注释 / 死代码）：可参考 inspiration 建议，但 designer 必须自审是否符合 §2.10 规则。

### 7.5 审计材料长期维护

- 本文件版本号绑定 DESIGN.md：DESIGN.md vN.M 改动时同步更新本文件；diff 作为下一轮 Plan Review 的输入。
- §2 的 92 条 check 编号一旦稳定不再调整（只追加），以保持 PR description 的引用稳定。
- §6.2 阶段退出门跟随 Phase 推进而冻结：`audit-phase1` tag 固化 P1 退出门；后续 PR 不得回写。
- 每 12 周清理一次 medium 项 backlog，目标 0；超过 20 项触发审计回顾会议。

---

## 附录 A — 92 条 check 索引

| Dimension | 范围 | 数量 |
|---|---|---|
| Correctness | C-001 ~ C-018 | 18 |
| Layering | L-001 ~ L-011 | 11 |
| Type Safety | T-001 ~ T-008 | 8 |
| Error Handling | E-001 ~ E-007 | 7 |
| Concurrency | N-001 ~ N-008 | 8 |
| Security | S-001 ~ S-008 | 8 |
| Performance | P-001 ~ P-007 | 7 |
| Migration | M-001 ~ M-008 | 8 |
| Observability | O-001 ~ O-008 | 8 |
| Maintainability | MN-001 ~ MN-009 | 9 |
| **合计** | | **92** |

> 编号说明：每个维度独立编号，跨维度不重复；新增条目 append 到本维度尾部，绝不复用旧编号。

## 附录 B — Severity 分布速览

| Severity | 数量 |
|---|---|
| `critical` | 23 |
| `high` | 41 |
| `medium` | 23 |
| `low` | 5 |
| **合计** | **92** |

> critical 占比 ~26%，集中在 correctness / layering / type_safety / error_handling 四象限，对应 DESIGN.md 反复出现的"绝对不能退化"语义（AC1/AC2/AC3/AC4/AC5/AC12/AC13/AC16）。

## 附录 C — 自动化覆盖统计

| 维度 | 自动化条目 | 总条目 | 自动化率 |
|---|---|---|---|
| Correctness | 18 | 18 | 100% |
| Layering | 11 | 11 | 100% |
| Type Safety | 8 | 8 | 100% |
| Error Handling | 7 | 7 | 100% |
| Concurrency | 7 | 8 | 87.5% |
| Security | 8 | 8 | 100% |
| Performance | 7 | 7 | 100% |
| Migration | 8 | 8 | 100% |
| Observability | 7 | 8 | 87.5% |
| Maintainability | 9 | 9 | 100% |
| **合计** | **90** | **92** | **97.8%** |

> Phase 3 退出门 ≥ 92% 与本表数据吻合（本次 P-006 新增 L-009/L-010/L-011 + P-018 重分类后，自动化率上限提升至 97.8%）；Phase 1 退出 80% 时仅 N-008 / O-006 两项手工条目允许仍 open，但需 §4.4 sign-off 标准下 reviewer 评分通过。

---

**END OF AUDIT_PLAN.md v0.1**
