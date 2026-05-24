# UX Requirements: Chinese Graph Workbench

## 1. Primary user story

As a game engine developer, I want to visually build an Agent Capsule workflow so that I can quickly connect mature agents, run the workflow, and inspect each node's result without manually editing many files.

## 2. Required Chinese labels

Use these labels or close equivalents.

### Navigation

- 工作流
- 节点库
- 运行记录
- 产物
- 设置

### Toolbar

- 新建
- 打开
- 保存
- 校验
- 运行
- 停止
- 自动布局
- 加载 Demo

### Node panel

- 搜索节点
- 添加节点
- 节点类型
- 运行时
- 描述

### Inspector

- 节点属性
- 连接属性
- 工作流属性
- 输入
- 输出
- 映射
- Prompt
- Schema
- 产物
- 日志

### Status

- 未运行
- 运行中
- 成功
- 失败
- 等待人工确认
- Schema 错误
- 产物错误

### Validation

- 校验通过
- 校验失败
- 缺少节点
- 缺少连接
- 存在环路
- 输入缺失
- 映射无效

## 3. Required interaction flow

### Create and connect

1. User opens the Workbench.
2. User sees the left Capsule palette.
3. User clicks or drags a Capsule into the canvas.
4. User adds a second node.
5. User drags from the first node output handle to the second node input handle.
6. Edge appears on the canvas.
7. Right inspector shows edge mapping.
8. User saves graph.

### Validate and run

1. User clicks 校验.
2. Validation errors appear in bottom panel.
3. User fixes missing input or invalid edge.
4. User clicks 运行.
5. Node statuses update.
6. User clicks a node to inspect input/output/artifacts/logs.

## 4. Visual clarity requirements

- Serial chain must appear left-to-right or top-to-bottom consistently.
- Parallel branches must visually split from a parent node.
- Fan-in must visually merge into downstream node.
- Auto layout must improve readability.
- Node labels must not be hidden by default.
- Status should be visible without opening inspector.

## 5. Minimal acceptable UI

No need for beautiful visual polish. The minimum acceptable UI is:

- readable Chinese text,
- usable node canvas,
- clear edges,
- functional inspector,
- visible validation errors,
- working run button,
- artifact viewer.
