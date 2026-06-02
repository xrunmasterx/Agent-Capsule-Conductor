# ACC 架构问题清单

> 本目录记录对 ACC 当前架构的深度调研结果。所有问题均经过 adversarial verification 复核。
> 调研目标: 在保持 ACC 健壮性 / 轻量简洁 / 高性能的前提下，识别冗余代码、兼容补丁、不适配方案。
> 本目录不包含代码修改，只做问题发现和建议。

## 调研方法

- **6 阶段 workflow**: 探查 → 分层调研 → 分类问题搜索 → 跨切面分析 → 对抗式验证 → 报告生成
- **复核机制**: 每条问题至少 1 名独立 reviewer 复核（默认拒绝，除非证据充分）。复核维度包括事实准确性（行号/调用关系/导入图是否真实）、根因诊断是否成立、建议方案是否可行且不引入回归。
- **模型分级**: 简单清点用 haiku，分层调研用 sonnet，跨切面分析与综述用 opus
- **证据要求**: 每条 finding 必须给出 file:line 锚点和可复现的代码引用，避免推测和虚构

## 统计

| 指标 | 数量 |
|------|------|
| 原始 findings 总数 | 90 |
| 通过对抗式验证 | **70** |
| 被复核排除（未通过 / 被反驳） | 14 |
| 排除率 | 15.6% |

> 说明: 6 条剩余 finding 在合并/重写过程中被并入其他条目或拆分，未单独保留也未列入"被排除"清单。

## 分类索引

| 文件 | 类别 | 数量 | 一句话简介 |
|------|------|------|------------|
| [01-redundancy-and-duplication.md](./01-redundancy-and-duplication.md) | 冗余与重复实现 | 12 | 同一职责存在多个并行实现，或同样的逻辑被反复内联，造成维护成本与一致性风险。 |
| [02-compat-and-legacy-scars.md](./02-compat-and-legacy-scars.md) | 兼容代码与遗留痕迹 | 8 | 为旧版本 / 旧 schema / 已下线路径保留的兼容分支与遗留字段，许多已无现存调用方。 |
| [03-layer-violations.md](./03-layer-violations.md) | 分层违规 | 14 | 违反 AGENTS.md 既定分层（domain / engine 纯净层、app 协调层、server 边界层）的导入与 IO 行为。 |
| [04-unsuitable-solutions.md](./04-unsuitable-solutions.md) | 不适配的方案 | 10 | 选型或抽象不匹配实际约束（local-first / 单进程 / 轻量），导致复杂度收益倒挂。 |
| [05-performance-issues.md](./05-performance-issues.md) | 性能问题 | 9 | 热路径上的重复 IO、O(n²) 扫描、不必要的全量读写与同步阻塞调用。 |
| [06-complexity-hotspots.md](./06-complexity-hotspots.md) | 复杂度热点 | 3 | 单函数 / 单模块的认知复杂度显著超出团队基线，影响可读性与可演进性。 |
| [07-patch-scars.md](./07-patch-scars.md) | 补丁伤疤 | 6 | 为修单个 bug 而打的局部补丁，掩盖了上游真正的根因；建议回到根因层级处理。 |
| [08-dead-code-and-orphans.md](./08-dead-code-and-orphans.md) | 死代码与孤儿模块 | 8 | 仅被测试引用、或在生产代码中无任何调用方的模块/函数/类型。 |

## 被复核排除的问题

为保证清单的可信度，下列 finding 在初稿中被提出，但在对抗式验证阶段被推翻或大幅修正，未进入最终清单。此处保留摘要作为透明度记录，便于后续如有新证据时回溯。

### 冗余与重复实现 (1 条)

