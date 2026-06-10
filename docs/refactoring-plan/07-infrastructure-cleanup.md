# 基础设施清理

> 重构系列第 7 号文档 | 分支：`dev_v2` | 优先级：高

---

## 现状分析

### 涉及文件及行数

| 文件 | 当前行数 | 主要问题 |
|------|---------|---------|
| `acc/domain.py` | ~1300 行 | L837-886：V2 Binding 数据类无任何运行时调用方 |
| `acc/ports/__init__.py` | 5 行 | 完全空洞的占位模块，无任何实质内容 |
| `acc/migration/__init__.py` | 2 行 | 空模块，实际逻辑在 `graph_importer.py` |
| `acc/binding/__init__.py` | 33 行 | Phase 1 骨架，`ProvenanceObject` 和 `Selector` 尚无运行时消费方 |
| `acc/binding/selector.py` | 119 行 | Phase 1 骨架，`parse_selector` 仅有单元测试，无生产调用 |
| `acc/binding/provenance.py` | 75 行 | Phase 1 骨架，仅 `server/run_projection.py` 有一处引用 |
| `acc/app/agent_sessions.py` | ~1487 行 | `_find_session_dir` O(N) 全量扫描；`StreamingAgentAdapterDispatcher` 重复调度逻辑；`read_jsonl`/`update_runtime_json`/`validate_session_id`/`permission_payload` 均为模块级孤立工具函数 |
| `acc/app/authoring.py` | ~2050 行 | `permission_payload`（L1222，字段多于 `agent_sessions` 版本）、`validate_session_id`（L2029，不同 pattern）均与 `agent_sessions.py` 形成重复 |
| `acc/app/workbench_adapter.py` | ~600 行 | `CODEX_EXECUTION_MODES`（L72-77）与 `callable_runner.py:38-41` 重复定义 |
| `acc/callable_runner.py` | ~730 行 | `CODEX_EXECUTION_MODES`（L38-41）、`update_runtime_json`（L715）重复；`AgentAdapterDispatcher` 与 `StreamingAgentAdapterDispatcher` 职责分裂 |
| `acc/adapters/claude_sdk.py` | 81 行 | `run()` 无论何种分支均返回 `status="unavailable"` 或 `status="failed"`，永远不能成功 |
| `acc/engine/supervisor.py` | >270 行 | `_callable_ref_key`（L264）、`_callable_ref_payload`（L268）为模块私有函数 |
| `acc/engine/handoff.py` | >300 行 | `_callable_ref_key`（L295）、`_callable_ref_payload`（L299）与 supervisor.py 完全重复 |

### 当前问题

1. **死代码堆积**：V2 Binding 数据类（`NodeInputBindingV2` 等）及 `InputBinding = NodeInputBindingV2` 别名自注释即说明"No current product runtime resolver consumes these V2 shapes"，是纯粹的未来占位代码。`acc/ports/__init__.py` 和 `acc/migration/__init__.py` 均为空壳，增加模块树噪音。

2. **O(N) 会话查找**：`_find_session_dir`（`agent_sessions.py:1015-1027`）在每次按 `session_id` 查找时对 `runs/_agent_sessions/*/*/session.json` 做全量 glob 遍历，随会话积累性能持续劣化。

3. **工具函数散落**：`read_jsonl`、`update_runtime_json`、`validate_session_id`、`permission_payload` 各自在 `agent_sessions.py` 和 `authoring.py`（或 `callable_runner.py`）中独立定义，部分已出现字段分化（`permission_payload` 的 `authoring` 版本多了 `env_policy`/`allowed_env`/`timeout_seconds`）。

4. **适配器调度分裂**：`AgentAdapterDispatcher`（`callable_runner.py:180`）负责批式执行，`StreamingAgentAdapterDispatcher`（`agent_sessions.py:1314`）负责流式执行，两者独立维护 runtime 字符串映射，存在漂移风险。

5. **常量重复**：`CODEX_EXECUTION_MODES` 在 `callable_runner.py:38` 和 `workbench_adapter.py:74` 各定义一次，未来修改需同步两处。

6. **ClaudeSdkAdapter 永远失败**：`claude_sdk.py` 中 `run()` 方法：若 SDK 不可用，返回 `status="unavailable"`；若 SDK 可用但无 `message_stream_factory`，仍返回 `status="unavailable"`；若使用 fake stream 但无 output，返回 `status="failed"`。在生产路径中此适配器没有可用场景。

