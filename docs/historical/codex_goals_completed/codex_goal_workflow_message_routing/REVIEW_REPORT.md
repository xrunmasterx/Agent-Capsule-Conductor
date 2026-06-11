# ACC Workflow Message Routing — 跨文档审查报告

> **审查对象**：`docs/codex_goal_workflow_message_routing/` 下的 5 份核心交付物
> **审查模式**：7 维度并行评审 + adversarial verification pipeline
> **报告语言**：中文叙述；代码标识符 / 文件路径 / 命令 / finding ID 保持英文

---

## 1. 摘要

### 1.1 审查范围

本次审查覆盖 ACC（Agent Capsule Conductor）"Workflow 消息路由重构"项目的 5 份关键文档：

| Doc ID | 文件 | 摘要 |
|--------|------|------|
| `design` | `DESIGN.md` v0.2 (619 行) | 提出 *Binding-First Result Store with Layered Provenance* 方案，6 层分离（control flow / data flow / data grain / binding / provenance / agent-visible input），3 阶段交付（minimal_increment → result_store），17 条 ACs（AC1–AC17），16 条 open question（Q1–Q16） |
| `comparison` | `CC_WORKFLOW_COMPARISON.md` v0.1 | 把 ACC v0.2 与 Claude Code 动态 workflow 在"消息路由 / 状态传递"维度做横向对比，结论：`well_fit / design_is_close_minor_patches`（4 个轴上 first-principles 同构，分歧均为 ACC 必要约束所致） |
| `strategy` | `IMPLEMENTATION_STRATEGY.md` v0.1 (834 行) | 3 阶段实施计划，4 条核心原则、5 大 primitive 组、~50 个原语、8 cross-cutting invariants（X-1..X-8）、8 层模块拓扑 + R1..R7 import-linter 规则、~27 文件级 verdict、Phase 1/2/3 分别 17/14/17 项变更 |
| `tests` | `TEST_PLAN.md` v0.2 | 77 case 测试金字塔（26 unit / 13 integration / 7 property / 17 e2e / 5 migration / 4 performance / 5 security），全覆盖 17 ACs，T-058 静态校验 AC×Test 矩阵 |
| `audit` | `AUDIT_PLAN.md` v0.1 | 89 条 audit checks 跨 10 维度（Correctness 18 / Layering 8 / Type Safety 8 / Error Handling 7 / Concurrency 8 / Security 8 / Performance 7 / Migration 8 / Observability 8 / Maintainability 9），自动化覆盖率 92.1%，phase 自动化目标 80%/88%/92% |

### 1.2 数字总览

- **Raw findings**：82
- **Confirmed**：46（55.6%）
- **Rejected (false positives)**：36（44.4%）
- **Top themes**：9 大主题，覆盖 critical 2 / high 6 / medium 1
- **Patch plan**：31 条补丁（P-001 … P-031），覆盖 5 critical / 13 high / 11 medium / 2 low

### 1.3 总体判定

> **Deliverables are ~80% solid**：原则、原语表、AC 结构均扎实，但 *cross-doc consistency* 是首要失败模式 —— Phase 3 在当前文档下**无法干净 exit**，主要原因：
>
> 1. **AC12 在 DESIGN / STRATEGY / AUDIT 三处指向不同 invariant**（critical-severity 审计 hook 锚错 AC）；
> 2. Phase-exit 测试列表与 §15 Q1–Q16 决策门在 TEST_PLAN / STRATEGY / AUDIT 之间相互矛盾；
> 3. 多个 primitive、字段名、import-linter R-rule 在文档间漂移。
>
> Layering 覆盖也不完整（`acc/persistence/`、`acc/scheduler/`、`acc/app/` 缺少 L-### 检查；R-rule 与 AUDIT 不一致），且若干 "NOT automated" 审计项实际可平凡自动化。

落地这 31 条补丁后，文档可进入 CCB peer review（提交给 codex reviewer 按 Rubric 打分）流程。

---

## 2. 审查方法

### 2.1 流水线

本次评审遵循 **dimension reviewers + adversarial verify** 双阶段流程：

1. **第一阶段 / dimension reviewers**：7 个独立维度并行 spawn reviewer 子任务，每个 reviewer 仅在本维度产出 raw findings（未去重、未仲裁），共 82 条。
2. **第二阶段 / adversarial verify**：对每条 raw finding 运行对抗式验证器：
   - **evidence cite check** —— 引用的行号和原文是否一一对应；
   - **counter-evidence search** —— 是否存在能反驳该 finding 的证据（其他文档段落、test、audit check）；
   - **refutation attempt** —— 显式反驳一遍，看 finding 是否仍站得住；
   - **stylistic guard** —— 排除纯口味/风格争议；
   - **achievability** —— 推荐的 fix 是否具体、可落地、且不超出 DESIGN scope。
   每条产出 `verdicts[finding_id]`，包含 `is_real / confidence / reason / counter_evidence / refutation`。

3. **第三阶段 / synthesis**：基于 `confirmed_findings` 提取 9 个 top themes，给出 31 条 patch_plan，其中每条 patch 标 `addresses` 字段反向对应 finding ID，便于审计闭环。

### 2.2 7 个评审维度

| 维度 | Reviewer 关注点 |
|------|----------------|
| `correctness` | AC 与测试的语义一致性、phase-exit 门可执行性 |
| `layering` | 模块边界、import-linter 规则、L-### 覆盖完整性 |
| `first_principles` | 原语去重、概念是否最小不可分、是否被多处定义 |
| `test_coverage` | AC×Test 矩阵、coverage threshold 路径正确性、phase 划分 |
| `audit_rigor` | 自动化标签准确性、severity 一致性、资源预算缺口 |
| `cross_doc_consistency` | 字段名、phase 计划、问题决策门跨文档对齐 |
| `missing_pieces` | COMPARISON action items 是否落地、UI 测试 / 缓存隔离测试缺失 |

复现方式：把 5 份 doc + dimension 描述喂给独立 reviewer，再对每条 raw finding 跑一遍 `verdicts` schema 描述的 adversarial validator 即可。

---

## 3. 核心主题（Top Themes）

按严重度排序的 9 大主题如下：

| # | 主题 | Severity | Findings | 落地补丁 |
|---|------|----------|----------|----------|
| T1 | AC12 一名两义 | **critical** | `correctness-001`, `audit_rigor-001` | P-001 |
| T2 | Phase-exit 门跨文档矛盾 | **critical** | `correctness-002`, `correctness-003`, `audit_rigor-002`, `cross_doc_consistency-001`, `cross_doc_consistency-003`, `cross_doc_consistency-006`, `missing_pieces-002`, `missing_pieces-004`, `test_coverage-002` | P-002, P-003, P-004, P-005 |
| T3 | Layering / import-boundary 覆盖不全 | **high** | `layering-001..006`, `layering-008`, `layering-009`, `layering-011` | P-006, P-007, P-008, P-009, P-010 |
| T4 | AC↔Test 矩阵漂移 | **high** | `correctness-004`, `correctness-009`, `test_coverage-001`, `test_coverage-005`, `test_coverage-007`, `test_coverage-010`, `cross_doc_consistency-002` | P-011, P-012, P-013, P-014 |
| T5 | 字段 / 原语 / first-principles 漂移 | **high** | `cross_doc_consistency-008`, `missing_pieces-008`, `first_principles-001`, `first_principles-010`, `first_principles-011` | P-022, P-023, P-025, P-026, P-027 |
| T6 | 并发上限与性能预算未决/不一致 | **high** | `cross_doc_consistency-009`, `cross_doc_consistency-012`, `missing_pieces-001`, `test_coverage-006` | P-016, P-017 |
| T7 | Audit 严谨度（自动化标签 / severity / 资源预算） | **high** | `audit_rigor-003`, `audit_rigor-004`, `audit_rigor-009`, `audit_rigor-010` | P-018, P-019, P-020, P-021 |
| T8 | DESIGN ↔ tests 契约漂移 | **high** | `test_coverage-004`, `cross_doc_consistency-011` | P-015, P-024 |
| T9 | 缺失 / 待落地 features | **medium** | `missing_pieces-005`, `missing_pieces-006`, `missing_pieces-009`, `missing_pieces-012` | P-028, P-029, P-030, P-031 |

### 3.1 T1 — AC12 一名两义（critical）

DESIGN AC12 (L528-L530) 的字面定义是 **测试分层治理**（legacy tag + main lane explicit-binding 矩阵），且 in-scope invariants 只列了 AC1/AC2/AC4/AC5/AC6/AC8/AC9。但是 AUDIT C-017 (L85，severity **critical**)、STRATEGY R-5 (L449)、STRATEGY 多处 AC12 引用（L77, L243, L255, L260）都把 AC12 解释为 **嵌套 workflow control-context 隔离**。TEST_PLAN T-058 测的是治理矩阵，T-071 测的却是 `no parent upstream_context bleed`。结果：一个 critical-severity audit hook 与一个 critical risk **锚到了 DESIGN 里语义完全不同的 AC**。CI 上报 `AC12 PASS` 时无法区分两个 intent。AUDIT 自身在 §6 L365 与 C-017 之间也自相矛盾。

> **修复方向**：拆出 AC18 = "Nested workflow boundary isolation"，把 C-017 / R-5 / T-027 / T-030 / T-067 / T-071 全部重定向（参见 P-001）。

### 3.2 T2 — Phase-exit 门跨文档矛盾（critical）

这是最危险的一类问题：3 份文档对"Phase N 何时算 done"给出**不可同时满足的**条件。

- STRATEGY P1-exit-1 (L309) 写 *T-001..T-053 pass*；TEST_PLAN phase1_exit (L749-L753) 仅列 22 个具体 test，且 L755 显式声明 *"T-001..T-005, T-015, T-016, T-027..T-039 stub placeholder OK in Phase 1"*。范围式与列表式不可调和。
- T-061 / T-068 在 phase1_exit must-pass 列表里，但其 spec 是"Phase 2/3 byte-equal to Phase 1 baseline"——Phase 1 阶段没有 Phase 2/3 产物可对比。
- T-008 (NodeCacheKey 测试) 在 phase1_exit must-pass，可被测模块 `acc/persistence/cache_key.py` 在 STRATEGY 里被排在 Phase 3 (L383)。
- AUDIT phase3_exit_q_resolution 要求 *Q1–Q16 all decided*；STRATEGY §8 把 Q3/Q12 显式 deferred 到 "Phase 4"；TEST_PLAN ship_gate 又仅列 5 个 Q（Q3/Q4/Q9/Q11/Q12）。3 个门各说各话。
- TEST_PLAN ship_gate 把 Q12 列为 ship blocker，STRATEGY Q12 = `UNDECIDED ... deferred to Phase 4`——直接打架。

