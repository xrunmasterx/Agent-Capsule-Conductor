# ACC 理想分层重构：大白话说明

状态：历史设计说明。本文保留分层重构的设计动机，但其中的 `WorkflowTemplate`、`NodeSpec`、
`EnvironmentFrame` 是旧阶段术语；当前产品合同使用 Core v2 callable-only 术语：
`WorkflowFunctionTemplate`、`NodeInvocationSpec`、`FunctionInvocation`、`ScopeFrame` 和
`SessionInstance`。

## 一句话

这次不是加功能，而是把 ACC 的核心内核拆成真正清晰的几层，避免一个 `acc.clean_workflow.py` 同时管读文件、校验图、调度节点、执行节点、写产物、管权限。

## 为什么要做

现在的 Clean Core 已经证明关键机制是对的：

- Workflow 模板不带本地 workspace。
- 运行时创建 EnvironmentFrame。
- control_edges 和 data_edges 分开。
- 上游写 outbox，下游读 inbox。
- scheduler materialize 数据。
- retry 不污染上次失败产物。
- node 有自己的 events.jsonl。

但这些职责目前仍可能集中在一个轻量整合模块里。这个阶段如果只跑 fake runner，问题不大；一旦接入真实 Codex、Claude、Cursor、Hermes，风险会显著上升。

真实 Agent 可能：

- 继承宿主机环境变量。
- 读写用户 workspace。
- 调 shell。
- 访问网络。
- 把 secret 写进 log 或 artifact。

所以接真实 Agent 之前，必须把分层和权限契约变硬。

## 新分层怎么理解

### 1. `acc.domain`

只放概念，不做 IO。

像 C++ 里的 struct / value object：

```text
WorkflowTemplate
EnvironmentBinding
EnvironmentFrame
NodeSpec
PortContract
ArtifactBundle
PermissionProfile
```

它不知道 CLI、文件系统、subprocess、UI。

### 2. `acc.engine`

只管图和调度。

它回答：

```text
图是否合法？
谁先跑？
谁能并发？
data edge 是否来自 control 上游？
failure_mode 怎么处理？
retry / timeout 怎么计划？
```

它不写文件，也不启动 Codex。

### 3. `acc.store`

只管落盘。

它负责：

```text
run_manifest.json
workflow_events.jsonl
nodes/<node_id>/events.jsonl
inbox/outbox
artifact_bundle.json
```

它不决定调度，也不执行 Agent。

### 4. `acc.runtime`

只管执行节点。

例如：

```text
FakeNodeRunner
ToolNodeRunner
AgentNodeRunner
WorkflowNodeRunner
```

它需要遵守权限、环境变量白名单、workspace_access 声明。

### 5. `acc.app`

应用服务层，把 engine、runtime、store 串起来。

它像游戏引擎里的 subsystem coordinator。

### 6. `acc.cli`

只解析命令行参数，然后调用 app。

CLI 不能倒灌进 engine/domain。

## 最核心的设计原则

```text
domain 不知道任何外部世界。
engine 不碰文件、不跑进程。
runtime 不改图语义。
store 不知道 CLI/UI。
cli 只做入口。
```

## 为什么不是为了“架构洁癖”

如果只是为了文件夹好看，不值得拆。

这次拆分的真正原因是：真实 Agent 接入前，权限、env、workspace 写锁、artifact、event、subprocess 必须变成硬边界，否则系统会变脆。

## 最终判断

ACC 的核心不是 UI、数据库、云服务，也不是自研 LLM Agent。

ACC 的核心是：

```text
无状态 WorkflowTemplate
+ 运行时 EnvironmentFrame
+ 确定性 Scheduler
+ 明确 Port / Inbox / Outbox
+ 可追踪 ArtifactBundle
+ 受控 Agent Runtime
```
