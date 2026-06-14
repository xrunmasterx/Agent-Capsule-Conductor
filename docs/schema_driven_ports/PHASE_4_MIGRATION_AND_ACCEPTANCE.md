# Phase 4 - Migration, Diagnostics, And Unit Acceptance

## 目标

把 schema-driven ports 从“能跑”补到“后续开发稳健”：旧 workflow 兼容，schema 改动后的 broken edge 可见、可解释、可修复，backend/frontend 单元和组件测试覆盖核心语义。

Phase 4 不负责真实 Browser 产品验收。真实用户路径放到 Phase 5。

## 约束

- 不静默删除用户 data edge。
- 不让 migration 自动猜测字段重命名。
- 不把内部 agent schema fields 自动暴露为 workflow outputs。
- 不改变无 schema legacy workflow 的行为。

## 修改范围

可能涉及：

```text
acc/engine/workflow_validation.py
acc/app/workbench_adapter.py
acc/app/workflow_normalization.py
web/src/components/WorkflowViewer.tsx
tests/unit/test_core_v2_output_schema_and_ports.py
tests/unit/test_workbench_adapter.py
tests/unit/test_workflow_normalization.py
web/src/components/WorkflowViewer.drag.test.tsx
web/src/App.test.tsx
docs/sdd/03-runtime-and-evidence.md
docs/sdd/05-interfaces-and-workbench.md
```

## 迁移规则

### 1. 无 `output_schema` 的旧节点

保持 legacy `output_ports` 行为。

原因：没有 schema 时不能安全推断业务输出字段。

### 2. 有 `output_schema` 的 agent node

规则：

```text
schema projection wins
```

保存时重新生成 output ports snapshot。

如果 legacy `output_ports` 多出 schema 中不存在的字段：

- 没有 edge 引用：保存时可收敛到 schema projection。
- 有 edge 引用：保留 edge，validate 报错，不静默删除。

### 3. Legacy top-level schema

Runtime 继续支持：

```text
output_value_for_port(output, "risk_table") -> output["risk_table"]
```

但新 UI 默认只推荐：

```text
output.outputs[port_id]
```

如果用户希望 top-level 字段成为可连接业务端口，应迁移到 `outputs` 容器。

### 4. Workflow container

Workflow 的 exposed outputs 仍由 boundary data edge / `workflow_output_bindings` 决定。

内部 agent schema fields 只有被用户明确连到 workflow output boundary 后，才成为 workflow 对外输出。

## Diagnostics

### Broken source port

触发条件：

```text
DataEdge source port 不存在于 source effective output ports
```

表现：

- backend validation error: `dangling_data_edge_source`
- error metadata 包含 `node_id`、`port`、`edge id/source/target`、`expected_schema_path`
- UI edge 显示 broken
- Inspector 显示 missing source port 和修复建议

### Broken target port

触发条件：

```text
DataEdge target port 不存在于 target input ports
```

表现：

- backend validation error: `dangling_data_edge_target`
- UI 提供“创建 target input port”修复入口

### Required input unbound

触发条件：

```text
required input 没有 static/workflow/data/control-main 来源
```

表现：

- backend validation error: `unbound_input_port`
- Inspector 说明缺少哪个 input，以及可用来源

### Full-output forwarding ambiguity

触发条件：

```text
source node 对多个 control 下游开启 full-output forwarding
```

这不是错误，因为用户要求 control-only 默认全量传递。

UI 应提示：

```text
此设置影响该节点所有控制线下游。
```

## Acceptance Matrix

| 场景 | 期望 |
| --- | --- |
| 只画 control edge | 下游收到上游完整 `main` output |
| 关闭 source full-output forwarding | control edge 只触发顺序，不传 output |
| 从 schema output port 拖到 node body | 自动创建 input port + data edge |
| schema 删除已连接字段 | edge broken，不静默删除 |
| workflow container 内部 agent 有 schema ports | 不自动暴露到父图 |
| 无 schema legacy workflow | 继续按旧 output_ports 工作 |
| legacy top-level schema | runtime 兼容，UI 不默认生成业务端口 |
| 手写 output_ports 与 schema 冲突 | schema 胜出，edge 引用旧 port 时 validate error |

## 测试组合

Backend：

```bash
uv run pytest -q tests/unit/test_schema_driven_ports.py
uv run pytest -q tests/unit/test_core_v2_output_schema_and_ports.py
uv run pytest -q tests/unit/test_workbench_adapter.py
uv run pytest -q tests/unit/test_workflow_normalization.py
```

Frontend：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

Workflow：

```bash
uv run acc workflow validate workflows/core_v2_stock_research_canvas.accflow.json
```

## 完成标准

- schema-derived output ports 在 backend 和 frontend 一致。
- 用户可以不点按钮，直接拖拽 output port 到目标节点创建数据连接。
- 关闭 full-output forwarding 后，runtime 不再通过 control-only 默认传 output。
- 旧 workflow 不被破坏。
- broken edge 可见、可解释、可修复。
- 单元测试和组件测试覆盖 migration 与 diagnostics；真实 Browser 验收留给 Phase 5。
