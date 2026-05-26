# ACC Clean Core Refactor：大白话说明

## 一句话说明

这次不是继续堆功能，而是把 ACC 的核心重构成一套更干净、更轻量、更结实的编排内核。

最终目标是：

```text
你可以把一个已经配置好的项目目录当作环境，
在里面放多个 Codex / Claude / Cursor / Hermes Agent 节点，
像 UE 蓝图一样连起来，
每个节点都像在这个目录里手动开一个 Agent CLI，
节点之间通过明确的输入/输出文件夹传数据，
整个 workflow 可以保存成无状态模板，下次换工作目录继续复用。
```

---

## 现在的问题是什么

之前的 ACC 已经做了很多东西：Capsule、Workflow、Graph、UI、Debugger、Kernel、GraphOps 等。

但如果一直补丁式往上加，系统会变得越来越乱：

```text
Capsule 到底是节点，还是 workflow，还是环境？
Workflow 到底是图，还是工作目录？
Agent 节点到底是一次 session，还是一个工作流？
输入输出到底是执行依赖，还是数据传递？
上游节点能不能直接写下游目录？
无状态 workflow 没有工作目录时到底在哪运行？
```

这些问题不解决，后面 UI 再漂亮也会不稳。

---

## 这次的新核心模型

这次把概念拆干净：

```text
WorkflowTemplate
  可保存、可复用、无状态的蓝图。

EnvironmentFrame
  运行时绑定的工作目录。可以是临时目录，也可以是用户指定项目目录。

Node
  工作流里的一个节点。可以是 Agent 节点、Tool 节点、子 Workflow 节点。

AgentSessionNode
  在 EnvironmentFrame 的工作目录里启动 Codex / Claude / Cursor / Hermes。

ToolNode
  执行 Python / Shell / if / for_each / merge / wait 等确定性逻辑。

Port
  节点的输入输出口。

Inbox / Outbox
  节点之间传文件和 artifact 的标准通道。

ArtifactBundle
  一个节点运行完后产生的结构化产物包。
```

一句话：

```text
Workflow 是蓝图，Environment 是运行环境，Agent 是环境里的 session，Port/Inbox/Outbox 是节点之间的数据接口。
```

---

## 为什么 workflow 保存时应该是无状态的

如果一个 workflow 保存时带着：

```text
F:\MyProject
/Users/me/project
```

它就不能复用，不能分享，不能跨项目。

所以正确做法是：

```text
workflow.accflow.json
  只保存图、节点、端口、连接、prompt、固定配置。

workflow.binding.local.json
  保存本机路径、工作目录绑定。这个文件应该 gitignore。
```

这样一个 workflow 模板可以复用到不同项目目录里。

---

## 为什么无状态 workflow 不能默认跑在 ACC 安装目录

这是一个重要修正。

不能让无状态 workflow 默认在 ACC 安装目录运行，因为这样会污染工具本身。

正确做法是：

```text
没有绑定工作目录时，创建 run 级临时 workspace：

runs/<run_id>/environments/<env_id>/workspace/
```

这样每次运行都是干净的。

---

## 为什么上游不能直接写下游目录

比如 A 节点输出给 B 节点，不能让 A 直接写到 B 的目录里。

否则会出现：

```text
并发冲突
污染下游目录
不知道文件是谁写的
调试困难
回放困难
```

正确做法：

```text
A 写自己的 outbox。
调度器把 A 的 outbox 复制/链接/引用到 B 的 inbox。
B 只读自己的 inbox。
```

也就是：

```text
A/.acc/outbox/main/
    ↓ scheduler materialize
B/.acc/inbox/from_A/main/
```

这样数据边界清楚。

---

## Agent 节点应该是什么体验

如果你把 workflow 绑定到：

```text
F:\Agent-Capsule-Conductor
```

然后在 workflow 里创建 3 个 agent 节点，那么它应该就像你手动打开 3 个 cmd：

```text
cd F:\Agent-Capsule-Conductor
codex ...
claude ...
cursor ...
```

这些 Agent 会自然使用这个目录里的：

```text
AGENTS.md
CLAUDE.md
skills/
hooks/
rules/
local scripts
```

这就是 ACC 的价值：不打断你已有的 Agent 使用习惯，只把它标准化、可视化、可编排。

---

## 这次重构的结束边界

这次不是做完整 SaaS，不是做新 LLM Agent，也不是复制 Conductor。

这次只做核心：

```text
1. 干净领域模型
2. 无状态 workflow template
3. workspace binding
4. environment frame
5. control edge / data edge
6. inbox / outbox
7. artifact bundle
8. deterministic scheduler
9. agent node inherited cwd
10. tests and acceptance
```

完成后，ACC 才真正有一个长期可扩展的内核。