7. **历史运行数据**：`runs/` 目录存有多个 `ui_workflow_*` 和 `task_canvas_*` 任务的历史运行产物（decisions.jsonl / dispatches.jsonl / events.jsonl 等），与 `runs/_agent_sessions/` 中的历史会话数据，按决策应全部清除。

---

## 重构目标

### 目标架构

```
acc/
  constants.py          # 新建：跨模块共享常量
  utils.py              # 扩充：read_jsonl / update_runtime_json / validate_session_id
  domain.py             # 删除 L837-886 V2 Binding 及 InputBinding 别名
  ports/                # 删除整个包
  migration/            # 保留 graph_importer.py，删除空 __init__.py（或保留单行）
  binding/              # 评估：ProvenanceObject 保留，selector 保留但标记 Phase 2 待集成；
                        # 或整包移入 domain.py
  adapters/
    __init__.py         # 新建统一适配器注册表 AdapterRegistry
    base.py             # 保持不变
    codex_cli.py        # 保持不变
    codex_app_server.py # 保持不变（streaming adapter）
    generic_cli.py      # 保持不变
    claude_sdk.py       # 删除
  app/
    agent_sessions.py   # 删除本地工具函数，改为从 acc.utils 导入；增加 session_id→path 索引
    authoring.py        # 删除重复工具函数，改为从 acc.utils 导入
    workbench_adapter.py# 删除 CODEX_EXECUTION_MODES，改从 acc.constants 导入
  callable_runner.py    # 删除 CODEX_EXECUTION_MODES 和 update_runtime_json，改为统一导入；
                        # AgentAdapterDispatcher 合并进 acc.adapters.__init__
  engine/
    _ref_utils.py       # 新建：_callable_ref_key / _callable_ref_payload
    supervisor.py       # 改为从 _ref_utils 导入
    handoff.py          # 改为从 _ref_utils 导入

runs/                   # 全部清空（历史数据可删除）
```

### 关键设计决策

1. **`acc/constants.py` 作为常量单一来源**：所有跨模块共享常量（`CODEX_EXECUTION_MODES`、`CODEX_EXECUTION_MODE_METADATA_KEY`、`CODEX_LOCAL_READONLY_NO_SANDBOX`、`CODEX_DANGER_FULL_ACCESS`）迁移至此文件。禁止在其他模块重新定义。

2. **`acc/utils.py` 扩充为工具函数集散地**：`read_jsonl`、`update_runtime_json` 从 `agent_sessions.py` 和 `callable_runner.py` 提取后放入 `utils.py`。两个 `validate_session_id` 因 regex pattern 不同，拆为 `validate_agent_session_id` / `validate_authoring_session_id` 共存于 utils.py。`permission_payload` 因字段集合已分化，保留两个具名版本 `agent_permission_payload` / `authoring_permission_payload_dict`，不做强行合并——强行合并会引入 None 默认值噪音。

3. **统一适配器注册表**：新建 `acc/adapters/__init__.py` 导出 `AdapterRegistry` 类，内部持有 `_batch_map: dict[str, AgentAdapter]` 和 `_streaming_map: dict[str, StreamingAgentAdapter]`，提供 `resolve_batch(runtime)` 和 `resolve_streaming(runtime)`。原两个 Dispatcher 类删除。

4. **Session ID → Path 索引**：在 `SessionStore`（或 `AgentSessionService`）中维护内存字典 `_session_index: dict[str, Path]`，在 `create_session` 时写入，在 `_find_session_dir` 中优先命中索引，未命中时仍 fallback 到 glob 扫描（冷启动恢复场景）并回填索引。

5. **TTL 清理机制**：`AgentSessionService` 新增 `cleanup_sessions(ttl_seconds: int)` 方法，扫描 `session.json` 的 `created_at` 字段，超过 TTL 的会话目录整体删除；在服务启动时异步触发一次。

6. **`acc/binding/` 保留策略**：`selector.py` 和 `provenance.py` 有单元测试和一处生产引用（`run_projection.py`），不删除；删除 `domain.py` 中的 V2 Binding 数据类（L837-886）及 `InputBinding` 别名，因为这些与 `binding/selector.py` 无关，是另一套未被集成的草稿。

---

## 详细实施步骤

### 步骤 1：删除死代码 — V2 Binding 数据类

**具体操作**
- 删除 `acc/domain.py` L837-886（5 个 V2 Binding dataclass + 注释块 + `InputBinding = NodeInputBindingV2` 别名）
- 确认无任何产品代码导入这些名称（已验证：仅有注释说明 "No current product runtime resolver consumes these V2 shapes"）

