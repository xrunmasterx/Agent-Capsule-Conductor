# Schema-Driven Ports Implementation Plan

## 目标

在不新增 runtime 状态机的前提下，实现：

- Agent output ports 从 `output_schema` 自动生成。
- 用户从 schema-derived output port 直接拖到下游节点，自动生成 target input port 和 `DataEdge`。
- control-only 继续默认传递完整 `main` output。
- 关闭 full-output forwarding 后，control edge 只保留调度依赖，数据只走显式 data edge。

## 全局验收约束

这些约束适用于所有阶段：

- `output_schema` 是 agent output ports 的 source of truth。
- `output_ports` 只是兼容 snapshot；schema 可投影时 schema 胜出。
- Agent output ports 在 UI 中只读展示，用户通过编辑 `output_schema` 改端口。
- Input ports 由用户连接行为生成，不从 schema 自动生成。
- Control edge 默认可能传完整 `main output`；UI 文案不能说成“只控制顺序不传数据”。
- `forward_main_output_on_control` 是 source node 级开关，影响该节点所有 control 下游。
- Broken data edge 不静默删除，必须保留并给出 validator/UI 诊断。
- Workflow boundary outputs 仍由 boundary / `workflow_output_bindings` 显式定义，不自动泄漏内部 agent schema。

## P0：核心闭环

### 1. 新增纯 projection helper

建议新增：

```text
acc/engine/schema_ports.py
```

职责：

- 不做 IO。
- 不依赖 server/UI/runtime subprocess。
- 输入 JSON Schema，输出 port projection。

建议接口：

```python
@dataclass(frozen=True)
class OutputPortProjection:
    port_id: str
    required: bool
    type: str
    cardinality: str
    json_path: str
    description: str | None = None
    title: str | None = None
    schema_type: str | None = None
    projected: bool = True
    deprecated: bool = False
    diagnostic: str | None = None

def project_output_port_metadata(
    schema: dict[str, Any] | None,
    *,
    include_main: bool = True,
) -> dict[str, OutputPortProjection]:
    ...

def effective_output_ports(
    node: NodeInvocationSpec,
) -> dict[str, PortContract]:
    ...

def schema_declares_output_port(
    schema: dict[str, Any] | None,
    port_id: str,
) -> bool:
    ...
```

P0 extraction rule：

```text
main -> /
schema.properties.outputs.properties.<field> -> /outputs/<field>
```

`project_output_port_metadata()` 给 UI/API/diagnostics 使用；`effective_output_ports()` 给 runtime/validation 使用。不要把 UI metadata 硬塞进 `PortContract` 后又在 serialization 中丢失。

Legacy fallback：

- `schema_declares_output_port()` 继续接受 top-level property，保持现有兼容。
- `project_output_ports_from_schema()` 默认只投影 `outputs.properties`，避免 UI 端口噪音。

### 2. 后端使用 effective output ports

修改点：

- `acc/engine/workflow_validation.py`
  - 用 `effective_output_ports(node)` 替代直接读取 `node.output_ports` 的关键检查。
  - data edge source 校验应接受 schema-derived ports。
  - workflow output binding source 校验应接受 schema-derived ports。
  - 保留 “非 main port 必须被 output_schema 声明” 的错误，但错误基于 effective schema 规则。

- `acc/runtime/node_payload.py`
  - `output_port_ids(node)` 在 `node.output_ports` 为空或可被 schema projection 推导时，返回 schema-derived ports。
  - `materialized_output_port_ids()` 不改状态机，只使用新的 effective port list。
  - `output_value_for_port()` 可以保持现有规则：`main` 返回完整 output，非 main 优先取 `outputs[port]`。

- `acc/app/workbench_adapter.py`
  - canonicalize/save/run 前，如果 agent node 有 `output_schema`：
    - 重新生成 `ports.outputs` snapshot。
    - 保留 `main`。
    - 不让旧手写 output_ports 覆盖 schema projection。
  - input ports 不从 schema 重算，保持用户连接产生的端口。

- `acc/app/workflow_normalization.py`
  - callable registry snapshot 时，如果 agent template 有 output schema，优先从 schema 生成 output ports。
  - 如果 template 只有 legacy `output_ports`，继续兼容。

