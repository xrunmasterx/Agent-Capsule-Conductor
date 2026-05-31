# 02 — 中期阶段：A1 统一外部 Agent 适配契约

**里程碑目标**：将 capsule/agent 执行收敛为带**能力位**的稳定协议，新增 backend 仅实现 adapter，编排层与 Workbench 不变。  
**借鉴来源**：Multica `Backend` + Paperclip `agent-run/v1` 能力位（[04_synthesis A1](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)）。  
**依赖**：P0 `CallableInvocationService`、`CapsuleRunner`、近期 B4 校验（推荐）。

---

### REQ-A1-001: AgentCapabilities 领域类型与声明

| 属性 | 值 |
|------|-----|
| 来源 | A1 |
| 阶段 | adapter |
| 优先级 | P0 |
| 依赖 | REQ-PRIN-001 |

**问题陈述**  
编排层需知晓 backend 是否支持 resume、流式、token 统计，避免调用不支持的 API。

**当前 ACC 现状**  
- `AgentAdapter` Protocol 仅 `run()`：`acc/adapters/base.py:60-62`  
- `AgentRunRequest` / `AgentRunResult` 无 capability 字段：`acc/adapters/base.py:8-57`  
- `capsule.yaml` runtime 配置经 `CapsuleRegistry` 加载：`acc/registry.py`（runtime 字符串选择 adapter key）  
- **缺口**：无能力位模型

**目标行为**  
在 `acc.domain` 增加不可变 `AgentCapabilities`（或等价），至少包含：

```python
@dataclass(frozen=True)
class AgentCapabilities:
    resumable_session: bool = False
    status_updates: bool = False
    log_streaming: bool = False
    token_usage: bool = False
```

**架构约束**  
仅 `acc.domain` 定义；engine 可校验声明与请求一致性。

**健壮性要求**  
缺省全 False；旧 capsule 无声明时视为「基础 run only」。

**验收标准**  
- 单元测试：capabilities 默认值  
- schema 文档生成（`schemas/` additive）

**风险与缓解**  
过度声明 → adapter 注册时自检 capability 与实现一致。

---

### REQ-A1-002: Adapter 协议扩展（capabilities + 可选 resume/stream hooks）

| 属性 | 值 |
|------|-----|
| 来源 | A1 |
| 阶段 | adapter |
| 优先级 | P0 |
| 依赖 | REQ-A1-001 |

**问题陈述**  
`CapsuleRunner` 通过字符串 key 选 adapter（`acc/runner.py:40-44`），协议应支持能力查询与可选操作，而非仅单一 `run()`。

**当前 ACC 现状**  
- 内置 adapters：`generic_cli`, `codex_cli`, `claude_sdk`  
- **缺口**：无 `capabilities()` / `resume()` 接口

**目标行为**  
```python
class AgentAdapter(Protocol):
    def capabilities(self) -> AgentCapabilities: ...
    async def run(self, request: AgentRunRequest) -> AgentRunResult: ...
    async def resume(self, request: ResumeRequest) -> AgentRunResult: ...  # optional
```

不支持的能力调用返回明确 `AccError`（adapter_error），写入 `RuntimeStatus.adapter_error`。

**架构约束**  
adapter 实现位于 `acc/adapters/*`；不 import server/web。

**验收标准**  
- fake adapter 实现全能力；hermetic 测试 resume 被拒绝路径  
- `CapsuleRunner` 在 resume 请求时检查 capabilities

**风险与缓解**  
破坏现有 adapter → 默认 `capabilities()` 返回全 False，仅 `run` 路径。

---

### REQ-A1-003: CallableInvocationService 能力感知调度

| 属性 | 值 |
|------|-----|
| 来源 | A1 |
| 阶段 | adapter |
| 优先级 | P1 |
| 依赖 | REQ-A1-002, P0 CallableInvocationService |

**问题陈述**  
Workflow 节点通过 `CallableInvocationService._run_capsule_backend` 调 `CapsuleRunner`（`acc/app/invocation.py:117-182`），应在 app 层根据 capabilities 决定是否启用流式事件投影或 session 续接。

