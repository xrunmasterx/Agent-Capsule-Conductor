# Phase 0 - Preflight, Execution Order, And Guardrails

## 目标

Phase 0 不实现功能。它的目标是把 schema-driven ports 的执行边界、前置事实、验收门槛和回滚点先固定下来，避免后续实现时只改 UI 显示、漏掉 runtime/validation，或者新增不必要的状态机。

最终执行阶段为：

```text
Phase 0: preflight + guardrails
Phase 1: backend schema -> output port projection
Phase 2: runtime / validation / adapter 使用 effective ports
Phase 3: Workbench UI schema ports + drag-to-node auto input
Phase 4: migration diagnostics + unit/component acceptance
Phase 5: browser product acceptance + release hardening
```

## 约束

- 不新增 runtime 状态机。
- 不改变 `ControlEdge` / `DataEdge` 的核心模型。
- `output_schema` 是 agent output ports 的 source of truth。
- `output_ports` 是兼容 snapshot，不是 agent 输出端口真相。
- input ports 由用户连接行为生成，不从 schema 自动生成。
- control edge 默认可以触发完整 `main` output 转发；关闭后只表示调度顺序。
- workflow container 的 exposed outputs 只由 boundary / `workflow_output_bindings` 决定，不能自动泄漏内部 agent schema fields。

## Phase 0 Preflight Gate

执行 Phase 1 前必须先确认以下代码事实：

1. `acc/runtime/node_payload.py`
   - `output_port_ids()` 当前没有从 `output_schema` 推导 output ports。
   - `output_value_for_port()` 已经支持非 `main` 优先读取 `output["outputs"][port]`，再 fallback legacy top-level。

2. `acc/engine/workflow_validation.py`
   - data edge source 校验和 workflow output binding 校验当前仍主要依赖 `node.output_ports`。
   - schema-derived ports 必须通过一个 shared helper 接入，不能每个函数各写一套判断。

3. `acc/app/workbench_adapter.py`
   - Workbench 保存 canonical node 时当前会接收 legacy `output_ports`。
   - 有 `output_schema` 的 agent node 必须在保存前重新生成 `ports.outputs` snapshot。

4. `acc/app/workflow_normalization.py`
   - callable registry snapshot 当前会 snapshot template ports/schema。
   - 有 output schema 的 agent template 必须优先从 schema 投影 output ports。

5. `web/src/components/WorkflowViewer.tsx`
   - UI 当前多处读 `node.outputPorts`。
   - `createDataEdgeCommand()` 依赖 source output port 和 target input port 存在。
   - `handleConnectEnd` 拖到 node body 的路径当前不是“自动建 input port”的主路径。

## 全局 UI / Product 验收约束

这些约束从 Phase 1 起就必须纳入实现，不允许到最后才补：

- control edge 文案必须与 runtime 语义一致：默认可能传完整 `main output`，不是单纯“只控制顺序”。
- `forward_main_output_on_control` 是 source node 级开关，影响该节点所有 control 下游。
- 关闭 full-output forwarding 后，已有 control edge 必须有视觉或文案提示：现在只调度，不传完整输出。
- Agent output ports 是 schema projection，UI 中只读展示；用户通过编辑 `output_schema` 调整输出端口。
- Workflow boundary output ports 仍由 boundary API 管理，不从内部 agent schema 自动生成。
- Broken data edge 不自动删除，必须保留并显示原因。
- Port tooltip / inspector 至少展示 `description`、`type`、`required`、`json_path`。
- 拖拽失败、端口冲突、schema 字段缺失必须有明确反馈，不能静默取消。

## 推荐执行顺序

1. Phase 1 只做 backend projection helper 和最小 unit tests。
2. Phase 2 把 runtime、validation、Workbench adapter、normalization 全部切到 effective output ports。
3. Phase 3 做 UI projection、只读 output ports、拖到 node body 自动创建 input port。
4. Phase 4 做 migration diagnostics、broken edge 表达、unit/component 验收。
5. Phase 5 用真实 Browser 证明用户路径可用：拖、存、重开、运行、查看 evidence、修复 broken edge。

## 每阶段完成门槛

每个 Phase 完成后必须回答：

1. 改了哪个架构边界。
2. 是否改变 runtime payload 语义。
3. 是否新增 durable state 或状态机。
4. 旧 workflow 是否仍能加载和 validate。
5. schema 改名后是否保留并标记 broken edge。
6. UI 是否准确表达 control/data 两类连接的真实语义。
7. 失败时最小回滚范围是什么。

## 回滚边界

- Phase 1 回滚：移除 projection helper 和对应 tests，恢复直接读 legacy ports。
- Phase 2 回滚：恢复 runtime/validation/adapter 对 `node.output_ports` 的读取。
- Phase 3 回滚：恢复前端从 `node.outputPorts` 渲染，不启用 drag-to-node auto input。
- Phase 4 回滚：保留旧 workflow 兼容路径，不删除任何用户 edge。
- Phase 5 回滚：关闭产品验收脚本或回到 legacy UI projection；不改变 runtime evidence。

## 禁止事项

- 不新增 `PortStateMachine`、`ConnectionStateMachine` 或类似长期状态。
- 不让 UI-only 字段成为 runtime 唯一依赖。
- 不把所有 top-level schema fields 默认生成端口。
- 不静默删除 broken data edge。
- 不让 workflow container 自动暴露内部 agent 的 schema fields。
