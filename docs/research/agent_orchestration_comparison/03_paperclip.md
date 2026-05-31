# Paperclip 深度架构与用户体验研究报告

> 研究对象:`F:\paperclipai\paperclip`(只读,未修改任何文件)。
> 性质:开源、可自托管的"自治 AI 公司控制平面"产品。所有论断均附代码/文档证据。
> 调研性质:只读静态分析,未修改任何文件。
> 生成日期:2026-05-29
> 相关文档:[返回索引 README](README.md) · [Conductor 调研](01_microsoft_conductor.md) · [Multica 调研](02_multica.md) · [三方综合对比](04_synthesis_vs_acc.md)

---

## 目录

- [A. 项目定位与技术栈](#a-项目定位与技术栈)
- [B. 核心架构](#b-核心架构)
  - [B1. Agent 如何建模](#b1-agent-如何建模)
  - [B2. 协作/编排模型:组织委派 + 工单 + 心跳,而非 DAG](#b2-协作编排模型组织委派--工单--心跳而非-dag)
  - [B3. 是否有中心编排者?如何决策?](#b3-是否有中心编排者如何决策)
  - [B4. 状态/上下文/记忆/会话与持久化](#b4-状态上下文记忆会话与持久化)
  - [B5. 前后端分工](#b5-前后端分工)
  - [B6. 执行调度:并行 / 流式 / human-in-the-loop](#b6-执行调度并行--流式--human-in-the-loop)
- [C. 可复用与组合模型](#c-可复用与组合模型)
- [D. 动态 / 智能编排能力](#d-动态--智能编排能力)
- [E. 用户体验设计(重点)](#e-用户体验设计重点)
  - [E1. 创建/配置/运行的流程](#e1-创建配置运行的流程)
  - [E2. 可视化与信息架构(具体布局)](#e2-可视化与信息架构具体布局)
  - [E3. 可观测性与调试](#e3-可观测性与调试)
  - [E4. 人审/干预交互](#e4-人审干预交互)
  - [E5. 上手成本 / 模板市场 / 协作](#e5-上手成本--模板市场--协作)
  - [E6. 做得好的 UX 细节(让普通用户也能编排)](#e6-做得好的-ux-细节让普通用户也能编排)
- [F. 与 ACC 理念的异同点(逐条)](#f-与-acc-理念的异同点逐条)
- [G. 最值得借鉴清单](#g-最值得借鉴清单)
  - [架构类](#架构类)
  - [UX 类](#ux-类)
- [H. 局限 / 不适用之处](#h-局限--不适用之处)
- [I. 关键证据索引(文件:行号)](#i-关键证据索引文件行号)

---

## A. 项目定位与技术栈
一句话定位:Paperclip 把"管理一群 AI agent 干活"建模成经营一家公司——而不是搭一条工作流。口号 "If OpenClaw is an employee, Paperclip is the company"(`README.md:32`),并明确定义为 control plane for autonomous AI companies(`doc/PRODUCT.md:5`、`doc/GOAL.md:9`)。

关键证据:
- 性质:开源 MIT、自托管 Node.js 服务 + React UI,自带嵌入式 Postgres,`npx paperclipai onboard` 一键启动(`README.md:30-34`、`README.md:283-306`)。
- 技术栈(monorepo,pnpm workspace):`server/`(Express REST + 编排服务)、`ui/`(React + Vite 看板)、`packages/db`(Drizzle schema/迁移)、`packages/shared`、`packages/adapters/*`、`packages/plugins`、`packages/mcp-server`(`AGENTS.md:23-32`、`pnpm-workspace.yaml:1-14`)。
- 运行形态:本地单进程 + 嵌入 Postgres(local-first),可指向自有 Postgres 做生产部署;两种部署模式 `local_trusted` / `authenticated`(`doc/PRODUCT.md:89-94`)。Roadmap 才有 Desktop App / Cloud(`README.md:367-378`)。
- 面向用户:"有 20 个 Claude Code 终端、想让 agent 7×24 自治运行但仍要审计和控成本"的个人创业者/小团队(`README.md:67-76`)。
- 解决的问题:agent 任务追踪丢失、上下文手工搬运、成本失控、协调/治理缺失(`README.md:128-137`)。

重要边界:README 用一整张表声明 "What Paperclip is not":不是 chatbot、不是 agent 框架、不是 workflow builder(明确"No drag-and-drop pipelines")、不是 prompt 管理器、不是单 agent 工具、不是 code review 工具(`README.md:266-275`)。已用 grep 确认 `ui/src` 内没有 `react-flow / @xyflow / dagre` 等 DAG 画布依赖,印证"非工作流编排"的定位。

## B. 核心架构

### B1. Agent 如何建模
Agent = 公司里的一名雇员,是一条公司作用域的具体记录(不是无状态模板)。`agents` 表字段(`packages/db/src/schema/agents.ts:14-45`):组织属性 `role`、`title`、`reportsTo`(自引用,构成 org chart 边)、`capabilities`;行为定义 `adapterType` + `adapterConfig`(jsonb:cwd、promptTemplate、CLI flags 等)、`runtimeConfig`(心跳调度策略);运行态直接挂在同一行:`status`、`lastHeartbeatAt`、`spentMonthlyCents`、`pauseReason/pausedAt`、`budgetMonthlyCents`、`permissions`。

"Adapter config 定义 agent"是核心原则——Paperclip 不规定 agent 内部格式,adapter 才是边界(`doc/PRODUCT.md:25`、`63-67`)。内置 adapter 10 个:`claude-local / codex-local / cursor-local / cursor-cloud / gemini-local / grok-local / opencode-local / pi-local / acpx-local / openclaw-gateway`(`packages/adapters/`),并支持运行时注册任意字符串类型的外部 adapter 插件(`packages/shared/src/adapter-type.ts:4-9`)。

Adapter 协议 `agent-run/v1` 是运行时无关的统一契约:`invoke(input, hooks, signal)`,输入含 `cwd/prompt/adapterConfig/runtimeState/env/timeoutSec`,输出 `outcome/sessionId/usage/costUsd/runtimeStatePatch`,能力位 `resumableSession/statusUpdates/logStreaming/tokenUsage`(`doc/spec/agent-runs.md:115-178`)。

### B2. 协作/编排模型:组织委派 + 工单 + 心跳,而非 DAG
不存在"全局工作流图"。编排发生在三个层面:
1. 结构层 = 组织树:CEO→CTO→工程师(`doc/PRODUCT.md:21-31`)。
2. 工作层 = 工单(issues):层级化任务,每个 task 都能沿 parent 链追溯到公司目标(`doc/PRODUCT.md:44-57`)。关键区分两种关系:`parentId`(结构/工作分解)与 `blockedByIssueIds`(依赖/等待),且明确"不要把 parent/child 当依赖"(`doc/execution-semantics.md:124-153`)。
3. 执行层 = 心跳(heartbeats):agent 不常驻,按 wakeup 触发短执行窗口(`doc/spec/agents-runtime.md:9-19`)。

### B3. 是否有中心编排者?如何决策?
没有"中心 LLM 规划器"。中心化的只有一个机械的 wakeup 协调器(单入口 `enqueueWakeup`,DB 持久化队列,每 agent 最多 1 个活跃 run,重复 wakeup 合并 coalesce,优先级 `on_demand > assignment > timer/automation`)(`doc/spec/agent-runs.md:330-403`)。

"智能"是分布式的:每个 agent 在自己的心跳里用 MCP 工具操作控制平面来分解/委派工作。Agent 可用动作面(`packages/mcp-server/src/tools.ts:226-597`)包括 `paperclipCheckoutIssue`、`paperclipCreateIssue/UpdateIssue`、`paperclipSuggestTasks`、`paperclipCreateApproval/ApprovalDecision`、`paperclipAskUserQuestions`、`paperclipRequestConfirmation`、`paperclipControlIssueWorkspaceServices` 等。任务分解与分派 = 上级 agent 在心跳里 create/assign 子 issue 给 reports;委派沿组织树上下流动(`README.md:93`)。

### B4. 状态/上下文/记忆/会话与持久化
- 模板 vs 运行态:在 agent 实体层没有严格分离(状态挂在 `agents` 行上)。真正的"结构 vs 状态"分离体现在可移植性层:导出的 company/agent 模板是"structure, not state"(`doc/CLIPHUB.md:32`)。
- 会话复用:按 `(agent, taskKey, adapterType)` 持久化可恢复 session;同一 taskKey 下次心跳复用上次会话,不同 task 各自独立(`doc/spec/agents-runtime.md:71-83`;表 `agent_task_sessions`,`doc/spec/agent-runs.md:442-458`)。
- 运行态真相:全部落在 Postgres——`heartbeat_runs`、`heartbeat_run_events`、`agent_runtime_state`、`agent_wakeup_requests`;完整日志不进 Postgres,由可插拔 `RunLogStore`(本地文件/对象存储/PG)存,只留 `logRef` + excerpt(`doc/spec/agent-runs.md:405-536`)。
- 上下文沿 goal 祖先链注入,agent 永远知道"为什么"(`README.md:151`、`doc/PRODUCT.md:48-57`)。

### B5. 前后端分工
- 后端是真相:server 编排服务 + Postgres 是运行时事实来源(`AGENTS.md:25-32`)。`server/src/services` 极厚(`heartbeat.ts` 单文件 ~372KB),含 recovery、approvals、budgets、productivity-review、issue-liveness、workspace-realization、plugin-* 等数十个服务。
- 前端是投影:React + Vite,通过 REST + WebSocket 实时订阅渲染;断线自动回退轮询(`doc/spec/agent-runs.md:587-627`、`doc/spec/agents-runtime.md:98-109`)。UI 期望"路由与 API 对齐、不静默吞错"(`AGENTS.md:152-156`)。

### B6. 执行调度:并行 / 流式 / human-in-the-loop
- 并行:多个 agent 各自心跳并行;但单 agent 串行(每 agent ≤1 活跃 run)(`doc/spec/agent-runs.md:362`)。
- 流式:adapter 通过 hooks 推 status/log/usage,WebSocket 实时推到浏览器(`doc/spec/agent-runs.md:145-150`、`610-627`)。
- 触发:4 种 wakeup——`timer / assignment / on_demand / automation`(`doc/spec/agents-runtime.md:20-28`)。
- 人审介入:approval 门、`ask_user_questions` / `request_confirmation` 交互原语、blocked 状态、watchdog 决策(snooze/continue)、预算硬停自动暂停(`doc/execution-semantics.md:242-279`、`353-376`、`README.md:147`)。

## C. 可复用与组合模型
Paperclip 不在节点级做"类/实例"分离,而在整组织级做"模板/实例"分离:
- ClipHub("下载一家公司"):把整套组织(org chart、agent 定义、adapter 配置、seed tasks、预算默认值)导出为可移植 artifact;明确"模板是 structure 而非 state——不含进行中任务、历史成本、运行态"(`doc/CLIPHUB.md:5`、`21-32`)。
- 多粒度子包:可单独发布 Agent 模板 / Team 模板(org 子树)/ Adapter 配置,并 mix 进已有公司(`doc/CLIPHUB.md:34-42`)。这是最接近 ACC"可复用 + 自由组合"的部分。
- 配置可保存/版本化:`agent_config_revisions` 表 + 治理回滚(`README.md:150`)。
- 分享协作:语义搜索、stars、fork(带血缘)、semver 版本(`doc/CLIPHUB.md:60-95`、`146-148`)。导出/导入在本仓已实现(`server/src/services/company-portability.ts`、UI `CompanyExport.tsx` / `CompanyImport.tsx`);ClipHub 注册中心本身是"独立 hosted 服务"(`doc/CLIPHUB.md:204`)——其线上实现是否在本仓内,未确认。

与 ACC 的本质差异:ACC 的复用单元是"无状态 ClassTemplate / WorkflowFunctionTemplate",运行态严格外置;Paperclip 的复用单元是"有状态雇员/组织的快照导出",日常运行时模板与实例是同一条记录,只有在 export 时才剥离状态。

## D. 动态 / 智能编排能力
- 支持运行时动态决定调用谁吗?支持,但形态与 ACC 设想的 supervisor 不同:不是一个 supervisor agent 在一张 DAG 上选节点,而是组织里的上级 agent 在自己的心跳中,通过创建/改派 issue 把工作委派给预先注册的下属 agent(`paperclipCreateIssue/UpdateIssue` 改 assignee,`packages/mcp-server/src/tools.ts:444-470`;委派沿 org chart 流动,`README.md:93`)。甚至有"CEO 创建/雇佣 agent"的设计(`doc/plans/2026-02-19-ceo-agent-creation-and-hiring.md`、`server/src/services/hire-hook.ts`),但受 approval 门控。
- 调用对象是预注册可复用,还是临时生成?主要是预注册的具体雇员。临时生成新 agent 属于"hiring",需治理审批。
- 决策是规则还是 LLM?调度本身是规则/机械(协调器、liveness 契约、恢复规则);"派给谁、分解成什么"是各 agent 自己的 LLM 判断(发生在 adapter 内部,Paperclip 不拥有这个 loop)。
- 明确不做的事:不自动改派给别的 agent、不从 `parentId` 推断依赖、不把人持有的工作当心跳执行(`doc/execution-semantics.md:449-464`)。
- 人如何干预:approval 审批、ask/confirm 交互、暂停/恢复/终止 agent、预算硬停、watchdog 决策、override 策略(`README.md:112-113`、`doc/execution-semantics.md:368-376`)。

> 对 ACC 的直接启发:Paperclip 证明了"分布式委派式动态编排"是 supervisor 之外的另一条可行路线——不需要中心规划器,只要有(1)统一 wakeup 入口、(2)清晰的所有权/活性契约、(3)org 关系做路由,就能让 agent 群自治推进且仍可治理。

## E. 用户体验设计(重点)
整体 UX 哲学(`doc/PRODUCT.md:104-153`):board/company 级抽象优先、5 分钟内看到 CEO 完成第一件真事、对话始终附着在工作对象上、渐进式披露、output-first、可观测但不崇拜日志。

### E1. 创建/配置/运行的流程
- Onboarding 向导:`OnboardingWizard.tsx`,CLI `npx paperclipai onboard`,目标"install→CEO 完成首个任务"一坐而成(`doc/PRODUCT.md:127-131`)。
- 建公司→定目标→建 CEO→定下属→设预算→Go(`doc/PRODUCT.md:73-86`、`README.md:40-44`)。
- Agent 配置:`pages/NewAgent.tsx` / `NewAgentDialog.tsx` / `components/AgentConfigForm.tsx`,含按 adapter 动态渲染的配置表单(`JsonSchemaForm.tsx`)、prompt 模板 + 可点击"pill"变量插入(`{{agent.id}}` 等,敏感变量 `credentials.*` 带警告徽章)(`doc/spec/agent-runs.md:544-579`)、心跳策略、cwd/超时/env。
- ClipHub 安装:`paperclipai install cliphub:<pub>/<slug>` 一行拉起整公司(`doc/CLIPHUB.md:86-90`)。

### E2. 可视化与信息架构(具体布局)
- 左侧 Sidebar:公司切换器(`CompanySwitcher`)、导航分区、`SidebarAgents`(带状态)、`SidebarProjects`、徽章计数;移动端 `MobileBottomNav`。
- Dashboard:MetricCard 指标卡(agents/issues/成本/待审批)+ `ActiveAgentsPanel` + 活动流 `ActivityRow`(带新事件动画)+ 图表(`RunActivityChart / IssueStatusChart / SuccessRateChart`)(`pages/Dashboard.tsx:15-70`、`DashboardLive.tsx`)。
- 看板:`KanbanBoard.tsx`(backlog/todo/in_progress/blocked/in_review/done 列,`IssueColumns.tsx` / `IssueGroupHeader`),还有 scaled kanban 设计(`doc/plans/2026-05-05-scaled-kanban-board*.md`)。
- Org Chart:`pages/OrgChart.tsx` 自研树形布局(递归 `subtreeWidth`/`layoutTree`),支持 pan/zoom/pinch、导出 SVG(`OrgChart.tsx:16-89`、`routes/org-chart-svg.ts`)——只读组织可视化,不是可编辑 DAG。
- Issue 详情(核心工作面):`pages/IssueDetail.tsx`(4000+ 行)聚合属性面板(`IssueProperties`)、聊天式评论线程(`IssueChatThread` / `CommentThread`)、运行账本(`IssueRunLedger`)、实时运行(`LiveRunWidget`)、工作区卡(`IssueWorkspaceCard`)、文档与标注(`IssueDocumentsSection` / `DocumentAnnotationLayer`)、approval/recovery/monitor 卡片。进度默认人类可读,原始 transcript 折叠在下层(`doc/PRODUCT.md:136-143`)。
- 产物展示:work products、文档、附件、预览 URL 作为一等公民(`README.md:217`、`doc/PRODUCT.md:139-140`)。

### E3. 可观测性与调试
- 渐进式披露三层:顶层人读摘要 → 中层 checklist/步骤/产物 → 底层原始日志/工具调用/transcript(`doc/PRODUCT.md:136-137`)。
- Run transcript:`components/transcript/` + `RunTranscriptView`,fork 还加了 stderr/tool 折叠分组(`AGENTS.md:204-208`)。
- 实时:WebSocket 推 run/agent/issue 事件,看板/列表/详情免刷新更新(`doc/spec/agent-runs.md:610-627`)。
- 错误可见:CLI 错误尽量完整展示,excerpt 立即可见、full log 可拉取(`doc/spec/agent-runs.md:748`)。
- 成本:`pages/Costs.tsx` + `QuotaBar`/`ProviderQuotaCard`/`BudgetPolicyCard`,按 company/agent/project/goal/provider/model 维度(`README.md:226-229`)。

### E4. 人审/干预交互
approval 卡(`ApprovalCard` / `ApprovalPayload`)、issue 内交互(`IssueThreadInteractionCard`:suggest_tasks / ask_user_questions / request_confirmation)、blocked/recovery 通知卡、watchdog 决策、暂停/终止按钮(`AgentActionButtons`)。

### E5. 上手成本 / 模板市场 / 协作
- 低上手:onboarding 向导 + ClipHub 模板 + "5 分钟首胜"目标。
- 模板市场:ClipHub(分类、语义搜索、stars、fork、版本、安全扫描)(`doc/CLIPHUB.md`)。
- 协作:多人 board 用户 + company memberships + invite 流 + 权限授予(`README.md:366`、`pages/CompanyAccess/CompanyInvites`)。

### E6. 做得好的 UX 细节(让普通用户也能编排)
1. 用"经营公司"这个人人都懂的心智模型替代图论,极大降低认知门槛。
2. goal ancestry 注入让每个任务自带"为什么",对齐感强。
3. 预算硬停 + 实时成本把"token 烧光"这一最大焦虑前置可视。
4. prompt pill 让非技术用户也能安全填模板变量。
5. 渐进式披露 + output-first:默认看结果和意图,不被日志淹没。
6. 移动端就绪,可在手机上监管。

## F. 与 ACC 理念的异同点(逐条)

| 维度 | ACC | Paperclip | 异/同 |
|---|---|---|---|
| 顶层心智模型 | 面向对象:agent=类、workflow=函数、节点=实例 | 面向组织:agent=雇员、company=组织、issue=工单 | 异(图论 vs 公司论) |
| 编排形态 | 机械 DAG workflow(人固定流程) | 无 DAG;org 委派 + 工单 + 心跳(`README.md:272`) | 异 |
| 控制权归人 | 人固定流程,agent 执行 | 人定目标/预算/审批,agent 自主分解执行 | 同向但更松 |
| 控制面 vs 执行面 | acc 管边界/manifest,外部 agent 拥内循环 | "control plane, not execution plane",adapter 拥内循环(`doc/GOAL.md:54`) | 强同 |
| 接入成熟外部 agent | codex/claude/hermes 等,各自 workspace 复用 | claude/codex/cursor/gemini/openclaw… adapter 协议 | 强同 |
| 无状态 + 可复用 | 模板严格无状态,运行态外置 | agent 实体有状态;仅在 export 时剥离状态(`doc/CLIPHUB.md:32`) | 异(分离粒度/时机不同) |
| 定义 vs 实例分离 | 节点级类/实例分离 | 组织级 模板/实例(ClipHub),节点级无分离 | 部分同 |
| 数据流转 | port/inbox/outbox/artifact,sender 不写 receiver | issue/comment/document/work-product/approval,workspace 隔离(git worktree) | 异(机制)同(显式不互写) |
| 动态编排 | 未来 supervisor 运行时选 agent | 现已有"分布式委派式"动态:上级 agent 改派下属 | 异路线,同目标 |
| 持久化/真相 | run-scoped manifests/events | Postgres + RunLogStore,UI 仅投影 | 强同(后端是真相,前端投影) |
| 可视化编排 | Workbench 画布编辑 workflow | 无编辑画布;org chart 只读 + 看板 | 异 |

## G. 最值得借鉴清单

### 架构类
1. 统一 Wakeup 协调器(single enqueue 入口 + DB 队列 + coalesce + 优先级)(`doc/spec/agent-runs.md:330-403`)。理由:把"何时跑哪个 agent"从各调用点收敛到一处,天然 restart-safe、去重、可审计。对 ACC 适配:supervisor 的"调用决策"也应只产生 wakeup 请求,由统一协调器消费;DAG 调度同样可复用。
2. 运行时活性契约 + 三级恢复(auto-recover / explicit recovery action / human escalation)(`doc/execution-semantics.md:155-447`)。理由:把"DAG 跑挂了/agent 卡死"变成可治理状态的关键工程资产,远超普通 retry。对 ACC 适配:为每个 ScopeFrame/SessionInstance 定义"健康/卡住"判定与恢复原语(requeue 一次、开 recovery、升级给人),落在 run manifest 里。
3. 运行时无关的 adapter 协议 `agent-run/v1` + 能力位 + 外部插件动态注册(`doc/spec/agent-runs.md:115-178`、`packages/shared/src/adapter-type.ts`)。理由:ACC 已有"接入成熟外部 agent"目标,这套 invoke/hooks/result + capabilities 是现成的稳定契约范本。对 ACC 适配:把 agent 节点的执行边界标准化为同形协议,便于热路径(`CallableInvocationService`)与未来更多后端共用。
4. 日志分层存储(轻量事件进库 + full log 进可插拔 RunLogStore,只留 logRef)(`doc/spec/agent-runs.md:405-536`)。理由:避免运行真相被大日志拖垮;与 ACC"manifests/events 轻、artifacts 重"理念一致。

### UX 类
5. 渐进式披露 + output-first 的 Run 视图(顶层意图摘要 / 中层步骤产物 / 底层 transcript)(`doc/PRODUCT.md:136-143`)。理由:让"普通人也能监管 agent"的核心 UX,正中 ACC Workbench 节点检查器"展示真实 input/output/artifact 证据"的诉求。对 ACC 适配:节点 inspector 默认显示结构化摘要 + 产物,把 raw 日志折叠到底层。
6. human-in-the-loop 交互原语标准化(`ask_user_questions` / `request_confirmation` / `suggest_tasks` / approval)(`packages/mcp-server/src/tools.ts:483-595`)。理由:把"人介入"做成一等的、结构化、可审计的交互对象。对 ACC 适配:supervisor/节点需要人确认时,产出 typed interaction 落到 run-scoped 状态,UI 据此渲染审批/追问卡。
7. "导出结构、不导出状态"的可复用包(ClipHub:agent/team/company 三粒度 + semver + fork 血缘)(`doc/CLIPHUB.md:21-42`、`146-148`)。理由:ACC 已主张"模板与运行态分离",这套是该理念在产品/生态层的完整落地范本。对 ACC 适配:为 ClassTemplate/WorkflowFunctionTemplate 提供导出/导入 + 版本 + 分享,且校验"模板不得含 run 目录/绝对路径/session"。
8. 预算硬停 + 实时成本可视(`README.md:147`、`doc/execution-semantics.md` 预算暂停)。理由:对接外部按量计费 agent 时,这是控成本焦虑的最强 UX。

## H. 局限 / 不适用之处
1. 不做精确流程编排:刻意没有 DAG/条件/扇入扇出/数据端口拓扑(`README.md:272`)。对 ACC"人固定机械 DAG"这一当前核心,不能直接借鉴编排机制本身——它的编排是 org 委派,弱结构。
2. agent 是有状态雇员,违背 ACC"无状态可复用 ClassTemplate":`agents` 行混合了定义与运行态(`agents.ts:23-35`),若照搬会破坏 ACC 模板纯净性。借鉴时只取其"导出层剥离状态"。
3. 单 agent 串行 + 心跳模型偏"自治后台公司",与 ACC"一次性确定性 workflow run"语义不同;心跳/timer 这套对纯 DAG 执行是过重的。
4. 重量级控制平面:数十个服务、`heartbeat.ts` ~372KB、嵌入 Postgres、插件/沙箱/秘钥/治理体系庞大。与 ACC"lightweight、local-first、不引入数据库"直接冲突——整体平台不可移植,只能借鉴局部模式。
5. 委派式动态编排缺乏确定性回放:任务分解依赖各 agent 的 LLM 判断,结果非确定;ACC 若引入,需在 supervisor 层补"提案→校验→dry-run→人审→apply"(这正是 ACC GraphOps 的强项,Paperclip 反而较弱)。
6. ClipHub 注册中心为独立 hosted 服务:线上注册端实现是否在本仓内未确认。
7. 本地 CLI adapter 无沙箱:host 上 unsandboxed 运行(`doc/spec/agents-runtime.md:152-162`),安全模型偏信任本地,ACC 若借鉴执行调度需自行加隔离。

## I. 关键证据索引(文件:行号)
定位/技术栈:`README.md:28-38,157-262,266-275,283-308,367-378`;`AGENTS.md:23-32`、`pnpm-workspace.yaml:1-14`、`package.json:6-13`;`doc/PRODUCT.md:5`、`doc/GOAL.md:9,28-54`。
Agent 建模/adapter:`packages/db/src/schema/agents.ts:14-45`;`packages/shared/src/adapter-type.ts:4-9`;`doc/spec/agent-runs.md:115-178,239-329`;`packages/adapters/`;`doc/PRODUCT.md:33-42,61-71`。
编排/调度/状态:`doc/spec/agents-runtime.md:9-28,71-83,98-109`;`doc/spec/agent-runs.md:330-403,405-536,587-627,544-579`;`doc/execution-semantics.md:11-122,124-153,155-294,295-447`;`server/src/services/`。
动态编排/动作面:`packages/mcp-server/src/tools.ts:226-597,444-470,483-519,417-425,564-585`;`server/src/services/hire-hook.ts`、`doc/plans/2026-02-19-ceo-agent-creation-and-hiring.md`。
可复用/组合:`doc/CLIPHUB.md:5,21-42,60-95,146-148,202-204`;`server/src/services/company-portability.ts`、`ui/src/pages/CompanyExport.tsx` / `CompanyImport.tsx`;`packages/db/src/schema/agent_config_revisions.ts`。
UX:`doc/PRODUCT.md:104-153`;`ui/src/pages/`(Dashboard.tsx:15-70、IssueDetail.tsx:1-60、OrgChart.tsx:16-89、Costs.tsx 等)、`ui/src/components/`。

未确认项:ClipHub 注册中心线上端是否在本仓:未确认。agent 实体的"模板/运行态分离"在运行库层不存在,仅在导出时剥离。

给 ACC 的一句话总结:Paperclip 与 ACC 共享"控制平面而非执行平面、复用成熟外部 agent、后端为真相前端为投影"的内核;但它用"公司/组织/工单/心跳/委派"取代了 ACC 的"类/函数/DAG"。对 ACC 最高价值的不是它的编排范式(那反而弱),而是它把调度收敛(wakeup 协调器)、活性与恢复契约、运行时无关 adapter 协议、渐进式 Run 可观测 UI、human-in-the-loop 交互原语、导出结构不导出状态的复用包这六件事打磨成了可直接对照的工程范本。