> **修复方向**：以 TEST_PLAN §11 phase exit 列表为单一真理源（P-002）；T-061/T-068 拆为 *baseline freeze* + *byte-equal*（P-003）；NodeCacheKey 提前到 Phase 1（P-004）；用 per-Q 表格取代笼统的"all 16 decided"门（P-005）。

### 3.3 T3 — Layering / import-boundary 覆盖不全（high）

`acc/persistence/`、`acc/scheduler/`、`acc/app/` 三层在 STRATEGY 里有边界声明，但**都没有对应的 L-### check 或 R-rule**。同时 STRATEGY R1 漏掉了 AUDIT L-001 显式禁止的 `acc.cli`，R3 漏掉了 AUDIT L-004 显式禁止的 `fastapi/typer`。AUDIT L-003 误把 `acc/provenance.py` 写作 `acc/binding/provenance.py`。`binding ↔ result_store` 的依赖方向在 Phase 1 与 Phase 3 之间反转，没有 contract-versioning 计划。Phase 3 的 `DAGScheduler / ApprovalBarrier` 没出现在 scheduler 的 public_api 列表里。

> **修复方向**：补 L-009 / L-010 / L-011（P-006）；让 R1/R3 与 AUDIT 一致（P-007）；修 L-003 路径（P-008）；选定 binding→result_store 方向（P-009）；扩展 architecture_test 列表（P-010）。

### 3.4 T4 — AC↔Test 矩阵漂移（high）

- TEST_PLAN markers 列表（L709-L710）里**没有** `T_AC1..T_AC17` 标记，但 AUDIT 的多个检查直接调用 `pytest -m T_AC2/T_AC8/...`——这些命令选不到任何 test。
- T-058 自检以"AC mark coverage"为前提，但 mark 约定从未定义，"disjoint on legacy files" 的判断粒度也未说清。
- T-070 是纯并发 cap 测试（concurrency=16, 100 节点 fan-out），却被标为 "verifies AC8"——AC8 是 upstream_context opt-in 语义。
- STRATEGY X-4 enforcement (L168) 写"Tests: T-074/T-077"，但这两个 test 测的是 ConfigError 否定路径；真正测 hash mutex 的是 T-007 / T-046。
- coverage:new_modules 列出的文件路径（`acc/runtime/binding_resolver.py`, `acc/persistence/checkpoints.py`）在 STRATEGY 模块布局里**根本不存在**。

> **修复方向**：注册 T_AC* marker 并让 T-058 提前到 Phase 1/2 exit（P-011）；T-070 重新归类（P-012）；X-4 重路由到 T-007+T-046（P-013）；coverage:new_modules 改用模块级 glob（P-014）。

### 3.5 T5 — 字段 / 原语 / first-principles 漂移（high）

- AUDIT C-016 用 `value_sha256`，DESIGN/STRATEGY/TEST_PLAN 用 `inline_value_sha256`——而 AUDIT 自己的 MN-008 显式禁止 legacy alias。
- `invoking_workflow_call_id` 在 STRATEGY 里标 *(inferred)*，被 AUDIT C-003 引用，但 DESIGN §7.2 里**根本没有这个字段**。
- `NamespaceSelector` 在 data_plane 与 identity 两个 group 里同时出现，namespace 集合还不一致（4 vs 5）。
- *Standalone-Equivalent Execution* 被表述为 Principle / AC / Invariant 三种说法，covering surface 在 input.json / AgentPayload / resolved_prompt.md 三者间漂移。
- `ENV-existing-exposure` 与 `ENV-Phase1-new-exposure` 沿时间轴拆成两个 primitive，Phase 1 落地后即变成无意义噪声。

### 3.6 T6 — 并发上限与性能预算（high）

`max_concurrent_nodes_per_run=16 / max_total_nodes_per_run=1000 / max_active_runs=8` 这组数字在 STRATEGY R-6 / AUDIT P-005 / TEST_PLAN T-070 / phase3_exit_concurrency_defaults 里被硬编码，但 **DESIGN §11.1 从未做出决策**——STRATEGY 自己用 *(inferred 16, parity with Claude Code)* 的语气承认了这一点。同时 over-limit behavior（queue / fail / 429-like）从未定义。AUDIT P-005 的 5% drift 与 TEST_PLAN perf_baseline 的 20% 阈值未命名各自度量；T-070 的 *± slack* 未量化；ci_perf_lane 又是 "doesn't block PR"，与 phase3_exit 把 P-005 当作硬门相互打架。

### 3.7 T7 — Audit 严谨度（high）

- M-004 / M-008 / L-008 / P-002 / S-008 标 *NOT automated* 但实际可用 grep / AST scan / cache-hit counter / front-end component test 自动化。Phase 3 自动化目标 92%，razor-thin。
- C-014 在 §2.1 标 *high*，§6 review_scope_critical_items 又把它列入 critical 范畴，Appendix B 数字也对不上（critical=23 vs 实际可数 21–22）。
- T-001 声称 `mypy --strict` 可强制 `frozen=True`——事实上 mypy 不验证 dataclass 装饰器参数，需要 `pytest assert ProvenanceObject.__dataclass_params__.frozen is True`。
- 没有任何检查约束 `events.jsonl` 增长、`run_manifest.json` 大小、`input.json` 字节上限——而 `max_total_nodes_per_run=1000` 意味着单次运行可能有 1000 行 binding_materializations。

### 3.8 T8 — DESIGN ↔ tests 契约漂移（high）

- DESIGN agent_visible.opt_in 列出 *ProvenanceSummary (acc_expose_provenance=true)*，T-022/T-074/T-077 却硬断言 `acc_expose_provenance=true raises ConfigError`——AC3 在两个文档里有相互排斥的解读。
- STRATEGY P3-collect_upstream_context-delete 写"删除 collect_upstream_context"，但 LegacyPassthroughBinding（DESIGN §7.6）+ R-7 rollback 仍依赖该函数存在——Phase 3 ship 即破坏 AC11 要求的 legacy lane。

### 3.9 T9 — 缺失 / 待落地 features（medium）

COMPARISON action-1 的 invariant cheat-sheet 未在 DESIGN §1 落地；NodeCacheKey 没有 cross-run-isolation 测试；AC10 UI Inspector 的前端组件测试在 TEST_PLAN 缺位；safe-borrow-4 PlanPreview 也没有明确的 "Phase 4 deferred / 调度落地" 处置。

---

## 4. 维度发现详情

下文按 7 维度分章，每章给出 confirmed findings 概览表 + 详情。每条详情严格引用原始 `evidence` / `why_it_matters` / `recommendation` / verdict 一句话。

### 4.1 Correctness（5 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `correctness-001` | high | inconsistent | AC12 semantic conflict: 'test layering' vs 'nested workflow isolation' |
| `correctness-002` | high | inconsistent | Ship gate requires Q3/Q12 resolved, but STRATEGY defers them |
| `correctness-003` | medium | incorrect | T-068/T-061 in Phase 1 must-pass list verify Phase 2/3 byte-equality |
| `correctness-004` | medium | incorrect | T-070 misclassified as AC8 supporting — actually verifies concurrency caps |
| `correctness-009` | medium | ambiguous | T-058 AC×Test matrix self-check relies on undefined 'AC mark' convention |

#### `correctness-001` —— AC12 一名两义

- **Evidence**：DESIGN AC12 (L528-L530) 字面是 *Test layering*；STRATEGY L77/L243/L255/L260/R-5 (L449)、AUDIT C-017 (L85) 都把 AC12 当作 *WorkflowCallInputBinding boundary / nested isolation*；AUDIT §6 L365 又把 AC12 映射到 *Test stratification*。
- **Why it matters**：critical-severity 审计 hook 锚到 DESIGN 里定义不同的 AC。"嵌套 workflow 隔离"在 DESIGN 里没有任何 AC 锚点。
- **Recommendation**：(a) 新增 AC18 = "Nested workflow boundary isolation"，重映射 C-017/T-027/T-030/T-071/R-5；或 (b) 重新归到 AC2（explicit-binding-only 的推论）。
- **Verdict reason**：高置信度真问题；STRATEGY/AUDIT 跨 4 处独立位置错锚 AC12，TEST_PLAN T-058 vs T-071 的双解读再次确认。

#### `correctness-002` —— Ship gate 要求 Q3/Q12 解决，STRATEGY 却 defer

- **Evidence**：TEST_PLAN ship_gate (L769-L776) 要求 *Q3/Q4/Q9/Q11/Q12 closed*；AUDIT phase3_exit_q_resolution (L416) 要求 *Q1–Q16 all decided*；STRATEGY Q3 (L475) `DEFERRED to end of Phase 3 or Phase 4`，Q12 (L484) `UNDECIDED ... deferred to Phase 4`，Q15/Q16 *partial*。
- **Why it matters**：Phase 3 ship 在某个门下必然过不去，否则就是默认 waive。
- **Recommendation**：(a) 强制 STRATEGY 在 Phase 3 ship 前给 Q3/Q12 一个最终决定；或 (b) 放宽 ship gate / AUDIT 接受 *deferred-with-rationale*。
- **Verdict reason**：高置信度真问题；4 文档证据互相打架，无任何缓和文本。

#### `correctness-003` —— T-061/T-068 列在 Phase 1 must-pass，却测 Phase 2/3 行为

- **Evidence**：TEST_PLAN phase1_exit 列出 T-061/T-068；T-061 (L494-L497) 测 *Phase 2/3 byte-equal to Phase 1 baseline*；T-068 (L535-L539) 测 *explicit override breaks parity (reverse validation)*；STRATEGY P1-baselines (L305) 明确 Phase 1 *生成* baseline。
- **Why it matters**：要么 T-061 vacuously true 屏蔽 AC15 风险；要么阻塞 Phase 1 ship。T-068 在 Phase 1 没有 prompt_appendix_policy 路径，reverse validation 必然失败。
- **Recommendation**：拆 T-061a (Phase 1 freeze baseline) + T-061b (Phase 2/3 byte-equal)；同样拆 T-068。AUDIT phase1_exit_test_green 移除 AC15。
- **Verdict reason**：高置信度；AUDIT 自身已把 AC15 byte-equality 放在 phase2_exit_critical_close。

#### `correctness-004` —— T-070 误标 AC8

- **Evidence**：TEST_PLAN AC8 矩阵 (L120) 列 T-070；T-070 (L549-L553) 是纯并发 cap 测试，零次提到 upstream_context / opt-in / acc_receive_upstream_context；AC8 (DESIGN L512-L514) 完全是 opt-in 语义。
- **Why it matters**：T-058 矩阵自检会把它统计为 AC8 覆盖，给出虚假信心。
- **Recommendation**：从 AC8 矩阵移除 T-070，重新归到 N-001 (concurrency permit) 或非 AC 性能回归。
- **Verdict reason**：高置信度；T-070 的 assertion 完全是 wall-clock + 并发数。

#### `correctness-009` —— T-058 自检依赖未定义的 AC mark

