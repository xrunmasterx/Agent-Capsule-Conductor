# Codex Goal Workflow Message Routing —— TEST PLAN

> 配套：`DESIGN.md` v0.2 (2026-05-31)、`CC_WORKFLOW_COMPARISON.md` v0.1。
> 覆盖 DESIGN.md §14 中显式声明的 18 条验收准则（AC1–AC18）。
> 仓库根：`F:/Agent-Capsule-Conductor/`；所有 pytest 命令在仓库根目录执行。

---

## 1. 摘要

### 1.1 测试金字塔结构

```
security      ( 5)
performance   ( 4)
migration     ( 5)
e2e           (17)   ← 1 case ↔ 1 AC（AC18 由现有 T-030 / T-071 等支撑用例覆盖，未新增 e2e 主轨）
property      ( 7)
integration   (13)
unit          (26)
                     总 77 cases
```

> AC18（DESIGN §14 新增 *Nested workflow boundary isolation*）通过既有支撑用例 T-027 / T-030 / T-071 共同覆盖，故 §3 矩阵新增 AC18 行但 §1.1 总计数不变。

| 层 | 用例数 | 目标 | 平均时长 |
|----|------:|-----|--------|
| unit | 26 | 单函数 / 数据类 / FSM / 解析器 | < 50 ms |
| integration | 13 | 跨模块 + 落盘，单 run | < 2 s |
| property | 7 | hypothesis 边界爆破 | < 5 s |
| e2e | 17 | 每个 AC 一条主轨 | < 10 s |
| migration | 5 | Phase 间字节级兼容 | < 15 s |
| performance | 4 | 阈值 / 并发 / 嵌套 / 大文件 | < 60 s（slow） |
| security | 5 | 隔离 / 注入 / 泄漏防御 | < 5 s |

### 1.2 AC 覆盖矩阵概览

| AC | 主轨 e2e | 支撑用例数 |
|----|--------|----:|
| AC1 | T-047 | 3 |
| AC2 | T-048 | 13 |
| AC3 | T-049 | 8 |
| AC4 | T-050 | 2 |
| AC5 | T-051 | 5 |
| AC6 | T-052 | 10 |
| AC7 | T-053 | 3 |
| AC8 | T-054 | 8 |
| AC9 | T-055 | 4 |
| AC10 | T-056 | 2 |
| AC11 | T-057 | 5 |
| AC12 | T-058 | 1 |
| AC13 | T-059 | 6 |
| AC14 | T-060 | 4 |
| AC15 | T-061b | 7 |
| AC16 | T-062 | 5 |
| AC17 | T-063 | 5 |
| AC18 | —    | 3 |

### 1.3 现状对照

- 当前 `tests/` 0 / 18 AC 完全覆盖（recon `tests` 节判定）。
- 多个现有用例锁定的是与新设计 **相反** 的不变量，典型：`tests/unit/test_clean_workflow_engine.py:169-251` 锁定 `context="upstream_output"` 默认透传 + 256 KiB 内联，需在 Phase 1 改造时打 `@pytest.mark.legacy` 隔离（详见附录 A）。

---

## 2. 测试分层

### 2.1 unit
- **目的**：锁定单函数 / 单数据类 / 单 ADT 的内部不变量；< 50 ms，无网络无子进程。
- **工具**：`pytest 8.2+` (`pyproject.toml:27-36`)、`MonkeyPatch`、`tmp_path`；直接 import 被测模块。
- **命名**：`tests/unit/test_<module>.py::test_<thing>_<behavior>`，纯英文。
- **mark**：默认无 mark（主 lane）；`@pytest.mark.posix` / `@pytest.mark.windows` / `@pytest.mark.legacy` 按需。

### 2.2 integration
- **目的**：跨模块协作（BindingResolver + ResultStore + 落盘 + manifest），单 run 维度，允许真实文件 IO。
- **工具**：`tmp_path`、`WorkflowAppService.run` 直调、`monkeypatch.setattr("acc.app.execute_clean_node", fake)` 注入 fake executor（沿用 `tests/unit/test_clean_workflow_engine.py:179` 模式）；`typer.testing.CliRunner` 仅在断 CLI 行为时使用。
- **命名**：`tests/integration/test_<scenario>.py`。
- **mark**：`@pytest.mark.integration`（+ `legacy` / `windows` 按场景）。

### 2.3 property
- **目的**：hypothesis 边界穷举（哈希 / FSM / 字段差集 / 路径相对性），每用例 100 例。
- **工具**：`hypothesis>=6.0`（新增 dev 依赖），`@settings(deadline=2000, max_examples=100)`。
- **命名**：`tests/property/test_<invariant>.py`。
- **mark**：`@pytest.mark.property`，进入主 lane。

### 2.4 e2e
- **目的**：每个 AC 一个主轨用例，命名固定 `test_acNN_<short>`，便于 `pytest -k acNN` 运行。
- **工具**：完整 `WorkflowAppService.run` + 真实 fixture `.accflow.json` + 真实落盘；不启动 agent 子进程（用 `tests/fixtures/capsules/` 下轻量 capsule）。
- **命名**：`tests/e2e/test_acNN_<topic>.py::test_acNN_<short>`。
- **mark**：`@pytest.mark.e2e`（+ `legacy` / `windows` 按 AC）。

### 2.5 migration
- **目的**：DESIGN.md §13 Phase 1/2/3 间兼容性、importer 行为、字节等同保证；AC11 + AC15 主战场。
- **工具**：分阶段 fixture 文件夹（`tests/fixtures/baselines/phase1|phase2|phase3/`）；legacy fixture 取自 `examples/workflows/`。
- **命名**：`tests/migration/test_<phase_or_path>.py`。
- **mark**：`@pytest.mark.migration` + 多数配 `legacy`。

### 2.6 performance
- **目的**：256 KiB 阈值 / 并发上限 / 嵌套深度 / reference 物化大文件；SLO 与告警基线。
- **工具**：`pytest-benchmark`（新增）或 `time.perf_counter`；baseline 持久化到 `tests/performance/baselines/*.json`。
- **命名**：`tests/performance/test_<scenario>_perf.py`。
- **mark**：`@pytest.mark.performance` + `slow`（不进主 lane，nightly 运行）。

### 2.7 security
- **目的**：跨 run 隔离 / prompt injection / provenance 泄漏 / path traversal 等默认拒绝类不变量。
- **工具**：普通 pytest，无外部安全工具；攻击向量以 fixture 注入。
- **命名**：`tests/security/test_<attack_class>.py`。
- **mark**：`@pytest.mark.security`，进入主 lane。

---

## 3. AC × Test 矩阵

| AC | 描述（DESIGN.md §14） | 主轨 e2e | 全部用例 |
|----|----------------------|--------|---------|
| AC1 | Control edge 仅 readiness（:483-485） | T-047 | T-017, T-032, T-047 |
| AC2 | Agent-visible 输入由显式 binding 唯一决定（:487-489） | T-048 | T-001, T-002, T-015, T-016, T-024, T-027, T-032, T-033, T-039, T-041, T-048, T-066, T-067 |
| AC3 | Provenance 默认 runtime-only（:491-493） | T-049 | T-001, T-021, T-022, T-042, T-049, T-074, T-075, T-077 |
| AC4 | Standalone-equivalent 字段集（:495-498） | T-050 | T-021, T-050 |
| AC5 | 并发 run 不共享中间状态（:500-502） | T-051 | T-005, T-029, T-044, T-051, T-076 |
| AC6 | Pause/resume 显式 checkpoint（:504-506） | T-052 | T-008, T-019, T-020, T-026, T-028, T-034, T-036, T-040, T-045, T-052 |
| AC7 | Final summary 由 aggregation 节点（:508-510） | T-053 | T-025, T-037, T-053 |
| AC8 | upstream_context 默认 opt-in（:512-514） | T-054 | T-018, T-022, T-033, T-039, T-054, T-066, T-067, T-070 |
| AC9 | Prompt 渲染可控（:516-518） | T-055 | T-012, T-013, T-055, T-073 |
| AC10 | UI Inspector 透明（:520-522） | T-056 | T-038, T-056 |
| AC11 | Legacy 文件迁移期可执行（:524-526） | T-057 | T-004, T-031, T-057, T-064, T-065 |
| AC12 | 测试分层（:528-530） | T-058 | T-058 |
| AC13 | ArtifactBundle 含结构化 Provenance（:532-534） | T-059 | T-002, T-006, T-007, T-046, T-059, T-069 |
| AC14 | 节点输出寻址化（:536-538） | T-060 | T-002, T-003, T-060, T-069 |
| AC15 | Capsule prompt 兼容兜底（:540-542） | T-061b | T-011, T-012, T-014, T-061a, T-061b, T-065, T-068a, T-068b, T-073 |
| AC16 | 内部路径相对化（:544-546） | T-062 | T-003, T-023, T-043, T-062, T-075 |
| AC17 | 平台 fallback 可观测（:548-550） | T-063 | T-009, T-010, T-035, T-063, T-072 |
| AC18 | Nested workflow boundary isolation（:552-554） | —（由支撑用例覆盖） | T-027, T-030, T-071 |