- **`acc/server/run_projection.py` 与 `acc/app/run_projection.py` 同名但分属不同关注点** — 文件名相同、常量重复属实，但"放错位置"的核心结论不成立: server 版本只被 `acc/server/routes/runs.py` 消费，逻辑上属于 server 层; 重命名/移入 `acc/result_store/` 会让子包反向 import 兄弟包，反而制造更严重的分层违规。Python 的全限定模块路径（`acc.app.run_projection` vs `acc.server.run_projection`）已经天然消歧。

### 分层违规 (4 条)

- **`acc/validation.py` 执行真实 IO** — AGENTS.md Stable Invariant §8 只把 `acc.domain` 和 `acc.engine` 列为纯净层，并未要求 `acc.validation` 必须 IO-free。且 `validate_artifacts()` 在生产代码中 0 调用方（仅测试引用），生产路径上的 artifact 校验由 `acc/app/core_v2_runtime.py:validate_artifact_contract()` 完成，所在层正确。
- **`acc/app/core_v2_runtime.py:load_runtime_overlay_payloads` 绕过 WorkflowCatalog** — 该 helper 不是 WorkflowCatalog 的重复，而是 WorkflowCatalog 的输入源: 它扫描事务级 overlay 目录，结果在下一行喂给 `WorkflowCatalog`。两者覆盖不同目录，建议合并会破坏设计。
- **`acc/server/routes/runs.py` L100 硬编码 `'ui_workflow_'` 前缀属于补丁伤疤** — 守卫代码确实存在，但根因诊断错误: `WorkbenchRunManager.submit` 在 HTTP 响应返回前已原子写入 `run_summary.json` 并重建 `index.json`，不存在所谓"索引缺失"的 bug。该守卫至多是历史遗留的多余防御，可作为低优先级清理处理。
- **`acc/control_plane.py` 函数内延迟 import `acc.app` 制造隐藏向上依赖** — `acc.app` 从未 import `acc.control_plane`，不存在循环依赖；调用方向是 cli/server → control_plane → acc.app，是正确的上→下依赖。函数内 import 只是组织松散，并非分层违规。

### 不适配的方案 (3 条)

- **`WorkbenchRunManager` 的进程内 in-memory 队列违反 "run dirs are the truth" 架构** — 三处事实错误: (1) `_reconcile_interrupted_runs` 显式把 `queued` 纳入 `ACTIVE_RUN_STATUSES` 并在启动时转 `crashed`，不存在"静默丢失"; (2) AGENTS.md 第 106-115 行明确背书 `WorkbenchRunManager` 模式; (3) 改成后台目录扫描会违反 Invariant 4（local-first，不引入分布式 worker）。
- **三个近似的 subprocess CLI adapter 应合并为一个可配置 adapter** — 经核实只有 3 行的 `write_jsonl` helper 在两个文件中重复，属轻微 code smell；其余适配器在执行模型（streaming+cancel vs communicate）、sandbox、output salvage、CODEX_HOME 隔离等维度差异显著，强行合并会产出更复杂的 god-object。
- **`run_manifest.json` 三个并发写入者，原子性被普通写覆盖** — 代码事实正确（`ArtifactStore.write_manifest` 非原子写、`persistence.manifest.write_atomic` 原子写、且两者 schema 完全不同），但严重程度被高估: `ArtifactStore` 仅在 4 个测试文件被 import，生产路径无调用方，"critical race in production" 不成立。建议重新定级为低优先级 design smell。

### 性能问题 (2 条)

- **每节点 4 处重复文件写入（patch scar）** — `agent_payload.json` 与 `input.json` 各自被独立子系统消费（`generic_cli` 走 `ACC_INPUT_PATH`、`run_index` 作 fallback、`invocation.py`/`artifact_store.py` 直接读取），不能简单合并。`artifacts/payload.json` 这一处可能是真正的孤儿写入，但单独一处不足以支撑"4 倍重复"的 major 严重度。
- **`supervisor.py` 在 `check_dispatch_policy` 与 `record_dispatch` 各读一次 `supervisor_state.json`** — 提议合并为一次读取会引入并发正确性 bug: 两次调用之间 `await execute_node` 期间，其他 dispatcher 可能 append 到 `call_graph` 或写入 `correlation_id`，缓存复用会导致 stale-base 写覆盖。两次磁盘读是 read-fresh-before-write 的正确性手段。