- **Evidence**：TEST_PLAN markers (L709-L710) 没列 `T_AC1..T_AC17`；AUDIT 在 S-001/S-002/M-001/M-003/N-003/O-003 等多处用 `pytest -m T_AC*`。
- **Why it matters**：`pytest -m T_AC*` 选不到任何 test；T-058 矩阵自检无可操作谓词。
- **Recommendation**：在 TEST_PLAN §marks 加注 `T_AC1..T_AC17` 约定，注册到 `pyproject.toml`；T-058 显式 assert `每个 AC≥1 main-lane test`。
- **Verdict reason**：中置信度；T-058 实现可改为按 test 名 pattern 解析作妥协，但 AUDIT `-m` 调用仍需修。

### 4.2 Layering（9 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `layering-001` | high | missing | acc/persistence/ has no dedicated L-### check |
| `layering-002` | high | missing | acc/scheduler/ has no dedicated L-### check |
| `layering-003` | medium | inconsistent | STRATEGY R1 forbidden list omits 'cli' that AUDIT L-001 forbids |
| `layering-004` | medium | inconsistent | STRATEGY R3 omits fastapi/typer ban that AUDIT L-004 enforces |
| `layering-005` | medium | incorrect | AUDIT L-003 misnames provenance file path |
| `layering-006` | high | inconsistent | Binding outbound deps contradict between Phase 1 and Phase 3 |
| `layering-008` | medium | under_specified | Architecture-test coverage misses L-003 (provenance) and L-008 (projection) |
| `layering-009` | medium | under_specified | acc/app/ outbound is unconstrained with no L-### enforcement |
| `layering-011` | low | missing | acc/scheduler/ public_api does not expose Phase 3 DAGScheduler / ApprovalBarrier |

#### `layering-001` —— `acc/persistence/` 无 L-### 检查

STRATEGY L187 显式定义 persistence 层边界（inbound binding/result_store/scheduler/server，outbound domain/stdlib），但 AUDIT §2.2 仅列 L-001..L-008，**完全没覆盖 persistence**。STRATEGY architecture_test 列表（L208-L213）也只 6 个 test，无 `test_persistence_layer_pure`。Persistence 是 Phase 1 新引入的层，承载 atomic_write、run_manifest writer、events_writer、NodeCacheKey——这些是 X-1/X-7 atomicity invariants 与 AC6/AC13 的支撑。无 import-linter 契约即意味着 `acc/server/run_manager.py` 或 `acc/app/*` 可以随时绕过 public API 直接 import 私有 `_temp_path_strategy / _lock_registry`。

> **Verdict**：high 置信，独立证据齐备，与 peer L-003/L-004 严重不对称，推荐添加 L-009 + R8 + `test_persistence_layer_pure`。

#### `layering-002` —— `acc/scheduler/` 无 L-### 检查

STRATEGY L188 仅写 *forbidden: fastapi/typer*，对比 binding/runtime 的 *forbid lateral peers* 显得过于宽松。AUDIT §2.2 无 scheduler 条目；STRATEGY architecture_test 也无 `test_scheduler_layer_pure`。Phase 3 在 P3-scheduler-dag-approval (L384) 引入 DAGScheduler + ApprovalBarrier，正是 app/__init__.py:534-575 重写的高耦合区，最容易出现回环 import。

> **Verdict**：high 置信，与 peer 不对称的边界声明本身就是设计 oversight。

#### `layering-003` —— STRATEGY R1 漏列 `acc.cli`

STRATEGY R1 (L196) 列 *acc.server / acc.app / acc.scheduler / acc.runtime / acc.adapters / fastapi / typer*；AUDIT L-001 (L92) 多列 `cli`。R2 (L197)、R3 (L198) 都列了 cli，仅 R1 没列——更像 copy-paste 漏写。如果 .importlinter 直接从 R1 生成，`from acc.cli import ...` 就能在 `acc/binding/` 内畅通。

> **Verdict**：high 置信，medium severity（契约规范 gap，非结构缺陷），单行修复。

#### `layering-004` —— STRATEGY R3 漏 `fastapi/typer`

STRATEGY R3 (L198) 仅 *acc.app / acc.cli / acc.server / acc.store*；AUDIT L-004 (L95) 显式禁止 FastAPI/Typer。`acc/runtime/` 装载 AgentPayload/RuntimePayload 装配、TransferPolicy、ApprovalBarrier helpers——绝不应耦合 HTTP framework symbol。

> **Verdict**：high 置信。append 两个模块名即可。

#### `layering-005` —— AUDIT L-003 路径写错

AUDIT L-003 (L94) 写 `acc/binding/provenance.py (i.e. acc/provenance.py) ...`。STRATEGY public_api (L226)、verdict_item (L271)、P1-provenance.py (L292)、architecture_test (L211) 一致把 provenance 放在 **顶层 `acc/provenance.py`**。括号注释会误导工具或开发者在 `acc/binding/` 下重建一份 provenance.py，直接破坏 AC13（单一 ProvenanceObject schema）和 MN-008（命名一致性）。

> **Verdict**：high 置信，medium severity，单行删括号即可。

#### `layering-006` —— binding ↔ result_store 方向反转

STRATEGY layer-acc/binding/ (L184) 声明 outbound 仅 *domain/persistence/stdlib*。但 STRATEGY P3-binding-resolver-resultstore (L380) 与 primitive BindingResolver (L79) 都写 *Phase 3 ResultStore client*——即 binding **必须** import result_store。同时 L184 写 binding 有 *inbound from result_store*，L185 写 result_store 有 *inbound from binding*——两张层卡片宣称互相反向消费，结构上循环。

> **Verdict**：high 置信。推荐方案：让 binding 在 outbound 里加 result_store 从 Phase 1 起即可（P-009）。

#### `layering-008` —— architecture_test 漏掉 provenance 与 projection

STRATEGY architecture_test (L208-L213) 仅 6 个 test，无 `test_provenance_module_pure`（对应 AUDIT L-003，severity high，**应当自动化**）。L-008 (run_projection.py) 在 AUDIT 标 *manual review*，但其内容（forbidden imports）完全可 import-linter / AST 自动化。

> **Verdict**：medium 置信，原因 L-008 部分确实是 AUDIT 自身刻意标 manual。L-003 的缺位无可辩驳。

#### `layering-009` —— `acc/app/` 缺 L-### 与 R-rule

STRATEGY L190 写 *acc/app/ inbound server/cli; outbound: all above layers' public APIs*——但**没有任何 R-rule、AUDIT L-### 来强制 "public APIs only"**。对比 L191（server）有显式 *MUST NOT cross app to read binding internals*，app 自己缺位。Phase 3 大量重写下层（BindingResolver→ResultStore client、reference 物化扩展），若 Phase 1/2 期间 app 漏入私有 `_in_memory_cache / _internal_resolve_field_selector / _temp_path_strategy`，Phase 3 重构即被卡住。

> **Verdict**：high 置信，medium severity；推荐 R8 + import-linter forbidden-symbol contract。

#### `layering-011` —— scheduler public_api 漏 Phase 3 新成员

STRATEGY public_api (L225) 仅暴露 `ReadySetComputer / compute_ready_set / Level / LevelIndex`；P3-scheduler-dag-approval (L384) 引入的 `DAGScheduler / ApprovalBarrier` 没有在 __init__.py 里 re-export，server/app 没有 canonical 入口可 import。MN-009（命名一致性）与 §4.3 自检里的"public API surfaces"条款都无参考列表。

> **Verdict**：medium 置信，low severity；persistence 已有 NodeCacheKey 加入 public_api 的先例，scheduler 应同步处理。

### 4.3 First Principles（3 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `first_principles-001` | high | inconsistent | NamespaceSelector listed as a primitive in TWO different groups |
| `first_principles-010` | medium | inconsistent | Standalone-Equivalent Execution stated as Principle, AC, and Invariant — three formulations |
| `first_principles-011` | low | over_engineered | ENV-existing-exposure / ENV-Phase1-new-exposure split into two primitives |

#### `first_principles-001` —— NamespaceSelector 两 group 双胞胎

STRATEGY L84 (data_plane) 把 `NamespaceSelector ADT` 描述为 4-variant discriminated union；L127 (identity) 又把 `NamespaceSelector 统一格式` 列为 5 namespace 集（多 `legacy`）。R-8 (L452) 又是 5 namespace 视角。AUDIT E-006 要求 workflow load-time 解析校验，而源真理自身对"合法 namespace 集"打架，BindingResolver / Workbench 编辑器必然分叉。

> **Verdict**：high 置信。归一到 data_plane 单一 primitive，authoritative 集合 = 5。

#### `first_principles-010` —— Standalone-Equivalent Execution 三表述

Principle-4 (L16) 指 *workflow input.json top-level keys ∩ {...} = ∅*；X-2 (L151) 指 *AgentPayload top-level keys*；DESIGN AC4 (L495-L498) 指 *workflow-mode input.json AND resolved_prompt.md*；StandaloneEquivalentExecution (L140) 又强调 "field-set equivalence (NOT byte equivalence)"。三种 surface 错位时 T-050 验证哪一个表面就模糊了。

> **Verdict**：medium 置信。建议把 Principle-4 对齐到 AUDIT C-004 的 AgentPayload 表述。

#### `first_principles-011` —— ENV 两个 primitive 拆得过细

STRATEGY 把 `ENV-existing-exposure` (L138) 与 `ENV-Phase1-new-exposure` (L139) 拆作两条 primitive；AUDIT S-003 (L145) 与 TEST T-023 (L270-L275) 已视作统一六元集。Phase 1 落地后区分即失效。

> **Verdict**：medium 置信，low severity；合并为单一 `AgentEnv`。

### 4.4 Test Coverage（7 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `test_coverage-001` | high | inconsistent | coverage:new_modules cites module paths absent from STRATEGY layout |
| `test_coverage-002` | high | ambiguous | T-061 in Phase 1 must-pass is semantically incoherent |
| `test_coverage-004` | high | inconsistent | T-022/T-074/T-077 contradict DESIGN's opt-in allowance for ProvenanceSummary |
| `test_coverage-005` | medium | under_specified | T-058 AC×Test matrix self-check absent from Phase 1 and Phase 2 exit |
| `test_coverage-006` | medium | under_specified | Performance test budgets are inconsistent or missing |
| `test_coverage-007` | medium | incorrect | T-070 verifies AC8 but actually exercises concurrency, not opt-in |
| `test_coverage-010` | low | ambiguous | T-058 'disjoint on legacy files' lacks operational definition |

#### `test_coverage-001` —— 覆盖率门指向不存在的路径

TEST_PLAN coverage:new_modules (L727) 要求 90% on `acc/runtime/binding_resolver.py`、`acc/provenance.py`、`acc/persistence/checkpoints.py`。STRATEGY 把 BindingResolver 放在 `acc/binding/resolver.py` (L221, L289)，persistence 文件是 `run_manifest.py / events_writer.py / atomic_write.py / cache_key.py` (L224, L291)。`binding_resolver.py` under runtime 与 `checkpoints.py` under persistence **均不存在**。CI 要么报 file-not-found，要么 silent dead-gate。