**涉及文件**
- `acc/domain.py`：删除 L837-886，共约 50 行

**预期结果**
- `domain.py` 缩减约 50 行，无副作用

**风险**：极低。代码注释已明确声明无运行时消费方，且全局 grep 确认无导入。

---

### 步骤 2：删除/清理空模块

**具体操作**
- 删除 `acc/ports/` 整个包（`__init__.py` 仅 5 行，无任何实质内容，无导入方）
- 将 `acc/migration/__init__.py` 内容清空或保留单行 docstring（当前仅 2 行注释，无任何代码；`graph_importer.py` 直接由 `acc/cli.py` 和集成测试导入，无需经过 `__init__.py`）

**涉及文件**
- `acc/ports/__init__.py`：整个目录删除
- `acc/migration/__init__.py`：确认当前状态（已验证为空），保持现状或添加单行 `from acc.migration.graph_importer import *` 作为便捷导出

**预期结果**
- 模块树减少噪音；`acc/ports/` 包不复存在

**风险**：低。需确认 import-linter 配置中是否有对这些包的约束规则（检查 `.importlinter`）。

---

### 步骤 3：删除 ClaudeSdkAdapter

**具体操作**
- 删除 `acc/adapters/claude_sdk.py` 整个文件
- 在 `acc/callable_runner.py` 中删除 `from acc.adapters.claude_sdk import ClaudeSdkAdapter`（L13）及 `AgentAdapterDispatcher.resolve` 中的 `claude_sdk` 分支（L192-193）
- 搜索并删除所有对 `ClaudeSdkAdapter` 的引用

**涉及文件**
- `acc/adapters/claude_sdk.py`：删除（81 行）
- `acc/callable_runner.py`：删除 L13 导入，删除 `AgentAdapterDispatcher` 中 `claude_sdk` 分支

**预期结果**
- `AgentAdapterDispatcher.resolve("claude_sdk")` 调用将直接命中兜底 `raise AccError(f"Unsupported production agent runtime {runtime!r}")`，行为与当前返回 `status="unavailable"` 相比更诚实（立即报错，不静默失败）

**风险**：低。`claude_sdk.py` 的 `run()` 在任何真实条件下均无法返回成功结果，删除不会降低功能。需检查是否有测试用例 mock 了该类（若有，连同测试删除）。

---

### 步骤 4：建立共享常量文件 `acc/constants.py`

**具体操作**

新建 `acc/constants.py`，内容：

```python
"""Shared constants for ACC. Import from here; do not redefine in submodules."""
from __future__ import annotations

CODEX_EXECUTION_MODE_METADATA_KEY = "codex_execution_mode"
CODEX_LOCAL_READONLY_NO_SANDBOX = "local_readonly_no_sandbox"
CODEX_DANGER_FULL_ACCESS = "danger_full_access"
CODEX_EXECUTION_MODES: frozenset[str] = frozenset({
    CODEX_LOCAL_READONLY_NO_SANDBOX,
    CODEX_DANGER_FULL_ACCESS,
})
```

然后修改导入方：
- `acc/callable_runner.py`：删除 L35-41 的本地定义，改为 `from acc.constants import CODEX_EXECUTION_MODE_METADATA_KEY, CODEX_LOCAL_READONLY_NO_SANDBOX, CODEX_DANGER_FULL_ACCESS, CODEX_EXECUTION_MODES`
- `acc/app/workbench_adapter.py`：删除 L72-77 的本地定义，改为从 `acc.constants` 导入

**涉及文件**
- `acc/constants.py`：新建
- `acc/callable_runner.py`：修改 L35-41
- `acc/app/workbench_adapter.py`：修改 L72-77

**预期结果**
- 常量单一来源，消除两处重复定义

**风险**：低。纯常量迁移，无逻辑变更，改完后跑 `pytest tests/unit/test_codex_*.py` 验证。

---

### 步骤 5：扩充 `acc/utils.py` — 工具函数整合

**具体操作**

向 `acc/utils.py` 添加以下函数（均从现有实现复制，略作统一）：

