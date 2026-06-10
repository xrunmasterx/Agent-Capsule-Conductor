# GraphOps 统一 API 重构

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 职责 |
|------|------|------|
| `acc/graphops.py` | 354 行 | Patch 模式：JSON Schema 校验、dry-run、apply（已禁用）、工具函数 |
| `acc/app/graphops_v3.py` | 777 行 | Transaction 模式：`GraphOpsProposalService` 完整生命周期 |
| `acc/server/routes/graphops.py` | 199 行 | FastAPI 路由层，同时 import 两个模块 |
| `acc/cli.py`（graphops 段） | ~60 行 | CLI 命令，只 import `acc.graphops` 的 patch 系列函数 |
| `acc/mcp_server/tools.py` | ~30 行 | MCP 工具层，只 import `GraphOpsProposalService` |
| `acc/app/decisions.py` | ~10 行 | Import `GRAPHOPS_PROPOSAL_ROOT`（v3）和 `graphops_governance_payload`（v1） |
| `tests/unit/test_graphops_patch_validation.py` | — | 覆盖 patch 模式（v1 API） |
| `tests/unit/test_graphops_v3.py` | — | 覆盖 transaction 模式（v3 API） |
| `tests/unit/test_graphops_supervisor_proposal.py` | — | 覆盖 supervisor dry-run（依赖 stub） |

### 当前问题

1. **API 分裂**：两套并行 API（patch 模式 vs transaction 模式）对外暴露，路由层需同时 import 两个模块。`acc/server/routes/graphops.py` 的 import 清单混合了 `GraphOpsProposalService`（v3）和 `apply_patch_request, dry_run_patch, validate_patch_file`（v1），认知负担高。

2. **工具函数反向依赖**：`acc/app/graphops_v3.py` 第 20 行直接 import `acc.graphops` 的三个工具函数（`contains_policy_value, contains_value, validate_relative_path`），形成 `app/` 层依赖根模块的反向耦合。

3. **Patch 模式是失效遗留**：`acc/graphops.py` 中 `GRAPHOPS_APPLY_STATUS = "not_implemented"`，`apply_patch_request` 最终强制抛 `AccError("Real GraphOps apply is not implemented in Option A")`，`dry_run_supervisor_proposal` 依赖 supervisor stub。整个 patch 模式已被 transaction 模式取代，仅保留了 dry-run 的展示价值。

4. **操作处理器内联**：`materialize_transaction`（graphops_v3.py 483–522 行）内部用 if/elif 分支直接处理 `agent_class`、`tool_class`、`workflow` 三种目标类型，无类型化的操作注册表，新增操作类型需修改核心函数。

5. **命名不一致**：v1 术语（`patch_id`, `target_type`, `operations[]`）与 v3 术语（`proposal_id`, `schema_version`, `targets[]`）并存于同一 HTTP 路由，外部调用者须理解两套术语。

6. **治理元数据散落**：`graphops_governance_payload()` 和 `GRAPHOPS_GOVERNANCE_MODE` 常量定义在 `acc/graphops.py`，被 `decisions.py` 和路由层引用，是 patch 模式的遗留概念，不应继续扩散。

---

## 重构目标

### 目标架构

```
acc/graphops.py                     ← 统一公开 API（保留文件名，完整替换内容）
  GraphOpsService                   ← 唯一对外服务类（原 GraphOpsProposalService 改名）
    .create_proposal(proposal)
    .list_proposals()
    .get_proposal(proposal_id)
    .validate(proposal_id)
    .dry_run(proposal_id)
    .approve(proposal_id, approval)
    .apply(proposal_id)
    .reject(proposal_id, reason)
  _OPERATION_HANDLERS               ← 内部注册表，不对外暴露
    "create_agent_class" -> _handle_create_agent_class
    "create_tool_class"  -> _handle_create_tool_class
    "create_workflow"    -> _handle_create_workflow
  GRAPHOPS_PROPOSAL_ROOT            ← 常量，对外可见
  工具函数（内部使用）：
    _contains_value / _contains_policy_value / _validate_relative_path

acc/app/graphops_v3.py              ← 删除
```