> **Verdict**：high 置信。改为模块级 glob 匹配。

#### `test_coverage-002` —— T-061 Phase 1 must-pass 语义不通

T-061 (L494-L497) 测 *Phase 2/3 byte-equal to Phase 1 baseline*，列在 phase1_exit (L749-L753)；STRATEGY P1-baselines (L305) 明确 Phase 1 才*生成* baseline。Phase 1 阶段没有 Phase 2/3 实现可对比。

> **Verdict**：high 置信。拆成 T-061a / T-061b（同 P-003）。

#### `test_coverage-004` —— T-022/T-074/T-077 与 DESIGN opt-in 路径冲突

DESIGN agent_visible.opt_in (L312-L323) 列 *ProvenanceSummary (acc_expose_provenance=true)*；TEST_PLAN T-022/T-074/T-077 硬断言 *acc_expose_provenance=true raises ConfigError*。AC3 由此有两种互斥解读。Phase2.deliverable.expose_flags (L445) 还把 acc_expose_provenance 当作可交付 flag。

> **Verdict**：high 置信。推荐 deny-only 路线（P-015）。

#### `test_coverage-005` —— T-058 自检在 Phase 1/2 缺位

T-058 (L131, L479-L482) 是 AC×Test 矩阵自检；phase1_exit / phase2_exit 都没列 T-058，仅 phase3_exit 列。Phase 1/2 期间矩阵漂移无任何门拦截。但 T-058 本身在 main lane 持续运行（matrix_self_check 与 ci_main 即可拦截 PR），所以 *"两个 phase 静默漂移"* 框架略夸张；底层 gap 仍真：Phase 1/2 各自的 expected matrix 子集尚未定义。

> **Verdict**：medium 置信。Phase-aware allowlist + 提前到 phase1_exit / phase2_exit must-pass。

#### `test_coverage-006` —— 性能预算不一致或缺失

T-069 *≤20% degradation*；T-070 *±slack*（slack 未定义）；T-071/T-072 无降级预算；perf_baseline (L734-L735) *>20% warning, not gating*；AUDIT P-005 (L160) *<5% drift*。AUDIT 与 TEST_PLAN 在同一 nightly runner 上施加不同度量，CI 无法分类。

> **Verdict**：medium 置信。命名 *concurrency-overhead 5%* vs *wall-clock 20%*，定义 slack 数值（P-017）。

#### `test_coverage-007` —— T-070 verifies AC8 误标

同 `correctness-004`。re-mark 到 N-001 或非 AC，或扩展 T-070 增加 *no upstream_context under explicit_only fan-out* 断言。

#### `test_coverage-010` —— T-058 disjoint 缺操作定义

T-058 *"main lane and legacy lane disjoint on legacy files"* 既可按 file path、又可按 test ID、按 AC、按 mark 组合解读。Appendix A (L786-L789) 列出像 `test_clean_workflow_engine.py` 这样在同一文件里既含 main-lane parametrize 又含 legacy 分支的情况——file-level disjoint 会误报。

> **Verdict**：medium 置信。锁定为 *test-ID 级 disjoint，file-permissive*。

### 4.5 Audit Rigor（6 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `audit_rigor-001` | critical | inconsistent | AC12 semantically conflated across DESIGN/STRATEGY/AUDIT |
| `audit_rigor-002` | high | inconsistent | Q1–Q16 phase-resolution timing contradicts across all 4 docs |
| `audit_rigor-003` | high | incorrect | Several 'NOT automated' items are trivially automatable |
| `audit_rigor-004` | medium | inconsistent | C-014 severity tag conflicts between check definition and §6 review-scope |
| `audit_rigor-009` | medium | incorrect | T-001 'frozen dataclass' requirement not enforced by mypy --strict alone |
| `audit_rigor-010` | medium | missing | Missing resource-budget audits: events.jsonl, run_manifest, agent-input |

#### `audit_rigor-001` —— AC12 跨文档语义冲突（与 `correctness-001` 同源，独立维度复证）

详见 3.1。这条 finding 在 audit_rigor 维度被独立 raise——表明问题穿透多个 reviewer 视角。Severity **critical**：critical-severity 审计 hook 锚错 AC，CI 报 "AC12 PASS" 时无法区分。

#### `audit_rigor-002` —— Q1–Q16 决策时机跨 4 文档矛盾

AUDIT phase3_exit_q_resolution (L416) 要 *all decided*；STRATEGY Q3/Q7/Q12 *deferred to Phase 4*、Q8/Q15/Q16 *partial*；TEST_PLAN ship_gate 仅列 5 个 Q。3 个门不可同时满足。

> **Verdict**：high 置信。建议把 DESIGN §15 设为 SoT，每条 Q 标 `exit_phase ∈ {1,2,3,post-GA}`。

#### `audit_rigor-003` —— "NOT automated" 标签虚高

P-002 (cache-hit counter)、S-008 (front-end component test)、L-008 (projection 公共 API import 检查) 在描述里就已经点名了**自动化方法**，却被标 *NOT automated*。M-004 (DEPRECATED 注释行号 grep)、M-008 (单一 default 常量 grep) 同样可脚本化。Phase 3 自动化 82/89=92.13%，razor-thin。

> **Verdict**：medium 置信。3/5 例（P-002 / S-008 / L-008）足够支撑核心结论；M-004/M-008 较弱可保留。

#### `audit_rigor-004` —— C-014 severity 自相矛盾

§2.1 标 *high*；§6 review_scope_critical_items 又列入 critical 路由。Appendix B 声称 critical=23、§2 实际可数 21–22。

> **Verdict**：high 置信。建议提升 C-014 → critical（cycles 是 AC1/AC7 前置条件），并跑脚本核对 Appendix B 计数。

#### `audit_rigor-009` —— T-001 frozen dataclass 强制工具不当

T-001 (L105) 写 *mypy --strict acc/provenance.py* 来强制 frozen=True——但 mypy 不验证 dataclass 装饰器参数。Contributor 移除 `frozen=True` 即静默通过 mypy。

> **Verdict**：high 置信。补 `pytest assert ProvenanceObject.__dataclass_params__.frozen is True`。

#### `audit_rigor-010` —— 缺资源预算审计

P-001..P-007 涵盖 ReadySet 复杂度、cache hit、InlineThreshold=256 KiB 等，但**没有**：events.jsonl 增长、run_manifest.json 大小（max_total_nodes_per_run=1000，可能 1000 行 binding_materializations 入 manifest）、agent input.json 字节上限（each_of fan-in 聚合可能 OOM）。

> **Verdict**：medium 置信。补 P-008/P-009/P-010（P-021）。

### 4.6 Cross-Doc Consistency（8 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `cross_doc_consistency-001` | critical | inconsistent | STRATEGY P1-exit "T-001..T-053 pass" vs TEST_PLAN explicit exclusions |
| `cross_doc_consistency-002` | high | incorrect | STRATEGY X-4 enforcement points to T-074/T-077 — wrong tests |
| `cross_doc_consistency-003` | high | inconsistent | NodeCacheKey: STRATEGY says Phase 3 new module, T-008 in Phase 1 must-pass |
| `cross_doc_consistency-006` | medium | inconsistent | TEST_PLAN ship_gate vs AUDIT phase3_exit on §15 questions |
| `cross_doc_consistency-008` | medium | inconsistent | AUDIT C-016 uses `value_sha256` vs canonical `inline_value_sha256` |
| `cross_doc_consistency-009` | medium | under_specified | STRATEGY R-6 names default 16 for max_concurrency — no doc actually decides |
| `cross_doc_consistency-011` | high | incorrect | STRATEGY P3 deletes collect_upstream_context while LegacyPassthroughBinding still routes through it |
| `cross_doc_consistency-012` | low | ambiguous | STRATEGY P-005 (5%) and TEST_PLAN T-070 (slack) impose perf budgets the perf-lane is non-gating about |

#### `cross_doc_consistency-001` —— Phase 1 exit 列表矛盾（critical）

STRATEGY P1-exit-1 (L309) "T-001..T-053 pass"；TEST_PLAN phase1_exit 仅列 22 个具体 test，phase1_optional (L755) 显式 stub OK 子集；P2-exit-1 / P3-exit-1 同样以 range 写法包含或漏掉若干 phase-misaligned tests。这是最直接的执行风险：reviewer 取 STRATEGY 字面则要么阻塞要么静默放水。

> **Recommendation**：以 TEST_PLAN §11 为 SoT，STRATEGY phase exit 全部 verbatim mirror（P-002）。

#### `cross_doc_consistency-002` —— STRATEGY X-4 enforcement 测试列表错挂

STRATEGY X-4-enforcement (L168) "Tests: T-074/T-077"。但 T-074 (L575-L579) 测 FORBIDDEN 字段不到达 agent；T-077 (L592-L595) 测 ConfigError 否定路径——两者都不直接 assert hash mutex (XOR)。真实测 mutex 的是 T-007 (XOR check) + T-046 (property 100%)。

> **Recommendation**：单行修复，"Tests: T-007 + T-046"（P-013）。

#### `cross_doc_consistency-003` —— NodeCacheKey timing 冲突

STRATEGY 说 acc/persistence/cache_key.py 是 Phase 3 新文件 (L383)；TEST_PLAN T-008 测真实 NodeCacheKey 计算（不是 stub），列在 phase1_exit；phase1_optional 也未把 T-008 列入"stub OK"。三选一：(a) Phase 1 不能 exit；(b) Phase 3 工作前置；(c) 静默降级 T-008。

> **Recommendation**：把 cache_key.py 提前到 Phase 1（pure function，无 Phase 3 deps，consumer 仍 Phase 3）（P-004）。

#### `cross_doc_consistency-006` —— ship gate vs phase3_exit Q 列表

详见 3.2 与 audit_rigor-002。

#### `cross_doc_consistency-008` —— C-016 字段名

AUDIT C-016 (L84) "exactly one of `value_sha256` or `source_artifact_sha256` non-null"；DESIGN/STRATEGY/TEST_PLAN/AUDIT MN-008 一致用 `inline_value_sha256`。MN-008 还显式禁止 legacy alias——AUDIT 自我矛盾。

> **Recommendation**：单行改为 `inline_value_sha256`（P-022）。

#### `cross_doc_consistency-009` —— max_concurrency 数字未决

STRATEGY R-6 自承 "inferred 16"；DESIGN 没决策；TEST_PLAN T-070 与 AUDIT P-005 / phase3_exit_concurrency_defaults 都已硬编 16/1000/8。COMPARISON gap-2 / action-2 已标 *should_fix* 未落地。