```python
def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file; return empty list if file does not exist."""
    ...  # 从 agent_sessions.py:1390 复制

def update_runtime_json(path: Path, updates: dict[str, Any]) -> None:
    """Merge updates into a JSON file, creating it if absent."""
    ...  # 从 agent_sessions.py:1475 复制（使用 load_json/write_json 形式）

def validate_agent_session_id(session_id: str) -> None:
    """Validate agent session id format: agent_session_<alphanum>."""
    ...  # 从 agent_sessions.py:1429 提取

def validate_authoring_session_id(session_id: str) -> None:
    """Validate authoring session id format: authoring_<alphanum>."""
    ...  # 从 authoring.py:2029 提取
```

注意：`update_runtime_json` 存在两个版本（`callable_runner.py` 用 `json.loads`，`agent_sessions.py` 用 `load_json`），统一使用 `load_json`（带 `AccError` 封装）。

然后在原始文件中删除本地定义，改为导入：
- `acc/app/agent_sessions.py`：删除 `read_jsonl`（L1390）、`update_runtime_json`（L1475）、`validate_session_id`（L1429），在文件顶部从 `acc.utils` 导入，并将 `validate_session_id` 调用点改为 `validate_agent_session_id`
- `acc/app/authoring.py`：删除 `validate_session_id`（L2029），在文件顶部从 `acc.utils` 导入 `validate_authoring_session_id`，更新调用点（L1112）
- `acc/callable_runner.py`：删除 `update_runtime_json`（L715），从 `acc.utils` 导入

**关于 `permission_payload`**：
- `agent_sessions.py:1434` 的版本仅含 4 个字段（`workspace_access/network/shell/dangerous`）
- `authoring.py:1222` 的版本含 7 个字段（额外含 `env_policy/allowed_env/timeout_seconds`）
- 决策：**不做强合并**。重命名为 `agent_permission_payload`（留在 `agent_sessions.py`）和 `authoring_permission_payload_dict`（留在 `authoring.py`），并在各自文件顶部加注释说明两者的字段差异，防止未来静默漂移。待后续 PermissionProfile 统一重构时再做真正合并。

**涉及文件**
- `acc/utils.py`：扩充约 30 行
- `acc/app/agent_sessions.py`：删除约 30 行本地工具函数，修改导入
- `acc/app/authoring.py`：删除约 5 行本地函数，修改导入
- `acc/callable_runner.py`：删除约 12 行，修改导入

**预期结果**
- 工具函数有且仅有一个实现位置，调用方统一从 `acc.utils` 获取

**风险**：中等。`validate_session_id` 重命名会影响所有调用点，需全局 grep 确认。`update_runtime_json` 两版实现的 error handling 略有差异，合并时需验证边界行为不变。

---

### 步骤 6：合并适配器调度器为统一注册表

**具体操作**

新建 `acc/adapters/__init__.py`，内容：

```python
"""Unified adapter registry for ACC agent runtimes."""
from __future__ import annotations

from acc.adapters.base import AgentAdapter, AgentRunRequest, AgentRunResult
from acc.adapters.codex_cli import CodexCliAdapter
from acc.adapters.codex_app_server import CodexAppServerAdapter
from acc.adapters.generic_cli import GenericCliAdapter

_BATCH_RUNTIMES: dict[str, type] = {
    "codex_cli": CodexCliAdapter,
    "generic_cli": GenericCliAdapter,
}

_STREAMING_RUNTIMES: dict[str, type] = {
    "codex_app_server": CodexAppServerAdapter,
    "codex_cli": CodexAppServerAdapter,  # codex_cli 在流式上下文中路由到 app_server
}


def resolve_batch_adapter(runtime: str) -> AgentAdapter:
    """Return a batch adapter for the given runtime name.

    Raises AccError for streaming-only or unsupported runtimes.
    """
    from acc.domain import AccError
    if runtime in _STREAMING_RUNTIMES and runtime not in _BATCH_RUNTIMES:
        raise AccError(
            f"{runtime!r} is a streaming runtime; use resolve_streaming_adapter instead"
        )
    cls = _BATCH_RUNTIMES.get(runtime)
    if cls is None:
        raise AccError(f"Unsupported production agent runtime {runtime!r}")
    return cls()


def resolve_streaming_adapter(runtime: str):
    """Return a streaming adapter for the given runtime name."""
    from acc.domain import AccError
    from acc.adapters.base import StreamingAgentAdapter  # type: ignore[attr-defined]
    cls = _STREAMING_RUNTIMES.get(runtime)
    if cls is None:
        raise AccError(f"Unsupported streaming agent runtime {runtime!r}")
    return cls()


__all__ = [
    "resolve_batch_adapter",
    "resolve_streaming_adapter",
    "AgentAdapter",
    "AgentRunRequest",
    "AgentRunResult",
]
```

