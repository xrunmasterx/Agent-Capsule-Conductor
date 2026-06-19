# PLAN 05 - Inspector 拆分

## 目标

把右侧 Inspector、数据连接面板、选择对象详情从 `WorkflowViewer.tsx` 中拆出，形成 view-model driven 的 inspector 模块。这个 plan 负责把属性编辑、端口编辑、edge/boundary preview、node/workflow 详情从主文件剥离。

## 前置条件

- PLAN 02 的 selection/model/edge pure functions 已完成。
- PLAN 03 的 boundary preview hook 已完成。
- PLAN 04 的基础 overlay/dock 组件已等价替换。

## 写集合

允许新增/修改：

- `web/src/components/inspector/RightInspector.tsx`
- `web/src/components/inspector/NodeInspector.tsx`
- `web/src/components/inspector/WorkflowInspector.tsx`
- `web/src/components/inspector/EdgeInspector.tsx`
- `web/src/components/inspector/PortInspector.tsx`
- `web/src/components/inspector/DataConnectionsPanel.tsx`
- `web/src/components/inspector/InternalNodeInspector.tsx`
- `web/src/workbench/model/selectedEntityDetails.ts`
- `web/src/workbench/model/inspectorActions.ts`
- `web/src/components/WorkflowViewer.tsx`
- inspector tests

禁止修改：

- ReactFlow connect lifecycle。
- run submit 行为。
- assistant GraphOps 行为。

## 模块边界

Inspector components 只负责：

- 根据 view model 展示字段。
- 发出用户 action。
- 展示 validation/diagnostics。

Inspector components 不负责：

- 直接遍历并修改 nested canvas。
- 调用 API。
- 推断 boundary transfer canonical binding。
- 操作 run stream。

## 任务清单

1. 迁 view model：
   - `selectedEntityDetailsModel`
   - selected node settings model。
   - selected edge model。
   - selected workflow/internal node lookup。
   - evidence ownership model。

2. 迁 action builder：
   - update invocation input。
   - add/delete/rename exposed port。
   - add/delete/rename internal port。
   - update boundary transfer metadata。
   - delete selected entity。

3. 新建 `RightInspector`：
   - 根据 `selection.kind` 分发到 node/workflow/edge/port/internal inspector。
   - 只接收 view model 和 callbacks/store actions。

4. 新建 `DataConnectionsPanel`：
   - 显示 explicit data edges。
   - 显示 control edges。
   - 显示 boundary transfer diagnostics。
   - 显示 ambiguous output mapping error。

5. 主文件替换：
   - `WorkflowViewer.tsx` 只组合 `RightInspector`。
   - 删除本地 `RightInspector`、`WorkflowInspector`、`DataConnectionsPanel` 等定义。

## 必须覆盖的测试

- 选中 root node 显示 invocation/static input/ports。
- 选中 workflow 显示 exposed inputs/outputs。
- 选中 internal node 显示 inside workflow 信息。
- 选中 data edge 显示 source/target ports。
- 选中 boundary control edge 显示 preview result。
- ambiguous boundary output 显示 error 且阻断 run。
- port rename 后 data edge 更新或明确 diagnostic。
- port delete 后相关 edge 清理/警告符合规则。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

- `WorkflowViewer.tsx` 不再定义 `RightInspector`。
- `WorkflowViewer.tsx` 不再定义 `DataConnectionsPanel`。
- inspector 不直接调用 `api.*`。
- inspector 不直接实现 boundary transfer 推断。

## 手工浏览器验收

- 选中 Agent/Tool 节点。
- 选中 Workflow 容器。
- 选中 workflow 内部节点。
- 选中 control edge。
- 选中 data edge。
- 编辑端口。
- 查看 boundary transfer preview。

## 不可回退语义

- Inspector 可以阻断运行错误，但不能改变后端 canonical compiler 规则。
- 显式 data edge 优先权不能被 inspector 自动修正覆盖。
- Workbench-only metadata 仍保存为 `boundary_transfer`。

## 交接给下一 plan

PLAN 06 可以迁 Assistant 和 GraphOps。进入 PLAN 06 前，Inspector 已从主文件剥离，assistant 仍可通过 props/store 获取 selection context。

## Goal 模式执行契约

### Goal

