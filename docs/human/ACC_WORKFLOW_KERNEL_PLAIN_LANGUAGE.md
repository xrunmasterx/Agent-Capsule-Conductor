# 给人看的说明：这次为什么要升级 ACC Workflow Kernel

## 一句话结论

这次升级的目标是：**让 ACC 不只是“能跑一个 Capsule”，而是能可靠地调度很多 Capsule，并且每个 Capsule 可以是一个已经搭好的 Agent Workflow。**

换成大白话：

```text
你已经有很多成熟的小队：
  Codex 工作流、Claude 工作流、Cursor 工作流、Hermes 工作流、ACC 子工作流。

ACC 要做的不是重新训练这些小队，
而是把它们包装成统一节点，
再用一套清晰的流程系统安排：
  谁先干、谁并行干、谁等谁、谁失败后怎么办、产物交给谁。
```

---

## 1. 现在为什么还不够

你现在的 ACC 已经能运行单个 Capsule，也能保存输入、输出、日志和 artifact。

但当你真正开始用它做复杂工作流时，会出现这些问题：

```text
1. 多个 Capsule 谁先执行？
2. 哪些 Capsule 可以同时执行？
3. 某个节点失败后，是整个流程停止，还是继续？
4. 下游节点到底用上游哪个 output 或 artifact？
5. 我已经做好的 Codex / Claude / Hermes 工作流，能不能直接塞进 Capsule？
6. ACC workflow 本身能不能作为一个 Capsule，被更大的 workflow 调用？
7. UI 怎么实时看到每个节点正在发生什么？
```

之前的 ACC 更像：

```text
标准节点执行器
```

这次要升级成：

```text
轻量工作流编排内核 + 可复用 Workflow Capsule 系统
```

---

## 2. 这次设计的核心思想

核心思想是四句话：

```text
1. Capsule 是可复用节点。
2. Capsule 内部可以是完整 Agent Workflow。
3. Workflow Kernel 负责调度多个 Capsule。
4. 所有过程都要有事件和产物，方便人检查和优化。
```

---

## 3. 用 C++ / 游戏引擎类比

你可以把它理解成：

```cpp
class CapsuleTemplate {
    Runtime runtime;       // Codex / Claude / Hermes / ACC subworkflow
    Skills skills;         // 已配置好的技能
    Hooks hooks;           // 生命周期 hook
    Permissions perms;     // 权限
    Schema input;          // 输入格式
    Schema output;         // 输出格式
};

class CapsuleSession {
    CapsuleTemplate* template;
    Workspace workspace;
    Artifacts artifacts;
    EventLog events;
};

class WorkflowKernel {
    Graph graph;
    Scheduler scheduler;
    FailurePolicy failurePolicy;
};
```

类比游戏引擎：

```text
CapsuleTemplate = 类 / Blueprint Class / Render Pass 定义
CapsuleSession = 运行时实例 / Blueprint Instance / 某次 Pass 执行
WorkflowGraph = TaskGraph / RenderGraph
WorkflowKernel = 调度器
Artifact = 中间资源 / 运行报告 / RenderDoc capture
EventLog = profiler timeline / execution trace
```

---

## 4. Capsule 要升级成什么

之前 Capsule 更像：

```text
运行一次 Codex 或 Claude
```

现在 Capsule 要支持五种类型：

```text
atomic
agent_session
agent_workflow
acc_workflow
external_workflow
```

### 4.1 atomic

最简单的脚本节点。

例如：

```text
Python 脚本
Shell 命令
JSON 转换
跑测试
解析日志
```

### 4.2 agent_session

一次成熟 Agent session。

例如：

```text
codex exec
claude agent sdk
cursor cli
hermes cli
```

### 4.3 agent_workflow

一个你已经配置好的 Agent 工作流。

例如：

```text
一个 Codex 工作流目录：
  AGENTS.md
  skills/
  hooks/
  prompts/
  scripts/

一个 Claude Code 工作流目录：
  CLAUDE.md
  .claude/skills/
  hooks/
  subagents/
```

它的意义是：

```text
你不用为了接入 ACC 而放弃原来搭好的 Agent 工作流。
ACC 只需要把它包装成 Capsule。
```

### 4.4 acc_workflow

一个 ACC 工作流本身也可以变成一个 Capsule。

也就是“套娃”：

```text
一个小 ACC workflow
  -> 包成 Capsule
  -> 放进更大的 ACC workflow
```

这对复用非常重要。

例如你有一个固定的“五 Agent 架构分析流程”：

```text
调研 -> 源码现实检查 -> 批判性 review -> 方案生成 -> 人工 gate
```

未来可以直接把它当一个节点用。

