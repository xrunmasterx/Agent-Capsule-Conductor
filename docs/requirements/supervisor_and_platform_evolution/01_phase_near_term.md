# 01 — 近期阶段：B4 强校验 + A5 日志分层 + B1 渐进披露

**里程碑目标**：在不改动 supervisor 核心的前提下，提升确定性 workflow 的「提交即可信」与 Workbench 可观测性。  
**借鉴来源**：[04_synthesis §五.1](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)（近期三件套）。  
**依赖 P0**：Callable 领域类型、`.accflow.json`、`validate_clean_workflow_*` 已存在。

---

## B4 — 运行前强校验 + dry-run

### REQ-B4-001: Callable 图端口绑定完整性校验

| 属性 | 值 |
|------|-----|
| 来源 | B4 / Conductor validator |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-PRIN-002 |

**问题陈述**  
图在运行中途因缺绑定/悬空端口失败，成本高；应在提交前秒级发现。

**当前 ACC 现状**  
- `validate_callable_workflow_function` 校验 control/data edge 拓扑：`acc/engine/__init__.py:400-426`  
- `validate_node_invocation_spec` 校验 `callable_ref`：`acc/engine/__init__.py:429-438`  
- **缺口**：未系统校验每个 `NodeInputBinding` 是否在无 static_value 时有合法 `source`；workflow 边界 `workflow_input_bindings` 与 exposed port 的覆盖度无独立错误码

**目标行为**  
`acc workflow validate` 与 API save 对 `.accflow.json` 报告：未绑定 required 输入端口、悬空 data edge target、workflow_call 缺 input_bindings 等，错误带 `node_id` + `port_id`。

**范围 / 非范围**  
- 范围：clean accflow + callable normalization 路径  
- 非范围：legacy `.graph.json` 仅保留现有 validate + import_hint（`acc/cli.py:557-564`）

**架构约束**  
纯逻辑在 `acc.engine`；`WorkflowAppService.validate` 调用（`acc/app/__init__.py:122-146`）。

**接口/数据契约草案**  
```python
# validate result additive fields
{
  "status": "invalid",
  "errors": [
    {"code": "unbound_input_port", "node_id": "n1", "port": "main", "message": "..."}
  ]
}
```

**健壮性要求**  
- 校验幂等、只读  
- 不触发网络/registry 副作用（registry 解析 capsule 引用可本地完成）

**验收标准**  
- Given accflow 节点缺 input binding When `acc workflow validate` Then exit 1 + errors 含 node_id  
- Given 修复后 When validate Then `status: valid`  
- 新增 `tests/unit/test_callable_binding_validation.py`

**风险与缓解**  
与 legacy graph 双格式并存 → 仅 accflow 强制新规则，legacy 显示 `import_hint`。

---

### REQ-B4-002: Artifact 与 callable 引用存在性校验

| 属性 | 值 |
|------|-----|
| 来源 | B4 |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-B4-001 |

**问题陈述**  
引用不存在的 capsule/workflow/artifact 路径应在 validate 阶段失败，而非 run 时 `AccError`。

**当前 ACC 现状**  
- Legacy：`validate_legacy_capsule_references`（`WorkflowAppService.validate` 内 legacy 分支）  
- Callable：`validate_callable_ref(..., known_callable_refs=...)` 可选集合：`acc/engine/__init__.py:455+`  
- **缺口**：`validate_clean_workflow_file` 未传入 registry 发现的全部 `agent_class`/`tool_class`/`workflow_function` id；静态 artifact 路径引用无校验

**目标行为**  
Validate 接受 registry + workflows 目录扫描，报告未知 `callable_ref.id`、缺失 `workflow_ref` 文件、绑定中非法 artifact 相对路径。

**架构约束**  
`acc.app` 注入 `CapsuleRegistry` 发现结果到 engine（engine 仍不读盘——由 app 预计算 `known_callable_refs: set[tuple[str,str]]`）。

**接口/数据契约草案**  
错误码：`unknown_callable_ref`, `missing_workflow_file`, `invalid_artifact_ref`