> **Recommendation**：DESIGN §11.1 落定数字 + over-limit behavior，单点常量 `acc/policy.py:DEFAULT_CONCURRENCY_LIMITS`（P-016）。

#### `cross_doc_consistency-011` —— Phase 3 删 collect_upstream_context 破 legacy lane

STRATEGY P3-collect_upstream_context-delete (L392) 写 *delete*；DESIGN LegacyPassthroughBinding (L235-L242) 与 STRATEGY R-7 mitigation (L451) 都依赖该函数。Phase 3 ship 即破 AC11 (legacy executable during migration) 与 phase3_exit_default_flip (legacy lane green)。

> **Recommendation**：把 *delete* 改为 *move 到 acc/binding/legacy.py 作 private helper*（P-024）。

#### `cross_doc_consistency-012` —— perf 门 vs perf-lane 非 gating

AUDIT ci_perf_lane "doesn't block PR"；P-005 (5% drift) 又被 phase3_exit_concurrency_defaults 当作 hard gate；TEST_PLAN perf_baseline 用 20% warning。3 个口径，T-070 *±slack* 未量化。

> **Recommendation**：让 P-005 在 nightly 一次性 gating；命名 5% 与 20% 各自度量；slack=*+50% expected*（P-017）。

### 4.7 Missing Pieces（8 条 confirmed）

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| `missing_pieces-001` | high | under_specified | Over-limit behavior for max_active_runs / max_concurrent_nodes_per_run / max_total_nodes_per_run never specified |
| `missing_pieces-002` | high | inconsistent | Ship-gate Q-convergence requirement contradicts AUDIT and STRATEGY |
| `missing_pieces-004` | medium | inconsistent | Q12 standalone wrap UNDECIDED but ship_gate explicitly requires Q12 closed |
| `missing_pieces-005` | medium | missing | COMPARISON action-1 invariant cheat-sheet not visibly added to DESIGN/STRATEGY |
| `missing_pieces-006` | medium | missing | NodeCacheKey lacks an AC5-cross-run-isolation test |
| `missing_pieces-008` | medium | ambiguous | invoking_workflow_call_id field marked 'inferred' — never officially in DESIGN |
| `missing_pieces-009` | low | missing | AC10 UI Inspector frontend component test not represented as a T-NNN case |
| `missing_pieces-012` | low | missing | PlanPreview/whole-plan approval (COMPARISON safe-borrow-4) not picked up anywhere |

#### `missing_pieces-001` —— over-limit behavior 未规定

`max_concurrent_nodes_per_run / max_total_nodes_per_run / max_active_runs` 仅有默认值，没有 queue / fail-fast / 429 reject 语义。COMPARISON action-2 已经要求过。STRATEGY T-018 出现 "overflow_behavior governs" 这种 forward reference，但 overflow_behavior 从未被定义。9-th 并发提交、1001-th 节点的运行时行为完全未指定。

#### `missing_pieces-002` / `missing_pieces-004` —— Ship-gate Q12 矛盾

详见 3.2 / 4.5 audit_rigor-002 / 4.6 cross_doc_consistency-006。

#### `missing_pieces-005` —— invariant cheat-sheet 未落地

COMPARISON action-1 (L205) 要求在 DESIGN §1 头部加 5-bullet quick reference（4 CC-isomorphic + 3 ACC mandatory divergences）。DESIGN recon 无此段。新读者每次都把分歧点当作"重新发明轮子"提出来。

#### `missing_pieces-006` —— NodeCacheKey 无 cross-run-isolation 测试

NodeCacheKey 公式 `sha256(capsule_id + capsule_version + ordered binding_inputs_sha256)` 不含 run_id；T-040 实际 confirm "Same (capsule_id, capsule_version, binding_inputs) yields identical key across processes"；T-052 covers sibling-run 隔离（在 resume 决策层）。但 AUDIT 没有显式 check 限制 NodeCacheKey 仅以 (run_id, key) 对查询。

> **Verdict**：medium 置信，medium severity（结构上其他门已部分覆盖，但需明示）。

#### `missing_pieces-008` —— invoking_workflow_call_id 不在 DESIGN

STRATEGY primitive (L124) 标 *Missing — Phase 1 new (inferred)*；AUDIT C-003 列入 disjoint set；MN-008 要求 ProvenanceObject 字段名"match DESIGN §7.2 literally"——但 DESIGN §7.2 字段集没有这个名字。MN-008 检查永远找不到锚。

> **Recommendation**：DESIGN §7.2 添加 invoking_workflow_call_id 定义（P-023）。

#### `missing_pieces-009` —— AC10 UI Inspector 缺前端组件测试

DESIGN AC10 (L520-L522) 要求 UI 显示 upstream_context contents (toggle) + per-data_edge materialization mode。TEST_PLAN AC10 仅列 T-038 (projection contract) + T-056 (endpoint)。AUDIT O-007 显式要求 *automated front-end component test + run_projection.py contract test*——TEST_PLAN 没提供前者。

> **Verdict**：low severity，T-038 的 `?show_upstream_context=true` 已 cover endpoint-driven 部分；可选择从 AUDIT O-007 删除前端要求或新增 vitest/playwright case。

#### `missing_pieces-012` —— PlanPreview 缺处置

COMPARISON safe-borrow-4 (L149-L151) 提议 Workbench Run 前先生成 PlanPreview。STRATEGY 仅有 ApprovalBarrier（per-node, mid-execution），没有 whole-plan pre-run 构造。explicit_only 在 Phase 3 翻默认后，pre-run 校验场景才更突出。

> **Verdict**：low 置信，low severity；推荐显式标 Phase 4 deferred（P-031）。

---

## 5. 补丁计划（Patch Plan）

按 severity 排序的 31 条补丁。`addresses` 列回链 confirmed findings。

### 5.1 总表

| Patch | Target | Kind | Severity | 一句话 | Addresses |
|-------|--------|------|----------|--------|-----------|
| **P-001** | `DESIGN.md` | split | **critical** | 拆 AC12 = test layering / 新增 AC18 = nested boundary isolation；重映射 C-017/R-5/T-027/T-030/T-067/T-071 | `correctness-001`, `audit_rigor-001` |
| **P-002** | `STRATEGY.md` | edit | **critical** | P1/P2/P3-exit 用 TEST_PLAN §11 列表替换 range 写法；加 SoT 注 | `cross_doc_consistency-001` |
| **P-003** | `TEST_PLAN.md` | split | **critical** | T-061 / T-068 各拆 a (Phase 1 baseline freeze) + b (Phase 2/3 byte-equal) | `correctness-003`, `test_coverage-002` |
| **P-004** | `STRATEGY.md` | edit | **critical** | NodeCacheKey 提前到 Phase 1；新增 PR-1.5 | `cross_doc_consistency-003` |
| **P-005** | `AUDIT.md` | edit | high | phase3_exit_q_resolution 改为 per-Q 表格（exit_phase 1..post-GA + disposition）；TEST_PLAN ship_gate 引用 | `correctness-002`, `audit_rigor-002`, `cross_doc_consistency-006`, `missing_pieces-002`, `missing_pieces-004` |
| **P-006** | `AUDIT.md` | add | high | 新增 L-009 (persistence) / L-010 (scheduler) / L-011 (app private-symbol) | `layering-001`, `layering-002`, `layering-009` |
| **P-007** | `STRATEGY.md` | edit | high | R1 加 `acc.cli`；R3 加 `fastapi/typer`；regenerate `.importlinter` | `layering-003`, `layering-004` |
| **P-008** | `AUDIT.md` | edit | medium | L-003 路径改 `acc/provenance.py` | `layering-005` |
| **P-009** | `STRATEGY.md` | edit | high | binding outbound = {domain, persistence, result_store, stdlib} 自 Phase 1 起 | `layering-006` |
| **P-010** | `STRATEGY.md` | add | medium | architecture_test 增 `test_provenance_module_pure` / `test_scheduler_layer_pure`；scheduler public_api 加 DAGScheduler/ApprovalBarrier | `layering-008`, `layering-011` |
| **P-011** | `TEST_PLAN.md` | add | high | 注册 T_AC1..T_AC17 marker；T-058 加 phase-aware allowlist + 提前到 Phase 1/2 exit | `correctness-009`, `test_coverage-005`, `test_coverage-010` |
| **P-012** | `TEST_PLAN.md` | edit | medium | T-070 从 AC8 移除 | `correctness-004`, `test_coverage-007` |
| **P-013** | `STRATEGY.md` | edit | high | X-4 enforcement test list 改 T-007 + T-046 | `cross_doc_consistency-002` |
| **P-014** | `TEST_PLAN.md` | edit | high | coverage:new_modules 改用 `acc/binding/`、`acc/result_store/` 等模块 glob | `test_coverage-001` |
| **P-015** | `DESIGN.md` | edit | high | 移除 ProvenanceSummary opt-in，落定 deny-only；关闭 §15 Q2/Q6 | `test_coverage-004` |
| **P-016** | `DESIGN.md` | add | high | §11.1 落定 16/1000/8 + over-limit 行为 + `acc/policy.py:DEFAULT_CONCURRENCY_LIMITS` 单点常量 | `cross_doc_consistency-009`, `missing_pieces-001` |
| **P-017** | `TEST_PLAN.md` | edit | high | P-005 nightly 一次性 gating；T-070 slack 量化；命名 *concurrency-overhead 5%* vs *wall-clock 20%* | `cross_doc_consistency-012`, `test_coverage-006` |
| **P-018** | `AUDIT.md` | edit | high | M-004/M-008/L-008/P-002/S-008 重新分类为 automated；更新 Appendix C | `audit_rigor-003` |
| **P-019** | `AUDIT.md` | edit | medium | C-014 提升为 critical；脚本核对 Appendix B 计数 | `audit_rigor-004` |
| **P-020** | `AUDIT.md` | edit | medium | T-001 工具改为 `mypy --strict + pytest assert __dataclass_params__.frozen` | `audit_rigor-009` |
| **P-021** | `AUDIT.md` | add | medium | 新增 P-008 (events.jsonl 大小) / P-009 (run_manifest.json 大小) / P-010 (input.json 字节上限) | `audit_rigor-010` |
| **P-022** | `AUDIT.md` | edit | medium | C-016 `value_sha256` → `inline_value_sha256` | `cross_doc_consistency-008` |
| **P-023** | `DESIGN.md` | add | medium | §7.2 ProvenanceObject 加 `invoking_workflow_call_id`；STRATEGY 去掉 *(inferred)* | `missing_pieces-008` |
| **P-024** | `STRATEGY.md` | edit | high | P3-collect_upstream_context-delete 改为 move → `acc/binding/legacy.py` private helper；新增 AUDIT M-009 callsite scan | `cross_doc_consistency-011` |
| **P-025** | `STRATEGY.md` | merge | high | NamespaceSelector 在 identity group 删除，仅保留 data_plane 单一 primitive | `first_principles-001` |
| **P-026** | `STRATEGY.md` | edit | medium | Principle-4 改为以 AgentPayload 表面表述；丢 input.json 字样 | `first_principles-010` |
| **P-027** | `STRATEGY.md` | merge | low | ENV-existing-exposure + ENV-Phase1-new-exposure 合并为 AgentEnv | `first_principles-011` |
| **P-028** | `DESIGN.md` | add | medium | §1 加 invariant cheat-sheet（4 CC-isomorphic + 3 ACC must-diverge） | `missing_pieces-005` |
| **P-029** | `TEST_PLAN.md` | add | medium | 新增 T-079 NodeCacheKey cross-run-isolation；STRATEGY L110 标 *(run_id, NodeCacheKey)* lookup | `missing_pieces-006` |
| **P-030** | `TEST_PLAN.md` | edit | low | AUDIT O-007 删除 *front-end component test*；交由 T-056 endpoint-driven 验证 | `missing_pieces-009` |
| **P-031** | `STRATEGY.md` | add | low | §10 加显式 PlanPreview 处置：Phase 4 deferred | `missing_pieces-012` |