> T-058 在 CI 中静态校验该矩阵，缺失即失败。

---

## 4. 完整测试用例清单

> `verifies_ac` 用 `AC1..AC18`；新增 AC 候选会单独标注。所有断言可执行，fixture 路径相对仓库根。

### 4.1 Unit 层（T-001..T-026）

**T-001 `test_binding_resolver_dispatches_field_selector`** | unit | AC2, AC3
- goal: `kind=selector` + `field:.structured.verdict` 解析为 scalar 并写一行 manifest。
- setup: `tests/unit/test_binding_resolver_dispatch.py`；ResultStore stub 提供 NodeResult{r1, upstream, main}，output={"structured":{"verdict":"approve"}}；binding=NodeInputBinding(target_port='task', source=DataEndpoint('upstream','main'), selector='field:.structured.verdict', kind='selector')。
- steps: 实例化 BindingResolver(run_id='r1', store=stub) → `resolve_node('downstream', [binding])` → 捕获 `(agent_payload, runtime_payload, manifest_rows)`。
- assertions: `agent_payload == {'task':'approve'}`；`len(manifest_rows)==1` 且 `selector=='field:.structured.verdict'`；`source_run_id=='r1'`；`runtime_payload.provenance.binding_applied` 含一行；`set(agent_payload.keys()) ∩ {'node','workflow.input','upstream_context','inbox.records','__acc_control_context'}==∅`。

**T-002 `test_binding_resolver_dispatches_outbox_selector`** | unit | AC2, AC13, AC14
- goal: `outbox:research_port` 解析为 outbox 目录，记录 `outbox_manifest.json` 自身 sha256（Q15 推荐）。
- setup: 同上文件；stub outbox_manifest 含两文件；selector='outbox:research_port'。
- steps: BindingResolver.resolve → 检视 ProvenanceObject 与 TransferPolicy。
- assertions: `agent_payload['task']` 为相对路径字符串（`runs/r1/nodes/upstream/outbox/research_port`）；`provenance.source_artifact_sha256==sha256(outbox_manifest bytes)`；`provenance.inline_value_sha256 is None`；`materialization_mode_resolved ∈ {reference,copy}`。

**T-003 `test_binding_resolver_dispatches_artifact_selector`** | unit | AC14, AC16
- goal: `artifact:report.md` 经 artifact_manifest 命中具名 artifact。
- setup: stub artifact_manifest 含 `name='report.md', relpath='nodes/upstream/main/artifacts/report.md'`。
- steps: resolve → 验证 artifact 命中。
- assertions: `agent_payload['task']=='nodes/upstream/main/artifacts/report.md'`（相对路径）；扫描 agent_payload/runtime_payload/manifest_rows 无 host-absolute 前缀；`provenance.source_artifact_sha256` 等于文件 sha256。

**T-004 `test_binding_resolver_legacy_passthrough_short_circuits`** | unit | AC11
- goal: `kind=legacy_passthrough` 跳过 selector 解析，走 legacy `collect_upstream_context`。
- setup: binding=NodeInputBinding(target_port='__legacy', kind='legacy_passthrough', selector=None)；mock NamespaceSelector.parse。
- steps: resolve → 检验 mock 调用 → 检视 payload。
- assertions: `agent_payload` 含 legacy 5 键；`NamespaceSelector.parse.mock_calls==[]`；构造 `NodeInputBinding(selector='field:.x', kind='legacy_passthrough')` 在 `__post_init__` 抛 ValueError。

**T-005 `test_binding_resolver_rejects_cross_run_reference`** | unit | AC5, AC8
- goal: source.run_id ≠ current run_id 时 fail-fast。
- setup: resolver run_id='current'；source NodeResult 在 run_id='sibling'。
- steps: 调 resolve → 捕获异常。
- assertions: 抛 `CrossRunReferenceError`（或 `AccError(code='cross_run_reference')`）；message 含两个 run_id；manifest_rows 为空（无半提交）。

**T-006 `test_provenance_object_serialization_roundtrip`** | unit | AC13
- goal: ProvenanceObject 序列化无损；缺字段时按规则失败或 fallback。
- setup: `tests/unit/test_provenance_object.py`；构造完整对象（frame_id, parent_frame_id, call_depth, binding_applied[], upstream_lineage[], materialization_mode_resolved, inline_value_sha256, schema_version, stability='internal-may-break'）。
- steps: to_json → from_json；删 schema_version 重读；保留 schema_version 但删 call_depth。
- assertions: roundtrip deep-equal；缺 schema_version → fall back 至 legacy dict reader（DESIGN.md:422-423）；缺 call_depth（schema_version 在）→ `ProvenanceSchemaError`。

**T-007 `test_provenance_object_hash_class_mutex`** | unit | AC13
- goal: `inline_value_sha256` XOR `source_artifact_sha256`。
- setup: 同上文件。
- steps: 双填 / 双空 / 单填两种。
- assertions: 双填 → `ProvenanceSchemaError('hash class mutex violated')`；双空 → `ProvenanceSchemaError`；单填两种成功。

**T-008 `test_node_cache_key_deterministic_and_capsule_version_sensitive`** | unit | AC6
- goal: NodeCacheKey 跨进程稳定；capsule_version 变即失效。
- setup: `tests/unit/test_node_cache_key.py`；`(capsule_id='cap-a', '1.0.0', [('b1','sha-A'),('b2','sha-B')])`。
- steps: 计算 key1；reversed insertion order 计算 key2；version='1.0.1' 计算 key3。
- assertions: `key1==key2`；`key1!=key3`；key 是 64 位小写 hex。

**T-009 `test_transfer_policy_resolves_three_modes`** | unit | AC17 | `@pytest.mark.posix`
- goal: POSIX 能力齐全时直接返回 declared 模式。
- setup: monkeypatch `platform_caps.has_symlink_priv=True, has_inode_links=True`。
- steps: resolve copy / reference / symlink。
- assertions: declared==resolved；未 emit `materialization_degraded`。

**T-010 `test_transfer_policy_windows_fallback_to_copy_with_event`** | unit | AC17 | `@pytest.mark.windows`
- goal: Windows 缺权限时降级 copy + emit 事件。
- setup: monkeypatch `os.symlink → OSError(EPERM)`；`has_symlink_priv=False`。
- steps: resolve reference / symlink；抓 events writer。
- assertions: 两次都 `resolved=copy, degraded=True, fallback_reason!=None`；emit 恰好 2 条 `materialization_degraded`；不抛异常。

**T-011 `test_render_prompt_policy_legacy_full_byte_equal_to_baseline`** | unit | AC15
- goal: `prompt_appendix_policy=legacy_full` 与 Phase-1 baseline 字节级一致。
- setup: `tests/unit/test_prompting_policy.py`；capsule `tests/fixtures/capsules/legacy_full_appendix/`；baseline `tests/fixtures/baselines/legacy_full_resolved_prompt.md`。
- steps: 同 input_payload 渲染 → 读 baseline。
- assertions: `rendered.encode('utf-8')==baseline.read_bytes()`；含 `## ACC Runtime Input` 块且包含完整 input_payload JSON。

**T-012 `test_render_prompt_policy_task_only_excludes_orchestration_keys`** | unit | AC9, AC15
- goal: `task_only` 仅含 binding-resolved task 字段。
- setup: capsule `tests/fixtures/capsules/task_only_appendix/`；input_payload 含 5 编排 key + task 字段。
- steps: 渲染 → 解析 `## ACC Runtime Input` JSON 块。
- assertions: `set(parsed.keys()) ⊆ {'task'}`；`set(parsed.keys()) ∩ {'node','workflow.input','upstream_context','inbox.records','__acc_control_context'}==∅`。

**T-013 `test_render_prompt_policy_none_emits_no_appendix`** | unit | AC9
- goal: `policy=none` 永不自动追加 appendix。
- setup: capsule `tests/fixtures/capsules/none_appendix/`；模板不引用 `{{input_json}}`。
- steps: 渲染。
- assertions: `'## ACC Runtime Input' not in rendered`；rendered 等于 jinja 仅渲染显式变量后的结果。

**T-014 `test_render_prompt_missing_policy_defaults_to_legacy_full`** | unit | AC15
- goal: 无 `prompt_appendix_policy` 字段视为 `legacy_full`。
- setup: capsule `tests/fixtures/capsules/legacy_no_policy_field/`。
- steps: Phase-2 ACC 渲染 → 与 legacy_full baseline 对比。
- assertions: 字节级相等；capsule loader 输出 debug log "defaulting prompt_appendix_policy=legacy_full"。