**健壮性要求**  
hermetic 模式用 fake registry/fixture capsules。

**验收标准**  
- Given 引用 `nonexistent.agent` When validate Then `unknown_callable_ref`  
- Given 绑定指向 repo 外路径 When validate Then 拒绝（复用 `reject_absolute_workspace_paths` 语义：`acc/engine` 已有）

**风险与缓解**  
registry 扫描变慢 → 缓存于单次 validate 调用。

---

### REQ-B4-003: 类型匹配与端口契约检查（MVP）

| 属性 | 值 |
|------|-----|
| 来源 | B4 |
| 阶段 | near |
| 优先级 | P1 |
| 依赖 | REQ-B4-001 |

**问题陈述**  
仅有拓扑不够；port `type` 不一致会导致运行期 schema 失败。

**当前 ACC 现状**  
- `PortContract.type` 默认 `"artifact"`：`acc/domain.py:32-37`  
- `validate_payload` 在 run 时校验 schema：`acc/runner.py:95`  
- **缺口**：data edge 连接无 type 兼容性检查

**目标行为**  
MVP：同 type 或显式 `compatible_with` 白名单；不匹配 → validate warning/error（可配置 strict）。

**接口/数据契约草案**  
`policies.port_type_check: strict|warn|off` 于 accflow metadata

**验收标准**  
- Given output port type `json` → input `artifact` When strict Then invalid

**风险与缓解**  
过严阻塞现有图 → 默认 `warn`，Workbench 显示黄标。

---

### REQ-B4-004: Dry-run 执行计划（不跑 agent）

| 属性 | 值 |
|------|-----|
| 来源 | B4 / GraphOps dry-run |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-B4-001, REQ-PRIN-003 |

**问题陈述**  
用户需要「会跑哪些 level、哪些节点、物化哪些边」的预览，零 token、可复现。

**当前 ACC 现状**  
- `topological_levels` / `callable_topological_levels`：`acc/engine`  
- GraphOps `dry_run_patch` 仅针对 patch，非 workflow run：`acc/graphops.py:108+`  
- **缺口**：无 `acc workflow validate --dry-run` 执行计划

**目标行为**  
CLI/API 返回：`levels`, `node_order`, `materialization_plan[]`, `estimated_node_count`，不创建 run_dir、不 spawn adapter。

**架构约束**  
复用 engine 层级划分；不调用 `acc.runtime`。

**接口/数据契约草案**  
```json
{
  "status": "dry_run",
  "workflow_id": "...",
  "levels": [["a"], ["b","c"]],
  "materialization_plan": [{"edge": "a.main->b.main", "mode": "copy"}]
}
```

**验收标准**  
- Given 合法 accflow When `acc workflow validate --dry-run` Then 无 runs/ 新目录  
- 与 GraphOps dry-run 错误格式一致（`status` 字段）

**风险与缓解**  
与真实 run 因 policy 差异 → 文档标注 dry-run 不保证权限/timeout 模拟。

---

### REQ-B4-005: Workbench/API 保存路径提交期校验

| 属性 | 值 |
|------|-----|
| 来源 | B4 |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-B4-001~002 |

**问题陈述**  
UI 保存 workflow 若不做 validate，用户仅在 run 时发现错误。

**当前 ACC 现状**  
- Workbench 持久化 accflow：`docs/codex_goal_callable_semantics/MIGRATION_NOTES.md`  
- **需确认**：`acc/server/routes/workflows.py` 保存 handler 是否在写盘前调用 `validate_clean_workflow_file`（实现时应 grep 验证）

**目标行为**  
`POST /api/workflows`（及等效 save）在写盘前执行 B4-001/002；失败返回 400 + structured errors，不写文件。

**架构约束**  
server 薄层 → `WorkflowAppService.validate` 或专用 `validate_for_save`。

**验收标准**  
- Given 非法 accflow payload When POST save Then 400 + errors  
- `tests/server/test_workflows_api.py` 覆盖

**风险与缓解**  
探查建议：`rg "validate_clean" acc/server/routes/workflows.py`

---

## A5 — 日志分层存储