### 3. 前端统一 effective ports

修改点：

- `web/src/components/WorkflowViewer.tsx`
  - 新增 TS helper：

```ts
function outputPortsFromSchema(
  outputSchema: Record<string, unknown> | undefined,
  fallbackPorts: WorkflowPortView[],
): WorkflowPortView[] { ... }

function effectiveOutputPortsForNode(node): WorkflowPortView[] { ... }
```

规则：

- `main` 总是存在。
- `outputSchema.properties.outputs.properties` 生成非 main ports。
- label/tooltip 来自字段 `description`。
- required 来自 `outputs.required`。
- fallback 只用于没有可投影 schema 的 legacy node。

需要替换的读取点：

- canvas node handles 渲染。
- `dataConnectNodes()` 中的 source `outputPorts`。
- `AgentNodeSettings` / `DataConnectionsPanel` 显示的输出端口。
- graph serialization 的 `internalNodeToGraphNode()` / `workflowToGraphNode()`。
- `NodeOutputSchemaPane` 的 schema field 展示。

### 4. 输出端口变为 schema-driven，只读展示

UI 行为：

- 对 agent node：
  - output ports 列表从 schema 生成。
  - 隐藏或禁用“添加输出端口 / 重命名输出端口 / 删除输出端口”按钮。
  - 提示用户通过编辑 `output_schema` 调整输出端口。

- 对 workflow boundary：
  - output ports 仍可由 boundary / `workflow_output_bindings` 管理。
  - 因为 workflow output 是子图对外 API，不等同于某个 agent 的 schema。

- 对 input ports：
  - 保留 rename/delete 作为高级操作。
  - 主流程不要求用户手动添加 input port。

### 5. 拖拽到节点自动生成 input port

当前已有 `completeDataConnectionWithNewInputPort()`，但入口偏 inspector/button。P0 要把它接到画布拖拽：

交互：

```text
drag A.output_field handle
drop on B node body
```

处理：

1. 识别 source 是 output data port。
2. target 是 node body，但不是具体 input handle。
3. 生成 target input port id：
   - 默认使用 source port id。
   - 如果冲突，生成 `<source_port>_2`。
4. 调用现有 `addInputPortToDataConnectNode()`。
5. 调用现有 `createDataEdgeCommand()`。
6. 自动补 control dependency，复用现有逻辑。

不建议新增按钮作为主路径。按钮可保留为辅助调试入口，但用户主路径应是拖拽。

### 6. Full-output forwarding 开关语义收敛

现有字段：

```text
node.control.forward_main_output_on_control
```

P0 要做的是让 UI 文案和 runtime 行为一致：

- 开启：只连 control edge 时，上游完整 output 进入下游 `main`。
- 关闭：control edge 只决定执行顺序，不传数据。

建议 UI 文案：

```text
控制线传递完整输出
```

说明：

```text
关闭后，控制线只决定运行顺序；需要数据时请从 output data port 拖数据线。
```

注意：这是 source node 级设置，会影响该节点所有 control 下游。

## P1：健壮性补强

### 1. Schema 改动后的 edge reconciliation

场景：

```text
旧 schema 有 outputs.valuation_conclusion
用户已连 A.valuation_conclusion -> B.valuation_conclusion
后来 schema 删除或改名 valuation_conclusion
```

行为：

- 不静默删除 data edge。
- UI 显示 broken edge。
- 保存/validate 返回明确错误：

```text
dangling_data_edge_source: A.valuation_conclusion no longer exists in output_schema
```

如果用户把字段重命名，提供“迁移 edge 到新字段”的手动操作即可，不要自动猜。

### 2. Input port provenance

Input port 是用户连接生成的消费别名。建议在 UI model metadata 中记录：

```json
{
  "source": "auto_created_from_data_edge",
  "source_node": "A",
  "source_port": "valuation_conclusion"
}
```

这不是 runtime 状态机，只是 UI/debug metadata。保存到 canonical 时可以进入 node metadata 或 port metadata；如果当前 `PortContract` 不支持 metadata，P1 可以只保留在 Workbench canvas snapshot。

### 3. Port projection diagnostics

Inspector 增加投影解释：