对外（user / API / audit）只看到 `GraphOpsService`，CLI / MCP / 路由均只 import `acc.graphops`。

### 关键设计决策

1. **类模式（`GraphOpsService`）**：与现有 `GraphOpsProposalService` 签名兼容，构造时接收 `project_root: Path`。外部调用方只需替换类名，不改方法签名。

2. **内部操作处理器注册表**：使用 `TypedDict` 定义操作输入/输出 schema，通过 `dict[str, Callable]` 注册表实现 dispatch。每个处理器签名：
   ```python
   # TypedDict 定义（内部）
   class MaterializedTarget(TypedDict):
       kind: str        # "agent_class" | "tool_class" | "workflow"
       content: str     # 序列化后的文件内容
       payload: dict[str, Any]

   # 处理器签名
   OperationHandler = Callable[
       [dict[str, Any], MaterializationContext],
       MaterializedTarget,
   ]

   _OPERATION_HANDLERS: dict[str, OperationHandler] = {
       "create_agent_class": _handle_create_agent_class,
       "create_tool_class":  _handle_create_tool_class,
       "create_workflow":    _handle_create_workflow,
   }
   ```
   `template` 字段保留 `dict[str, Any]`（LLM 输出字段，不强类型约束）。

3. **Patch 模式完全废弃**：`validate_patch`, `dry_run_patch`, `apply_patch_request`, `semantic_diff_for_patch`, `validate_patch_file`, `graphops_governance_payload`, `dry_run_supervisor_proposal` 等函数**不迁移**，直接删除。CLI 的 `graphops validate-patch` / `validate` / `dry-run` / `apply-patch` 子命令一并删除。HTTP 路由的 `/graphops/validate`, `/graphops/dry-run`, `/graphops/apply`, `/graphops/examples` 端点一并删除。

4. **工具函数私有化**：`contains_value`、`contains_policy_value`、`validate_relative_path`、`contains_legacy_workflow_field` 迁入 `acc/graphops.py` 内部，命名为 `_contains_value` 等（下划线前缀），不对外导出。`acc/app/graphops_v3.py` 删除后自然消除旧的跨模块 import。

5. **治理常量清理**：`GRAPHOPS_GOVERNANCE_MODE`, `GRAPHOPS_APPLY_STATUS`, `graphops_governance_payload()` 随 patch 模式一起删除。`decisions.py` 中引用 `graphops_governance_payload` 的位置直接删除该字段（该信息在 decision inbox 中无实际意义）。

---

## 详细实施步骤

### 步骤 1：在 `acc/graphops.py` 中合并所有逻辑并重写

**具体操作：**
- 将 `acc/app/graphops_v3.py` 的全部内容迁入 `acc/graphops.py`，同时：
  - `GraphOpsProposalService` 重命名为 `GraphOpsService`
  - 将工具函数（`contains_value`, `contains_policy_value`, `validate_relative_path`, `contains_legacy_workflow_field`）改为内部私有函数（`_contains_value` 等）
  - 提取 `materialize_transaction` 内部的 per-type 分支为独立处理器函数（`_handle_create_agent_class`, `_handle_create_tool_class`, `_handle_create_workflow`）并注册到 `_OPERATION_HANDLERS` 字典
  - 定义 `MaterializationContext` TypedDict，将 `project_root`、`staging_dir`、`registry`、`workflow_ids` 打包传递给处理器
  - 删除 patch 模式全部函数（`validate_patch`, `dry_run_patch`, `apply_patch_request`, `semantic_diff_for_patch`, `validate_patch_file`, `graphops_governance_payload`, `dry_run_supervisor_proposal`，以及相关常量 `GRAPHOPS_GOVERNANCE_MODE`, `GRAPHOPS_APPLY_STATUS`, `GRAPHOPS_PATCH_SCHEMA_PATH`, `FORBIDDEN_OPERATIONS`）
  - 保留 `GRAPHOPS_PROPOSAL_ROOT`（被 `decisions.py` 引用）
