# PLAN 02 - 纯模型函数抽离

## 目标

把 `WorkflowViewer.tsx` 中无副作用的核心语义抽到 `web/src/workbench/model/*`。这是整个重构最重要的一步：先让行为核心脱离 React 组件闭包，后续 UI、hooks、store 才能安全迁移。

## 前置条件

- PLAN 01 已完成。
- 共享类型和常量已经可用。
- 测试仍从旧入口通过。

## 写集合

允许新增：

- `web/src/workbench/model/canvasProjection.ts`
- `web/src/workbench/model/canvasEdgeOps.ts`
- `web/src/workbench/model/boundaryTransferProjection.ts`
- `web/src/workbench/model/flowProjection.ts`
- `web/src/workbench/model/canvasLayout.ts`
- `web/src/workbench/model/selectionModel.ts`
- `web/src/workbench/model/taskModel.ts`
- `web/src/workbench/model/*.test.ts`

允许修改：

- `web/src/components/WorkflowViewer.tsx`
- `web/src/App.test.tsx`
- `web/src/components/WorkflowViewer.drag.test.tsx`
- `web/src/components/canvas/boundaryTransfer.ts`
- `web/src/components/canvas/boundaryTransfer.test.ts`

禁止修改：

- store ownership。
- ReactFlow component ownership。
- backend boundary transfer compiler。

## 模块职责

### `canvasProjection.ts`

迁入：

- `graphToWorkspaceCanvas`
- `canvasToWorkflowGraph`
- focus workflow graph projection。
- graph/canvas normalize helpers。
- graph edge metadata encode/decode。

约束：

- 不 import React。
- 不 import Zustand。
- 不调用 API。
- 不读写 localStorage。
- 不依赖 ReactFlow component。

### `canvasEdgeOps.ts`

迁入：

- `resolveScopedConnection`
- `createDataEdgeCommand`
- `createControlEdgeCommand`
- edge duplicate detection。
- data/control conflict detection。
- port rename/delete 后 edge patch 计算。

必须保留：

- 显式 data edge 优先。
- 已存在的非边界 `main -> main` data edge 可显示和保存。
- 新建 data edge 的产品规则不被 `isImplicitMainDataEdge` 误用。

### `boundaryTransferProjection.ts`

迁入：

- boundary transfer metadata normalize。
- preview request payload builder。
- preview diagnostics -> inspector view model。
- `runtime_control_edge=false` 的 view model。

必须保留：

- 前端不伪造 valid binding。
- `boundary_transfer` snake_case 是保存规范。
- 兼容旧 `boundaryTransfer` / `mapping`。

### `flowProjection.ts`

迁入：

- canvas nodes -> ReactFlow node DTO。
- canvas edges -> ReactFlow edge DTO。
- handle id encode/decode。
- edge view mode filtering。
- root/focused workflow canvas projection。

约束：

- 可以 import ReactFlow type。
- 不能 import React components。

### `canvasLayout.ts`

迁入：

- dagre layout。
- workflow container auto-size。
- internal layout。
- focused workflow layout。

### `selectionModel.ts`

迁入：

- normalize selection。
- selected entity lookup。
- selected entity detail model builder。
- delete selected object command。

### `taskModel.ts`

迁入：

- create default task。
- task migration。
- load/save payload normalization 的纯函数部分。
- demo canvas factory 移出 `WorkflowViewer.tsx`。

## 任务清单

1. 逐个创建 pure model 文件，先复制函数和依赖类型。
2. 为每个 pure model 文件增加单测。
3. 在 `WorkflowViewer.tsx` 中用 import 替换本地函数。
4. 迁移测试 import 来源：
   - 纯函数测试从 `App.test.tsx` / `WorkflowViewer.drag.test.tsx` 拆到 model tests。
   - 集成测试继续通过 UI 入口验证。
5. 保留短期 compatibility export 只作为过渡，并标记 PLAN 09 删除。

## 必须新增的测试

- `canvasProjection.test.ts`
  - graph -> canvas -> graph roundtrip。
  - workflow boundary metadata 保留。
  - focused workflow projection 保留 exposed ports。

- `canvasEdgeOps.test.ts`
  - control edge 创建。
  - data edge 创建。
  - duplicate edge 拒绝。
  - 跨 scope 连接拒绝。
  - 已存在 `main -> main` data edge 不被过滤。

- `boundaryTransferProjection.test.ts`
  - camelCase -> snake_case normalize。
  - explicit mapping inference。
  - preview unavailable 不伪造 valid。

- `flowProjection.test.ts`
  - data/control edge className/marker。
  - focused workflow boundary handle。
  - `all/control/data` edge view mode。

## 验收标准

```bash
cd web
npx tsc --noEmit
npm run test -- --run
```

并满足：

- `WorkflowViewer.tsx` 中不再定义 graph/canvas conversion 主函数。
- `WorkflowViewer.tsx` 中不再定义 edge semantic 主函数。
- 新 pure model 文件无 React/Zustand/API import。
- boundary transfer 和显式 data edge 测试不回退。

## 不可回退语义

- boundary control transfer 仍不进入 runtime `control_edges`。
- run/save payload 中 `boundary_transfer` metadata 仍按既有规范输出。
- 显式 data edge 不被隐式 main edge 逻辑吞掉。

## 交接给下一 plan

PLAN 03 可以开始迁 effect hooks。进入 PLAN 03 前，所有 effect hooks 需要调用的 reducer/projection 都应已在 pure model 中。

## Goal 模式执行契约

### Goal