**当前 ACC 现状**  
- 单一 `runner.run(...)` 调用，无 capability 分支  
- flag：`ACC_USE_CALLABLE_DISPATCH`

**目标行为**  
- 若 `log_streaming`：session events 增量写入（与 REQ-A5-001 对齐）  
- 若 `resumable_session`：node manifest 记录 `external_session_id`，重跑时可 `resume`  
- 若不支持：降级为一次性 `run`，manifest 标注 `capability_degraded: true`

**接口/数据契约草案**  
`session_instance_manifest.json` additive：

```json
{
  "capabilities_requested": ["log_streaming"],
  "capabilities_effective": ["log_streaming"],
  "external_session_id": null
}
```

**健壮性要求**  
flag off 路径行为不变；capability 仅 additive manifest。

**验收标准**  
- Given codex fake When run Then manifest 含 capabilities_effective  
- Given resume 不支持 When resume requested Then 明确错误，不静默

**风险与缓解**  
真实 codex resume 仅 opt-in smoke test。

---

### REQ-A1-004: capsule.yaml → AgentCapabilities 映射

| 属性 | 值 |
|------|-----|
| 来源 | A1 |
| 阶段 | adapter |
| 优先级 | P1 |
| 依赖 | REQ-A1-001 |

**问题陈述**  
ClassTemplate 来源于 capsule；能力声明应来自 capsule 配置而非硬编码在 runner。

**当前 ACC 现状**  
- `CapsuleSpec` / registry 解析：`acc/registry.py`, `acc/schemas.py`  
- **缺口**：yaml 无 capabilities 段

**目标行为**  
`capsule.yaml` 可选：

```yaml
runtime:
  adapter: codex_cli
  capabilities:
    resumable_session: true
    log_streaming: true
```

加载时合并 adapter 默认与用户覆盖（用户覆盖不得声明 adapter 未实现的能力）。

**架构约束**  
registry 解析；`legacy_compat.capsule_spec_to_callable_ref` 保留，capabilities 进 `AgentClassTemplate.metadata` 或专用字段。

**验收标准**  
- Given 声明 log_streaming 但 adapter 不支持 When load Then validate 警告或错误  
- 现有 capsules 无 capabilities 段仍可运行

**风险与缓解**  
schema 变更 → additive schema version in `schemas/`.

---

### REQ-A1-005: legacy_compat 与双路径一致

| 属性 | 值 |
|------|-----|
| 来源 | A1 / P0 |
| 阶段 | adapter |
| 优先级 | P1 |
| 依赖 | REQ-A1-003, REQ-PRIN-004 |

**问题陈述**  
`ACC_USE_CALLABLE_DISPATCH=0` 时仍走 `execute_legacy_capsule_node`；能力位对两条路径应一致或显式标注差异。

**当前 ACC 现状**  
- `execute_app_clean_node` 三分支：`acc/app/__init__.py:1057-1101`  
- `legacy_compat` 映射 CallableRef：`acc/app/legacy_compat.py`

**目标行为**  
- flag on/off 对同一 capsule 报告的 capabilities **一致**  
- legacy 路径 manifest 逐步 additive 同字段，避免 UI 分叉

**验收标准**  
- 同一 capsule 在 flag on/off 下 `capabilities_effective` 相同（fake backend）  
- `tests/integration/test_callable_agent_backend.py` 扩展

**风险与缓解**  
legacy 路径改动面大 → 先 manifest 对齐，resume 仅 callable 路径。

---

## 中期里程碑

- [ ] `AgentCapabilities` + adapter `capabilities()` 落地  
- [ ] 至少一个真实 adapter（如 `generic_cli`）与一个 fake 实现能力位差异测试  
- [ ] 文档：`docs/codex_goal_callable_semantics/` 增补 adapter 章节（实现时）  
- [ ] 不引入 DB；不合并 template/session 状态