- 移除原 `acc/graphops.py` 顶部对 `jsonschema` 的 import（patch schema 校验已删除）

**涉及文件：**
- 重写：`acc/graphops.py`
- 暂不修改 `acc/app/graphops_v3.py`（下一步更新调用方后再删）

**预期结果：**
- `from acc.graphops import GraphOpsService` 可用，方法签名与原 `GraphOpsProposalService` 完全一致
- `_OPERATION_HANDLERS` 注册表就位，`materialize_transaction` 通过 dispatch 调用处理器

---

### 步骤 2：将 `acc/app/graphops_v3.py` 改为临时 shim

**具体操作：**
- 清空 `acc/app/graphops_v3.py` 的实现，改为纯转发：
  ```python
  # TRANSITIONAL SHIM — delete after all callers migrated
  from acc.graphops import GraphOpsService as GraphOpsProposalService  # noqa: F401
  from acc.graphops import GRAPHOPS_PROPOSAL_ROOT  # noqa: F401
  ```
- 目的：让尚未更新的调用方在过渡期不报错，同时标明迁移意图

**涉及文件：**
- 修改：`acc/app/graphops_v3.py`

**预期结果：**
- 现有 `from acc.app.graphops_v3 import GraphOpsProposalService` 的调用方不报错
- 为步骤 3 的调用方更新提供安全窗口

---

### 步骤 3：更新所有调用方

**3.1 `acc/server/routes/graphops.py`**
- 删除全部 patch 模式 HTTP 端点：`/examples`, `/validate`, `/dry-run`, `/apply`
- 删除对应 request model：`GraphOpsRequest`, `GraphOpsApplyRequest`
- 删除 import：`apply_patch_request, dry_run_patch, graphops_governance_payload, semantic_diff_for_patch, validate_patch_file`
- 将 `from acc.app.graphops_v3 import GraphOpsProposalService` 改为 `from acc.graphops import GraphOpsService`
- `graphops_v3_service()` 工厂函数返回类型改为 `GraphOpsService`
- 删除 `load_patch()` 辅助函数（只被已删除端点使用）

**3.2 `acc/mcp_server/tools.py`**
- 将 `from acc.app.graphops_v3 import GraphOpsProposalService` 改为 `from acc.graphops import GraphOpsService`
- 将所有 `GraphOpsProposalService(...)` 实例化改为 `GraphOpsService(...)`

**3.3 `acc/app/decisions.py`**
- 将 `from acc.app.graphops_v3 import GRAPHOPS_PROPOSAL_ROOT` 改为 `from acc.graphops import GRAPHOPS_PROPOSAL_ROOT`
- 删除 `from acc.graphops import graphops_governance_payload`
- 删除代码中 `graphops_governance_payload()` 的调用（该字段在 decision inbox 无实际含义，直接移除）

**3.4 `acc/cli.py`**
- 删除 import：`apply_patch_request, dry_run_patch, graphops_governance_payload, validate_patch_file`
- 删除以下 CLI 命令（对应已删除的 patch 模式 API）：
  - `@graphops_app.command("validate-patch")`
  - `@graphops_app.command("validate")`
  - `@graphops_app.command("dry-run")`
  - `@graphops_app.command("apply-patch")`
- 若 `graphops_app` 下已有 transaction 系列命令则保留并更新 import

**涉及文件：**
- 修改：`acc/server/routes/graphops.py`, `acc/mcp_server/tools.py`, `acc/app/decisions.py`, `acc/cli.py`

**预期结果：**
- 所有调用方使用 `from acc.graphops import GraphOpsService`
- 无任何调用方再引用 patch 模式函数

---

### 步骤 4：删除旧文件

**具体操作（按顺序）：**
1. 运行 `grep -rn "from acc.app.graphops_v3" --include="*.py"` 确认零结果
2. 删除 `acc/app/graphops_v3.py`
3. 运行 `grep -rn "graphops_governance_payload\|apply_patch_request\|dry_run_patch\|validate_patch" --include="*.py"` 确认零结果
4. 确认 `acc/graphops.py` 中原 patch 模式函数已全部删除（步骤 1 已完成）
5. 搜索并删除 `schemas/graphops_patch_schema.json`（若存在）