然后更新调用方：
- `acc/callable_runner.py`：`AgentAdapterDispatcher().resolve(runtime)` → `resolve_batch_adapter(runtime)`；删除 `AgentAdapterDispatcher` 类定义（L180-194）
- `acc/app/agent_sessions.py`：`StreamingAgentAdapterDispatcher().resolve(runtime)` → `resolve_streaming_adapter(runtime)`；删除 `StreamingAgentAdapterDispatcher` 类定义（L1314-1318）

**涉及文件**
- `acc/adapters/__init__.py`：新建
- `acc/callable_runner.py`：删除 `AgentAdapterDispatcher`（约 15 行），修改调用
- `acc/app/agent_sessions.py`：删除 `StreamingAgentAdapterDispatcher`（约 5 行），修改调用

**预期结果**
- 唯一的 runtime→adapter 映射表，消除两个 Dispatcher 的漂移风险

**风险**：中等。需确认 `codex_cli` 在流式 vs 批式上下文中的路由逻辑与现有行为一致（现在 `streaming_runtime_name("codex_cli")` 返回 `"codex_app_server"`，合并后应在 `_STREAMING_RUNTIMES["codex_cli"]` 直接映射到 `CodexAppServerAdapter`）。

---

### 步骤 7：提取 `acc/engine/_ref_utils.py`

**具体操作**

新建 `acc/engine/_ref_utils.py`：

```python
"""Shared CallableRef utility functions for engine submodules."""
from __future__ import annotations

from typing import Any
from acc.domain import CallableRef


def callable_ref_key(ref: CallableRef) -> tuple[str, str]:
    return (ref.kind, ref.id)


def callable_ref_payload(ref: CallableRef) -> dict[str, str | None]:
    return {"kind": ref.kind, "id": ref.id, "version": ref.version}
```

然后在 `supervisor.py` 和 `handoff.py` 中：
- 删除 `_callable_ref_key`（各约 2 行）和 `_callable_ref_payload`（各约 2 行）本地定义
- 在顶部添加 `from acc.engine._ref_utils import callable_ref_key as _callable_ref_key, callable_ref_payload as _callable_ref_payload`（保持调用点别名不变，零修改调用处）

**涉及文件**
- `acc/engine/_ref_utils.py`：新建（约 12 行）
- `acc/engine/supervisor.py`：删除 L264-269，添加导入
- `acc/engine/handoff.py`：删除 L295-300，添加导入

**预期结果**
- 两个引擎模块共享同一函数实现，消除未来分化隐患

**风险**：极低。两个现有实现内容完全相同（已验证），纯提取无逻辑变更。

---

### 步骤 8：Session ID → Path 索引优化

**具体操作**

在 `acc/app/agent_sessions.py` 的 `AgentSessionService`（或对应的管理类）中：

1. 在类 `__init__` 中增加 `self._session_index: dict[str, Path] = {}`
2. 修改 `_create_session_dir`（约 L990）：在成功写入 `session.json` 后执行 `self._session_index[session_id] = session_dir`
3. 修改 `_find_session_dir`（L1015-1027）：

```python
def _find_session_dir(self, session_id: str) -> Path:
    validate_agent_session_id(session_id)
    # Fast path: in-memory index
    if session_id in self._session_index:
        cached = self._session_index[session_id]
        if (cached / "session.json").exists():
            return cached
        # Stale index entry — remove and fall through
        del self._session_index[session_id]
    # Cold-start fallback: glob scan + back-fill index
    root = self.project_root / AGENT_SESSIONS_ROOT
    if not root.exists():
        raise AccError(f"Agent session not found: {session_id}")
    for session_path in root.glob("*/*/session.json"):
        try:
            payload = require_object(load_json(session_path), "session.json")
        except AccError:
            continue
        found_id = payload.get("session_id")
        if isinstance(found_id, str):
            self._session_index[found_id] = session_path.parent  # back-fill
        if found_id == session_id:
            return session_path.parent
    raise AccError(f"Agent session not found: {session_id}")
```

4. 新增 `cleanup_sessions(ttl_seconds: int = 86400 * 7) -> int` 方法：