**T-015 `test_namespace_selector_parser_accepts_four_namespaces`** | unit | AC2
- goal: 解析器仅接受 `field:` / `outbox:` / `artifact:` / `each_of:`。
- setup: `tests/unit/test_namespace_selector.py`。
- steps: 解析四种合法形式 + 裸路径 `.summary` + 未知 `graphql:.x`。
- assertions: 四种合法 → ADT 匹配；裸路径 / 未知 namespace → `SelectorParseError(offset)`。

**T-016 `test_namespace_selector_path_grammar_restricted_jsonpath`** | unit | AC2
- goal: path 语法限制 `.key` / `[index]` / `[*]`。
- steps: 解析 `field:.a.b[0][*].c` / `field:..deep` / `field:.a[?(@.x>1)]`。
- assertions: 第一条成功；后两条 `SelectorParseError`。

**T-017 `test_ready_set_pure_function`** | unit | AC1
- goal: ReadySet 纯函数，无 IO，幂等。
- setup: 图 A→B→C, A→D。
- steps: ReadySet({},{}) → {A}；ReadySet({A:success},{}) → {B,D}；ReadySet({A:failed},{}, fail_fast) → ∅；ReadySet({A:failed},{}, continue) → ∅。
- assertions: 各次返回 frozenset 符合预期；同输入两次 set-equal；mock 计数证 0 IO。

**T-018 `test_concurrency_policy_permit_lifecycle`** | unit | AC8
- goal: 四种终态都释放许可。
- setup: max_concurrent_nodes_per_run=2。
- steps: 取 2 个 → 一条 success / 一条异常释放 → 再取 2 走 skipped / cancelled。
- assertions: permit ∈ [0, cap]；四终态各释放一次；超 cap 按 overflow_behavior 等待 / 拒绝。

**T-019 `test_node_status_fsm_monotonicity`** | unit | AC6
- goal: FSM 拒绝倒退、拒绝双终态。
- steps: pending→ready→running→success → 尝试 success→running / success→failed / paused→ready。
- assertions: 前三步成功；倒退抛 `InvalidStatusTransition`；paused→ready 是唯一允许的回退；单 transition 仅 emit 1 event。

**T-020 `test_run_manifest_atomic_write`** | unit | AC6
- goal: temp+rename 写入；部分写入不破坏前一版本。
- setup: tmp_path 已有 `run_manifest.json{status:'running'}`；monkeypatch `os.rename → OSError`。
- steps: append CompletedNodeRecord → flush → 重读。
- assertions: flush 抛 OSError；磁盘 manifest 不变（status 仍 'running'）；run_dir 下无 `*.tmp`。

**T-021 `test_agent_payload_runtime_payload_split_excludes_provenance`** | unit | AC3, AC4
- goal: build_payload 拆分 AgentPayload（无 provenance）与 RuntimePayload（有 provenance）。
- setup: resolved={'task':'hello'}；ProvenanceObject 已构造。
- steps: `build_agent_payload(resolved, [], 'task_only')`；`build_runtime_payload(resolved, provenance, orchestration_metadata)`。
- assertions: agent_payload=={'task':'hello'}；与 FORBIDDEN 集合（见 AC3 列表）∩==∅；runtime_payload['provenance'] 是 typed ProvenanceObject；runtime_payload['orchestration_metadata'] 含 `node`/`workflow.input`/`inbox.records`。

**T-022 `test_expose_metadata_flag_default_deny`** | unit | AC3, AC8
- goal: `acc_expose_workflow_metadata` 默认空白名单 → 零 metadata 进入 AgentPayload。
- steps: whitelist=[] / whitelist=['workflow.input'] / 试 `acc_expose_provenance=True`。
- assertions: 空名单 → agent_payload=={'task':'x'}；含 'workflow.input' 但不含 'node'；`expose_provenance=True` → ConfigError。

**T-023 `test_agent_runtime_env_exports_all_six_vars`** | unit | AC16
- goal: 三 adapter 统一导出 `ACC_RUN_ID/RUN_DIR/INBOX_DIR/OUTBOX_DIR/ENVIRONMENT_ID/NODE_ID`。
- setup: `AgentRunRequest(run_id='r1', run_dir=tmp_path/'runs'/'r1', ...)`。
- steps: 三 adapter 调 `.build_env(request)`。
- assertions: 三者均含 `ACC_RUN_ID='r1'` 与 `ACC_RUN_DIR=str(absolute)`；六个 ACC_* 全有；ACC_RUN_DIR 是绝对路径（仅 ENV 现算，AC16）。
- 评注：当前 `acc/adapters/codex_cli.py:24-31` 仅导出四个，本用例锁定 Phase 1 deliverable。

**T-024 `test_inline_threshold_constant_is_256_kib`** | unit | AC2
- goal: `InlineThreshold == 256*1024`，唯一定义。
- steps: import 并断值；grep 仓库 `MAX_UPSTREAM_CONTEXT_INLINE_BYTES` 与 `256 * 1024` 仅一处定义点。
- assertions: 等于 262144；唯一定义。
- 评注：当前在 `acc/app/node_invocation.py:11`，重构后应迁出。

**T-025 `test_each_of_selector_resolves_to_ordered_list`** | unit | AC7
- goal: `each_of` 按 instance_index 排序，独立于完成顺序。
- setup: ResultStore 中三个 for_each 实例完成顺序 [2,0,1]。
- steps: resolve `each_of:fanout_a.summary`；改完成顺序重跑；其中一个仍 running 时 resolve。
- assertions: 输出 list==[i0.summary, i1.summary, i2.summary]；不同完成顺序得相同 list；含未完成时抛 `NotReady`。

**T-026 `test_completed_node_record_order_atomicity`** | unit | AC6
- goal: 写入顺序 outbox_manifest → events.jsonl(node_finished) → binding_materializations → completed_nodes。
- setup: 插桩四 writer 顺序记录；在 binding_materializations 与 completed_nodes 间注入 crash。
- steps: 跑节点至完成阶段 crash → 读 run_manifest。
- assertions: 实际顺序 == [outbox_manifest, node_finished_event, binding_materializations, completed_nodes]；crash 后 completed_nodes 不含该节点；前三者已存在（forensic trail）。

### 4.2 Integration 层（T-027..T-039）

**T-027 `test_five_binding_kinds_end_to_end`** | integration | AC2, AC7, AC18
- goal: NodeInput / WorkflowInput / WorkflowOutput / WorkflowCallInput / WorkflowCallOutput 五种 binding 在一次 run 内全部正确解析。
- setup: `tests/integration/test_binding_kinds_e2e.py`；fixture `tests/fixtures/redesign/all_five_bindings.accflow.json`（父 workflow 调用嵌套 workflow）。
- steps: WorkflowAppService.run → 读父 / 嵌 input.json → 读最终 output → 读 binding_manifest.json。
- assertions: 每节点 input.json 仅含 binding 声明字段；binding_manifest 五行五种 kind；嵌套节点 input.json 不含父级 upstream_context；最终 workflow output 等于 aggregation 节点经 WorkflowOutputBinding 输出。

**T-028 `test_pause_resume_via_run_manifest_checkpoint`** | integration | AC6
- goal: resume 用 `completed_nodes + binding_materializations` 决策；缺失即重跑。
- setup: fixture `three_node_chain.accflow.json` (A→B→C)；首跑 B 写 outbox 但未追加 checkpoint 时暂停。
- steps: A 完整完成 → B 写 outbox+node_finished 不写 checkpoint → 触发 pause → resume → 检视各节点执行计数。
- assertions: A 跳过；B 重跑；C 在 B 重跑后执行；最终 manifest 含三条 CompletedNodeRecord，node_cache_key 稳定。

**T-029 `test_resume_does_not_read_sibling_run_outbox`** | integration | AC5, AC6
- goal: resume 拒绝读取兄弟 run 的 outbox。
- setup: 两 run r1/r2；r1 完成 B；r2 暂停 B 未完成。
- steps: 在 r2 resume 路径注入引用 r1 的 binding → resume r2。
- assertions: 立即抛 `CrossRunReferenceError(r1)`；r2 binding_materializations 无源自 r1 行；r2 从头重跑 B。

**T-030 `test_nested_workflow_call_input_binding_explicit_propagation`** | integration | AC2, AC18
- goal: WorkflowCallInputBinding 显式传值；删去 binding 后无父上下文穿透。
- setup: fixture `nested_workflow_call.accflow.json`。
- steps: 跑父 workflow → 检视嵌套首节点 input.json → 用变体 fixture（删 binding）重跑。
- assertions: 有 binding：嵌套 input.json 含 `task=parent.A.output.summary`，invoking_workflow_call_id 已设置；无 binding：嵌套 input.json 不含父级字段，无 `__acc_control_context`；parent_frame_id 链到 root；call_depth==1。

