# ACC 环境化 Workflow 设计：大白话说明

状态：历史设计说明。本文用于解释“workflow 运行需要独立环境边界”的设计动机；当前实现术语以
Core v2 callable-only 为准：`WorkflowFunctionTemplate` 表达可复用函数体，`ScopeFrame` 表达运行
scope，`NodeInvocationSpec` 表达节点调用点，`SessionInstance` 表达一次 agent/tool 执行。文中的
`WorkflowTemplate`、`EnvironmentFrame`、`AgentSessionNode`、`ToolNode` 不应直接视为当前运行时 API。

## 1. 这次要解决什么问题

你现在发现一个关键点：

```text
所有东西都叫 capsule 是对的，
但 capsule 之间不应该只是平铺的五种类型。
它们之间应该有层级和依赖关系。
```

你想要的真实使用体验是：

```text
我指定一个工作目录，比如 F:\Agent-Capsule-Conductor。
然后我在这个工作目录里放 3 个 Agent 节点。
这 3 个 Agent 节点的使用体验，应该和我分别在这个目录下开 3 个 agent CLI 一样。
它们自然能用这个目录里的 AGENTS.md、CLAUDE.md、skills、hooks、rules。
```

这非常合理。

所以这次设计要把 ACC 从：

```text
一堆不同类型 capsule 平铺在图上
```

升级成：

```text
Workflow 是一个环境容器；
Agent / Tool 是环境里的节点；
每次运行会把 workflow 模板绑定到某个工作目录，形成一个 EnvironmentFrame；
Agent 节点就在这个 EnvironmentFrame 的工作目录里启动。
```

## 2. 当前旧模型的问题

之前我们把 Capsule 分成：

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

这个分类有价值，但它没有完全表达：

```text
谁是环境？
谁在环境里运行？
谁只是工具？
输入输出文件放在哪里？
保存 workflow 时是否保存工作目录？
复用 workflow 时怎么重新指定工作目录？
```

所以新模型要把这些问题说清楚。

## 3. 新模型的核心概念

### 3.1 WorkflowTemplate：保存下来的蓝图

WorkflowTemplate 就像 UE5 蓝图类。

它保存：

```text
内部有哪些 Agent 节点
内部有哪些 Tool 节点
节点之间怎么连
有哪些输入口
有哪些输出口
默认 prompt 是什么
默认 rules / skills 是什么
```

但它默认不保存你的本机工作目录。

也就是说：

```text
保存的 workflow 是无状态的。
```

你下次拖出来用时，需要重新指定工作目录。

### 3.2 EnvironmentFrame：运行时工作环境

EnvironmentFrame 是运行时创建出来的环境实例。

它可以绑定一个真实工作目录：

```text
F:\Agent-Capsule-Conductor
```

绑定后，里面的 Agent 节点启动时就像：

```bash
cd F:\Agent-Capsule-Conductor
codex exec ...
```

或者：

```bash
cd F:\Agent-Capsule-Conductor
claude ...
```

所以它能自然读取这个目录里的：

```text
AGENTS.md
CLAUDE.md
skills/
hooks/
rules/
```

### 3.3 AgentSessionNode：在环境里开启一个 Agent CLI

AgentSessionNode 不是自己实现 Agent。

它只是：

```text
在 EnvironmentFrame 的工作目录里，启动 Codex / Claude / Cursor / Hermes。
```

所以使用体感应该接近：

```text
我自己在 cmd 里进入该目录，然后打开 agent CLI。
```

### 3.4 ToolNode：确定性工具节点

ToolNode 是：

```text
Python 脚本
Shell 命令
if
for_each
merge
wait
json transform
```

这些节点不需要 LLM 智能，主要负责稳定处理数据和流程控制。

### 3.5 WorkflowNode：一个 workflow 也可以当节点

一个完整 workflow 可以被封装成一个节点，放进另一个 workflow。

这就是“套娃”：

```text
大的 workflow
  -> 调一个子 workflow
      -> 子 workflow 里有多个 agent 和 tool
```

## 4. 输入输出怎么设计

你提出“workflow 有多个输入和输出”是对的。

但有一个关键修正：

```text
上游节点不要直接把文件写到下游 workflow 的目录里。
```

为什么？

因为这会破坏隔离：

```text
A 节点可以直接污染 B 的 workspace。
B 出错时不知道是谁写的。
两个节点并发时容易冲突。
```

更好的方式是：

```text
每个节点只写自己的 outbox。
调度器负责把上游 outbox 里的 artifact 复制或链接到下游 inbox。
```

也就是：

```text
A/outbox/result
  -> scheduler materialize
  -> B/inbox/from_A/result
```

这样：

```text
数据流清楚
来源可追踪
并发更安全
调试更容易
```

## 5. Workflow 的工作目录怎么设计

不要把默认无状态 workflow 放在 ACC 安装目录里直接跑。

更安全的方式是：

```text
无状态 workflow 默认使用 run 目录下的临时工作区。
```

例如：

```text
runs/<run_id>/environments/<workflow_instance_id>/workspace/
```

原因：

```text
ACC 安装目录不应该被 workflow 写脏。
每次运行应该隔离。
失败后方便清理。
不同 run 不互相污染。
```

如果用户显式绑定工作目录，才使用：

```text
F:\Agent-Capsule-Conductor
```

## 6. 嵌套规则怎么设计

推荐规则：

```text
WorkflowTemplate 可以嵌套 WorkflowTemplate。
但 EnvironmentFrame 默认只允许一层 stateful workspace boundary。
```

换句话说：

```text
无状态 workflow 可以实例化一个有状态 workflow。
有状态 workflow 里默认不能再创建另一个有状态 workflow。
```

但可以允许：

```text
有状态 workflow 里调用无状态子 workflow，并让它继承父 workspace。
```

这样既支持复用，又避免工作目录嵌套混乱。

## 7. 为什么这比旧五分类更好

旧模型：

```text
atomic / agent_session / agent_workflow / acc_workflow / external_workflow
```

更像类型枚举。

新模型：

```text
WorkflowTemplate = 蓝图类
EnvironmentFrame = 工作目录实例
AgentSessionNode = 在环境中启动 agent
ToolNode = 稳定工具
Port/Inbox/Outbox = 数据通道
```

它更符合你的真实使用方式：

```text
我先搭一个可复用 workflow。
保存时不绑定机器路径。
使用时指定工作目录。
Agent 节点自然使用该目录的配置。
输入输出通过 inbox/outbox 明确传递。
```

## 8. 这次目标

这次 goal 的目标是让 Codex 实现：

```text
1. WorkflowTemplate / EnvironmentFrame 数据模型
2. AgentSessionNode cwd 继承父 workflow 工作目录
3. Stateless workflow 保存和复用
4. Stateful workflow runtime binding
5. Inbox / Outbox / ArtifactBundle 数据通道
6. Workflow input/output port
7. 有状态 workflow 嵌套限制
8. BehaviorPack overlay / workspace-native 配置策略
9. UI 和 CLI 都能看到 workflow 环境和端口
10. 完整测试和回归验证
```

一句话：

> 让 ACC 的 workflow 真正像“带工作目录的 Agent 蓝图”，而不是一堆平铺的节点。