```python
def cleanup_sessions(self, ttl_seconds: int = 86400 * 7) -> int:
    """Delete session directories older than ttl_seconds. Returns count deleted."""
    import time
    root = self.project_root / AGENT_SESSIONS_ROOT
    if not root.exists():
        return 0
    cutoff = time.time() - ttl_seconds
    deleted = 0
    for session_path in root.glob("*/*/session.json"):
        if session_path.stat().st_mtime < cutoff:
            shutil.rmtree(session_path.parent, ignore_errors=True)
            self._session_index.pop(session_path.parent.name, None)
            deleted += 1
    return deleted
```

**涉及文件**
- `acc/app/agent_sessions.py`：修改 `_find_session_dir`，增加 `cleanup_sessions` 方法，增加 `_session_index` 字段初始化

**预期结果**
- 频繁调用的 session 查找从 O(N glob) 降为 O(1) 字典查找；TTL 清理防止 `_agent_sessions/` 无限增长

**风险**：中等。索引仅在当前进程内存中，多进程部署场景（未来）需重新评估（当前为单用户本地部署，不适用）。`cleanup_sessions` 使用 `st_mtime`，在某些文件系统上精度可能不够，可改为读取 `session.json` 中的 `created_at` 字段（ISO 格式）以获得更精确的语义。

---

### 步骤 9：清除历史运行数据

**具体操作**

1. 删除 `runs/` 目录下所有历史任务运行数据：

```bash
# 在项目根目录执行
# 删除所有 ui_workflow_* 和 task_canvas_* 历史运行目录
rm -rf runs/ui_workflow_acc_workspace_canvas_*/
rm -rf runs/ui_workflow_task_canvas_*/
rm -rf runs/task_canvas_*/
```

2. 删除 `runs/_agent_sessions/` 下的所有历史会话：

```bash
rm -rf runs/_agent_sessions/*/
```

3. 清空 `runs/index.json`（保留文件，内容置为 `{}`）

4. 保留 `runs/_workbench_canvas_snapshots/` 和 `runs/_workflow_function_specs/` 目录（这些是配置/快照，不是运行数据，视具体内容决定）

**涉及文件/目录**
- `runs/ui_workflow_*`：删除（10 个目录）
- `runs/task_canvas_*`：删除
- `runs/_agent_sessions/*`：删除子目录，保留父目录
- `runs/index.json`：置空

**预期结果**
- 减少磁盘占用；消除旧运行数据对调试新功能的干扰；为干净测试环境铺路

**风险**：低。按决策，历史数据完全可删除。删除前建议执行一次 `git status runs/` 确认这些目录未被版本控制（通常 `.gitignore` 已排除 `runs/`）。

---

## 文件变更清单

### 新建文件

| 文件路径 | 内容摘要 | 大小估计 |
|---------|---------|---------|
| `acc/constants.py` | `CODEX_EXECUTION_MODES` 等共享常量 | ~15 行 |
| `acc/adapters/__init__.py` | `resolve_batch_adapter` / `resolve_streaming_adapter` 统一注册表 | ~50 行 |
| `acc/engine/_ref_utils.py` | `callable_ref_key` / `callable_ref_payload` 提取 | ~15 行 |

### 修改文件

| 文件路径 | 变更类型 | 估计净变化 |
|---------|---------|----------|
| `acc/utils.py` | 扩充：添加 `read_jsonl`、`update_runtime_json`、`validate_agent_session_id`、`validate_authoring_session_id` | +35 行 |
| `acc/domain.py` | 删除：L837-886 V2 Binding 数据类及 `InputBinding` 别名 | -52 行 |
| `acc/callable_runner.py` | 删除：常量定义、`update_runtime_json`、`AgentAdapterDispatcher`；修改导入 | -40 行 |
| `acc/app/agent_sessions.py` | 删除：本地工具函数（`read_jsonl`、`update_runtime_json`、`validate_session_id`、`StreamingAgentAdapterDispatcher`）；优化 `_find_session_dir`；新增 `cleanup_sessions` | 净约 -30 行 |
| `acc/app/authoring.py` | 删除：`validate_session_id`（L2029）；修改导入 | -5 行 |
| `acc/app/workbench_adapter.py` | 删除：`CODEX_EXECUTION_MODES` 定义（L72-77）；修改导入 | -7 行 |
| `acc/engine/supervisor.py` | 删除：`_callable_ref_key` + `_callable_ref_payload` 本地定义；修改导入 | -5 行 |
| `acc/engine/handoff.py` | 删除：`_callable_ref_key` + `_callable_ref_payload` 本地定义；修改导入 | -5 行 |
| `acc/migration/__init__.py` | 保持现状（空文件），确认无需修改 | 0 行 |
| `runs/index.json` | 置空为 `{}` | 内容清零 |