**T-031 `test_legacy_full_mode_preserves_baseline_behavior`** | integration | AC11, AC15 | `@pytest.mark.legacy`
- goal: `binding_mode=legacy_full` 与 Phase-1 baseline 字节级一致。
- setup: fixture `tests/fixtures/legacy/demo_parallel.graph.json`；baseline `tests/fixtures/baselines/legacy_full_run/`。
- steps: legacy_graph_importer 导入 → 运行 → diff baseline。
- assertions: 每节点 input.json / resolved_prompt.md 字节相等；最终 workflow output 相等。

**T-032 `test_mixed_mode_explicit_for_bound_legacy_for_unbound`** | integration | AC1, AC2, AC11
- goal: mixed 模式下 bound 节点走 BindingResolver、unbound 走 LegacyPassthroughBinding。
- setup: fixture `mixed_mode.accflow.json`，B 声明 InputBinding，C 不声明。
- steps: 跑 → 检视 B/C 的 input.json。
- assertions: B.input.json 仅含 binding 声明字段，无 upstream_context；C.input.json 是 legacy 5 键 shape；binding_manifest 含 B (kind=selector) 与 C (kind=legacy_passthrough)。

**T-033 `test_explicit_only_mode_unbound_node_sees_nothing`** | integration | AC2, AC8
- goal: explicit_only 下 unbound 节点收到空 AgentPayload。
- setup: fixture `explicit_only.accflow.json` A→B，B 无 binding。
- steps: 运行 → 读 B input.json / resolved_prompt.md。
- assertions: B.input.json 顶层 keys ∩ {'node','workflow.input','upstream_context','inbox.records','__acc_control_context'}==∅；B.input.json 仅可能含 `{}` 或 whitelisted metadata；fixture 标 B 为 opt-out → AgentPayload 为 `{}`。

**T-034 `test_crash_reconciler_distinguishes_paused_from_crashed`** | integration | AC6
- goal: `_reconcile_interrupted_runs` 区分 paused / crashed。
- setup: tmp runs_dir：`r_paused` 有 `pause_requested` marker；`r_dead` 无。
- steps: 重启 RunManager → 检视两 run 状态。
- assertions: r_paused.status=='paused'；r_dead.status=='crashed'；r_paused events.jsonl 含 `run_paused_recovered`；r_dead 含 `run_crashed`；events.jsonl 未被截断。
- 评注：当前 `acc/server/run_manager.py:191-204` 不区分 paused，本用例锁定补丁。

**T-035 `test_materialization_degraded_event_end_to_end`** | integration | AC17 | `@pytest.mark.windows`
- goal: Windows mock 下 reference 物化降级 emit 事件 + 写 binding_manifest 行。
- setup: monkeypatch `os.symlink → OSError`；fixture `reference_materialization.accflow.json`。
- steps: 跑 workflow → 读 events.jsonl + binding_manifest.json。
- assertions: 恰 1 条 `materialization_degraded` 事件，含 binding_id 与 `reason='symlink_priv_unavailable'`；binding_manifest 行 `materialization_mode_resolved='copy', degraded=true`；run.status=='success'。

**T-036 `test_approval_barrier_monopolizes_level`** | integration | AC6
- goal: ApprovalBarrier 节点独占其 level。
- setup: fixture：level 2 三兄弟 A/B/C，B 是 approval。
- steps: 启动至 level 2 → 验证 B 处 awaiting_approval / A,C pending → 触发 approval marker → 等完成。
- assertions: B 等待期间 level 2 同时 running 计数 ≤ 1；approval 后三节点全部完成；重放 marker 不重复执行 B。
- 评注：DESIGN.md §11.3 Phase 3 deliverable，目前缺失。

**T-037 `test_aggregation_capsule_produces_workflow_output`** | integration | AC7
- goal: `WorkflowOutputBinding` 必须显式指向 aggregation 节点。
- setup: valid `aggregation_only.accflow.json`；invalid `no_aggregation.accflow.json`。
- steps: 校验两 fixture → 运行 valid 的。
- assertions: invalid 校验失败 `workflow_output_bindings.must_target_aggregation`；valid 最终 summary 仅来自 X；binding_manifest 含 source=X 的 WorkflowOutputBinding 行。

**T-038 `test_workbench_inspector_projection_exposes_resolved_fields`** | integration | AC10
- goal: `/api/runs/{id}/projection` 返回必需字段。
- setup: `tests/server/test_inspector_projection.py`；复用 `tests/server/conftest.py:15-26` 的 `client`；先跑小 workflow。
- steps: GET projection（默认 toggle off）→ GET projection（`?show_upstream_context=true`）。
- assertions: 默认含 `resolved_prompt`/`applied_bindings`/`materialization_modes_per_edge`；默认不含 `upstream_context`；toggle on 时出现并与 runtime_payload 一致；degraded 行含 `degraded=true`。

**T-039 `test_binding_resolver_fail_fast_on_missing_source_node_result`** | integration | AC2, AC8
- goal: source NodeResult 不存在时 BindingResolver 在 consumer 跑前 fail-fast。
- setup: fixture A→B，A 配置失败。
- steps: 跑 → 检视 B 状态。
- assertions: A.status=='failed'；B 永不进入 running，B.status ∈ {cancelled, skipped}；不存在 `B/input.json`。

### 4.3 Property 层（T-040..T-046）

**T-040 `test_provenance_hash_determinism_across_runs`** | property | AC6
- goal: 相同 (capsule_id, capsule_version, ordered binding inputs) 跨进程产生相同 NodeCacheKey。
- setup: hypothesis 生成 ProvenanceObject + binding_inputs。
- steps: 100 例 → key1=current → key2=after dict-shuffle / float-format perturbation → 子进程重算。
- assertions: 全部 key1==key2；任一字段变动 → key 不同；子进程一致。

**T-041 `test_ancestor_mask_invariant_under_topo_permutation`** | property | AC2
- goal: `graph_ancestor_masks` 输出在 topological-order permutation 下不变。
- setup: hypothesis 生成 ≤ 30 节点 DAG。
- steps: 一种 topo 序计算 → 重排（保 DAG 顺序）→ 重新计算并对比 ancestor 集合。
- assertions: 每节点 ancestor 集合 set-equal；mask 数值可不同但所代表节点集合不变。复用 `acc/workflow_graph.py:375-404`。

**T-042 `test_no_runtime_only_field_in_agent_payload_under_any_binding_combination`** | property | AC3
- goal: 任意 binding kind / expose flag / policy 组合下 AgentPayload 永不含 provenance/runtime-only key。
- setup: hypothesis 生成 1..5 binding（混合 kind）+ 随机 expose flag + 随机 policy。
- steps: 走生产代码路径构建 AgentPayload → 扫描顶层 keys。
- assertions: FORBIDDEN={'producer_session_id','bundle_id','binding_applied','call_depth','materialization_mode_resolved','parent_frame_id','invoking_workflow_call_id','frame_id','schema_version','stability'}；每例 ∩==∅；尝试 `expose_provenance=True` → ConfigError。

**T-043 `test_path_relativity_in_persisted_json`** | property | AC16
- goal: 任何 workflow 跑完后所有持久化 JSON 中无 host-absolute 路径。
- setup: hypothesis 生成 1-5 节点 workflow。
- steps: 跑 → walk run_dir 读所有 *.json → 扫描 host-absolute prefix。
- assertions: 所有 JSON 字符串值不含绝对前缀；run_dir 重命名后所有相对路径仍可解析；运行期 ACC_RUN_DIR 是绝对（sanity）。

**T-044 `test_binding_resolver_run_isolation_under_random_pairs`** | property | AC5
- goal: BindingResolver 拒绝任何 source.run_id ≠ current 的 binding。
- setup: hypothesis 生成 (current_run_id, source_run_id) 对。
- steps: 每对 + 五种 binding kind 解析。
- assertions: current==source 成功；current!=source 100% `CrossRunReferenceError`；拒绝时 manifest 不变。

**T-045 `test_node_status_fsm_monotone_under_random_event_sequences`** | property | AC6
- goal: 随机 event 序列下 NodeStatus 单调推进至终态。
- steps: hypothesis 从 {scheduled,started,succeeded,failed,cancelled,skipped,paused,resumed} 生成序列 → 应用至 FSM。
- assertions: 进入终态后所有后续 event 抛 `InvalidStatusTransition`；paused→resumed→running 是唯一回退；单 transition 仅 emit 1 event。

