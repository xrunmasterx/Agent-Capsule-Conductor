# Phase 3 - Workbench UI Schema Ports And Drag Connections

## 目标

让用户在可视化画布上直接使用 schema-derived output ports，并通过拖拽完成精确数据连接：

```text
从 A.output_field handle 拖到 B node body
  -> 自动创建 B.output_field input port
  -> 自动创建 DataEdge A.output_field -> B.output_field
  -> 自动补 control dependency
```

主路径必须是画布拖拽，不是按钮式端口管理。

## 约束

- 不重构整个 `WorkflowViewer.tsx`。
- 不新增前端长期状态机。
- UI state 只是 workflow/template 的 projection。
- Agent output ports 由 `output_schema` 推导，只读展示。
- Workflow boundary output ports 仍可编辑，因为它们是子 workflow 的外部 API。

## 修改范围

重点文件：

```text
web/src/components/WorkflowViewer.tsx
web/src/components/WorkflowViewer.drag.test.tsx
web/src/App.test.tsx
web/src/i18n/
```

如需轻量拆分，可新增：

```text
web/src/components/workflow-viewer/schemaPorts.ts
```

但本阶段不强制拆文件，避免扩大 diff。

## 方案

### 1. Frontend effective output ports

新增 TS helper：

```ts
function outputPortsFromSchema(
  outputSchema: Record<string, unknown> | undefined,
  fallbackPorts: WorkflowPortView[],
): WorkflowPortView[] { ... }

function effectiveOutputPortsForNode(node: InternalNode): WorkflowPortView[] { ... }
```

规则：

- `main` 总是存在。
- 只从 `outputSchema.properties.outputs.properties` 生成非 `main` ports。
- `label` / tooltip 使用 `title` 或 `description`。
- `required` 来自 `outputs.required`。
- `jsonPath = /outputs/<field>`。
- 没有可投影 schema 时 fallback legacy `node.outputPorts`。

必须替换的读取点：

- canvas node handles 渲染。
- `dataConnectNodes()` 的 source output ports。
- `DataConnectionsPanel` 的 output port 列表。
- node settings / inspector 的 output port 展示。
- graph serialization 前的 output port snapshot。
- schema fields preview。

### 2. Agent output ports 只读

对 agent node：

- 禁用或隐藏“添加输出端口”。
- 禁用 schema-derived output port 的重命名和删除。
- 提示：输出端口来自 `output_schema.properties.outputs.properties`。

对 workflow boundary：

- 保留 output ports 管理能力。
- 不把内部 agent schema 自动暴露成 workflow outputs。

### 3. 拖到 node body 自动创建 input port

当前已有能力：

```text
completeDataConnectionWithNewInputPort()
addInputPortToDataConnectNode()
createDataEdgeCommand()
```

Phase 3 要把它们接到 canvas drag/drop 主路径：

1. 用户从 output data handle 开始拖拽。
2. 鼠标悬停到 `.react-flow__node` 或节点输入区域。
3. 目标节点高亮，并提示：

```text
释放后创建输入端口：<source_port>
```

4. release 后：
   - 如果 target 同名 input port 不存在，创建它。
   - 如果同名 input port 存在且没有冲突，复用它。
   - 如果同名 input port 已有 one-cardinality incoming edge，P0 可生成 `<source_port>_2`，并显示 toast；P1 再做替换/追加选择。
   - 创建 `DataEdge source.port -> target.port`。
   - 自动补 control dependency。

无效 drop 不能静默取消，必须提示原因。

### 4. Full-output forwarding 文案收敛

字段：

```text
node.control.forward_main_output_on_control
```

建议 UI 文案：

```text
控制线传递完整输出
```

说明：

```text
开启时，只连控制线也会把该节点完整输出传给下游 main input。
关闭后，控制线只决定运行顺序；需要数据时请从 output data port 拖数据线。
此设置影响该节点所有控制线下游。
```

必须修正任何类似“控制线只决定执行顺序，不传输数据”的旧 tooltip，因为默认行为并非如此。

### 5. Port tooltip / Inspector

每个 schema-derived output port 至少展示：

```text
port id
description
type
required
json_path
projection source: output_schema
```

如果 schema field 无法投影，应展示 diagnostic，而不是让端口消失且无解释。

### 6. 画布产品标准

必须覆盖：

- output port hover 有清晰 tooltip。
- 拖拽到目标节点时有 drop highlight。
- 拖拽成功后有轻量反馈。
- 冲突命名时行为可预测。
- 端口数超过 6/10/20 时有折叠、滚动或分组策略。
- 长字段名、中文 description、窄 inspector 不溢出。
- 50% / 125% zoom 下 handle 仍可点击，tooltip 仍可读。

## 非目标

- 不做可视化 JSON Schema editor。
- 不做 deep JSON path selector。
- 不做 edge-level forwarding。
- 不做 `many` cardinality 的完整 runtime 聚合。

## 测试

Frontend tests 必须覆盖：

1. `outputs.properties.a/b/c` 生成 `main/a/b/c` output handles。
2. `outputSchema` 改变后 output ports 随之变化。
3. agent output ports 只读，不能通过 UI 按钮直接增删改。
4. 从 `A.a` 拖到 `B` node body，自动创建 `B.a` input port。
5. 保存 graph 后有 `data_edges: A.a -> B.a`。
6. 拖拽到无效目标时显示失败原因。
7. 关闭 full-output forwarding 后，保存 payload 包含 `control.forward_main_output_on_control=false`。
8. 控制线相关 tooltip 和开关文案与 runtime 语义一致。

推荐命令：

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

## 完成标准

- 用户不需要按钮就能从 schema-derived output port 拖到下游节点并生成 input port。
- Agent output ports 不再和 `output_schema` 双写漂移。
- UI 清楚表达 control-only 全量传递和显式 data edge 的差异。
- 保存后的 graph 可被 backend validate 和 runtime 使用。