### 删除文件

| 文件/目录路径 | 原因 | 是否影响产品功能 |
|-------------|------|---------------|
| `acc/adapters/claude_sdk.py` | ClaudeSdkAdapter 永远返回失败/不可用，无生产价值 | 否 |
| `acc/ports/__init__.py`（整个 `acc/ports/` 包） | 空洞占位模块，无任何实质内容或导入方 | 否 |
| `runs/ui_workflow_acc_workspace_canvas_*/` | 历史运行数据，按决策完全可删除 | 否 |
| `runs/ui_workflow_task_canvas_*/` | 历史运行数据 | 否 |
| `runs/task_canvas_*/` | 历史运行数据 | 否 |
| `runs/_agent_sessions/*/（子目录）` | 历史会话数据 | 否 |

---

## 测试计划

### 关键测试用例

**步骤 1-2（死代码删除）**

- `tests/unit/test_binding_selector.py`：运行验证 `acc.binding` 模块仍可正常导入（Selector 类型未受影响）
- `tests/unit/test_binding_provenance.py`：运行验证 `ProvenanceObject` 未受影响
- 全量 `pytest tests/unit/test_callable_domain.py`：确认 domain.py 删除后原有 Binding 类型测试通过

**步骤 3（ClaudeSdkAdapter 删除）**

- 搜索 `tests/` 中所有引用 `ClaudeSdkAdapter` 或 `claude_sdk` 的测试文件，一并删除或更新
- `pytest tests/unit/ -k "adapter"` 确认其他 adapter 测试通过

**步骤 4（常量迁移）**

- `pytest tests/unit/ -k "codex"` 确认 codex 相关功能不受影响
- 手动验证 workbench_adapter 和 callable_runner 中 `CODEX_EXECUTION_MODES` 校验逻辑仍正确

**步骤 5（工具函数整合）**

- 新建 `tests/unit/test_utils.py`（若不存在）：
  - `test_read_jsonl_missing_file`：不存在的路径返回空列表
  - `test_read_jsonl_malformed_lines`：跳过解析失败行，返回有效条目
  - `test_update_runtime_json_creates_new_file`：目标文件不存在时新建
  - `test_update_runtime_json_merges_existing`：合并而非覆盖
  - `test_validate_agent_session_id_valid`：`agent_session_abc123` 通过
  - `test_validate_agent_session_id_invalid`：`authoring_xxx` 抛 AccError
  - `test_validate_authoring_session_id_valid`：`authoring_abc123` 通过

**步骤 6（适配器注册表）**

- `pytest tests/unit/ -k "adapter or dispatcher"` 全量通过
- 新增 `tests/unit/test_adapter_registry.py`：
  - `test_resolve_batch_codex_cli`：返回 `CodexCliAdapter` 实例
  - `test_resolve_batch_generic_cli`：返回 `GenericCliAdapter` 实例
  - `test_resolve_batch_codex_app_server_raises`：应抛 AccError（streaming-only）
  - `test_resolve_streaming_codex_app_server`：返回 `CodexAppServerAdapter` 实例
  - `test_resolve_streaming_codex_cli`：应路由到 `CodexAppServerAdapter`
  - `test_resolve_unknown_raises`：应抛 AccError

**步骤 7（`_callable_ref_key` 提取）**

- 现有 `tests/unit/test_engine_supervisor.py` 和 `tests/unit/test_engine_handoff.py`（若存在）全量通过
- 无需新增测试（纯提取，逻辑不变）

**步骤 8（Session 索引优化）**

- 新增 `tests/unit/test_agent_session_index.py`：
  - `test_find_session_dir_hot_path`：创建 session 后立即 find，验证走索引（不触发 glob）
  - `test_find_session_dir_cold_start`：清空索引后 find，验证 glob fallback 并回填索引
  - `test_find_session_dir_stale_index`：索引指向已删除目录，验证 fallback 逻辑
  - `test_cleanup_sessions_removes_old`：写入旧 mtime 的 session，验证被删除
  - `test_cleanup_sessions_keeps_fresh`：写入新 mtime 的 session，验证被保留

**回归验证**

- `pytest tests/unit/ tests/integration/ -x`：无新增 FAIL
- `pytest tests/server/test_agent_sessions_api.py`：全量通过

---

