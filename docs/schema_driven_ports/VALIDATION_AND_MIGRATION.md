# Schema-Driven Ports Validation And Migration

## 验证标准

这个改动是否成功，不看 UI 是否多了按钮，而看四个不变量是否成立：

1. `output_schema` 是 agent output ports 的源头。
2. control-only 默认能把完整 output 传给下游。
3. 关闭 full-output forwarding 后，只有显式 data edge 会传数据。
4. schema 改动不会静默破坏 data edge；要么自动对齐，要么明确报错。

## 最小验收用例

### Case 1：schema 自动生成 output ports

输入：

```json
{
  "type": "object",
  "properties": {
    "outputs": {
      "type": "object",
      "properties": {
        "a": { "type": "string", "description": "A field" },
        "b": { "type": "array", "items": { "type": "string" } },
        "c": { "type": "object", "additionalProperties": true }
      },
      "required": ["a"]
    }
  },
  "required": ["outputs"]
}
```

期望：

```text
UI output ports: main, a, b, c
canonical ports.outputs: main, a, b, c
a.required = true
b.required = false
c.required = false
```

### Case 2：control-only 全量传递

Graph：

```text
A --control--> B
```

条件：

```text
A.forward_main_output_on_control unset 或 true
B.main 没有被 static input / data edge 填充
```

期望：

```text
B payload.main = A 完整 output
binding_manifest 包含 control_main_default
```

### Case 3：关闭 full-output forwarding

Graph：

```text
A --control--> B
```

条件：

```text
A.control.forward_main_output_on_control = false
没有 A -> B data edge
B.main required = true
```

期望：

```text
validate 报 unbound_input_port
runtime 不应偷偷把 A output 放入 B.main
```

### Case 4：精确 data edge 传递

Graph：

```text
A.outputs.valuation_conclusion --data--> B.valuation_conclusion
A --control--> B
```

条件：

```text
A.forward_main_output_on_control = false
A output.json = {
  "outputs": {
    "valuation_conclusion": "base case attractive but risk high",
    "risk_watchlist": ["export control"]
  }
}
```

期望：

```text
B payload.valuation_conclusion = "base case attractive but risk high"
B payload.main 不存在，除非 B 自己有 static/main input
binding_manifest 包含 data_edge
```

### Case 5：schema 改动导致 broken edge

旧 schema：

```text
outputs.valuation_conclusion
```

已有 edge：

```text
A.valuation_conclusion -> B.valuation_conclusion
```

新 schema：

```text
outputs.valuation_view
```

期望：

```text
edge 不被静默删除
UI 显示 broken source port
validate 报 dangling_data_edge_source
用户手动迁移到 A.valuation_view
```

## 迁移策略

### 1. 现有 canonical workflow

现有 `.accflow.json` 中如果有：

```json
"ports": {
  "outputs": {
    "main": {},
    "report": {}
  }
}
```

且没有 `output_schema`，保持兼容，不强制改。

原因：旧 workflow 可能依赖手写 port contract；没有 schema 时不能凭空推断结构化输出。

### 2. 有 `output_schema` 且有手写 `output_ports`

规则：

```text
schema projection wins
```

保存时重新生成 output ports snapshot。

如果旧手写 port 不在 schema 中：

- 如果没有 data edge 引用它，可以移除 snapshot。
- 如果有 data edge 引用它，validate 报错，提示用户修 schema 或迁移 edge。

### 3. Legacy top-level schema

历史 schema 可能是：

```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "risk_table": { "type": "array" }
  }
}
```

Runtime 继续支持：

```text
output_value_for_port(output, "risk_table") -> output["risk_table"]
```

但新 UI 不应默认把所有 top-level properties 都当 output ports。迁移建议：

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string" },
    "summary": { "type": "string" },
    "outputs": {
      "type": "object",
      "properties": {
        "risk_table": { "type": "array" }
      }
    }
  }
}
```

这样 `risk_table` 是可连接业务端口，`status/summary` 是 envelope。

### 4. Workflow container

Workflow container 的 ports 不直接从内部 agent schema 生成。

迁移规则：

```text
internal agent output schema
  -> internal output ports
  -> user connects to Workflow Outputs boundary
  -> workflow_output_bindings
  -> workflow exposed outputs
```

这能保持子 workflow 的 API 边界明确，不让内部节点字段自动泄漏到父图。

## 兼容性风险

### 风险 1：旧测试依赖手写 output ports

处理：

- 无 `output_schema` 的旧节点继续保留手写 ports。
- 有 `output_schema` 的节点以 schema projection 为准，更新测试断言。

### 风险 2：control-only 行为和“控制线只控制顺序”的直觉冲突

当前用户明确希望 control-only 默认传完整 output。

处理：

- UI 文案必须明确：

```text
控制线传递完整输出
```

- 关闭开关后，control edge 才是纯 readiness。

### 风险 3：大 output 被默认传入下游

处理：

- 默认保留，因为这是用户要求的简单模式。
- 在 inspector 中提示：大上下文或精确传递时关闭 full-output forwarding。
- 后续可加 payload size warning，但不作为 P0。

### 风险 4：source node 级开关粒度不足

处理：

- P0 接受这个边界。
- P2 再考虑 edge-level `ControlEdge.context`，但不能在本轮引入。

## 建议执行顺序

1. Phase 0：preflight、代码事实确认、全局 UI/product 验收约束、回滚点。
2. Phase 1：后端 projection helper 和 unit tests。
3. Phase 2：后端 validation/runtime/workbench adapter/normalization 使用 effective output ports。
4. Phase 3：前端 schema-derived output ports 展示，拖拽 output port 到 node body 自动创建 input port。
5. Phase 4：migration diagnostics、broken edge 表达、backend/frontend unit/component acceptance。
6. Phase 5：Browser product acceptance。它不是单元测试替代品，而是真实 Workbench 用户路径验证。

## Phase Gates / Rollback

| Phase | Gate | Rollback |
| --- | --- | --- |
| Phase 0 | 所有前置读取点和验收约束写清 | 无代码改动 |
| Phase 1 | `outputs.properties -> main + fields` helper tests 通过 | 移除 helper 和 tests |
| Phase 2 | schema-derived data edge validate/run 通过 | 恢复 runtime/validation/adapter 读取 legacy ports |
| Phase 3 | canvas drag-to-node 自动建 input port 通过 | 恢复 UI 从 `node.outputPorts` 渲染 |
| Phase 4 | migration/broken-edge unit/component tests 通过 | 保留 edge，不执行 destructive migration |
| Phase 5 | Browser 完成加载、拖拽、保存、重开、运行、修复 broken edge | 临时关闭 UI schema projection 主路径，保留 backend 支持 |

## 产品验收补充

Phase 5 必须证明以下路径：

1. 加载含 `outputs.properties` 的 workflow 后，节点显示 schema-derived output ports。
2. 从 output port 拖到下游 node body 后，自动创建 input port 和 data edge。
3. 保存并刷新页面后，端口和 data edge 不漂移。
4. 运行 workflow 后，下游 input evidence 显示显式 data edge 字段。
5. 关闭 full-output forwarding 后，下游不会收到完整 `main` output。
6. schema 字段改名后，UI 显示 broken edge，validate 返回 `dangling_data_edge_source`，用户修复后 validate 通过。

## 推荐命令

Backend：

```bash
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

Workflow validation：

```bash
uv run acc workflow validate workflows/core_v2_stock_research_canvas.accflow.json
```