### REQ-A5-001: 轻量事件与重日志分离

| 属性 | 值 |
|------|-----|
| 来源 | A5 / Paperclip agent-run |
| 阶段 | near |
| 优先级 | P1 |
| 依赖 | REQ-PRIN-008 |

**问题陈述**  
全量 stdout 进入事件流会导致 jsonl 膨胀、UI 卡顿；需区分「时间线事件」与「完整日志 artifact」。

**当前 ACC 现状**  
- 节点 `events.jsonl`：`acc/store/__init__.py:155,180-194`  
- `stdout.log` / `stderr.log`：`acc/adapters/base.py:28-34`, `acc/runner.py`  
- `SessionEventEmitter` → `events.jsonl`：`acc/runner.py:56-61`  
- **缺口**：无统一策略规定哪些 event type 禁止嵌入大 payload；workflow 级 `workflow_events.jsonl` 与节点事件未分层引用

**目标行为**  
事件 payload 仅含摘要、指针；>N KB 文本必须写 artifact/log 文件并在事件中放 `log_ref`。

**架构约束**  
`acc.events` / store 写入；adapter 不直接写 workflow_events。

**接口/数据契约草案**  
```python
# NodeEvent.payload 约定
{"summary": "...", "log_ref": "nodes/n1/stdout.log", "excerpt": "...<=2KB..."}
```

**健壮性要求**  
截断 excerpt 幂等；路径相对 run_dir。

**验收标准**  
- Given 大 stdout When run Then events.jsonl 单行 < 4KB  
- artifact API 可读完整 stdout

**风险与缓解**  
旧 UI 读 events 全文 → B1 投影改读 `log_ref`。

---

### REQ-A5-002: node_run_manifest 增加 logRef 与 excerpt 字段

| 属性 | 值 |
|------|-----|
| 来源 | A5 |
| 阶段 | near |
| 优先级 | P1 |
| 依赖 | REQ-A5-001 |

**问题陈述**  
Run index 与 inspector 需要稳定字段定位完整日志，而非扫描目录。

**当前 ACC 现状**  
- `NodeRunSummary` 含 `stdout_log`, `stderr_log`, `event_log`：`acc/run_index.py:23-41`  
- `build_node_summary` 填充路径：`acc/run_index.py:173+`  
- **缺口**：无 `log_ref`（主日志）、`log_excerpt` 统一字段；无多 backend 流式 log 区分

**目标行为**  
`node_summary.json` 与 API `GET /api/runs/{id}/nodes/{node_id}` 增加可选：`log_ref`, `log_excerpt`, `transcript_ref`（指向重 artifact）。

**接口/数据契约草案**  
```python
class NodeRunSummary:
    log_ref: str | None = None      # primary full log
    log_excerpt: str | None = None  # <= 2048 chars
    transcript_ref: str | None = None
```

**验收标准**  
- Given 节点成功 When rebuild index Then node summary 含 log_ref 指向存在文件  
- Workbench 概览层只拉 excerpt（见 REQ-B1-001）

**风险与缓解**  
additive 字段，`extra="allow"` 已启用 → 旧客户端忽略新字段。

---

## B1 — 渐进式披露 + output-first

### REQ-B1-001: 节点 Inspector 三层 UI 契约

| 属性 | 值 |
|------|-----|
| 来源 | B1 / Paperclip PRODUCT |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-A5-002 |

**问题陈述**  
用户监管 agent 需要先看结论与产物，再看原始日志；否则 cognitive load 过高。

**当前 ACC 现状**  
- Inspector tabs：overview/input/output/config/history/raw：`web/src/components/WorkflowViewer.tsx:2725-2752`  
- 运行证据：`EvidencePreview` input/output：`WorkflowViewer.tsx:2907-2917`  
- **缺口**：无强制「层 1 摘要 / 层 2 步骤与产物 / 层 3 transcript」信息架构；logs/events 与 overview 并列未折叠

**目标行为**  
- **层 1（默认 overview）**：status、summary、output.json 结构化摘要、artifact 列表  
- **层 2（steps/artifacts tab）**：事件时间线、产物链接、失败分类  
- **层 3（logs/raw）**：stdout/stderr/transcript，默认折叠