### 5.2 Patch 详情

下面只展开 5 critical / 13 high 共 18 条；medium / low 直接看上表 + 输入 JSON 即可。

#### P-001 — DESIGN.md split AC12

将 DESIGN §13 现有 AC12 保留 *Test layering* 原义。新增 AC18 紧邻 AC12：
> **AC18 — Nested workflow boundary isolation**：`WorkflowCallInputBinding / WorkflowCallOutputBinding` 必须不传播 parent 的 `upstream_context / __acc_control_context / 任何未显式 binding 字段` 进入嵌套调用；`WorkflowCallOutputBinding` 同样限制可跨边界返回的字段。

随后批量重定向：

- AUDIT C-017 → AC18；
- STRATEGY R-5 / L77 / L243 / L255 / L260 → AC18；
- TEST_PLAN T-027 / T-030 / T-067 / T-071 → 标 `@pytest.mark.T_AC18` 或在 docstring 写 *verifies AC18*；
- DESIGN §13 顶部加一行 **AC index header**，由 STRATEGY/TEST_PLAN/AUDIT 共同 import。

#### P-002 — STRATEGY.md mirror TEST_PLAN phase exit

替换三段 range 写法：

```text
P1-exit-1: T-001..T-053 pass         → P1-exit-1: 见 TEST_PLAN §11 phase1_exit (T-006/T-007/T-008/...)
P2-exit-1: T-054..T-058 pass         → P2-exit-1: 见 TEST_PLAN §11 phase2_exit
P3-exit-1: T-059..T-077 pass         → P3-exit-1: 见 TEST_PLAN §11 phase3_exit
```

加一句注：*"Source of truth = TEST_PLAN.md §11 phase exits; this section MUST mirror."*

#### P-003 — TEST_PLAN.md split T-061 / T-068

```
T-061 → T-061a (Phase 1 must-pass)：generate baselines/phase1/* + reload + reproducibility
T-061 → T-061b (Phase 2/3 must-pass)：current impl byte-equal to baseline
T-068 → T-068a (Phase 1 must-pass)：appendix policy default capture
T-068 → T-068b (Phase 2/3 must-pass)：explicit override breaks parity (reverse validation)
```

`phase1_exit` 仅引用 a；`phase2_exit / phase3_exit` 引用 b。AUDIT phase1_exit_test_green 删除 AC15 byte-equality 期望。

#### P-004 — STRATEGY.md NodeCacheKey 提前 Phase 1

- L110 primitive 标签 *Phase 3 new* → *Phase 1 new*；
- 新增 P1 PR (PR-1.5: cache_key.py)；
- pause/resume *consumer* 仍 Phase 3；
- 检查 X-7-enforcement test 列表（T-008/T-019/T-052）已自洽。

#### P-005 — AUDIT.md per-Q 表格

把 `phase3_exit_q_resolution` 改为：

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

TEST_PLAN ship_gate 改为 *"references AUDIT phase3_exit_q_resolution"*。DESIGN §15 每条 Q 加 `{decided, deferred-phase-4, internal-may-evolve}` tag。

#### P-006 — AUDIT.md 新增 L-009/L-010/L-011

```
L-009 (persistence purity)
  禁止 imports: acc.server / acc.app / acc.cli / acc.runtime / fastapi / typer
  severity: high; tool: import-linter

L-010 (scheduler purity)
  禁止 imports: acc.app / acc.cli / acc.server / fastapi / typer
  severity: high; tool: import-linter

L-011 (app private-symbol ban)
  acc/app/* 仅可 import 各下层 __init__.py 公共导出；禁止下划线开头符号
  severity: medium; tool: 自定义 AST scan，私有符号清单来自 STRATEGY public_api L221-L226
```

STRATEGY §4 同步加 R8/R9/R10。

#### P-007 — STRATEGY.md R1/R3 修正

- R1 (L196) 在 forbidden 列表加 `acc.cli`；
- R3 (L198) 在 forbidden 列表加 `fastapi`、`typer`；
- 重新 emit `.importlinter` contract；
- `test_runtime_layer_pure` assertion 列表加上 fastapi / typer 检查。

#### P-009 — STRATEGY.md binding 方向

- L184 outbound 改为 `{domain, persistence, result_store, stdlib}`；
- AUDIT L-001/L-002 inbound/outbound 同步更新；
- P3-binding-resolver-resultstore 措辞改为 *"BindingResolver gains ResultStore-backed dispatch in Phase 3 (already permitted by layer contract)"*。

#### P-011 — TEST_PLAN.md T_AC marker

1. §marks 增加：

   > `T_AC1..T_AC17` — 每个 verifies AC<n> 的 test 必须声明 `@pytest.mark.T_AC<n>`；main e2e 恰好声明一个；supporting case 可多个。

2. `pyproject.toml [tool.pytest.ini_options].markers` 注册全部 17 个 mark。

3. T-058 body 改写：

   > `pytest --collect-only -m "T_AC<n>"` 对 n∈[1..17] 都 ≥1 main-lane test；test ID 全集到 declared `T_AC<n>` 的 mapping 为 ≥1；main-lane 与 legacy-lane test ID 集合 disjoint（file-permissive，ID-strict）。

4. T-058 提前到 phase1_exit / phase2_exit must-pass，phase-aware allowlist 写入 `tests/_helpers/expected_ac_matrix.json`。

#### P-013 — STRATEGY.md X-4 enforcement

L168 改为：

```
Tests: T-007 (unit XOR check on ProvenanceObject construction)
       + T-046 (property: 100% mutex across [0, 1 MiB])
```

AUDIT C-016 加反向 cross-ref *"verified by TEST_PLAN T-007 + T-046"*。

#### P-014 — TEST_PLAN.md coverage:new_modules

```
acc/runtime/binding_resolver.py    →  acc/binding/
acc/persistence/checkpoints.py     →  acc/persistence/
acc/provenance.py (kept)
+ acc/result_store/
+ acc/runtime/
+ acc/scheduler/
```

CI 加保护：每个 glob 在 `pytest --cov` 报告基数 > 0 才施加 `--cov-fail-under=90`。

#### P-015 — DESIGN.md drop ProvenanceSummary opt-in

`agent_visible.opt_in` (L312-L323) 删除 *ProvenanceSummary (acc_expose_provenance=true)*。补充段落：

> Provenance fields are runtime-only and have no agent-visible opt-in path; use ProvenanceSummary only via the Workbench inspector projection.

§15 Q2 / Q6 标 *decided*。

#### P-016 — DESIGN.md §11.1 concurrency 决策

新增段落：

```
max_concurrent_nodes_per_run = 16
max_total_nodes_per_run     = 1000
max_active_runs              = 8

over-limit:
  max_concurrent_nodes_per_run → asyncio.Semaphore queue (FIFO)
  max_total_nodes_per_run      → fail-fast at graph compile (NodeCountExceeded)
  max_active_runs              → submission rejected (HTTP 429-equivalent)

constants live in acc/policy.py:DEFAULT_CONCURRENCY_LIMITS
```

STRATEGY R-6 *inferred 16* → *per DESIGN §11.1*。T-070 / P-005 引用常量。

#### P-017 — TEST_PLAN.md perf 预算

- P-005 在 nightly 一次性 gating；AUDIT ci_perf_lane 允许 per-check override；
- T-070 期望总时间 = `ceil(100/16) × 50ms + 50ms 固定 overhead`，fail at +50%；
- 命名差异：*concurrency-overhead 5%* (P-005) vs *wall-clock 20%* (perf_baseline)；
- T-071 / T-072 加 ≤20% regression 预算。

#### P-018 — AUDIT.md 重新分类 5 个 manual 项

```
M-004  →  CI: grep '#DEPRECATED' acc/app/__init__.py:912-916,1379-1391
M-008  →  CI: grep default binding_mode literal, count == 1
L-008  →  import-linter contract or AST scan: run_projection.py imports only acc.result_store / acc.persistence public re-exports
P-002  →  unit test: cache-hit counter assertion
S-008  →  front-end component test (vitest) gates the visual; manual UX review reduces to optional
```

更新 Appendix C 自动化总数；保留 *NOT automated* 给真正需要人类判断的项（UX visual, N-008 lock callsite review）。

#### P-024 — STRATEGY.md collect_upstream_context move

P3-collect_upstream_context-delete (L392)：

```
- delete acc/app/node_invocation.py:94-117
+ move    acc/app/node_invocation.py:94-117 → acc/binding/legacy.py
+         as private helper _legacy_collect_upstream_context
+         callable only from LegacyPassthroughBinding dispatch path
```

DESIGN §7.6 更新到新位置。R-7 rollback 语义保留。AUDIT 新增 M-009：

```
M-009 (collect_upstream_context callsite scope)
  callsites must equal {LegacyPassthroughBinding.dispatch}
  severity: high; tool: AST scan
```

#### P-025 — STRATEGY.md NamespaceSelector 合并

删除 identity group 中 L127 的 `NamespaceSelector-unified-format` 整条；仅保留 data_plane L84 的 `NamespaceSelector-ADT`，并把 namespace 集合写为权威 5 元 `{field, outbox, artifact, each_of, legacy}`。

---

## 6. 被驳回的 findings（False Positives, 36 条）

为透明起见，列出本次 raw findings 中被对抗式验证驳回的 36 条。每条一句话 reason，便于读者复核没有偷懒：