### 死代码与孤儿模块 (4 条)

- **`acc/artifact_store.py:62-63` 覆盖原子 manifest 写** — 所谓"DAG engine 调用 `write_atomic` 后被 `write_manifest` 覆盖"在生产代码中不存在调用链: 两者均为孤儿/未接入代码，"critical data-loss risk" 立不住。
- **`acc/session.py:SessionManifest` (Pydantic) 与 `domain.SessionInstance` (dataclass) 双重 session 表示** — `SessionManifest` 在文件外从未被 import 或实例化，磁盘 `session_manifest.json` 以 raw dict 读写，绕过 Pydantic 类。本质是死代码，而非"两套活跃表示并存"。
- **`acc/run_index.py:15-64` 的 `RunSummary/NodeRunSummary` 是 domain 类型放错模块** — 这些是 Pydantic 序列化模型而非领域不变量持有者; `acc/domain.py` 用 frozen dataclass 维持纯净，把 Pydantic 类放进去会破坏架构一致性。模型 + CRUD 同模块是合理的 repository 模式。
- **`acc/cli.py` 移除 `acc run` 命令** — 建议会误删 `acc run diff <run_a> <run_b>` 这条仍然有效的子分发路径（L129-139 调用 `diff_runs()`）。只有 `acc batch-run` 是真正的死代码; 该 finding 应改写为窄范围的 `acc batch-run` 移除建议。

## 后续建议优先级

清理建议分三个梯队，按"风险 / 收益 / 改动半径"权衡。**核心原则: 先做无回归风险的纯删除，再做收敛重复实现，最后才动架构性重构。**

### 第一梯队（低风险高收益，建议优先处理）

1. **死代码清理（08）+ 补丁伤疤回退（07）**: 这两类问题改动局部、回归风险最小，且能立即缩小代码面、减少新人理解成本。建议先做仅被测试引用的孤儿函数/类型删除（注意保留对应测试或一并下线），再回到补丁伤疤的根因层级处理（例如把硬编码前缀守卫替换为索引完整性检查）。
2. **兼容代码下线（02）**: 对每条遗留分支先确认"现存调用方 = 0"，再走删除流程。这一步会显著降低"哪条路径才是当前真相"的认知负担。

### 第二梯队（中等风险，需要结构性收敛）

3. **冗余与重复实现（01）**: 收敛同一职责的多份实现到唯一 source of truth，但要先确定哪一份是"主"、哪一份是"影"，再逐步迁移调用点。这一步要求调用图清晰，建议在第一梯队清理之后做。
4. **分层违规（03）**: 大多数违规可以通过把 IO 调用上移到 `acc.app` 协调层、把纯净模块的副作用清空来解决。需要逐模块审视，确保不会把违规简单"搬家"到另一层。

### 第三梯队（高风险或需要更多上下文，谨慎评估）

5. **不适配的方案（04）**: 涉及选型层面的取舍，单独看每条都可能是合理设计在不同约束下的产物。建议在前两梯队完成后重新评估，避免基于过时印象做重构。
6. **性能问题（05）+ 复杂度热点（06）**: 性能问题应先有 profiling 数据再动手，否则容易优化到非热路径; 复杂度热点应在功能稳定期重构，避免在演进活跃期破坏 git history 的可读性。

### 通用执行守则

- **每次清理一类、不混合多类**: 单 PR 单类别，便于回滚和 review。
- **删除前先 grep 全仓 + 跑全量测试**: 尤其是 dead-code 类，AGENTS.md 中的 stable invariants 必须复核。
- **保留删除记录**: 在 commit message 或 CHANGELOG 中说明被删模块的"曾经用途"，避免日后有人重新发明同一个轮子。