```text
valuation_conclusion
from output_schema /outputs/valuation_conclusion
required: true
type: string
```

这能让用户理解“为什么这个端口存在”。

### 4. 多输入策略

当前 `PortContract.cardinality` 已有 `one` / `many` 的表达空间。

P1 规则：

- `one`：一个 input port 只能有一个 incoming data edge。
- `many`：允许多个 incoming data edge，runtime payload 可以聚合为数组或 keyed object。

P0 可先沿用现有 one/replace 行为；P1 再完善 many 的 runtime 聚合语义。

## P2：长期演进

### 1. Edge-level full-output forwarding

如果未来用户明确需要：

```text
A -> B control 传完整 output
A -> C control 不传完整 output
```

可以复用现有 `ControlEdge.context`，把类型从：

```python
Literal["none"]
```

扩展为：

```python
Literal["none", "forward_main"]
```

但这会改变 control edge 语义面，必须单独设计迁移和测试。本轮不建议做。

### 2. 更细粒度 selector

当前 port 对应一个 top-level output field。

后续可以支持：

```text
/outputs/report/executive_summary
/outputs/valuation/base_case/target_price
```

这需要 `DataEdge` 保存 `source_selector/json_path`，而不是只保存 `source.port`。这是更大改动，P0 不做。

### 3. 增量 schema editor

未来可以做可视化 schema editor：

- 添加 output field。
- 设置 type/required/description。
- 实时生成 ports。
- 改名时提示迁移 data edges。

但 P0 只需要 raw JSON schema + projection preview。

## 测试计划

### Backend unit tests

新增或扩展：

```text
tests/unit/test_schema_driven_ports.py
tests/unit/test_core_v2_output_schema_and_ports.py
tests/unit/test_workbench_adapter.py
tests/unit/test_workflow_normalization.py
```

覆盖：

1. `outputs.properties` 生成 output ports。
2. `main` 永远存在并表示完整 output。
3. data edge source 可以引用 schema-derived port。
4. schema 删除字段后 data edge 报 `dangling_data_edge_source`。
5. save canonical payload 时 output ports 与 schema projection 对齐。
6. `forward_main_output_on_control=false` 时 required main input 不再被 control edge 满足。
7. control-only 默认 full output forwarding 仍然有效。

### Frontend tests

扩展：

```text
web/src/components/WorkflowViewer.drag.test.tsx
web/src/App.test.tsx
```

覆盖：

1. 编辑/加载含 `outputs.properties.a/b/c` 的 schema 后，画布显示 `main/a/b/c` output handles。
2. 用户从 `a` output handle 拖到 B 节点主体，自动创建 `B.a` input port 和 data edge。
3. 保存 graph 后，data edge 是 `A.a -> B.a`。
4. 关闭 full-output forwarding 后，保存 payload 包含 `control.forward_main_output_on_control=false`。
5. output port 不再需要通过“添加输出端口”按钮创建。

### Browser acceptance

Browser acceptance 不再作为 Phase 4 的一部分，而是独立 Phase 5。手动验收路径：

1. 加载 NVIDIA 示例。
2. 打开某 agent 的 output schema，确认 `outputs` 字段生成多个 output ports。
3. 从一个 output port 拖到下游 agent 节点主体。
4. 确认下游自动出现同名 input port。
5. 关闭上游“控制线传递完整输出”。
6. 运行 workflow。
7. 双击下游节点，确认输入中只包含显式 data edge 字段，不包含上游完整 output。

## Phase 拆分

详细执行文档：

- `PHASE_0_EXECUTION_ORDER.md`：preflight、全局约束、回滚点。
- `PHASE_1_BACKEND_SCHEMA_PROJECTION.md`：backend projection helper。
- `PHASE_2_RUNTIME_VALIDATION_ADAPTER.md`：runtime、validation、adapter、normalization。
- `PHASE_3_WORKBENCH_UI_DRAG.md`：UI schema ports、拖到 node body 自动创建 input port。
- `PHASE_4_MIGRATION_AND_ACCEPTANCE.md`：migration diagnostics 和单元/组件验收。
- `PHASE_5_PRODUCT_ACCEPTANCE.md`：真实 Browser 产品验收和 release hardening。