**T-046 `test_inline_threshold_strategy_mutex`** | property | AC13
- goal: 任意 byte 大小下 inline / source 哈希互斥。
- setup: hypothesis 大小 ∈ [0, 1 MiB]。
- steps: 用该大小 payload 解析 binding → 检视 ProvenanceObject。
- assertions: ≤ 256 KiB → inline 设、source 空；> 256 KiB → 反之；mutex 100%。

### 4.4 E2E 层（T-047..T-063）

> 命名 `test_acNN_<short>` 与 §3 矩阵一一对应；`pytest tests/e2e -k 'ac0'` 可单独跑。

**T-047 `test_ac1_control_edge_readiness_only`** | e2e | AC1
- setup: `tests/e2e/test_ac01_control_edge_readiness.py`；fixture `control_only.accflow.json` (A→B 仅 ControlEdge)。
- steps: `binding_mode=explicit_only` 跑 → 读 B input.json / resolved_prompt.md。
- assertions: `B.input.bindings_resolved=={}`；`set(B.input.json keys) ∩ {'node','workflow.input','upstream_context','inbox.records','__acc_control_context'}==∅`；`B.resolved_prompt.md` 不含 A 的 output_summary / output_inline / inbox.records 子串。

**T-048 `test_ac2_agent_visible_input_uniquely_from_explicit_binding`** | e2e | AC2
- setup: fixture `dataedge_only.accflow.json` A→B 一条 DataEdge 仅声明 port 'x'；capsule `requires_y/` assert 'y'。
- steps: 跑 → 检视 B agent_payload + 执行结果。
- assertions: `B.agent_payload=={'x':...}`；`B.run.status=='failed'` 错误信息引用 'y'；binding_manifest 含一行 selector='field:.x'。

**T-049 `test_ac3_provenance_default_runtime_only`** | e2e | AC3
- setup: fixture `standard_chain.accflow.json`。
- steps: 跑 → 读所有 input.json / resolved_prompt.md → 定义 FORBIDDEN（同 T-042）。
- assertions: 每 input.json 顶层 keys ∩ FORBIDDEN==∅；每 resolved_prompt.md 嵌入 JSON 块顶层 key 不含 FORBIDDEN；ArtifactBundle 中 ProvenanceObject 仍持久化（仅 agent 不可见）。

**T-050 `test_ac4_standalone_equivalent_field_set`** | e2e | AC4
- setup: capsule `echo_task/`。
- steps: standalone 跑（`acc/runner.py`）抓 standalone_input.json/prompt → 一节点 workflow（explicit_only）抓 workflow_input.json/prompt → key-set 对比。
- assertions: `set(workflow_input.json keys) ∩ {'node','workflow.input','upstream_context','inbox.records','__acc_control_context'}==∅`；workflow_input.json 中每个 binding-declared key 在 binding_manifest.json 中有对应行；不断言字节级 prompt diff（AC4 已收敛）。

**T-051 `test_ac5_concurrent_runs_isolated`** | e2e | AC5
- setup: fixture `two_node_chain.accflow.json`；两 run 并行 + run_B 注入跨 run 引用。
- steps: `asyncio.gather(run_A, run_B)` → 等待终止。
- assertions: run_A 成功；run_B fail-fast `CrossRunReferenceError`，不影响 run_A；两个 run_dir 字符串扫描互无对方 run_id。

**T-052 `test_ac6_pause_resume_explicit_checkpoint`** | e2e | AC6
- setup: 复用 T-028 三节点链 fixture，三场景。
- steps: (a) 完整 checkpoint 后 pause → resume 跳过 B；(b) outbox-only-no-checkpoint 后 pause → resume 重跑 B；(c) 兄弟 run 输出存在但本 run checkpoint 缺失 → 不读兄弟。
- assertions: (a) B 总执行 1 次；(b) B 总执行 2 次；(c) binding_materializations 仅引用本 run。

**T-053 `test_ac7_final_summary_from_aggregation_node`** | e2e | AC7
- setup: valid `aggregation_only.accflow.json` / invalid `no_aggregation.accflow.json`。
- steps: 校验两 fixture → 跑 valid。
- assertions: invalid 校验失败 `workflow_output_bindings.must_target_aggregation`；valid 最终 summary 仅来自 X；aggregation node 消费 `each_of:` 或显式 per-instance bindings。

**T-054 `test_ac8_upstream_context_default_opt_in`** | e2e | AC8
- setup: 三节点：B 不 opt-in、C `acc_expose_upstream_context=true`、D `acc_upstream_context_fields=['summary']`。
- steps: explicit_only 跑 → 读 B/C/D input.json。
- assertions: B 无 upstream_context；C 有完整 list；D 仅含 'summary'；Workbench projection 仅在 C/D 渲染 ⚠ banner。

**T-055 `test_ac9_prompt_render_controllable`** | e2e | AC9
- setup: capsule `none_appendix/`（policy=none）+ `explicit_input_macro/`（模板含 appendix 宏）。
- steps: 同输入跑两 capsule → 与模板源对比。
- assertions: none_appendix：`'## ACC Runtime Input' not in prompt`；explicit_input_macro：appendix 出现且仅含 declared task 字段；两者均不含 legacy auto-appendix（除非 policy=legacy_full）。

**T-056 `test_ac10_ui_inspector_transparency`** | e2e | AC10
- setup: 复用 server conftest；跑含 degraded materialization 的 workflow（Windows mock）。
- steps: 调 projection 端点（默认 + toggle on）。
- assertions: 默认含 `resolved_prompt`/`applied_bindings`/`materialization_modes_per_edge`；toggle on 添加 `upstream_context`；degraded edge 含 `degraded=true` 与 `fallback_reason`；前端 component 测试断言 toggle 行为。

**T-057 `test_ac11_legacy_files_still_executable`** | e2e | AC11 | `@pytest.mark.legacy`
- setup: fixture `examples/workflows/demo_parallel.graph.json`、`examples/workflows/ui_demo_graph.graph.json`。
- steps: legacy_graph_importer 导入 → 端到端跑 → 检视 imported template。
- assertions: 两 run status='success'；imported template 的 `graph.legacy=true`；每个 legacy 节点至少注入一条 LegacyPassthroughBinding；最终输出与 redesign 前 baseline 一致。

**T-058 `test_ac12_test_layering_governance`** | e2e | AC12
- setup: 通过 subprocess 调 `pytest --collect-only`；phase-aware allowlist 写入 `tests/_helpers/expected_ac_matrix.json`。
- steps: 对 n∈[1..18] 跑 `pytest --collect-only -m "T_AC<n>"` → 收集 main lane / legacy lane 的 test ID 全集 → 与 `expected_ac_matrix.json` 当前 phase 子集比对。
- assertions: 对 n∈[1..18] 都 ≥1 main-lane test 声明 `@pytest.mark.T_AC<n>`（AC18 由 T-027 / T-030 等 integration 主 lane 用例承担，无独立 e2e 主轨）；test ID 全集到 declared `T_AC<n>` 的 mapping 计数为 ≥1；main-lane 与 legacy-lane test ID 集合 disjoint（file-permissive，ID-strict —— 同一文件可同时含两 lane 的 parametrize 分支，但 test ID 不可重叠）；CI 配置定义两条 lane。

**T-059 `test_ac13_artifact_bundle_structured_provenance`** | e2e | AC13
- setup: 多节点 workflow。
- steps: 跑 → walk runs/<run_id>/ 找 ArtifactBundle → `ProvenanceObject.from_json` 反序列化。
- assertions: 每 bundle 反序列化成功；每 ProvenanceObject 的 binding_applied/upstream_lineage/materialization_mode_resolved 非空；移除任一必填字段后反序列化抛 `ProvenanceSchemaError`。

**T-060 `test_ac14_node_output_addressable_by_triple`** | e2e | AC14
- setup: fixture `multi_port_node.accflow.json`，节点 X 有 ports {main, secondary}。
- steps: 跑 → ResultStore 三元组查询 → 不存在三元组查询。
- assertions: 每三元组返回唯一 bundle；X.main 与 X.secondary 的 sha256 不同；不存在三元组返回 None（无 sibling-port fallback）。

**T-061a `test_ac15_capsule_prompt_baseline_freeze_phase1`** | e2e | AC15 | `@pytest.mark.legacy`
- goal: Phase 1 生成并固化 legacy capsule corpus 的 prompt baseline，并验证 reload + reproducibility（Phase 1 must-pass）。
- setup: corpus `tests/fixtures/capsules/legacy_corpus/`（≥5 个）；baseline 输出目录 `tests/fixtures/baselines/phase1/legacy_corpus/`（首跑写入；后续跑只读对比）。
- steps: Phase-1 ACC 跑每 capsule → 生成 / 写入 baseline → 同进程二次跑读取 baseline → 子进程再跑做 reproducibility 对比。
- assertions: 每 capsule resolved_prompt.md 写入 baseline 成功；同进程 reload 字节级相等；子进程独立跑结果与 baseline 字节级相等（reproducibility）；baseline 目录至少含 5 个 capsule 产物。