把右侧 Inspector、数据连接面板、端口/edge/workflow/internal node 面板迁出 `WorkflowViewer.tsx`，并把复杂判断下沉到 pure view-model/action-builder。完成后 inspector 组件只展示父层或 hook 提供的 model/diagnostics/callback，不直接调用 API 或实现 boundary transfer 推断。

### Non-goals

- Inspector 不拥有 run/save 阻断语义。它只展示 diagnostics；submit guard 和后端 compiler 负责阻断。
- 不改变 port rename/delete 产品规则。
- 不把 assistant、GraphOps、ReactFlow canvas 或 store ownership 混进本 plan。

### 前置与修正

- 文档和实现必须使用真实字段 `selection.type`，不是 `selection.kind`。
- 如果 `useBoundaryTransferPreview` 尚未由 PLAN 03 完成，本 plan 第一阶段只允许补 hook 或接收父级 preview result，不能在 inspector 组件里直接调用 `api.boundaryTransferPreview`。
- 新增 `web/src/workbench/model/*` 时必须说明它是 pure view-model/action-builder 层：不 import React，不调用 API，不读写 store。

### 执行分片

1. 迁 `selectedNodeSettingsModel`、`selectedEntityDetailsModel`、port/edge property group builder。
2. 新建 `buildDataConnectionsModel(...)`，组件只消费 `incoming/outgoing/targets/readonlyReasons/diagnostics`。
3. 新建 port action builder：rename 会同步 data edge endpoint；delete 有相关 data edge 时拒绝；delete last port 拒绝；schema-derived output port 只读；workflow boundary pseudo-node 端口方向用当前 `storedPortDirectionForDataConnectNode` 语义。
4. 拆 `RightInspector` 分发，区分 executable workflow invocation node 与 inline workflow container。
5. 拆 `NodeInspector`、`WorkflowContainerInspector`、`InternalNodeInspector`、`EdgeInspector`、`PortInspector`、`DataConnectionsPanel`。
6. `EdgeInspector` 只展示 boundary preview result。如果要支持 `boundary_transfer.mappings` 编辑，必须保存 snake_case v1 metadata 并补测试。
7. 删除 `WorkflowViewer.tsx` 中本地 inspector 函数。

### 必补测试样例

- pure model：root Agent/Tool、inline workflow container、internal node、data edge、port、empty selection；executable workflow 被归类为 callable node，不是 container。
- `RightInspector` 分发：使用 `selection.type`；覆盖 workflow invocation、workflow container、internal、edge、port。
- `DataConnectionsPanel` view model：root/internal scope 的 incoming/outgoing/targets/scope mismatch。
- schema-derived output port 只读：rename/delete disabled 或 action blocked，提示修改 output schema。
- port action builder：root/internal/boundary pseudo-node rename/delete；有 edge 拒删；最后一个端口拒删；无 edge 非最后端口可删。
- dangling data edge diagnostics：root/internal 都覆盖。
- boundary preview：loading、valid、unavailable warning、ambiguous output error、edge_id 过滤。
- run/save guard 测试放在 submit hook 或 App 集成测试，不放在 inspector 组件内。

### 静态门禁

```bash
rg -n "function RightInspector|function DataConnectionsPanel|function WorkflowInspector|function EdgeInspector|function PortInspector|function InternalNodeInspector" web/src/components/WorkflowViewer.tsx
rg -n "api\\.|boundaryTransferPreview" web/src/components/inspector
rg -n "selection\\.kind" web/src
rg -n "window\\.prompt" web/src/components/inspector
```

预期：前三条无结果；第四条如果保留，必须有明确产品接受和测试，否则改为可测试 inline rename form。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

如触及 boundary transfer run/save guard，补跑：

```bash
python -m pytest -q tests/server/test_workbench_canvas_snapshots_api.py tests/unit/test_workbench_adapter.py
```

### Commit / Push

- 禁止 `git add .`。只 stage `web/src/components/inspector/*`、`web/src/workbench/model/*` 中本 plan 的 model/action-builder、必要 `WorkflowViewer.tsx` 删除 hunk、相关 tests 和本文档。
- commit message 建议：`refactor(workbench): extract workflow inspector panels`。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果 inspector 组件需要直接调用 API 才能工作，停止，先补 hook/parent data flow。
- 如果端口删除会自动清 data edge 或放宽 schema-derived port 只读规则，停止，除非另有产品 plan 明确改变语义。
