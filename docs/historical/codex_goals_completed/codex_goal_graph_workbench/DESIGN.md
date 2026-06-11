# Graph Workbench Design

## 1. First-principles design

The workflow is a graph, not a list.

A list or button-based sequence can only express “run after this”. It cannot clearly show branching, merging, parallelism, failure path, or data dependency. Since Agent Capsule workflows are meant to coordinate multiple high-order agents, graph visualization is not decoration; it is the core representation.

## 2. Core philosophy

```text
Human authors the graph.
AI may propose graph changes.
The graph runtime validates and executes deterministic topology.
Mature agents execute inside nodes.
```

This preserves the original architecture:

```text
Conductor / graph runner = topology
acc = capsule execution boundary
Claude / Codex / other agents = internal intelligence
artifacts = evidence and data flow
```

## 3. Recommended visual stack

### 3.1 Primary choice: React Flow + ELK/Dagre

Use React Flow as the graph canvas because:

- It is React-native.
- Custom nodes are React components.
- Handles support explicit input/output connection points.
- Edges are first-class objects.
- It integrates cleanly with side panels, inspectors, and React state.
- It is enough for a practical workflow editor without adopting a whole visual-programming framework.

Use ELK or Dagre for automatic layout.

### 3.2 Reference systems

Use these systems as references, not direct dependencies:

- Node-RED: palette + canvas + wiring + deploy mental model.
- ComfyUI: graph workflow, node links, reusable subgraphs.
- Unreal Blueprint: class/template vs instance mental model.

### 3.3 Alternatives considered

- Rete.js: strong visual programming framework, but it includes processing/dataflow concepts that may duplicate the existing `acc` runtime.
- LiteGraph.js: close to Blueprint/ComfyUI style, but less aligned with a React/shadcn app and may be harder to integrate into the current stack.
- AntV X6: strong graph editing engine, especially in Chinese/Ant ecosystem; consider it if the current frontend is already Ant Design/X6-oriented.

## 4. Frontend layout

```text
AppShell
  TopToolbar
    - 工作流名称
    - 保存
    - 校验
    - 运行
    - 自动布局
    - Demo
  LeftPanel
    - 节点库
    - 搜索 Capsule
    - 拖入画布 / 点击添加
  GraphCanvas
    - Node cards
    - Edges
    - Status badges
    - Minimap
    - Controls
  RightInspector
    - NodeInspector
    - EdgeInspector
    - WorkflowInspector
    - RunInspector
  BottomPanel
    - Run status
    - Validation errors
    - Logs summary
```

## 5. Node visual design

Each node card should show:

- Display label in Chinese
- capsule id
- runtime type
- status badge
- warning icon if validation failed
- small artifact indicator after run

Node handles:

- left: input handle
- right: output handle
- optional lower handle for failure path in later phase

Node status colors:

- gray: 未运行
- blue: 运行中
- green: 成功
- red: 失败
- yellow: 等待人工确认
- purple: Schema 错误
- orange: 产物错误

## 6. Edge visual design

Edges should show dependency clearly.

Required edge types:

- default dependency edge
- mapped data edge
- future failure edge placeholder

Edge label should be optional but visible on selection.

## 7. Graph schema independence

The saved graph format must not be raw React Flow state only.

Use project-level `WorkflowGraph` as source of truth:

```text
WorkflowGraph -> UI adapter -> React Flow nodes/edges
React Flow changes -> UI adapter -> WorkflowGraph
```

This prevents frontend library lock-in.

## 8. Execution model

Graph run should use existing capsule runner.

```text
WorkflowGraph
  -> validate
  -> topological sort
  -> execute node by node or parallel by levels
  -> each node calls existing acc run logic
  -> collect output.json and artifacts
  -> write workflow_run.json
```

No LLM dynamic routing in this phase.

## 9. Input mapping

Downstream node input may be:

1. Static JSON input.
2. Expression referencing upstream output.

Example:

```json
{
  "message": "{{ nodes.echo.output.summary }}"
}
```

Mapping syntax must be minimal and validated.

## 10. Chinese-first i18n

Use a dictionary:

```text
web/src/i18n/zh-CN.ts
web/src/i18n/en-US.ts
```

Default locale: `zh-CN`.

Do not scatter hard-coded UI strings.

## 11. Testing strategy

Tests must cover:

- graph schema validation
- cycle detection
- topological order
- serial run
- fan-out/fan-in run
- UI text Chinese labels
- graph canvas renders nodes and edges
- edge connection updates graph JSON
- build passes

Default tests remain hermetic.
