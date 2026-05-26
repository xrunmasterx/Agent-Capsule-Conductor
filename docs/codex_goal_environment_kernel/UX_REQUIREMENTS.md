# UX Requirements

If a web workbench exists, update it to make environment semantics visible.

## Required UI concepts

### 1. Workflow container

Show workflow as a container / group.

Display:

```text
工作流名称
状态：未绑定 / 无状态 / 已绑定工作目录
工作目录路径
```

### 2. Agent node

Show:

```text
Agent 类型
cwd
behavior pack mode
input ports
output ports
last run status
```

### 3. Port edges

Edges should represent ports, not just generic dependency.

Show:

```text
source node / source port -> target node / target port
```

### 4. Inbox / Outbox inspector

For each node:

```text
输入目录
输出目录
artifact manifest
source node information
```

### 5. Bind workspace action

User can bind/rebind workflow workspace.

Display warning:

```text
保存 workflow 模板不会保存本机路径；本机路径写入 local binding file。
```

### 6. Nesting warnings

If user tries to place stateful workflow inside stateful workflow:

```text
默认禁止：有状态 workflow 内不能再嵌套有状态 workflow。
```
