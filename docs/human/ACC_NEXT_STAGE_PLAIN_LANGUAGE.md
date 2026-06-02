# ACC 下一阶段大白话说明

状态：历史路线说明。本文保留当时对 Debugger、Workflow Adapter、Control Plane 和 Browser E2E 的
阶段拆解，但其中 `Capsule`、`Workflow Capsule`、`list_capsules` 等说法不是当前 Core v2
callable-only 运行时术语。当前可复用资产应优先理解为 Agent/Tool class template 和
WorkflowFunctionTemplate。

## 一句话结论

现在 ACC 已经能跑、能编排、能画图，下一步要把它变成真正“用得舒服”的系统：**能调试、能复用已有 Agent 工作流、能被更上层 Agent 调用，并且能通过浏览器真实操作验证体验。**

---

## 1. 现在的问题是什么

你现在已经不是从 0 到 1 的阶段。

底层已经有：

```text
Capsule
acc run
Artifact
Workflow Graph
Workflow Kernel
Graph Workbench
```

但真正用起来会遇到新问题：

```text
1. 节点失败了，我怎么快速知道哪里错了？
2. 我能不能只重跑某个节点，而不是重跑整个 workflow？
3. 我已经做好的 Codex / Claude / Hermes 工作流，能不能直接变成一个 Capsule？
4. ACC workflow 能不能自己作为一个 Capsule，被更大的 workflow 调用？
5. Codex 能不能像调用工具一样调用 ACC workflow？
6. UI 是否真的好用？我能不能在浏览器里用鼠标和键盘真实验证？
```

这就是下一阶段要解决的问题。

---

## 2. 设计哲学

### 2.1 不重写 Agent

ACC 不应该变成新的 Claude Code、Codex 或 Hermes。

成熟 Agent 已经很强，ACC 的任务是：

```text
把它们封装成 Capsule，
把多个 Capsule 编排起来，
把过程和结果完整展示出来。
```

### 2.2 不重写底层 Runtime

已有的 `acc run` 是系统地基。

下一阶段不能破坏：

```text
stdout JSON contract
artifact store
schema validation
adapter boundary
hermetic tests
```

### 2.3 Workflow 是资产

一个 workflow 不只是一次运行。

它应该能：

```text
保存
复用
嵌套
调试
被 Agent 调用
被人优化
```

### 2.4 人是最终决策者，Agent 是副驾驶

Codex 可以：

```text
调用 ACC
读取结果
提出修改建议
生成 graph patch
运行 dry-run
```

但不应该默认：

```text
删除 human gate
开启危险权限
直接 apply 结构性修改
```

---

## 3. 下一阶段分成四个目标

## Goal 1：Workflow Debugger & Replay

解决：

```text
我怎么调试 workflow？
我怎么重跑某个节点？
我怎么从某个节点 fork？
我怎么比较两次运行？
```

要做：

```text
run replay
node rerun
rerun from node
fork run
run diff
artifact diff
prompt diff
event replay
```

大白话：

```text
像 RenderDoc 一样，不只是看最终画面，而是能看到每个 pass，能重跑 pass，能比较两帧差异。
```

---

## Goal 2：Workflow Capsule & Agent Workflow Adapter

解决：

```text
我已经做好的 Codex / Claude / Hermes 工作流，怎么无感接入 ACC？
ACC 子工作流能不能变成一个 Capsule？
Conductor 或其他外部 workflow 能不能也变成 Capsule？
```

要做：

```text
kind=agent_workflow
kind=acc_workflow
kind=external_workflow
behavior_pack
lifecycle setup/run/collect/cleanup
materialized template snapshot
nested workflow capsule
```

大白话：

```text
不是为了接入 ACC 重新写工作流，而是把你已有的工作流包成一个节点。
```

---

## Goal 3：Agent-callable ACC Control Plane

解决：

```text
Codex 能不能调用 ACC？
Claude 能不能调用 ACC？
上层 Agent 能不能 list capsules、run workflow、inspect run、get artifact？
```

要做：

```text
稳定 JSON CLI
可选 MCP server
control API
list_capsules
describe_capsule
run_workflow
inspect_run
get_artifact
propose_patch
validate_patch
dry_run_patch
```

大白话：

```text
ACC 不只是给人点按钮用，也要能被更高层 Agent 当工具调用。
```

---

## Goal 4：Browser E2E UX Optimization

解决：

```text
UI 到底好不好用？
能不能用鼠标键盘真实跑通？
中文界面是否完整？
节点连接、运行、查看输出是否顺手？
```

要做：

```text
浏览器自动化测试
中文 UI 检查
创建 Capsule journey
连接节点 journey
运行 workflow journey
并行 workflow inspection journey
artifact viewer journey
console/network error 检查
问题修复循环
```

大白话：

```text
让 Codex 像真实用户一样打开浏览器，点按钮、拖节点、连边、运行、看结果，发现问题就修。
```

---

## 4. 为什么要按这个顺序

顺序是：

```text
Debugger -> Workflow Capsule -> Agent Control Plane -> Browser E2E
```

原因：

```text
1. 先能调试，复杂 workflow 才能修。
2. 再能封装已有 Agent workflow，资产才能复用。
3. 再让上层 Agent 调用 ACC，系统才能套娃。
4. 最后用浏览器 E2E 真实验证体验，发现并修复 UX 问题。
```

如果先做 UI，就会变成：

```text
表面能点，内部不好调。
```

---

## 5. 完成后的系统应该是什么样

最终你应该能这样使用：

```text
1. 打开浏览器 Workbench。
2. 新建或导入一个已有 Codex workflow capsule。
3. 把它拖到图里。
4. 再拖一个 Claude review capsule。
5. 连线。
6. 运行。
7. 节点实时变色。
8. 点击任意节点查看 input / prompt / output / artifact / events。
9. 某个节点失败，只重跑这个节点或从这个节点 fork。
10. 让 Codex 调用 ACC workflow，查看结果并提出优化 patch。
11. 人审查 patch 后再 apply。
```

一句话：

```text
ACC 变成一个可视化、可复用、可调试、可被 Agent 调用的 Agent Workflow 操作系统雏形。
```
