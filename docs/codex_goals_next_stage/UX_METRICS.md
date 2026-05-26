# ACC Workbench UX Metrics

## Purpose

These metrics define whether ACC is comfortable enough to use, not just technically functional.

## Critical metrics

### 1. Chinese-first UI

Core UI labels must default to Chinese.

Required labels:

```text
节点库
工作流
画布
属性面板
输入
输出
产物
日志
保存
校验
运行
自动布局
重跑节点
从此节点重跑
Fork 运行
对比运行
```

### 2. No manual multi-file Capsule creation for basic nodes

A user should be able to create a simple Capsule from UI or scaffold command without manually creating:

```text
capsule.yaml
prompt_template.md
input_schema.json
output_schema.json
artifact_manifest.yaml
```

### 3. Graph-first workflow editing

Workflow dependencies must be visible as graph edges.

Button-only sequential connection is insufficient.

### 4. Parallel structure visibility

A parallel demo must visually show fan-out and fan-in.

### 5. Result inspectability

From any node in a completed run, a user should reach:

- input,
- resolved prompt,
- output,
- artifacts,
- logs,
- events,

within two UI navigation actions after selecting the node.

### 6. Failure diagnosability

For failed nodes, the UI should display:

- status,
- error category,
- stderr or schema error,
- related artifact/log path,
- recommended next action.

### 7. Debug actions

If implemented, the UI should expose:

- 重跑节点,
- 从此节点重跑,
- Fork 运行,
- 对比运行.

### 8. Browser health

During critical journeys:

- no blank page,
- no severe console errors,
- no broken critical API calls,
- no missing core labels,
- no unhandled runtime exceptions.

## Scoring

Each journey gets:

```text
pass
partial
fail
blocked
```

A goal can pass only if all critical journeys are `pass` or documented `blocked` due to missing external browser tooling, with all hermetic tests still passing.