在 PLAN 01 已完成的前提下，把 `WorkflowViewer.tsx` 中可纯化的 model/projection/command/layout/selection/task 逻辑迁到 `web/src/workbench/model/*` 或既有等价 pure module。完成后 tests 优先从真实 model module import，`WorkflowViewer.tsx` 只保留短期兼容 re-export 白名单。

### Non-goals

- 不迁移 ReactFlow 组件本体和 DOM handle 渲染，这属于 PLAN 07。
- 不迁移 API/EventSource/localStorage effect，这属于 PLAN 03。
- 不让前端 boundary transfer 推断取代后端 canonical compiler。
- 不删除最终 wrapper/export block，这属于 PLAN 09。

### 前置硬条件

- `web/src/types/workbench.ts` 和 `web/src/workbench/constants.ts` 已存在并被 stores/hooks/components 消费。
- `TASK_STORE_KEY`、port layout constants、shared domain type 不再从 `WorkflowViewer.tsx` 取得。
- 如果上述条件不成立，先回到 PLAN 01，不要复制闭包依赖开始 PLAN 02。

### 执行分片

1. 迁 `boundaryTransferProjection`：复用现有 `web/src/components/canvas/boundaryTransfer.ts` 与后端 golden fixture，原文件短期可以 facade/re-export，不能出现第二套 inference 规则。
2. 迁 `canvasProjection`：`graphToWorkspaceCanvas`、`canvasToWorkflowGraph`、workflow/internal graph transform、runtime state stripping、schema-derived ports overlay。
3. 迁 `canvasEdgeOps`：`resolveScopedConnection`、`createDataEdgeCommand`、`createControlEdgeCommand`、auto control dependency、cardinality conflict、cycle check、slot limit、port rename/delete、scoped edge deletion。
4. 迁 `flowProjection`：ReactFlow DTO、handle id encode/decode、edge address、focused workflow scope、root/child edge id 去重、edge view mode。该模块可 import ReactFlow type，但不能 import React component。
5. 迁 `canvasLayout`：dagre layout、fit/expand pure helper、workflow container sizing。drag/reparent 交互如未迁出，必须明确交接 PLAN 07。
6. 迁 `selectionModel`：selection normalize、legacy edge selection upgrade、selected details pure model、delete aftermath。
7. 迁 `taskModel`：pure sanitize/migration/default，不读写 localStorage。demo canvas factory 放入 explicit demo/fixture module，不作为 startup default。

### 必补测试样例

- `canvasProjection.test.ts`：root graph data/control roundtrip；focused workflow exposed inputs/outputs roundtrip；`metadata.workflow_port_edges` 不进入 runtime control edges；schema-derived output ports 覆盖 stale snapshot；template 输出不含 run/session/runtime path。
- `canvasEdgeOps.test.ts`：已导入显式 `main -> main` data edge 可 roundtrip，新建普通 `main -> main` 仍按当前产品规则拒绝；boundary data edge 不补 runtime control edge；duplicate output binding 复用旧 edge；cardinality replace；cycle rejection；slot limit；cross-scope rejection；port rename/delete 硬规则；root/internal 同 id 删除互不影响。
- `boundaryTransferProjection.test.ts`：兼容 `boundaryTransfer`、`boundary_transfer`、旧 `mapping.mappings`；复用 `tests/fixtures/boundary_transfer_cases.json`；preview unavailable 不伪造 valid binding；`runtime_control_edge: false` 保持可见；error diagnostics 不被降级。
- `flowProjection.test.ts`：`all/control/data` 过滤；已有显式 `main -> main` data edge 在 data/all 可见；root/child 同 id 生成唯一 flow edge id；focused workflow boundary handle 旧 alias 兼容。
- `canvasLayout.test.ts`：fan-out/fan-in 排序；boundary rank；container auto-size；center-locked expansion；demo layout 不重叠。
- `selectionModel.test.ts`：root/internal/port/edge selection；legacy edge selection 唯一升级；scoped deletion；running task 下 deletion blocked。
- `taskModel.test.ts`：malformed local payload fallback；旧 key 兼容读、新 key 写；sanitize run-only fields；default task 不加载 demo canvas。

### 静态门禁

```bash
rg -n "ReactFlow|Handle|NodeResizer|useState|useEffect|localStorage|api\\." web/src/workbench/model
rg -n "from ['\"].*(api|stores|components/WorkflowViewer|WorkflowViewer)" web/src/workbench/model
rg -n "__workflowViewerTestables" web/src
rg -n "TASK_STORE_KEY" web/src
```

预期：model 模块不依赖 React component、store、API、localStorage；`WorkflowViewer.tsx` 可短期 re-export 已迁出 helper，但 tests 必须逐步改到真实 owner。

### 验证命令

```bash
cd web
npx tsc --noEmit
npm run test -- --run
npm run build
```

如果触及 boundary/canonical 语义，还必须跑：

```bash
python -m pytest -q tests/unit/test_workbench_adapter.py tests/unit/test_workflow_normalization.py tests/unit/test_schema_driven_ports.py
```

### Commit / Push

- 禁止 `git add .`，按分片小提交优先。
- 推荐 commit message 分片：`refactor(workbench): extract boundary transfer projection model`、`refactor(workbench): extract canvas graph projection model`、`refactor(workbench): extract canvas edge command model`。
- 每个分片提交前 `git diff --cached --name-only`，确认没有 `.acc/`、`.codex_runtime_logs/`、无关后端或其他 plan 改动。
- 验证通过后 `git push origin dev_v3`。

### Stop conditions

- 如果需要修改后端 compiler/runtime 语义，停止并单独设计 backend plan。
- 如果 pure model 为了通过测试需要 import `WorkflowViewer.tsx`，说明迁移边界错误，必须回滚该分片设计。