**涉及文件：**
- 删除：`acc/app/graphops_v3.py`
- 删除（若存在）：`schemas/graphops_patch_schema.json`

**预期结果：**
- 代码库中不再存在 v3 模块和 patch schema

---

### 步骤 5：更新测试文件

**具体操作：**
- 删除 `tests/unit/test_graphops_patch_validation.py`（测试已废弃的 patch 模式，无迁移价值）
- 删除 `tests/unit/test_graphops_supervisor_proposal.py`（`dry_run_supervisor_proposal` 已删除）
- 修改 `tests/unit/test_graphops_v3.py`：
  - `from acc.app.graphops_v3 import GraphOpsProposalService, validate_transaction` 改为 `from acc.graphops import GraphOpsService`；`validate_transaction` 改为 `from acc.graphops import validate_transaction`（若对外导出）或直接通过 service 方法测试
  - 将所有 `GraphOpsProposalService` 替换为 `GraphOpsService`
  - 文件重命名为 `tests/unit/test_graphops.py`（可选）
- 新增 `tests/unit/test_graphops_operation_handlers.py`：覆盖三个操作处理器的 validate + materialize 路径

**涉及文件：**
- 删除：`tests/unit/test_graphops_patch_validation.py`, `tests/unit/test_graphops_supervisor_proposal.py`
- 修改：`tests/unit/test_graphops_v3.py`
- 新增：`tests/unit/test_graphops_operation_handlers.py`

---

### 步骤 6：运行测试验证

**具体操作：**
- `pytest tests/unit/test_graphops_v3.py -v`（迁移后的主测试）
- `pytest tests/ -v`（全量回归）
- 手动确认 HTTP 路由 `/graphops/proposals/*` 所有端点签名与迁移前一致

---

## 文件变更清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `tests/unit/test_graphops_operation_handlers.py` | 操作处理器单元测试 |

### 修改文件

| 文件 | 变更描述 |
|------|---------|
| `acc/graphops.py` | 完整重写：合并 transaction 逻辑，加入类型化操作处理器注册表，删除 patch 模式，重命名为 `GraphOpsService` |
| `acc/server/routes/graphops.py` | 删除 patch 端点及其 request models；`GraphOpsProposalService` → `GraphOpsService` |
| `acc/mcp_server/tools.py` | `GraphOpsProposalService` → `GraphOpsService` |
| `acc/app/decisions.py` | import 路径改为 `acc.graphops`；删除 `graphops_governance_payload` 引用 |
| `acc/cli.py` | 删除 patch 模式 CLI 命令和 import |
| `tests/unit/test_graphops_v3.py` | `GraphOpsProposalService` → `GraphOpsService`；更新 import 路径 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `acc/app/graphops_v3.py` | 全部逻辑迁入 `acc/graphops.py` |
| `tests/unit/test_graphops_patch_validation.py` | 测试已废弃的 patch 模式 |
| `tests/unit/test_graphops_supervisor_proposal.py` | `dry_run_supervisor_proposal` 随 patch 模式一起删除 |
| `schemas/graphops_patch_schema.json`（若存在） | patch schema 随 patch 模式废弃 |

---

## 测试计划

### 关键测试用例

**GraphOpsService 生命周期（`test_graphops_v3.py` / `test_graphops.py`）**
- `test_create_proposal_valid`：合法 transaction → `status: drafted`
- `test_create_proposal_duplicate_id_rejected`：同 proposal_id 二次创建 → `AccError`
- `test_validate_proposal_invalid_operation`：包含未知 operation → `status: invalid`，`errors` 含 `operation_forbidden`
- `test_dry_run_no_files_written`：`dry_run()` 完成后目标路径无文件写入，`mutated: false`
- `test_approve_validates_digest`：`dry_run_digest` 不匹配 → `AccError`
- `test_apply_creates_files_and_status`：完整生命周期（create → validate → dry_run → approve → apply）→ 文件写入磁盘，`status: applied`
- `test_apply_stale_base`：apply 前目标文件已存在 → `AccError`，`status: stale_base`
- `test_reject_non_terminal`：非终态 proposal → `status: rejected`