**范围 / 非范围**  
- 范围：Workbench 节点 inspector + RunInspector 节点视图  
- 非范围：重写 entire App shell

**架构约束**  
`web/` 仅消费 API 投影，不读 run_dir 裸路径（除现有 evidence API）。

**接口/数据契约草案**  
UI 类型扩展：  
```typescript
type NodeInspectorProjection = {
  summary: string;
  output_preview: object;
  artifacts: ArtifactLink[];
  transcript_ref?: string;
  log_excerpt?: string;
};
```

**验收标准**  
- Given fixture run When 打开 inspector Then 默认 tab 可见 summary 无完整 stdout  
- `web` 测试：`Workflow node inspector shows real input and output` 扩展断言层 1/3 分离

**风险与缓解**  
与现有 tab 命名冲突 → 将 logs+raw 合并为「详细日志」。

---

### REQ-B1-002: Run/Node API 投影字段（summary / steps / artifacts / transcript_ref）

| 属性 | 值 |
|------|-----|
| 来源 | B1 |
| 阶段 | near |
| 优先级 | P0 |
| 依赖 | REQ-A5-002, REQ-B1-001 |

**问题陈述**  
前端不应拼接多个端点才能画层 1；服务端应提供稳定投影。

**当前 ACC 现状**  
- `GET /api/runs/{run_id}` → `RunSummary`：`acc/server/routes/runs.py:30-32`  
- `GET /api/runs/{run_id}/nodes/{node_id}` → `NodeRunSummary` dump：`runs.py:44-49`  
- artifacts 列表单独 endpoint：`runs.py:52-78`  
- **缺口**：无 `steps`（事件摘要列表）、`output_preview`（截断 JSON）

**目标行为**  
节点 API 增加：`output_preview`（限深/限大小）、`steps`（来自 events.jsonl 的轻量摘要）、`transcript_ref`。

**架构约束**  
`acc.server` 组装；读取 events 在 store/app 层，limit 大小。

**健壮性要求**  
超大 output.json 只返回 preview + 完整 via artifact read API。

**验收标准**  
- Given 大 output When GET node Then `output_preview` size < 32KB  
- Given events When GET node Then `steps.length` <= 50

**风险与缓解**  
性能 → 缓存 node 投影于 run 结束后写入 `node_summary.json`（可选 P1）。

---

### REQ-B1-003: Run-scoped 实时事件订阅（Workbench）

| 属性 | 值 |
|------|-----|
| 来源 | B1 / Multica 事件流 |
| 阶段 | near |
| 优先级 | P1 |
| 依赖 | REQ-B1-002 |

**问题陈述**  
多任务并行时 UI 需按 `run_id` 拉事件，不能全局单例。

**当前 ACC 现状**  
- `GET /api/runs/{run_id}/events`（需确认 routes 实现，探查 `acc/server/routes/runs.py` 余下部分）  
- `WorkbenchRunManager` run-scoped：`acc/server/run_manager.py:31-54`  
- **缺口**：前端是否对 terminal run 停止轮询需与 AGENTS.md 一致

**目标行为**  
Workbench 提交 run 后仅轮询该 `run_id` events；切换 task 不取消其他 run 轮询（降频即可）。

**验收标准**  
- 现有 `App.test.tsx` 多 run 用例仍通过  
- 文档化 terminal 状态停止高频 poll

**风险与缓解**  
需确认 events route 是否存在 → 无则本 REQ 含实现子项。

---

## 近期里程碑验收（阶段 Done 定义）

- [ ] `acc workflow validate` 覆盖 B4-001~002，可选 --dry-run（B4-004）  
- [ ] Workbench save 拒绝非法 accflow（B4-005）  
- [ ] 节点 inspector 三层结构上线（B1-001）+ API 字段（B1-002）  
- [ ] events 与 stdout 分离策略（A5-001）及 summary 字段（A5-002）  
- [ ] `uv run pytest -q` + `cd web && npm run test -- --run` 通过  
- [ ] flag off 行为无回归