### 4.5 external_workflow

封装外部 workflow 系统。

例如：

```text
Microsoft Conductor workflow
n8n workflow
Hermes workflow
其他外部编排系统
```

ACC 不需要吞掉所有系统，而是把它们接进来。

---

## 5. Workflow Kernel 要解决什么

Workflow Kernel 不是要变成一个巨大的 Conductor 复刻版。

它只需要先解决 ACC 自己最刚需的编排问题：

```text
1. DAG 拓扑排序
2. 同一层节点并行执行
3. 节点失败策略
4. 节点重试和超时
5. 上游 artifact 显式传给下游
6. workflow run manifest
7. workflow events
8. 子工作流 capsule
```

### 5.1 串行和并行

以前可能是：

```text
A -> B -> C 逐个执行
```

但真实 workflow 经常是：

```text
        PaperAgent1
       /
Input -> PaperAgent2 -> Merge -> Review -> Final
       \
        BlogAgent1
```

所以 Workflow Kernel 要能识别：

```text
PaperAgent1、PaperAgent2、BlogAgent1 可以并行跑。
Merge 必须等它们全部完成。
```

### 5.2 失败策略

节点失败后不能只有一种行为。

至少要支持：

```text
fail_fast：一个失败，整个 workflow 停止
continue_on_error：失败也继续跑后续可运行节点
all_or_nothing：并行组里有一个失败，整组失败
manual_review：失败后进入人工检查
```

### 5.3 数据边和控制边

图里的边不应该只表示“连起来”。

它应该分清楚：

```text
control edge：谁先执行谁后执行
data edge：上游哪个 output/artifact 传给下游哪个 input
```

类比 RenderGraph：

```text
control dependency：pass 顺序
data dependency：资源依赖
```

这样复杂 workflow 才不会乱。

---

## 6. 为什么要做事件系统

现在 ACC 已经有很多文件：

```text
input.json
output.json
events.jsonl
artifacts/
run_summary.json
```

但 UI 如果只是读文件夹，很难实时知道：

```text
节点是否已经开始？
Prompt 是否已经渲染？
Workspace 是否准备好？
Adapter 是否正在输出？
Output 是否已经校验？
Artifact 是否缺失？
```

所以要加入统一事件：

```text
workflow_started
node_scheduled
node_started
session_started
prompt_rendered
workspace_prepared
adapter_started
adapter_event
output_validated
artifact_validated
node_completed
node_failed
workflow_completed
```

这样 UI 可以像 profiler timeline 一样实时显示状态。

---

## 7. Conductor 还要不要参考

要参考，但不照搬。

Conductor 值得参考的是：

```text
1. 确定性 workflow 语义
2. 并发和失败策略
3. event log 和 dashboard/replay 思路
4. strong validation
5. human gate / resume 思路
```

但 ACC 不应该复制：

```text
1. Conductor 完整 YAML DSL
2. Provider-owned agent execution
3. 远程 registry
4. WebDashboard 逻辑塞进 core
5. 复杂 dialog evaluator
```

ACC 的优势是：

```text
边界更轻
本地优先
Artifact-first
默认测试 hermetic
可以封装成熟外部 Agent 和已有 Agent Workflow
```

所以最终关系是：

```text
ACC Graph / Workbench
  -> 人类编辑和观察 workflow

ACC Workflow Kernel
  -> 本地轻量调度

ACC Capsule Runtime
  -> 执行每个 capsule

Conductor Bridge
  -> 导出到 Conductor YAML，接入更严肃的 workflow backend
```

---

## 8. 最终系统会变成什么

最终 ACC 应该是：

```text
可视化、可插拔、可嵌套的 Agent Workflow 编排工具。
```

它允许你：

```text
1. 把已有 Codex / Claude / Hermes 工作流封装成 Capsule。
2. 在图上把这些 Capsule 连起来。
3. 设置执行顺序、并行、失败策略、人工 gate。
4. 运行 workflow。
5. 查看每个 Capsule 的中间过程和最终产物。
6. 让更上层 Codex 调用 ACC workflow。
7. 让 Codex 提议修改 workflow，但必须 validate / dry-run / human approve。
```

---

## 9. 一句话总结

这次升级不是为了做花哨 UI，也不是为了复制 Conductor。

它是为了把 ACC 从：

```text
能跑单个 Capsule 的执行器
```

升级成：

```text
能编排多个 Agent Workflow Capsule 的轻量工作流内核。
```

最终目标是：

```text
你已有的任何 Agent 工作流，都能无感封装成 Capsule；
ACC 能调度它们；
人能看见全过程；
更上层 Agent 能安全调用和复用它们。
```
