# ACC v2 重构总规划

> 文档版本：2026-06-11 | 分支：dev_v3 | 产品负责人决策确认日期：2026-06-11

---

## 重构概览

| # | Feature | 优先级 | 估算工作量 | 关键风险 |
|---|---------|--------|-----------|---------|
| 04 | Domain 模型拆分（domain.py → models/serialization/validation） | P0 | 1 天（8 h） | 76 个文件全量 import 改写，漏改即运行时 ImportError |
| 07 | 基础设施清理（历史数据、空壳模块、死代码、依赖审计） | P0 | 0.5 天（4 h） | 删除 runs/ 目录前需备份测试 fixture |
| 03 | 状态机形式化 + ControlLedger 三层架构 | P1 | 5 天 | core_v2_runtime.py 修改范围大，隐性非法转换可能暴露 |
| 05 | GraphOps 统一 API（双模式 → 单 GraphOpsService） | P1 | 1 天（7.5 h） | materialize_transaction dispatch 重写引入 bug |
| 02 | Core Runtime 拆分（God Module → acc/runtime/） | P2 | 2 天（14 h） | 过渡 re-export 遗漏导致调用方 ImportError |
| 01 | WorkflowViewer.tsx 拆分（17K 行 → 瘦壳 + 子模块） | P2 | 13 天 | ReactFlow nodeTypes 引用不稳定、Zustand 切片跨读 |
| 06 | 前端 UX 修复、i18n 系统化、CSS 模块化 | P3 | 2 天（15.5 h） | CSS Modules 迁移视觉回归 |

**合计估算**：约 24.5 天（单人串行）；Phase 1+2+3 后端部分约 9 天，Phase 4 前端约 15 天，两条线可并行压缩至约 15 天。

---

## 依赖关系图

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 04 Domain 模型拆分                07 基础设施清理                         │
│ (acc/models + serialization +    (runs/ 清空, 空壳删除,                 │
│  validation, 删 domain.py)        死代码清理, 依赖审计)                   │
└──────────┬──────────────────────────────────────────────────────────────┘
           │ 所有 Python 模块 import domain → import models
           ▼
┌──────────────────────────┐     ┌──────────────────────────────────────┐
│ 03 状态机 + ControlLedger │     │ 05 GraphOps 统一 API                 │
│ (state_machine.py,        │     │ (graphops.py 重写,                   │
│  ledger_writer.py,        │     │  graphops_v3.py 删除,                │
│  STRICT 模式)             │     │  patch 模式废弃)                      │
└──────────┬───────────────┘     └──────────────────────────────────────┘
           │ Writer API 就绪
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 02 Core Runtime 拆分                                                  │
│ (acc/runtime/ 包: ledger_writer, scheduler, executor,                │
│  dispatch_gate, payload, io, workflow_io, nested_workflow,           │
│  invocation — core_v2_runtime.py 压缩为过渡包装)                       │
└──────────────────────────────────────────────────────────────────────┘