| Finding ID | 驳回理由（一句话） |
|------------|-------------------|
| `correctness-005` | 表面冲突实为不同 surface 的并行 invariant，无矛盾 |
| `correctness-006` | 引用行号偏差，原文实际无该 inconsistency |
| `correctness-007` | 误读 STRATEGY phase plan，X-2 与 X-7 各覆盖不同生命周期 |
| `correctness-008` | recommendation 已在 P-005 范围内，重复项 |
| `correctness-010` | 风格偏好（命名长度），非语义问题 |
| `layering-007` | binding 不直接 import schemas，引用不成立 |
| `layering-010` | run_projection.py 仅供 server 内部，AUDIT L-008 已覆盖 |
| `first_principles-002` | Principle-3 与 Principle-4 互补不冗余 |
| `first_principles-003` | RuntimePayload metadata 与 AgentPayload split 正交 |
| `first_principles-004` | NodeResult 命名沿用 DESIGN，是 alias 而非 duplicate |
| `first_principles-005` | TransferPolicy 与 ArtifactBundle 关心点不同 |
| `first_principles-006` | binding_mode 是配置开关而非 primitive |
| `first_principles-007` | ScopeFrame 与 frame_id 是同一概念在不同 surface |
| `first_principles-008` | LegacyPassthroughBinding 是 binding kind，不是 primitive |
| `first_principles-009` | producer_session_id 与 frame_id 各承担不同身份 |
| `first_principles-012` | ResultStore 是 primitive 也是模块，不双计 |
| `test_coverage-003` | T-038 已覆盖 projection 契约，无 gap |
| `test_coverage-008` | T-046 property 测试 sample 上限合理 |
| `test_coverage-009` | T-077 测试目标精确，未越界 |
| `test_coverage-011` | migration tests 5 case 与 5 capsules 设计一致 |
| `test_coverage-012` | property 测试用 hypothesis 是已选定方案 |
| `audit_rigor-005` | severity high 与 phase exit 临界 close 一致 |
| `audit_rigor-006` | T-AC11 mapping 正确，对应 legacy lane gating |
| `audit_rigor-007` | C-005 / S-004 共同覆盖 cross-run reject，不重复 |
| `audit_rigor-008` | mypy --strict 在 acc/persistence 已有效，无空缺 |
| `audit_rigor-011` | observability dimension O-001..O-008 已 cover events 完整性 |
| `audit_rigor-012` | manual review 名单合理控制在 7 项 |
| `cross_doc_consistency-004` | 误判 phase change，实际 STRATEGY 与 TEST_PLAN 一致 |
| `cross_doc_consistency-005` | 命名差异在范围注释里已解释 |
| `cross_doc_consistency-007` | acc/store 与 acc/result_store 是 alias，已注解 |
| `cross_doc_consistency-010` | ApprovalBarrier scope 描述精度足够 |
| `missing_pieces-003` | Phase2.deliverable 已覆盖该项 |
| `missing_pieces-007` | run_manifest schema 有 events 反链字段 |
| `missing_pieces-010` | upstream_lineage 在 ProvenanceObject 已定义 |
| `missing_pieces-011` | bundle_id 不 expose 是显式安全设计 |
| `missing_pieces-013` | EachOfFanInSelector 已 schedule 在 Phase 2 |

---

## 7. 下一步建议

文档已经接近 ship-ready，但 5 critical patches 不修就上线会在 Phase 1/3 exit 处直接卡门。建议两条路径任选其一（也可串行）：

### 选项 A：直接落地 patch_plan

让 designer 按 severity 顺序应用补丁——优先 P-001、P-002、P-003、P-004、P-005（5 critical），随后 13 high。每条 patch 已给出文件、kind、行号范围与具体 edit 指令，可以并行多文档编辑。建议落地完成后跑一次 `import-linter`、`pytest --collect-only -m "T_AC*"`、`pytest --cov` smoke 验证关键门可以执行。

预估工作量：

- critical 5 条 ≈ 半天（DESIGN/STRATEGY/TEST_PLAN/AUDIT 多点协调）；
- high 13 条 ≈ 一整天；
- medium/low 13 条 ≈ 半天。

### 选项 B：CCB peer review（codex reviewer）

把本报告（`REVIEW_REPORT.md`）+ 5 份 doc 合并打包发给 reviewer 角色（按 CLAUDE.md 中 `reviewer = codex`）。具体动作：

```bash
/ask codex
[PLAN REVIEW REQUEST]
--- PLAN START ---
… 把本 review report + 5 份 doc 全部贴入 …
--- PLAN END ---
按 AGENTS.md Rubric 打分；目标 overall ≥ 7.0 且无单维度 ≤ 3。
返回 JSON: { dimensions: { ... }, overall: float, blockers: [...], suggestions: [...] }
```

收到打分后：

- 若 overall ≥ 7.0 且各维度 > 3：直接进入选项 A 落地补丁；
- 若 overall < 7.0 或有维度 ≤ 3：先按 reviewer 反馈修补，再走第二轮（最多 3 轮）。

> 个人推荐：**先 A 修 5 critical patches，再 B 走 codex 打分**。这样 reviewer 评分时就不会被几个显眼的 phase exit 矛盾打断主线评估。

---

## 附录 A — Confirmed Findings（机读 JSON 摘要）

> 完整字段（含 evidence、why_it_matters、recommendation、related_doc_lines、verdicts）见输入 JSON。这里仅放 `id / dimension / severity / category / title` 索引，供机器消费。

```json
[
  {"id":"correctness-001","dimension":"correctness","severity":"high","category":"inconsistent","title":"AC12 semantic conflict: 'test layering' in DESIGN vs 'nested workflow isolation' in STRATEGY/AUDIT"},
  {"id":"correctness-002","dimension":"correctness","severity":"high","category":"inconsistent","title":"Ship gate requires Q3/Q12 resolved, but STRATEGY explicitly defers/leaves them unresolved"},
  {"id":"correctness-003","dimension":"correctness","severity":"medium","category":"incorrect","title":"T-068/T-061 in Phase 1 must-pass list verify Phase 2/3 byte-equality"},
  {"id":"correctness-004","dimension":"correctness","severity":"medium","category":"incorrect","title":"T-070 misclassified as AC8 supporting — actually verifies concurrency caps, not upstream_context opt-in"},
  {"id":"correctness-009","dimension":"correctness","severity":"medium","category":"ambiguous","title":"T-058 AC×Test matrix self-check relies on undefined 'AC mark' convention"},
  {"id":"layering-001","dimension":"layering","severity":"high","category":"missing","title":"acc/persistence/ layer has no dedicated import-boundary check (L-###)"},
  {"id":"layering-002","dimension":"layering","severity":"high","category":"missing","title":"acc/scheduler/ layer has no dedicated import-boundary check (L-###)"},
  {"id":"layering-003","dimension":"layering","severity":"medium","category":"inconsistent","title":"STRATEGY R1 forbidden list omits 'cli' that AUDIT L-001 forbids"},
  {"id":"layering-004","dimension":"layering","severity":"medium","category":"inconsistent","title":"STRATEGY R3 omits fastapi/typer ban that AUDIT L-004 enforces"},
  {"id":"layering-005","dimension":"layering","severity":"medium","category":"incorrect","title":"AUDIT L-003 misnames provenance file path"},
  {"id":"layering-006","dimension":"layering","severity":"high","category":"inconsistent","title":"Binding outbound deps contradict between Phase 1 (adapter) and Phase 3 (ResultStore client)"},
  {"id":"layering-008","dimension":"layering","severity":"medium","category":"under_specified","title":"Architecture-test coverage misses L-003 (provenance) and L-008 (projection)"},
  {"id":"layering-009","dimension":"layering","severity":"medium","category":"under_specified","title":"acc/app/ layer outbound is unconstrained with no L-### enforcement"},
  {"id":"layering-011","dimension":"layering","severity":"low","category":"missing","title":"STRATEGY public_api for acc/scheduler/ does not expose Phase 3 DAGScheduler / ApprovalBarrier"},
  {"id":"first_principles-001","dimension":"first_principles","severity":"high","category":"inconsistent","title":"NamespaceSelector listed as a primitive in TWO different groups"},
  {"id":"first_principles-010","dimension":"first_principles","severity":"medium","category":"inconsistent","title":"Standalone-Equivalent Agent Execution stated as Principle, AC, and Invariant — three formulations"},
  {"id":"first_principles-011","dimension":"first_principles","severity":"low","category":"over_engineered","title":"ENV-existing-exposure and ENV-Phase1-new-exposure are split into two primitives"},
  {"id":"test_coverage-001","dimension":"test_coverage","severity":"high","category":"inconsistent","title":"coverage:new_modules cites module paths absent from STRATEGY layout"},
  {"id":"test_coverage-002","dimension":"test_coverage","severity":"high","category":"ambiguous","title":"T-061 in Phase 1 must-pass is semantically incoherent"},
  {"id":"test_coverage-004","dimension":"test_coverage","severity":"high","category":"inconsistent","title":"T-022/T-074/T-077 contradict DESIGN's opt-in allowance for ProvenanceSummary"},
  {"id":"test_coverage-005","dimension":"test_coverage","severity":"medium","category":"under_specified","title":"T-058 AC×Test matrix self-check absent from Phase 1 and Phase 2 exit"},
  {"id":"test_coverage-006","dimension":"test_coverage","severity":"medium","category":"under_specified","title":"Performance test budgets are inconsistent or missing"},
  {"id":"test_coverage-007","dimension":"test_coverage","severity":"medium","category":"incorrect","title":"T-070 verifies AC8 but actually exercises concurrency, not opt-in"},
  {"id":"test_coverage-010","dimension":"test_coverage","severity":"low","category":"ambiguous","title":"T-058 'disjoint on legacy files' lacks operational definition"},
  {"id":"audit_rigor-001","dimension":"audit_rigor","severity":"critical","category":"inconsistent","title":"AC12 semantically conflated across DESIGN/STRATEGY/AUDIT"},
  {"id":"audit_rigor-002","dimension":"audit_rigor","severity":"high","category":"inconsistent","title":"Q1–Q16 phase-resolution timing contradicts across DESIGN/STRATEGY/TEST/AUDIT"},
  {"id":"audit_rigor-003","dimension":"audit_rigor","severity":"high","category":"incorrect","title":"Several 'NOT automated' items are trivially automatable — manual budget inflated"},
  {"id":"audit_rigor-004","dimension":"audit_rigor","severity":"medium","category":"inconsistent","title":"C-014 severity tag conflicts between check definition and §6 review-scope list"},
  {"id":"audit_rigor-009","dimension":"audit_rigor","severity":"medium","category":"incorrect","title":"T-001 'frozen dataclass' requirement not enforced by mypy --strict alone"},
  {"id":"audit_rigor-010","dimension":"audit_rigor","severity":"medium","category":"missing","title":"Missing resource-budget audits: events.jsonl growth, run_manifest size, agent-input DOS"},
  {"id":"cross_doc_consistency-001","dimension":"cross_doc_consistency","severity":"critical","category":"inconsistent","title":"STRATEGY Phase 1 exit claims T-001..T-053 pass, TEST_PLAN excludes most of that range"},
  {"id":"cross_doc_consistency-002","dimension":"cross_doc_consistency","severity":"high","category":"incorrect","title":"STRATEGY X-4 invariant enforcement points to T-074/T-077 — those don't verify hash mutex"},
  {"id":"cross_doc_consistency-003","dimension":"cross_doc_consistency","severity":"high","category":"inconsistent","title":"NodeCacheKey conflict: STRATEGY says Phase 3, T-008 in Phase 1 must-pass"},
  {"id":"cross_doc_consistency-006","dimension":"cross_doc_consistency","severity":"medium","category":"inconsistent","title":"TEST_PLAN ship_gate vs AUDIT phase3_exit on §15 questions"},
  {"id":"cross_doc_consistency-008","dimension":"cross_doc_consistency","severity":"medium","category":"inconsistent","title":"AUDIT C-016 hash mutex check uses field name `value_sha256` instead of `inline_value_sha256`"},
  {"id":"cross_doc_consistency-009","dimension":"cross_doc_consistency","severity":"medium","category":"under_specified","title":"STRATEGY R-6 names default 16 for max_concurrency that no doc actually decides"},
  {"id":"cross_doc_consistency-011","dimension":"cross_doc_consistency","severity":"high","category":"incorrect","title":"STRATEGY P3 deletes `collect_upstream_context` while LegacyPassthroughBinding still routes through it"},
  {"id":"cross_doc_consistency-012","dimension":"cross_doc_consistency","severity":"low","category":"ambiguous","title":"STRATEGY P-005 (5%) and TEST_PLAN T-070 perf budgets vs non-gating perf-lane"},
  {"id":"missing_pieces-001","dimension":"missing_pieces","severity":"high","category":"under_specified","title":"Over-limit behavior for max_active_runs / max_concurrent_nodes_per_run / max_total_nodes_per_run never specified"},
  {"id":"missing_pieces-002","dimension":"missing_pieces","severity":"high","category":"inconsistent","title":"Ship-gate Q-convergence requirement contradicts AUDIT and STRATEGY's actual dispositions"},
  {"id":"missing_pieces-004","dimension":"missing_pieces","severity":"medium","category":"inconsistent","title":"Q12 standalone wrap UNDECIDED but ship_gate explicitly requires Q12 closed"},
  {"id":"missing_pieces-005","dimension":"missing_pieces","severity":"medium","category":"missing","title":"COMPARISON action-1 invariant cheat-sheet not visibly added to DESIGN/STRATEGY"},
  {"id":"missing_pieces-006","dimension":"missing_pieces","severity":"medium","category":"missing","title":"NodeCacheKey lacks an AC5-cross-run-isolation test"},
  {"id":"missing_pieces-008","dimension":"missing_pieces","severity":"medium","category":"ambiguous","title":"invoking_workflow_call_id field marked 'inferred' — never officially in DESIGN.md ProvenanceObject"},
  {"id":"missing_pieces-009","dimension":"missing_pieces","severity":"low","category":"missing","title":"AC10 UI Inspector frontend component test not represented as a T-NNN case"},
  {"id":"missing_pieces-012","dimension":"missing_pieces","severity":"low","category":"missing","title":"PlanPreview/whole-plan approval (COMPARISON safe-borrow-4) not picked up anywhere"}
]
```

