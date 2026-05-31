# 主流多 Agent 编排架构调研 · 与 ACC 三方综合对比

> 一句话定位:对三套市面上的多 agent 编排/管理系统(微软 Conductor、Multica、Paperclip)做只读深度画像,并在第一性原理框架下与 ACC(Agent Capsule Conductor)横向对比,为 ACC 的架构演进提供横向参考。
> 调研对象:`F:\conductor\conductor`、`F:\Multica\multica`、`F:\paperclipai\paperclip`(均只读静态源码分析,未修改任何文件)。
> 调研性质:只读架构与用户体验研究 + 综合对比。
> 生成日期:2026-05-29

---

## 目录

- [背景与目的](#背景与目的)
- [文档导航](#文档导航)
- [一句话结论:四系统定位对比](#一句话结论四系统定位对比)
- [阅读指引](#阅读指引)

---

## 背景与目的

ACC 的核心理念是:agent 节点 = 类(无状态可复用 `ClassTemplate`)、workflow = 函数(`WorkflowFunctionTemplate`)、模板与运行时状态严格分离、把编排控制权交给人(当前为纯机械 DAG workflow)、无缝接入已配置好的成熟外部 agent、节点间数据通过显式 port/inbox/outbox/artifact 流转,并以 GraphOps 做人审治理。

为给 ACC 的下一步演进(尤其是「未来 supervisor:编排者 agent 运行时动态调用可复用 agent」与确定性编排体验)提供横向参考,本调研选取了三套定位各异的同类系统做深度画像:

- **微软 Conductor**:CLI 优先、YAML 声明式的确定性编排器(与 Netflix/Orkes Conductor 无关)。
- **Multica**:把编码 agent 当「数字员工」的 AI 原生任务管理平台(「带 AI 一等公民的 Linear」)。
- **Paperclip**:把管理 agent 建模成「经营一家公司」的自治 AI 公司控制平面。

每份单独调研均采用统一的 A–I 结构(项目定位/核心架构/可复用与组合/动态编排/用户体验/与 ACC 异同/可借鉴清单/局限/证据索引),所有论断附 `文件:行号` 证据;综合篇在此之上做第一性原理对比与可借鉴清单。

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [`01_microsoft_conductor.md`](01_microsoft_conductor.md) | 微软 Conductor 单独深度调研(A–I 全文) |
| [`02_multica.md`](02_multica.md) | Multica 单独深度调研(A–I 全文) |
| [`03_paperclip.md`](03_paperclip.md) | Paperclip 单独深度调研(A–I 全文) |
| [`04_synthesis_vs_acc.md`](04_synthesis_vs_acc.md) | 三方综合对比与可借鉴清单(第一性原理对比 + 借鉴/不借鉴 + 路线图建议) |

---

## 一句话结论:四系统定位对比

| 系统 | 真实身份 / 技术栈(一句话) | 控制流形态 | 谁决定下一步 | 与 ACC 的关系定位 | 最值得借鉴的 1–2 点 |
|---|---|---|---|---|---|
| **ACC**(对比基准) | 面向对象的工作流编排系统(agent=类、workflow=函数),本地优先 | 静态 DAG(人固定流程) | **人** | —(基准) | —(待吸收方) |
| **Conductor(微软)** | `conductor-cli`:Python + Typer + Pydantic 的 CLI/库,YAML 声明式编排,进程内单机执行 | 静态 DAG + 运行时数据驱动展开(for-each / conditional),明确「编排环不放 LLM」 | **人**(YAML 首匹配路由) | **同源兄弟**:与 ACC 当前确定性、人定流程形态高度同源 | ① 运行前强校验 + `--dry-run` 执行计划;② 进程内零配置实时仪表盘(DAG 可视化 + 浏览器内 human gate) |
| **Multica** | AI 原生任务管理平台:Next.js + Go(Chi/WS)+ PostgreSQL/pgvector + 本地 daemon,统一 `Backend` 封装 12+ 外部 CLI agent | 事件驱动黑板(issue 评论)+ `@mention` 路由,无 DAG | **LLM**(Squad Leader 运行时推理) | **未来镜像**:已跑通 ACC 规划中的 supervisor 形态 | ① Squad-Leader 三件套(协议注入 + roster + `@mention` 路由)= supervisor 现成范式;② 统一 `Backend` 外部 agent 适配契约 + 决策审计强制化 |
| **Paperclip** | 自治 AI 公司控制平面:Node.js(Express)+ React + 嵌入式 Postgres + Drizzle,「公司/雇员/工单/心跳」模型 | 组织树委派 + 工单 + 心跳,刻意「Not a workflow builder」(无 DAG 画布) | **LLM**(上级 agent 在心跳里委派) | **反面参照**:编排范式不该抄,但工程资产最成熟 | ① 统一 wakeup 协调器 + 活性/恢复契约 + 运行时无关 adapter 协议 `agent-run/v1`;② 渐进式披露 + output-first 的 Run 视图、human-in-the-loop 交互原语、「导结构不导状态」复用包 |

---

## 阅读指引

- 只关心「ACC 该往哪走」的读者:直接读 [`04_synthesis_vs_acc.md`](04_synthesis_vs_acc.md),它给出第一性原理四问对比、ACC 三条护城河、可借鉴清单(架构 A1–A5 / UX B1–B5,各含证据与适配建议)、明确不借鉴的 5 条,以及承接 P0 的路线图建议。
- 关心「人掌控的确定性编排」主线:重点读 [`01_microsoft_conductor.md`](01_microsoft_conductor.md)。
- 关心「未来 supervisor 动态调用可复用 agent」主线:重点读 [`02_multica.md`](02_multica.md) 的 D 节(Squad-Leader)。
- 关心调度收敛、活性/恢复、可观测 UI、人审原语、复用包等横切工程范本:读 [`03_paperclip.md`](03_paperclip.md)。
- 每份单独调研末尾的「I. 关键证据索引」给出全部 `文件:行号` 出处,便于回溯核对;凡引用外部仓库代码处,均以普通代码块 + 文字标注路径行号呈现(非本仓代码)。