前端线（独立，可与后端并行）：
┌──────────────────────────┐
│ 01 WorkflowViewer 拆分    │
│ (Zustand store,          │
│  canvas/authoring/        │
│  assistant/inspector/     │
│  execution 子模块)        │
└──────────┬───────────────┘
           │ 主文件框架稳定后
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 06 前端 UX + i18n + CSS Modules                                       │
│ (format.ts, zh-CN.ts 系统化, 7 组件 CSS Module 化,                   │
│  InteractionPanel/ArtifactViewer/CallableBrowser 功能修复)            │
└──────────────────────────────────────────────────────────────────────┘
```

**关键约束**：
- 04 必须先于 03、02、05 完成（所有 Python 模块依赖 acc.domain，04 重命名后才能安全改其他模块）
- 03 必须先于 02 完成（02 的 ledger_writer.py 实现依赖 03 的 state_machine.py 和 Writer API）
- 07 可与 04 并行（07 的历史数据清理、空壳删除不依赖 domain 重命名）
- 05 与 03 相互独立（各自修改不同文件，无共享改写点）
- 01 与所有后端 feature 独立，可任何时间启动
- 06 部分依赖 01（WorkflowEvidenceDock 的 CSS Module 化在 01 的 CSS 迁移框架完成后进行）

---

## 推荐执行顺序

### Phase 1：基础层（Foundation） — 约 1.5 天

**目标**：消除全局阻塞依赖，为后续所有 feature 解锁并行空间。

| 任务 | 估算 | 并行说明 |
|------|------|---------|
| 04 Domain 模型拆分（models + serialization + validation，删 domain.py） | 1 天 | 主线 |
| 07 基础设施清理（runs/ 清空、空壳删除、acc/binding 死代码、依赖审计） | 0.5 天 | 与 04 并行（不修改同一文件） |

**完成门控**：
- `from acc.domain import` 在全库零出现（`test_no_domain_import.py` 绿色）
- `acc/binding/` 目录已删除
- `runs/` 目录已清空并重建

---

### Phase 2：核心逻辑层（Core Logic） — 约 2 天

**目标**：建立 STRICT 状态机，统一 GraphOps，为 Runtime 拆分提供基础。

| 任务 | 估算 | 并行说明 |
|------|------|---------|
| 03 状态机 + ControlLedger 三层架构 | 5 天（分阶段） | 主线；Phase 2 完成 Layer 3 + Layer 2 设计 |
| 05 GraphOps 统一 API | 1 天 | 与 03 并行（无共享文件） |

**完成门控**：
- `acc/state_machine.py` 所有转换路径单元测试绿色
- `acc/ledger_writer.py` 集成测试（tmpdir）绿色
- `GraphOpsService` 生命周期测试全通
- `acc/app/graphops_v3.py` 已删除

---

### Phase 3：运行时层（Runtime） — 约 2.5 天

**目标**：拆解 God Module，完成 STRICT 状态机在运行时中的全面接入。

| 任务 | 估算 | 并行说明 |
|------|------|---------|
| 03 后半段（core_v2_runtime.py 接入 Writer API，统一 handoff/supervisor/run_lifecycle） | 1.5 天 | 依赖 Phase 2 完成 |
| 02 Core Runtime 拆分（acc/runtime/ 包迁移，dispatch_gate 去重，asyncio.to_thread） | 2 天 | 依赖 03 Writer API 就绪 |

**完成门控**：
- `acc/app/core_v2_runtime.py` 压缩至约 40 行过渡 re-export
- `tests/runtime/` 所有测试绿色
- `append_plan_step_transition` 全局只剩 `acc/ledger_writer.py` 内部一处调用

---

### Phase 4：前端层（Frontend） — 约 15 天（可与后端并行）

**目标**：消除前端 God Component，建立 UX 基准，完成 i18n 系统化。

| 任务 | 估算 | 并行说明 |
|------|------|---------|
| 01 WorkflowViewer 拆分（Zustand + 子模块提取，14 步骤） | 13 天 | 前端主线，可在 Phase 1 完成后立即启动 |
| 06 前端 UX + i18n + CSS Modules（11 步骤） | 2 天 | 部分步骤（chevron 修正、ControlPlanePanel 开关）可在 01 启动的同时并行完成 |

**完成门控**：
- `WorkflowViewer.tsx` 缩减至 ≤300 行
- `__workflowViewerTestables` 导出已删除
- `zh-CN.ts` 新增约 150 个 key，TypeScript 编译零类型错误
- `styles.css` 缩减至全局 token + utility（WorkflowViewer 专用 class 已迁出）

---

## 各 Feature 摘要

### Feature 01 — WorkflowViewer.tsx 拆分重构

**范围**：前端最大 God Component，`WorkflowViewer.tsx` 当前 17,521 行，承载全部 Workbench 逻辑。目标是通过安装 Zustand 状态管理（3 个切片：workbenchStore / runStore / assistantStore），将组件按关注点拆分为 canvas、authoring、assistant、inspector、execution、workbench 六大子目录，主文件压缩至 ≤300 行瘦壳。同时删除 14 个 `STOCK_*_AGENT_ID` 演示常量和 `__workflowViewerTestables` 聚合导出对象，各纯函数改为模块级命名导出。

**关键文件**：`web/src/components/WorkflowViewer.tsx`（主目标），新建 40+ 子模块，新建 3 个 Zustand store。

**工作量**：13 人天（14 步骤，单人串行，部分可并行）。

**风险**：ReactFlow `nodeTypes` 对象引用不稳定导致节点闪烁重渲（缓解：模块顶层常量定义 + `memo()`）；Zustand selector 跨 store 读取导致不必要的 re-render（缓解：严格 selector 粒度）。

---

### Feature 02 — Core Runtime 拆分与 dispatch 去重

**范围**：后端最大 God Module，`acc/app/core_v2_runtime.py` 2,422 行，同时承担 7 种职责。核心操作包括：创建 `acc/runtime/` 包（9 个子模块），将三个 95% 重复的 dispatch 函数提取为 `_dispatch_steps` 通用骨架（代码从 ~315 行压缩到 ~115 行），`FixedRunControlLedger` 重命名为 `FixedRunControlLedgerWriter`，原文件压缩为约 40 行过渡 re-export。

**关键文件**：`acc/app/core_v2_runtime.py`（压缩），新建 `acc/runtime/` 包（ledger_writer, scheduler, executor, invocation, dispatch_gate, payload, io, workflow_io, nested_workflow）。

**工作量**：2 天（14 h，主要集中在 STRICT 状态机集成和 dispatch_gate 提取）。

**风险**：过渡 re-export 遗漏某个符号导致 ImportError（缓解：步骤 13 后全量 `pytest -x`）；`asyncio.to_thread` 批量合并后某写入失败难以定位（缓解：私有函数内部不捕获异常）。

---

### Feature 03 — 状态机形式化与 ControlLedger 三层架构

**范围**：当前状态机无写入时校验（只在读取时验证），`FixedRunControlLedger` 职责混合（读写 + I/O + 业务逻辑），`handoff.py` / `supervisor.py` / `run_lifecycle.py` 直接绕过中央 Writer 调用底层 append 函数。目标是建立三层严格分离：Layer 1 不可变域记录（frozen dataclass）、Layer 2 `FixedRunControlLedgerWriter`（唯一写入点）、Layer 3 纯转换辅助函数 `transition_plan_step / transition_dispatch`（无副作用，可单元测试所有 36 个合法/非法路径）。STRICT 模式：非法转换立即 `raise AccError`，不依赖读取时发现。

**关键文件**：新建 `acc/state_machine.py` + `acc/ledger_writer.py`；修改 `acc/app/core_v2_runtime.py` / `handoff.py` / `supervisor.py` / `run_lifecycle.py` / `control_ledger_codec.py`；删除 `runs/` 历史数据。

**工作量**：5 天（Layer 3 纯函数 1 天，Layer 2 Writer 设计 0.5 天，core_v2_runtime 接入 1.5 天，统一调用方 0.5 天，其余测试与清理）。

**风险**：`core_v2_runtime.py` 修改范围大（删除 82-572 行），可能引入 regression（缓解：步骤前先补全单元测试，git 逐步提交）；现有代码中可能已存在隐性非法转换，STRICT 模式激活后会抛出（缓解：先写测试覆盖当前行为，再添加校验）。

---

### Feature 04 — Domain 模型拆分

**范围**：`acc/domain.py` 1,411 行，混合三种职责（数据定义 + 序列化 + 验证）。目标是拆分为 `acc/models.py`（830 行，所有 frozen dataclass + 常量）、`acc/serialization.py`（350 行，to/from_dict 系列）、`acc/validation.py`（80 行，validate_core_v2_* 系列），并删除 domain.py 及 V2 Binding 死代码（`acc/binding/` 整包、`acc/ports/__init__.py` 空壳）。76 个文件的 `from acc.domain import` 全量改写，无向后兼容 re-export。

**关键文件**：`acc/domain.py`（删除），新建三个模块，修改 76 个消费文件（46 个 acc 源文件 + 38 个测试文件）。

**工作量**：1 天（8 h，主要工作量在步骤 5 全量 import 改写，建议用脚本批量替换后人工 review diff）。

**风险**：import 改写遗漏导致运行时 ImportError（缓解：`test_no_domain_import.py` 自动化检测）；`control_ledger_to_dict` 调用方散落较多（缓解：先 `grep` 确认全量再改写）。

---

### Feature 05 — GraphOps 统一 API

**范围**：当前存在两套并行 API（`acc/graphops.py` patch 模式 + `acc/app/graphops_v3.py` transaction 模式），路由层须同时 import 两个模块，patch 模式实际已废弃（`apply` 强制抛 AccError）。目标是将 transaction 模式全量迁入 `acc/graphops.py`，`GraphOpsProposalService` 重命名为 `GraphOpsService`，删除所有 patch 相关函数和端点，工具函数私有化（加下划线前缀），内部操作处理器从 if/elif 分支重构为 `_OPERATION_HANDLERS` 注册表。删除 `acc/app/graphops_v3.py`。

**关键文件**：重写 `acc/graphops.py`；删除 `acc/app/graphops_v3.py`；修改 `acc/server/routes/graphops.py` / `acc/mcp_server/tools.py` / `acc/app/decisions.py` / `acc/cli.py`。

**工作量**：1 天（7.5 h，主要集中在 graphops.py 重写和操作处理器提取）。

**风险**：步骤 3 遗漏某个调用方（缓解：完成后 `grep -rn "from acc.app.graphops_v3"` 确认零结果）；materialize_transaction dispatch 逻辑重写引入 bug（缓解：步骤 1 完成后立即执行原有测试以行为等价为门控）。

---

### Feature 06 — 前端 UX 修复、i18n 系统化与 CSS 模块化

**范围**：8 个前端组件存在明确 bug 或 UX 问题：`InteractionPanel` 的 ask/suggest 类型无输入框（用户卡住）、`WorkflowEvidenceDock` chevron 方向反转、`ArtifactViewer` 多节点无切换、`CallableBrowser` 删除无确认对话框、`DecisionInboxPanel` 暴露原始 UUID、`ControlPlanePanel` 开发者工具无保护开关、`RunInspector` 暴露原始路径和未格式化字节数。同步完成：`format.ts` 补全 `formatBytes` / `formatTimestamp`，`zh-CN.ts` 扩展约 150 个 key（分区结构），7 个组件迁移至 CSS Modules，`styles.css` 缩减约 800–1200 行。

**关键文件**：`web/src/format.ts`、`web/src/i18n/zh-CN.ts`、7 个组件 tsx 及对应新建 `.module.css`、`web/src/styles.css`（缩减）。

**工作量**：2 天（15.5 h，CSS Modules 迁移是主要工作量，约 4 h）。

**风险**：CSS Modules 迁移视觉回归（缓解：每组件迁移后浏览器截图对比）；i18n 嵌套结构变更破坏现有引用（缓解：只追加 key，不修改已有顶级 key，TypeScript 编译捕获）。

---

### Feature 07 — 基础设施清理

**范围**：与其他 feature 解耦的清理工作，包括：删除 `runs/` 目录历史运行数据（产品负责人已确认，schema 不兼容，不需迁移）；删除空壳模块（`acc/ports/__init__.py`、`acc/migration/__init__.py`）；随 04 一并删除 `acc/binding/` Phase 1 死代码骨架（selector.py、provenance.py、`__init__.py`）；清理 `schemas/graphops_patch_schema.json`（随 05 一并删除）；审计并删除 `web/src/styles.css` 中 WorkflowViewer 专用 class 的非迁移候选（保留全局 token + reset）；前端 `localStorage` key 版本化失效（防止旧 schema 数据污染）。

**关键文件**：`runs/` 目录，`acc/binding/` 目录，`acc/ports/__init__.py`，`acc/migration/__init__.py`，前端 localStorage key 版本常量。

**工作量**：0.5 天（4 h，大多数为确认操作 + 机械删除，主要时间花在历史数据备份 + 验证）。

**风险**：删除 `runs/` 目录导致开发环境丢失测试 fixture（缓解：重构前将重要 fixture 备份至 `tests/fixtures/`）；`acc/binding/` 删除后有隐藏消费者（缓解：删除前 `grep -r "from acc.binding"` 确认零结果）。

---

## 总工作量与排期

### 工作量汇总

| 阶段 | Feature | 工作量 |
|------|---------|--------|
| Phase 1（基础层） | 04 Domain 拆分 | 1 天 |
| Phase 1（基础层） | 07 基础设施清理 | 0.5 天 |
| Phase 2（核心逻辑层） | 03 状态机（前半：Layer 3 + Layer 2） | 2 天 |
| Phase 2（核心逻辑层） | 05 GraphOps 统一 | 1 天 |
| Phase 3（运行时层） | 03 状态机（后半：接入 core_v2_runtime，统一调用方） | 3 天 |
| Phase 3（运行时层） | 02 Core Runtime 拆分 | 2 天 |
| Phase 4（前端层） | 01 WorkflowViewer 拆分 | 13 天 |
| Phase 4（前端层） | 06 前端 UX + i18n + CSS | 2 天 |
| **合计（串行）** | | **24.5 天** |

### 并行执行排期建议

假设单人执行，将后端和前端线并行：

```
周次 | 后端线                                | 前端线
----|--------------------------------------|-----------------------------------
W1  | Phase 1: 04 + 07 (1.5 天)           | Phase 4: 01 开始（步骤 1-3，1.5 天）
    | Phase 2: 03 Layer 3+2 (2 天)        | 01 继续（步骤 4-7，2 天）
