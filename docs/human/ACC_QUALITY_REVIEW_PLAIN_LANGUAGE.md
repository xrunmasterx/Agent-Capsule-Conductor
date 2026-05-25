# ACC 质量审计与加固：大白话说明

## 这次不是继续加功能

前面几轮已经让 ACC 有了很多能力：

- 能跑 Capsule；
- 能保存 artifact；
- 能做 workflow graph；
- 能做可视化工作台；
- 能做 workflow kernel；
- 能做 debugger / replay；
- 能让上层 Agent 调用；
- 能做浏览器 E2E 测试。

现在最大的风险不是“功能不够”，而是：

```text
功能越来越多，系统开始变重、变乱、变脆。
```

所以这次目标不是继续堆功能，而是做一次系统级体检和加固。

---

## 这次要解决什么问题

核心问题有 7 个：

1. **架构是否还干净？**
   - ACC 是否仍然是轻量编排框架？
   - 有没有开始变成 Dify / LangGraph / Conductor 的重复实现？

2. **核心契约是否还稳定？**
   - `acc run --emit-conductor-json` 是否仍然只输出一个 JSON？
   - 默认测试是否仍然 hermetic？
   - 旧的 capsule / workflow 是否仍然能跑？

3. **代码是否臃肿？**
   - 是否有重复逻辑？
   - 是否有过度抽象？
   - 是否有一堆没有必要的 manager / service / adapter？

4. **算法是否简单高效？**
   - 图校验是否是 O(V+E)？
   - 拓扑排序是否是 O(V+E)？
   - event replay 是否能流式处理？
   - 是否把大 artifact 全部读进内存？

5. **安全是否足够保守？**
   - 有没有路径穿越？
   - 有没有危险 shell 注入？
   - 有没有 stdout 泄漏 token？
   - 有没有 `danger-full-access` 默认开启？

6. **UI 是否真的可用？**
   - 中文是否完整？
   - 节点是否能拖拽和连线？
   - 浏览器是否能真实跑 demo？
   - 失败后用户是否知道哪里错了？

7. **Codex 是否能通过证据证明完成？**
   - 不是口头说“完成了”；
   - 必须有测试、浏览器报告、截图、日志、审计报告。

---

## 这次的设计哲学

### 1. 先审计，再修复

Codex 不能一上来就改代码。

正确流程是：

```text
读代码
读旧文档
跑测试
跑浏览器 E2E
生成 FINDINGS.md
按优先级修复
补测试
回归验证
生成最终审计报告
```

---

### 2. 轻量优先

ACC 的优势是轻量、可插拔、可嵌套。

所以优化方向不是：

```text
加更多框架
加更多数据库
加更多复杂 DSL
加更多服务层
```

而是：

```text
删掉重复代码
收敛概念
简化 API
减少依赖
保持本地优先
保持文件系统 artifact-first
```

---

### 3. 性能优化必须有证据

不能为了“感觉更快”乱改。

必须说明：

```text
当前复杂度是什么
瓶颈在哪里
改完复杂度是什么
benchmark 或测试结果是什么
```

例如：

```text
图校验：O(V+E)
拓扑层级计算：O(V+E)
事件回放：streaming，不一次性加载所有 events
artifact viewer：大文件分页或截断预览
```

---

### 4. 修 bug 必须有回归测试

如果发现：

```text
stdout 混日志
schema validation 漏洞
path traversal
graph cycle 没检测
parallel runner 失败聚合错
```

修完以后必须补测试。

---

### 5. 浏览器体验必须真实点击验证

如果有 UI，不能只说 npm build 通过。

Codex 必须像真实用户一样：

```text
打开页面
点击创建 Capsule
拖节点
连线
保存 workflow
运行 workflow
查看 artifact
打开并行 demo
检查错误信息
```

并生成：

```text
browser_e2e_report.json
screenshots/
console.log
network.log
```

---

## 最终完成是什么样

这次 goal 完成后，你应该得到：

```text
1. 一份完整质量审计报告。
2. 所有 critical/high 问题已修复或明确说明为什么暂缓。
3. 所有旧 acceptance 仍然通过。
4. 新的质量验收通过。
5. 浏览器 E2E 有证据。
6. 性能热点有 benchmark 或复杂度说明。
7. 安全边界有测试。
8. 代码比之前更清晰，而不是更复杂。
```

一句话：

> 这次不是让 Codex 继续“造功能”，而是让 Codex 像资深工程师一样，对 ACC 做架构审计、质量加固、性能瘦身和真实用户体验验证。