## 风险与缓解

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|-------|-----|---------|
| `validate_session_id` 重命名遗漏某处调用点 | 高 | 低 | 步骤 5 执行前，使用 `grep -rn "validate_session_id"` 全量确认所有调用点，逐一更新 |
| `update_runtime_json` 两个版本 error handling 差异导致边界行为变化 | 中 | 低 | 统一使用 `acc.utils.load_json`（有 AccError 封装）；若 path 不存在则从 `{}` 开始；运行 `test_update_runtime_json_*` 覆盖所有分支 |
| 适配器注册表合并后 `codex_cli` 路由逻辑不一致 | 高 | 中 | 在 `_STREAMING_RUNTIMES` 中明确 `"codex_cli": CodexAppServerAdapter`；新增专项测试覆盖该路由 |
| 删除 `acc/ports/` 包后 import-linter 规则失效 | 低 | 低 | 检查 `.importlinter` 文件，删除或更新相关 `ports` 包约束 |
| 历史运行数据删除后某配置或测试 fixture 依赖其存在 | 中 | 低 | 检查 `tests/` 目录中是否有硬编码 `runs/ui_workflow_*` 路径的 fixture；使用 `grep -rn "runs/ui_workflow"` 全量扫描 |
| Session 索引在进程重启后丢失，首次 find 必须 glob 扫描 | 低 | 高（必然发生） | 这是预期行为（cold-start fallback），已在实现中处理；首次扫描完成后索引被回填，后续恢复 O(1) |
| `cleanup_sessions` 误删活跃会话（时钟偏差或 st_mtime 不准） | 高 | 低 | 生产实现改为读取 `session.json["created_at"]` 字段而非 `st_mtime`；TTL 默认 7 天，足够宽松 |

---

## 依赖关系

```
步骤 1（V2 Binding 删除）
    ↓ 无依赖关系，可独立执行

步骤 2（空模块清理）
    ↓ 需先确认 .importlinter 无 ports 依赖规则

步骤 3（ClaudeSdkAdapter 删除）
    → 步骤 6（适配器注册表）必须在步骤 3 之后，或同步执行（注册表不引用 ClaudeSdkAdapter）

步骤 4（constants.py 建立）
    → 步骤 6 依赖步骤 4（注册表内部可能用到常量）
    → 步骤 5 可与步骤 4 并行

步骤 5（工具函数整合）
    → 需在步骤 8（Session 索引优化）之前完成（索引优化的 `_find_session_dir` 调用 `validate_agent_session_id` 来自 utils.py）

步骤 6（适配器注册表）
    → 依赖步骤 3、步骤 4
    → 独立于步骤 5、7、8

步骤 7（_ref_utils.py 提取）
    → 完全独立，可随时执行

步骤 8（Session 索引优化）
    → 依赖步骤 5（`validate_agent_session_id` 必须来自 utils.py）

步骤 9（历史数据清除）
    → 完全独立，可最先或最后执行，不影响代码步骤
```

**推荐执行顺序**：
1. 步骤 9（数据清除，无代码变更风险）
2. 步骤 1 + 步骤 2 + 步骤 7（独立死代码删除，并行安全）
3. 步骤 4（建立 constants.py）
4. 步骤 3（删除 ClaudeSdkAdapter）
5. 步骤 5（工具函数整合）
6. 步骤 6（适配器注册表）
7. 步骤 8（Session 索引优化）

---

## 预估工作量

| 步骤 | 工作量 | 备注 |
|------|-------|------|
| 步骤 1：V2 Binding 删除 | 0.5 小时 | 纯删除，极低风险 |
| 步骤 2：空模块清理 | 0.5 小时 | 含 .importlinter 检查 |
| 步骤 3：ClaudeSdkAdapter 删除 | 1 小时 | 含测试清理 |
| 步骤 4：constants.py | 1 小时 | 含两处调用方修改和验证 |
| 步骤 5：工具函数整合 | 3 小时 | 调用点多，需逐一验证；测试新增 |
| 步骤 6：适配器注册表 | 2 小时 | 含新增测试 |
| 步骤 7：_ref_utils.py 提取 | 0.5 小时 | 极简提取 |
| 步骤 8：Session 索引优化 | 2 小时 | 含 TTL 清理和测试 |
| 步骤 9：历史数据清除 | 0.5 小时 | shell 命令，含 git 确认 |
| **合计** | **~11 小时** | 约 2 个工作日，含测试编写 |

---

*最后更新：2026-06-11 | 关联文档：00-master-plan.md | 分支策略：每完成一个步骤即 self-commit + push 到 `dev_v2`*
