# Graph Workbench Spec

## 1. Product definition

Graph Workbench is a Chinese-first visual workflow builder for Agent Capsule workflows.

It uses the existing `acc` runtime for execution and does not replace the current CLI/runtime architecture.

## 2. Required UX

### 2.1 Chinese-first UI

All major user-facing UI text must be Chinese by default:

- Buttons
- Menus
- Page titles
- Empty states
- Error messages
- Node status labels
- Inspector labels
- Tooltip labels

Preferred labels:

- 工作流
- 节点库
- 画布
- 节点属性
- 连接
- 输入
- 输出
- 产物
- 日志
- 校验
- 运行
- 保存
- 自动布局
- 串行
- 并行
- 失败
- 等待人工确认

Implementation should use an i18n dictionary, not hard-coded scattered text.

### 2.2 Graph-first interaction

Workflow editing must be graph-first:

- The central area is a node canvas.
- Capsules are added as nodes.
- Edges visually represent dependencies.
- Users can drag edges between node handles.
- Serial and parallel relationships must be visually obvious.
- Node order cannot be represented only by buttons.

### 2.3 Minimal layout

Required layout:

```text
┌────────────────────────────────────────────────────────────┐
│ 顶部工具栏：保存 / 校验 / 运行 / 自动布局 / Demo            │
├───────────────┬───────────────────────────┬────────────────┤
│ 左侧节点库     │ 中间图谱画布               │ 右侧属性面板     │
│ Capsule 列表   │ React Flow / graph canvas │ 节点/边/运行详情 │
├───────────────┴───────────────────────────┴────────────────┤
│ 底部运行面板：状态、错误、日志、最近运行                    │
└────────────────────────────────────────────────────────────┘
```

### 2.4 Node model

A graph node represents a capsule instance, not the capsule template itself.

Node fields:

```json
{
  "id": "source_reality_check_1",
  "capsule_id": "source-reality-check.codex",
  "label": "源码现实检查",
  "position": { "x": 100, "y": 200 },
  "input": {},
  "input_mapping": {},
  "notes": "",
  "ui": {
    "collapsed": false,
    "color": "default"
  }
}
```

### 2.5 Edge model

An edge represents dependency and data flow.

Edge fields:

```json
{
  "id": "edge_a_b",
  "from": "node_a",
  "to": "node_b",
  "label": "输出给下游",
  "mapping": {
    "message": "{{ nodes.node_a.output.summary }}"
  },
  "condition": null
}
```

### 2.6 Workflow graph file

Use `workflows/*.graph.json` as the UI-native graph format.

Required fields:

```json
{
  "id": "demo_graph",
  "version": "0.2.0",
  "name": "Demo 工作流",
  "description": "",
  "nodes": [],
  "edges": [],
  "metadata": {}
}
```

### 2.7 Graph validation

Validation must detect:

- Missing capsule
- Duplicate node id
- Edge references missing node
- Self edge
- Cycle
- Invalid mapping expression syntax
- Missing required node input that is neither static input nor mapped from upstream
- Invalid graph JSON schema

### 2.8 Graph run

The graph runner must execute nodes in topological order.

It must support:

- Serial dependency
- Fan-out parallel branches where possible
- Fan-in dependency
- Per-node run directories
- Workflow run summary

It must not support in this phase:

- loops
- LLM dynamic routing
- automatic agent planning
- complex retry policy

### 2.9 Run inspector

For each graph run, user must be able to inspect:

- node status
- input.json
- resolved_prompt.md
- output.json
- artifacts
- stdout.log
- stderr.log
- events.jsonl

## 3. Technology recommendation

Preferred:

- React + TypeScript
- React Flow for canvas
- ELK or Dagre for auto layout
- FastAPI backend if backend already exists
- Existing `acc` CLI/core for execution

The implementation may adapt to the existing project structure, but must keep graph schema independent from the UI library.

## 4. Existing system compatibility

Must preserve:

- Existing CLI tests
- Existing hermetic tests
- Existing capsule format
- Existing `acc run` behavior
- Existing stdout JSON contract