**T-061b `test_ac15_capsule_prompt_compat_byte_level`** | e2e | AC15 | `@pytest.mark.legacy`
- goal: Phase 2/3 当前实现与 Phase-1 baseline 字节级一致（Phase 2/3 must-pass）。
- setup: corpus `tests/fixtures/capsules/legacy_corpus/`（≥5 个）+ baseline `tests/fixtures/baselines/phase1/legacy_corpus/`（由 T-061a 生成）。
- steps: Phase-2/3 ACC 各跑一遍 → 与 Phase-1 baseline diff。
- assertions: 每 capsule resolved_prompt.md 字节级与 baseline 相等；显式 task_only 的 capsule prompt 不含 5 编排 key。

**T-062 `test_ac16_run_dir_relocatable`** | e2e | AC16
- steps: 跑 multi-node workflow 至 `tmp/runs/<id>/` → 移至 `tmp/archive/<id>_renamed/` → 只读打开 → 扫描 *.json 中绝对路径。
- assertions: ResultStore.get(...) 返回相同 ArtifactBundle 内容；任一 binding 重新解析得相同 sha256；Workbench inspector projection 渲染相同；任意 JSON 不含 host-specific 绝对前缀。

**T-063 `test_ac17_platform_fallback_observable`** | e2e | AC17 | `@pytest.mark.windows`
- setup: monkeypatch `os.symlink` + `platform_caps`；fixture `reference_materialization.accflow.json`。
- steps: 跑 → 读 events.jsonl / binding_manifest.json / projection。
- assertions: run.status=='success'；events.jsonl 含 1 条 `materialization_degraded`，含 binding_id 与 `reason='symlink_priv_unavailable'`；binding_manifest 行 `materialization_mode_resolved='copy', degraded=true`；projection 渲染 `degraded=true`。

### 4.5 Migration 层（T-064..T-068）

**T-064 `test_legacy_graph_importer_injects_legacy_passthrough`** | migration | AC11 | `@pytest.mark.legacy`
- goal: importer 把每条 `context='upstream_output'` 转成 LegacyPassthroughBinding 并打 `graph.legacy=true`。
- setup: fixture `examples/workflows/demo_parallel.graph.json`。
- steps: `legacy_graph_importer.import_template(...)` → 检视 template。
- assertions: 每个含 legacy 入边节点至少一条 NodeInputBinding(kind='legacy_passthrough')；selector 为空；`template.metadata['legacy']==True`；导入后默认 `binding_mode='legacy_full'`。
- 评注：当前默认在 `acc/legacy_graph_importer.py:276-280`。

**T-065 `test_phase1_mixed_mode_zero_behavior_change`** | migration | AC11, AC15 | `@pytest.mark.legacy`
- goal: Phase 1 仅做底座硬化，所有 legacy fixture 在 mixed 模式下字节级保持原行为。
- setup: corpus `examples/workflows/*.graph.json` + `tests/fixtures/legacy/`；baseline `tests/fixtures/baselines/phase1/`。
- steps: Phase-1 ACC 跑每 fixture → diff baseline。
- assertions: 全部 diff 为空；bundle 中 ProvenanceObject 已存在；ENV 已含 `ACC_RUN_ID + ACC_RUN_DIR`。

**T-066 `test_phase2_explicit_only_opt_in_per_workflow`** | migration | AC2, AC8
- goal: 一 workflow 切 explicit_only 不影响其他并发 workflow。
- setup: W1 (mixed) 与 W2 (explicit_only) 共享 capsule 并发。
- steps: `asyncio.gather(W1, W2)` → 检视各 workflow 节点 input.json shape。
- assertions: W1 节点仍走 legacy 5-key shape；W2 节点仅含 binding-declared key；两 run 的 binding_manifest 各自仅引用自身 run_id。

**T-067 `test_phase3_default_flip_to_explicit_only`** | migration | AC2, AC8
- goal: Phase 3 默认 binding_mode=explicit_only；importer 自动迁移 legacy 至 mixed。
- setup: 新建 `.accflow.json` 不写 binding_mode 字段；legacy `.graph.json` 走 `tools/migrate_graph_to_explicit_binding.py`。
- steps: 加载 fresh accflow → 检验默认；跑迁移工具检视输出；explicit_only 下跑无 binding 节点。
- assertions: 新模板默认 explicit_only；迁移工具输出 `binding_mode='mixed'` + `acc_expose_*` 注解；无 binding 节点 AgentPayload 为空（或访问未声明字段时 fail-fast）。

**T-068a `test_capsule_without_policy_field_default_capture_phase1`** | migration | AC15 | `@pytest.mark.legacy`
- goal: Phase 1 捕获并固化 *无 prompt_appendix_policy 字段 capsule → 默认 legacy_full* 的渲染结果作为 baseline（Phase 1 must-pass）。
- setup: corpus 含若干无该字段 capsule；baseline 输出目录 `tests/fixtures/baselines/phase1/no_policy_field_default/`。
- steps: Phase-1 ACC 跑每 capsule（单节点 workflow） → 写入 / 校验 baseline → 检查 capsule loader debug log。
- assertions: baseline 写入成功，每 capsule 产物存在；capsule loader debug log 含 "defaulting prompt_appendix_policy=legacy_full"；同进程 reload baseline 字节级相等。

**T-068b `test_capsule_without_policy_field_is_legacy_full`** | migration | AC15 | `@pytest.mark.legacy`
- goal: 无 `prompt_appendix_policy` 字段的 capsule 在 Phase 2/3 下与 baseline 字节级一致；显式 override 触发反向验证（Phase 2/3 must-pass）。
- setup: corpus 含若干无该字段 capsule；baseline `tests/fixtures/baselines/phase1/no_policy_field_default/`（由 T-068a 生成）。
- steps: Phase-2 / Phase-3 各跑一次单节点 workflow → 与 Phase-1 baseline diff；同 capsule 显式改为 task_only 再跑一次。
- assertions: 默认路径 diff 全部为空；capsule loader debug log 含 "defaulting prompt_appendix_policy=legacy_full"；显式改为 task_only 后行为不再字节级一致（反向验证 default 路径唯一）。

### 4.6 Performance 层（T-069..T-072）

**T-069 `test_inline_threshold_256kib_inline_vs_reference_throughput`** | performance | AC13, AC14 | `@pytest.mark.slow`
- goal: 256 KiB 阈值边界两侧 BindingResolver 选择正确策略并测量吞吐。
- setup: payload sizes [128 KiB, 256 KiB, 256 KiB+1, 512 KiB, 4 MiB]。
- steps: 各 size 跑 100 次 binding resolution 计时 → 记录 strategy + 耗时 → 写 baseline。
- assertions: ≤ 256 KiB → strategy='inline'；> 256 KiB → strategy='reference'；相对 baseline 退化 ≤ 20%。

**T-070 `test_100_node_level_concurrency`** | performance | AC8 | `@pytest.mark.slow`
- goal: max_concurrent_nodes_per_run=16 下成功运行 100 节点 fan-out level，无 head-of-line blocking。
- setup: fixture `100_node_level.accflow.json`，每节点 sleep 50ms。
- steps: 跑 → 每 10ms 采样 running 计数 → 记录总 wall time。
- assertions: 最大 running 计数 ≤ 16；100 节点全 success；总 wall time 期望 = `ceil(100/16) × 50ms + 50ms 固定 overhead`，超出该期望 +50% 即 fail；性能预算口径区别：*concurrency-overhead 5%*（AUDIT P-005，nightly 一次性 gating）vs *wall-clock 20%*（perf_baseline，nightly 警告，非每 PR gating）。

**T-071 `test_deep_nested_workflow_call_depth_5`** | performance | AC18
- goal: call_depth ≥ 5 不溢出栈、不串上下文。
- setup: fixture `deep_nested_5.accflow.json` (W1→W2→W3→W4→W5)。
- steps: 跑外层 → 走访每嵌套 run 的 ProvenanceObject。
- assertions: 最深 call_depth==5；顺 parent_frame_id 5 跳到 root；每嵌套 input.json 不含父级 upstream_context（除非显式 WorkflowCallInputBinding）；每个 invoking_workflow_call_id 在 run 内唯一；wall-clock 相对 baseline 退化 ≤ 20%。