W2  | Phase 2: 05 GraphOps (1 天)         | 01 继续（步骤 8-11，2 天）
    | Phase 3: 03 后半 (3 天)             | 01 继续（步骤 12-14，1.5 天）
W3  | Phase 3: 02 Runtime (2 天)          | Phase 4: 06 UX+i18n+CSS (2 天)
```

**乐观排期**：约 3 周（如果后端线和前端线同时推进，总日历时间约 15 个工作日）。

**保守排期**：约 4 周（单人串行，或频繁上下文切换带来的效率损耗）。

**里程碑**：
- M1（第 2 天末）：04 + 07 完成，domain.py 已删除，所有 Python import 已迁移至 models/serialization/validation
- M2（第 7 天末）：03 Layer 3/2 + 05 完成，STRICT 状态机就绪，GraphOps 统一，历史数据已清空
- M3（第 12 天末）：03 全量接入 + 02 完成，God Module 拆分完成，后端架构全面稳定
- M4（最终）：01 + 06 完成，前端 Workbench 模块化，i18n 全覆盖

---

## 质量保障

### 测试策略

**原则**：测试随重构同步编写，不单独设立测试 sprint。每个 feature 的实施步骤中已内嵌测试任务。

| 测试层次 | 覆盖范围 | 工具 |
|---------|---------|------|
| Layer 3 纯函数单元测试 | state_machine.py 所有转换路径（36 条合法/非法路径） | pytest |
| Layer 2 集成测试（tmpdir） | FixedRunControlLedgerWriter 完整 dispatch 生命周期 | pytest + tmp_path |
| Domain 模型测试 | frozen dataclass 不可变性、常量不可变性、序列化往返 | pytest |
| Import 完整性测试 | `test_no_domain_import.py`：全库无 `from acc.domain import` | pytest + ast |
| GraphOps 生命周期测试 | create → validate → dry_run → approve → apply → reject | pytest |
| Canvas 纯函数单元测试 | canvasToGraph 往返一致性、canvasEdgeOps 合法/拒绝路径 | Jest |
| Zustand store 测试 | store 初始化、canvas 加载、selection 变更流程 | Jest + RTL |
| SSE hook 测试 | useWorkbenchLiveStream 模拟 EventSource，terminal event 停止轮询 | Jest |
| 前端 UX 测试 | InteractionPanel ask/suggest 提交、ConfirmDialog focus trap、formatBytes | Jest + RTL |
| 全量回归 | 每个 feature 完成后运行 `pytest -x`（后端）和 `npm test`（前端） | pytest + Jest |

**不设 CI pipeline**：所有测试在本地 `pytest` / `npm test` 执行，符合单用户本地部署场景。

### 门控规则

- **Critical（必须修复才能合并）**：任何测试失败、ImportError、运行时 TypeError
- **High（本 feature 内修复）**：STRICT 状态机非预期拒绝合法转换、ReactFlow 节点闪烁
- **Medium/Low（可追踪，不阻塞合并）**：CSS 视觉细节差异、i18n key 遗漏

---

## Git 提交策略

### 分支策略

当前工作分支：`dev_v3`（由 git status 确认）。目标合并入：`main`。

### 每 Feature 提交结构

每个 feature 在同一分支 `dev_v3` 上按步骤提交，提交完成后 push：

```
# Feature 04 示例：
git commit -m "feat(domain): create acc/models.py with all frozen dataclasses"
git commit -m "feat(domain): create acc/serialization.py with to/from_dict functions"
git commit -m "feat(domain): create acc/validation.py with validate_core_v2_* functions"
git commit -m "refactor(domain): rewrite all 76 files from acc.domain to acc.models/serialization/validation"
git commit -m "chore(domain): delete acc/domain.py and acc/binding/ dead code"
git commit -m "test(domain): add test_no_domain_import.py and test_models.py"
git push origin dev_v3
```

### 提交粒度原则

1. **一步骤一提交**：每个 feature 的每个实施步骤对应一个 commit，便于 `git bisect` 定位问题
2. **测试与实现同 commit**：纯函数提取和对应的单元测试在同一 commit 中提交（test first 或 test together 均可）
3. **不混合 feature**：不在同一 commit 中同时修改两个 feature 的文件，避免 review 混乱
4. **完成门控后 push**：每个 feature 的所有步骤完成、测试绿色后再 push，不 push 半完成状态
5. **过渡 shim 单独 commit**：任何 `# DEPRECATED` / `# TRANSITIONAL SHIM` 的添加单独 commit，删除时也单独 commit，使 git log 清晰标记迁移窗口

### Commit Message 规范

格式：`<type>(<scope>): <description>`

| type | 用途 |
|------|------|
| `feat` | 新增功能、新建模块 |
| `refactor` | 代码重构（无功能变化） |
| `fix` | Bug 修复 |
| `chore` | 删除文件、清理死代码、依赖升级 |
| `test` | 新增/修改测试 |
| `style` | CSS 迁移（仅样式变化） |
| `docs` | 文档更新 |

scope 对应 feature 编号：`domain`、`runtime`、`ledger`、`graphops`、`viewer`、`ux`、`infra`。

---

*本文档综合 01-07 七份 feature 规划，依据 2026-06-11 产品负责人决策确认意见整合而成。各 feature 详细步骤、文件变更清单、测试用例见对应编号文档。*