**操作处理器（`test_graphops_operation_handlers.py`）**
- `test_handle_create_agent_class_valid`：合法 template → YAML 内容含正确 callable_id
- `test_handle_create_agent_class_id_filename_mismatch`：id ≠ 文件名 → `AccError`
- `test_handle_create_tool_class_missing_runner`：无 runner 字段 → `AccError`
- `test_handle_create_workflow_invalid_callable_ref`：callable_ref 不存在 → `AccError`
- `test_handle_create_workflow_valid`：合法 template → JSON 内容通过 `parse_workflow_function_template`

**安全策略（保留在主测试）**
- `test_forbidden_danger_full_access`：`danger-full-access` 值 → `validate_target` 拒绝
- `test_forbidden_network_enable`：`network: true` → 拒绝
- `test_forbidden_write_files_enable`：`write_files: true` → 拒绝
- `test_forbidden_path_traversal`：`../secrets.yaml` 路径 → 拒绝

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 步骤 3 遗漏某个调用方导致运行时 ImportError | 中 | 高 | 步骤 3 完成后运行 `grep -rn "from acc.app.graphops_v3\|graphops_governance_payload\|apply_patch_request" --include="*.py"` 确认零结果 |
| `acc/graphops.py` 重写后 `materialize_transaction` dispatch 逻辑引入 bug | 中 | 高 | 步骤 1 完成后立即执行原有 `test_graphops_v3.py` 测试（不修改），以行为等价为门控 |
| `decisions.py` 删除 `graphops_governance_payload` 字段后 API 响应格式变化 | 低 | 低 | 该字段在 decision inbox 无语义，前端不依赖；直接删除，无需兼容 |
| patch 相关 CLI 命令删除影响已有脚本 | 低 | 低 | 单用户本地部署，无外部依赖；删除即可 |
| `schemas/graphops_patch_schema.json` 被其他工具引用 | 低 | 低 | 删除前运行 `grep -rn "graphops_patch_schema" --include="*.py" --include="*.json"` 确认引用情况 |

---

## 依赖关系

```
步骤 1（重写 acc/graphops.py）
  ↓
步骤 2（graphops_v3.py 改为 shim）
  ↓
步骤 3（更新所有调用方）— 可并行执行 3.1/3.2/3.3/3.4
  ↓
步骤 4（删除旧文件）— 必须在步骤 3 全部完成后执行
  ↓
步骤 5（更新测试）
  ↓
步骤 6（全量测试验证）
```

与其他重构计划的依赖：
- **ControlLedger 重构（03）**：独立，无共享文件，可并行执行
- **WorkflowViewer 分拆（前端）**：独立，无依赖
- **Supervisor stub 清理**：`dry_run_supervisor_proposal` 删除后，需检查 `acc/app/supervisor.py` 中 `proposal_to_graphops_patch` 函数的其他引用（若无，可一并标记为 stub）

---

## 预估工作量

| 步骤 | 预估时间 | 说明 |
|------|---------|------|
| 步骤 1：重写 `acc/graphops.py` | 3 小时 | 主要工作：合并两个模块逻辑，提取操作处理器，删除 patch 遗留 |
| 步骤 2：shim 转发层 | 15 分钟 | 机械替换 |
| 步骤 3：更新调用方（4 个文件） | 1.5 小时 | 每个文件 import 更新 + 删除端点/命令 |
| 步骤 4：删除旧文件 | 20 分钟 | 确认引用 + 删除 |
| 步骤 5：更新/新增测试 | 2 小时 | 删除旧测试 + 修改迁移 + 新增处理器测试 |
| 步骤 6：测试验证 | 30 分钟 | pytest 全量 |
| **合计** | **~7.5 小时** | |