**T-072 `test_reference_materialization_large_files_baseline`** | performance | AC17 | `@pytest.mark.slow`
- goal: 256 MiB outbox 在 POSIX 上 reference 物化 O(metadata)；Windows 优雅降级。
- setup: A 产 256 MiB；B `materialization=reference`。
- steps: POSIX 真实 symlink 跑 → 模拟 Windows（symlink 抛错）跑 → 测两路径解析时间。
- assertions: POSIX 解析时间 < 100 ms；Windows 时间随 size 上升（确实 copy）+ emit `materialization_degraded` + B 仍跑通；两路径 `provenance.source_artifact_sha256` 相同；wall-clock 相对 baseline 退化 ≤ 20%。

### 4.7 Security 层（T-073..T-077）

**T-073 `test_prompt_injection_via_upstream_blocked_under_task_only`** | security | AC9, AC15
- goal: 恶意上游输出无法在 task_only 下注入 orchestration-metadata 形状到下游 prompt。
- setup: 上游 output.json 含伪造 `## ACC Runtime Input ... {"node":...}` + 'workflow.input' 键；下游 capsule policy=task_only，binding `field:.task`。
- steps: 跑 → 读下游 resolved_prompt.md 并解析所有 JSON 块。
- assertions: `## ACC Runtime Input` 块恰好 1 个（框架自身）；该块顶层 keys ⊆ {'task'}；注入的 'workflow.input' 字面量不作为顶层 key 出现；注入字符串作为 'task' 的 value 存在（数据，非控制结构）。

**T-074 `test_runtime_only_field_never_reaches_agent_under_any_path`** | security | AC3
- goal: 跨 binding_mode × policy × expose flags 矩阵，AgentPayload 永不含 runtime-only 字段。
- setup: `@pytest.mark.parametrize` 3×3×2 组合。
- steps: 每组合跑单节点 workflow → 读 input.json + resolved_prompt.md。
- assertions: FORBIDDEN ∩ input.json 顶层 keys==∅；FORBIDDEN ∩ resolved_prompt.md token 集==∅；`acc_expose_provenance=true` → ConfigError 而非泄漏。

**T-075 `test_acc_run_id_run_dir_not_in_agent_payload_or_prompt`** | security | AC3, AC16
- goal: ACC_RUN_ID/RUN_DIR 仅以进程 ENV 形式存在，不进入 AgentPayload / RuntimePayload 顶层 / resolved_prompt.md。
- steps: 跑小 workflow → 通过插桩 adapter 抓 agent process env → 读 input.json + resolved_prompt.md。
- assertions: 进程 env 含 ACC_RUN_ID/RUN_DIR（sanity）；input.json 顶层 keys 不含 'ACC_RUN_ID'/'ACC_RUN_DIR'，无值字面等于 run_id；resolved_prompt.md 中 run_id 仅以 binding-resolved task 字段形式出现；ProvenanceObject 内部含 run_id（runtime-only），不进入 agent_payload。

**T-076 `test_cross_run_reference_rejected_fail_fast`** | security | AC5
- goal: 三类攻击向量（binding 声明、symlink 注入、path-traversal selector）均被拒绝。
- setup: 两个已完成 run r_a / r_b。
- steps: (1) r_b binding 写 `source.run_id=r_a`；(2) r_b run_dir 内放指向 r_a 的 symlink；(3) selector `artifact:../../r_a/...`；调 BindingResolver.resolve。
- assertions: (1) 立即 `CrossRunReferenceError`；(2) ResultStore 通过 manifest run_id 校验拒绝（不依赖路径解析）；(3) selector parser 拒绝 path-traversal；任何向量下 binding_manifest 无半提交。

**T-077 `test_expose_provenance_flag_cannot_leak_provenance_fields`** | security | AC3
- goal: 即便假设性的 `acc_expose_provenance=true` 通过校验，BindingResolver 仍拒绝在 AgentPayload 出 provenance 字段（defense in depth）。
- steps: case1 节点 raw `acc_expose_provenance=true` 校验；case2 raw `acc_expose_workflow_metadata=['producer_session_id']` 校验；mock 强制绕过校验后跑。
- assertions: case1 → `ConfigError('expose_provenance is not a permissible flag')`；case2 → `ConfigError('producer_session_id is not a permissible whitelist key')`；强制绕过：BindingResolver 的 deny-list 仍阻止 provenance keys 流入 AgentPayload。

---

## 5. Fixtures 与 helpers 设计

### 5.1 目录骨架

```
tests/
├── conftest.py                       # 新增：通用 helpers + fixtures
├── _helpers/
│   ├── binding.py                    # binding_node, data_edge, workflow_call_binding
│   ├── result_store.py               # in-memory ResultStore stub
│   ├── provenance.py                 # ProvenanceObject builder
│   ├── runtime.py                    # tmp_run_dir, run_manager_factory
│   ├── adapters.py                   # fake_executor, capture_env
│   └── strategies.py                 # hypothesis strategies
├── fixtures/
│   ├── capsules/
│   │   ├── echo_task/                # T-050
│   │   ├── requires_y/               # T-048
│   │   ├── legacy_full_appendix/     # T-011
│   │   ├── task_only_appendix/       # T-012
│   │   ├── none_appendix/            # T-013, T-055
│   │   ├── legacy_no_policy_field/   # T-014
│   │   ├── explicit_input_macro/     # T-055
│   │   └── legacy_corpus/            # T-061a baseline freeze ≥5 个 (T-061b consumes from same corpus)
│   ├── redesign/
│   │   ├── all_five_bindings.accflow.json
│   │   ├── three_node_chain.accflow.json
│   │   ├── nested_workflow_call.accflow.json
│   │   ├── mixed_mode.accflow.json
│   │   ├── explicit_only.accflow.json
│   │   ├── reference_materialization.accflow.json
│   │   ├── aggregation_only.accflow.json
│   │   ├── no_aggregation.accflow.json
│   │   ├── multi_port_node.accflow.json
│   │   ├── 100_node_level.accflow.json
│   │   ├── deep_nested_5.accflow.json
│   │   ├── control_only.accflow.json
│   │   ├── dataedge_only.accflow.json
│   │   ├── standard_chain.accflow.json
│   │   └── two_node_chain.accflow.json
│   ├── legacy/                       # 复用 examples/workflows
│   └── baselines/
│       ├── phase1/
│       ├── legacy_full_resolved_prompt.md
│       ├── legacy_corpus_phase1/
│       └── legacy_full_run/
└── server/conftest.py                # 现有；不动
```

### 5.2 共享 fixtures（`tests/conftest.py`）

| Fixture | scope | 作用 |
|--------|-------|------|
| `tmp_run_dir(tmp_path)` | function | 生成 `tmp_path/runs/<uuid>/`，返回 RunDir handle |
| `result_store_stub()` | function | in-memory ResultStore，可注册 NodeResult |
| `provenance_builder()` | function | 合法 ProvenanceObject builder（避免每用例手填 12 字段） |
| `clean_template(tmp_path)` | function | 写最小 `.accflow.json` 至 tmp_path |
| `legacy_template(tmp_path)` | function | 写最小 legacy `.graph.json` |
| `windows_no_symlink(monkeypatch)` | function | `os.symlink → OSError(EPERM)` + `has_symlink_priv=False` |
| `posix_full_caps(monkeypatch)` | function | 强制 `has_symlink_priv=True, has_inode_links=True` |
| `capture_adapter_env()` | function | 包装 adapter 的 `build_env`，配合 T-023 / T-075 |
| `fake_executor(monkeypatch)` | function | `monkeypatch.setattr("acc.app.execute_clean_node", ...)` |

### 5.3 Mock 契约

**InMemoryResultStore**
```python
class InMemoryResultStore:
    def register(self, node_result, output_json=None, outbox_files=None) -> None: ...
    def get(self, run_id, node_id, port_id) -> NodeResult | None: ...
    def has(self, run_id, node_id, port_id) -> bool: ...
    def query(self, *, run_id) -> list[NodeResult]: ...
```
契约：register 自动写 outbox_manifest.json 至 tmp run_dir；get 跨 run 时返回 None；不持久化跨测试。

**Fake executor**
```python
async def fake_execute_clean_node(node_id, agent_payload, *, run_dir,
                                  outputs=None, fail=False) -> NodeOutcome: ...
```
契约：不启动子进程；按 outputs 写入 outbox + ArtifactBundle + ProvenanceObject；调用顺序与 T-026 规定一致：outbox_manifest → events.jsonl(node_finished) → binding_materializations → completed_nodes。

### 5.4 Helper 工厂

| Helper | 用途 |
|--------|------|
| `binding_node(node_id, *, kind='selector', selector='field:.task')` | 构造 NodeInputBinding |
| `data_edge(source, target, *, materialization='reference')` | 构造 DataEdge + DataEndpoint |
| `workflow_call_binding(call_site_id, parent_source, target_input)` | 构造 WorkflowCallInputBinding |
| `expect_binding_manifest_row(rows, **kw)` | 断言 helper |
| `make_artifact_bundle(node_id, port_id, *, content)` | 在 tmp run_dir 内造 bundle |
| `freeze_baseline(run_dir, baseline_dir)` | 拷贝 run_dir 至 baseline（手工更新） |