---

## 附录 B — Synthesis JSON dump

```json
{
  "overall_verdict": "Deliverables are ~80% solid: the principles, primitive table, and AC structure are sound, but cross-doc consistency is the dominant failure mode — Phase 3 cannot exit cleanly today because (a) AC12 names two different invariants across DESIGN/STRATEGY/AUDIT, (b) phase-exit test lists and Q1–Q16 resolution gates contradict between TEST_PLAN/STRATEGY/AUDIT, and (c) several primitives, field names, and import-linter R-rules drift between docs. Layering coverage is also incomplete (no L-### for persistence/scheduler/app, R-rule omissions vs AUDIT), and a handful of 'NOT automated' audit items are trivially automatable.",
  "top_themes_count": 9,
  "patch_count": 31,
  "patch_severity_breakdown": {
    "critical": 5,
    "high": 13,
    "medium": 11,
    "low": 2
  },
  "themes": [
    {"theme":"AC12 names two different invariants — critical-severity audit hook is bound to the wrong AC","severity":"critical","finding_ids":["correctness-001","audit_rigor-001"]},
    {"theme":"Phase-exit gates contradict across STRATEGY / TEST_PLAN / AUDIT (test lists + §15 Q-resolution)","severity":"critical","finding_ids":["correctness-002","correctness-003","audit_rigor-002","cross_doc_consistency-001","cross_doc_consistency-003","cross_doc_consistency-006","missing_pieces-002","missing_pieces-004","test_coverage-002"]},
    {"theme":"Layering/import-boundary coverage incomplete; R-rules and L-### checks drift","severity":"high","finding_ids":["layering-001","layering-002","layering-003","layering-004","layering-005","layering-006","layering-008","layering-009","layering-011"]},
    {"theme":"AC↔Test matrix drift; AC marks undefined; T-058 self-check has no operational definition","severity":"high","finding_ids":["correctness-004","correctness-009","test_coverage-001","test_coverage-005","test_coverage-007","test_coverage-010","cross_doc_consistency-002"]},
    {"theme":"Field/primitive naming and first-principles drift","severity":"high","finding_ids":["cross_doc_consistency-008","missing_pieces-008","first_principles-001","first_principles-010","first_principles-011"]},
    {"theme":"Concurrency defaults and over-limit behavior under-specified; perf budgets disagree","severity":"high","finding_ids":["cross_doc_consistency-009","cross_doc_consistency-012","missing_pieces-001","test_coverage-006"]},
    {"theme":"Audit rigor: 'NOT automated' items are mostly automatable; severity tags drift; resource budgets missing","severity":"high","finding_ids":["audit_rigor-003","audit_rigor-004","audit_rigor-009","audit_rigor-010"]},
    {"theme":"DESIGN ↔ tests contract drift (opt-in semantics, Phase 3 deletions)","severity":"high","finding_ids":["test_coverage-004","cross_doc_consistency-011"]},
    {"theme":"Missing/deferred features lacking explicit disposition","severity":"medium","finding_ids":["missing_pieces-005","missing_pieces-006","missing_pieces-009","missing_pieces-012"]}
  ],
  "patch_index": [
    {"id":"P-001","target":"DESIGN.md","kind":"split","severity":"critical","addresses":["correctness-001","audit_rigor-001"]},
    {"id":"P-002","target":"STRATEGY.md","kind":"edit","severity":"critical","addresses":["cross_doc_consistency-001"]},
    {"id":"P-003","target":"TEST_PLAN.md","kind":"split","severity":"critical","addresses":["correctness-003","test_coverage-002"]},
    {"id":"P-004","target":"STRATEGY.md","kind":"edit","severity":"critical","addresses":["cross_doc_consistency-003"]},
    {"id":"P-005","target":"AUDIT.md","kind":"edit","severity":"high","addresses":["correctness-002","audit_rigor-002","cross_doc_consistency-006","missing_pieces-002","missing_pieces-004"]},
    {"id":"P-006","target":"AUDIT.md","kind":"add","severity":"high","addresses":["layering-001","layering-002","layering-009"]},
    {"id":"P-007","target":"STRATEGY.md","kind":"edit","severity":"high","addresses":["layering-003","layering-004"]},
    {"id":"P-008","target":"AUDIT.md","kind":"edit","severity":"medium","addresses":["layering-005"]},
    {"id":"P-009","target":"STRATEGY.md","kind":"edit","severity":"high","addresses":["layering-006"]},
    {"id":"P-010","target":"STRATEGY.md","kind":"add","severity":"medium","addresses":["layering-008","layering-011"]},
    {"id":"P-011","target":"TEST_PLAN.md","kind":"add","severity":"high","addresses":["correctness-009","test_coverage-005","test_coverage-010"]},
    {"id":"P-012","target":"TEST_PLAN.md","kind":"edit","severity":"medium","addresses":["correctness-004","test_coverage-007"]},
    {"id":"P-013","target":"STRATEGY.md","kind":"edit","severity":"high","addresses":["cross_doc_consistency-002"]},
    {"id":"P-014","target":"TEST_PLAN.md","kind":"edit","severity":"high","addresses":["test_coverage-001"]},
    {"id":"P-015","target":"DESIGN.md","kind":"edit","severity":"high","addresses":["test_coverage-004"]},
    {"id":"P-016","target":"DESIGN.md","kind":"add","severity":"high","addresses":["cross_doc_consistency-009","missing_pieces-001"]},
    {"id":"P-017","target":"TEST_PLAN.md","kind":"edit","severity":"high","addresses":["cross_doc_consistency-012","test_coverage-006"]},
    {"id":"P-018","target":"AUDIT.md","kind":"edit","severity":"high","addresses":["audit_rigor-003"]},
    {"id":"P-019","target":"AUDIT.md","kind":"edit","severity":"medium","addresses":["audit_rigor-004"]},
    {"id":"P-020","target":"AUDIT.md","kind":"edit","severity":"medium","addresses":["audit_rigor-009"]},
    {"id":"P-021","target":"AUDIT.md","kind":"add","severity":"medium","addresses":["audit_rigor-010"]},
    {"id":"P-022","target":"AUDIT.md","kind":"edit","severity":"medium","addresses":["cross_doc_consistency-008"]},
    {"id":"P-023","target":"DESIGN.md","kind":"add","severity":"medium","addresses":["missing_pieces-008"]},
    {"id":"P-024","target":"STRATEGY.md","kind":"edit","severity":"high","addresses":["cross_doc_consistency-011"]},
    {"id":"P-025","target":"STRATEGY.md","kind":"merge","severity":"high","addresses":["first_principles-001"]},
    {"id":"P-026","target":"STRATEGY.md","kind":"edit","severity":"medium","addresses":["first_principles-010"]},
    {"id":"P-027","target":"STRATEGY.md","kind":"merge","severity":"low","addresses":["first_principles-011"]},
    {"id":"P-028","target":"DESIGN.md","kind":"add","severity":"medium","addresses":["missing_pieces-005"]},
    {"id":"P-029","target":"TEST_PLAN.md","kind":"add","severity":"medium","addresses":["missing_pieces-006"]},
    {"id":"P-030","target":"TEST_PLAN.md","kind":"edit","severity":"low","addresses":["missing_pieces-009"]},
    {"id":"P-031","target":"STRATEGY.md","kind":"add","severity":"low","addresses":["missing_pieces-012"]}
  ]
}
```

---

> **报告结束**。
> 输出文件：`F:/Agent-Capsule-Conductor/docs/codex_goal_workflow_message_routing/REVIEW_REPORT.md`
> 关联输入：`DESIGN.md` / `CC_WORKFLOW_COMPARISON.md` / `IMPLEMENTATION_STRATEGY.md` / `TEST_PLAN.md` / `AUDIT_PLAN.md`