### 5.5 hypothesis strategies（`tests/_helpers/strategies.py`）

```python
binding_input_strategy = st.tuples(st.text(min_size=1, max_size=8), sha256_hex_strategy)
provenance_strategy    = st.builds(ProvenanceObject, ...)
small_dag_strategy     = st.builds(make_dag, n_nodes=st.integers(1, 30))
selector_strategy      = st.one_of(field_st, outbox_st, artifact_st, each_of_st)
```

---

## 6. CI 集成

### 6.1 pytest 配置（扩展 `pyproject.toml [tool.pytest.ini_options]`）

```toml
markers = [
    "unit", "integration", "property", "e2e", "migration", "performance", "security",
    "legacy", "windows", "posix", "slow",
    "T_AC1", "T_AC2", "T_AC3", "T_AC4", "T_AC5", "T_AC6", "T_AC7", "T_AC8", "T_AC9",
    "T_AC10", "T_AC11", "T_AC12", "T_AC13", "T_AC14", "T_AC15", "T_AC16", "T_AC17", "T_AC18",
]
```

> `T_AC1..T_AC18` — 每个 verifies AC<n> 的 test 必须声明 `@pytest.mark.T_AC<n>`；main e2e 恰好声明一个；supporting case 可多个。全部 18 个 mark 在 `pyproject.toml [tool.pytest.ini_options].markers` 中注册。

### 6.2 Lane 配置（`.github/workflows/ci.yml` 期望形态）

| Lane | 命令 | 是否 gating |
|------|------|------------|
| main | `pytest -m "not legacy and not slow"` | 是 |
| legacy | `pytest -m "legacy and not slow"` | 是（独立） |
| nightly-slow | `pytest -m slow` | 否 |
| windows-fallback | `pytest -m "windows and not slow"`（windows runner） | 是 |
| posix-only | `pytest -m "posix and not slow"`（ubuntu runner） | 是 |

### 6.3 覆盖率阈值

- 全仓行覆盖率：80%（`pyproject.toml [tool.coverage.report] fail_under = 80`）。
- 新引入模块（按 module-level glob 匹配）：90%
  - `acc/binding/` （前规划稿写作 `acc/runtime/binding_resolver.py`，按 STRATEGY 落点修正）
  - `acc/persistence/` （前规划稿写作 `acc/persistence/checkpoints.py`，按实际文件 glob 修正）
  - `acc/provenance.py` （保留）
  - `acc/result_store/`
  - `acc/runtime/`
  - `acc/scheduler/`
- CI 加保护：每个 glob 在 `pytest --cov` 报告基数 > 0 才施加 `--cov-fail-under=90`，避免空 glob silent dead-gate。
- 进入 Phase 3 后开 `--cov-branch`，阈值 75%。
- hypothesis falsifying example 必须 commit `.hypothesis/`。

### 6.4 慢测试隔离

- 性能层（T-069..T-072）默认 `@pytest.mark.slow`。
- nightly：`pytest -m slow --benchmark-storage=tests/performance/baselines/`。
- nightly 一次性 gating（对应 AUDIT P-005，*concurrency-overhead 5%*）；AUDIT `ci_perf_lane` 允许 per-check override。
- *wall-clock 20%* 预算（perf_baseline 命名）：T-069/T-071/T-072 单个 check 退化超 baseline 20% → CI 警告（不立即每 PR gating，nightly 触发）。

### 6.5 Windows 必跑用例

T-010 / T-035 / T-063 / T-072 必须在 Windows runner 上执行。即便 mock 已覆盖逻辑路径，至少一台真实 Windows runner 跑一遍 main lane 兜底。

### 6.6 矩阵自检

T-058 在 main lane 强制运行；subprocess 调 `pytest --collect-only`，失败即说明某 AC 不再有 verifying test。

---

## 7. 验收门槛

### 7.1 Phase 1（substrate hardening）

> 目标：mixed mode 下行为与 baseline 字节级一致；ProvenanceObject、ENV 透出、相对路径、checkpoint 框架就位。

**必过**：T-006, T-007, T-008, T-019, T-020, T-023, T-024, T-026, T-031, T-040, T-043, T-045, T-049, T-057, T-058, T-059, T-061a, T-062, T-064, T-065, T-068a, T-074, T-075。

**Phase 1 不强制**：依赖 BindingResolver 真实选择路径的用例（T-001..T-005, T-015, T-016, T-027..T-039）—— Phase 1 用 stub 占位即可；AC10 projection 视配套节奏。

### 7.2 Phase 2（render_prompt rewrite + payload split + Workbench inspector）

> 目标：AgentPayload / RuntimePayload 拆分、prompt_appendix_policy 落地、acc_expose_* 标记可用、explicit_only mode 可按 workflow 启用。

**必过 Phase 1 全部 + 以下**：T-001..T-005, T-009, T-010, T-011..T-014, T-015, T-016, T-021, T-022, T-027, T-030, T-032, T-033, T-038, T-039, T-042, T-044, T-046, T-047, T-048, T-050, T-054, T-055, T-056, T-058, T-061b, T-066, T-067, T-068b, T-073, T-077。

### 7.3 Phase 3（ResultStore + default flip + migration tool + approval barrier）

> 目标：BindingResolver = ResultStore 客户端；默认 explicit_only；migration 工具；approval barrier 落地；Windows fallback 上线；reference 物化扩展到任意节点。

**必过 Phase 1 + Phase 2 + 以下**：T-017, T-018, T-025, T-028, T-029, T-034, T-035, T-036, T-041, T-051, T-052, T-053, T-058, T-060, T-063, T-067, T-076。性能层 T-069..T-072 在 nightly slow lane 中绿灯，回退 ≤ 20%。

### 7.4 全局门槛（Ship）

- 18 / 18 AC（含 AC18 由支撑用例覆盖）主轨与支撑用例 100% 通过。
- main lane：100% 通过 + 行覆盖 ≥ 80%。
- legacy lane：100% 通过（legacy 字节级 baseline 不破）。
- windows lane：T-010 / T-035 / T-063 / T-072 全部通过。
- T-058 矩阵自检通过 —— 任何 AC 失去 verifying test 即 ship 失败。
- DESIGN.md §15 Q（Q3 / Q4 / Q9 / Q11 / Q12 等）至少在文档侧关闭，Phase 3 ship 前不再有 AMBIGUOUS 标签的 primitive。

---

## 附录 A — 现有测试迁移路径

DESIGN.md `tests` recon 指出现有用例锁定了与新设计相反的不变量。Phase 1 必须迁移（**不删除**）：

| 现有用例（file:line） | 锁定行为 | 迁移动作 |
|--------------------|---------|---------|
| `tests/unit/test_clean_workflow_engine.py:169-197` | 默认 ControlEdge 透传 upstream_context | parametrize：default 分支 = 新 default（AC1）；legacy 分支 = `ControlEdge.context='upstream_output'` 显式构造，加 `@pytest.mark.legacy` |
| `tests/unit/test_clean_workflow_engine.py:200-251` | 256 KiB inline 阈值 | 拆两条：legacy lane 锁旧形态；main lane 锁 T-024 + T-046 阈值不变量 |
| `tests/unit/test_clean_workflow_engine.py:294-347` | upstream_context 顺序 / 共享路径 | 仅 legacy lane 保留；main lane 由 T-001/T-002/T-027 替代 |
| `tests/unit/test_clean_workflow_engine.py:350-398` | 嵌套 workflow 默认透传父 upstream_context | 翻转：main lane 验证「不透传」（T-030）；legacy lane 保留旧断言 |
| `tests/unit/test_prompting.py` | 模板未引用 input_json 时自动追加 | parametrize：legacy_full / task_only / none 三分支（即 T-011..T-013） |

**迁移原则**（DESIGN.md AC12 治理）：不删除，全部 `@pytest.mark.legacy` 隔离；CI legacy lane 与 main lane 独立运行；legacy 失败不阻塞 main lane（initially advisory），Phase 3 默认翻转后转 gating。

---

## 附录 B — 用例编号汇总

```
unit         T-001..T-026  (26)
integration  T-027..T-039  (13)
property     T-040..T-046  ( 7)
e2e          T-047..T-063  (17)
migration    T-064..T-068  ( 5)
performance  T-069..T-072  ( 4)
security     T-073..T-077  ( 5)
                           ----
                            77
```

总计 **77** 用例，覆盖 **18 / 18** AC（AC18 由 T-027 / T-030 / T-071 共同覆盖，无独立 e2e 主轨），分布于 7 个测试层。
