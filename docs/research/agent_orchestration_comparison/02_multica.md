# Multica 架构与用户体验深度画像报告

> 研究对象:`F:\Multica\multica`(只读,未修改任何文件)。
> 用途:与 ACC(Agent Capsule Conductor)横向对比的结构化参照画像。所有论断均附代码/文档证据(文件:行号)。
> 调研性质:只读静态分析,未修改任何文件。
> 生成日期:2026-05-29
> 相关文档:[返回索引 README](README.md) · [Conductor 调研](01_microsoft_conductor.md) · [Paperclip 调研](03_paperclip.md) · [三方综合对比](04_synthesis_vs_acc.md)

---

## 目录

- [A. 项目定位与技术栈](#a-项目定位与技术栈)
- [B. 核心架构](#b-核心架构)
  - [B.1 多 agent 如何建模](#b1-多-agent-如何建模)
  - [B.2 编排/协作模型:事件驱动的"issue 黑板 + @mention 路由",不是 DAG](#b2-编排协作模型事件驱动的issue-黑板--mention-路由不是-dag)
  - [B.3 是否有中心编排者?——只有"Squad Leader"这一个 LLM 编排者](#b3-是否有中心编排者只有squad-leader这一个-llm-编排者)
  - [B.4 任务分解与分派机制](#b4-任务分解与分派机制)
  - [B.5 状态/上下文管理](#b5-状态上下文管理)
  - [B.6 执行与调度:异步、并发、流式](#b6-执行与调度异步并发流式)
- [C. 可复用与组合模型](#c-可复用与组合模型)
- [D. 动态/智能编排能力(重点)——Squad Leader = ACC 未来 supervisor 的现成范式](#d-动态智能编排能力重点squad-leader--acc-未来-supervisor-的现成范式)
- [E. 用户体验设计(重点)](#e-用户体验设计重点)
  - [E.1 用户如何定义 agent 与编排](#e1-用户如何定义-agent-与编排)
  - [E.2 可视化与信息架构](#e2-可视化与信息架构)
  - [E.3 可观测性与调试](#e3-可观测性与调试)
  - [E.4 上手成本与接入外部 agent 的方式](#e4-上手成本与接入外部-agent-的方式)
- [F. 与 ACC 理念的异同点(逐条)](#f-与-acc-理念的异同点逐条)
- [G. 最值得借鉴清单](#g-最值得借鉴清单)
  - [架构层](#架构层)
  - [UX 层](#ux-层)
- [H. 局限 / 不适用之处](#h-局限--不适用之处)
- [I. 关键证据索引(文件:行号)](#i-关键证据索引文件行号)

---

## A. 项目定位与技术栈

结论:Multica 不是工作流编排引擎,而是一个"把 AI 编码 agent 当成可被指派任务的同事"的开源托管平台(managed-agents platform)——本质是"带 AI 一等公民的 Linear"。

证据:
- 自我定位:`README.md:15-33` —"Your next 10 hires won't be human… The open-source managed agents platform. Turn coding agents into real teammates — assign tasks, track progress, compound skills."
- `CLAUDE.md:22-27` —"Multica is an AI-native task management platform — like Linear, but with AI agents as first-class citizens… Built for 2-10 person AI-native teams."
- 名字来源(`README.md:41-51`):致敬 Multics 分时操作系统,核心隐喻是"人与 autonomous agents 共同分时复用一套系统"。

运行形态:自托管/云双形态的客户端-服务器产品(非库、非纯 SaaS)。
- 架构图 `README.md:156-176`:`Next.js Frontend ↔ Go Backend (Chi + WS) ↔ PostgreSQL(pgvector)`,旁挂一个跑在用户机器上的 Agent Daemon。
- 自托管:`brew install` / 安装脚本 / `--with-server`(`README.md:67-105`)。

技术栈(实证):

| 层 | 技术 | 证据 |
|---|---|---|
| 前端 | Next.js 16(App Router)+ React 19 + Zustand + TanStack Query + Tailwind4 + shadcn/Base UI | `CLAUDE.md:30-39`、`pnpm-workspace.yaml:5-62` |
| 后端 | Go(Chi router、sqlc、gorilla/websocket) | `AGENTS.md:16`、`server/go.mod` |
| 数据库 | PostgreSQL 17 + pgvector | `README.md:175` |
| Agent 运行时 | 本地 daemon 执行外部 CLI agent | `README.md:176`、`server/internal/daemon/` |
| 多端 | `apps/web`(Web)、`apps/desktop`(Electron)、`apps/mobile`(Expo/RN iOS) | `package.json:7-21`、`CLAUDE.md:33-35` |
| CLI | Go 编写的 `multica` CLI + daemon | `server/cmd/multica/`、`CLI_AND_DAEMON.md` |

面向用户:2–10 人的 AI 原生小团队;解决的问题:让编码 agent 不再靠人"复制粘贴 prompt、盯着跑",而是像同事一样被指派 issue、自主认领执行、回报进度、复用技能(`README.md:31-33`)。

支持的外部 agent(关键):Claude Code、Codex、GitHub Copilot CLI、OpenClaw、OpenCode、Hermes、Gemini、Pi、Cursor Agent、Kimi、Kiro CLI、Antigravity(`README.md:33,117`、`server/pkg/agent/agent.go:1-4,110`)。

## B. 核心架构

### B.1 多 agent 如何建模
Agent = 持久化的"数字员工"实体,而非无状态模板。一个 Agent 是 DB 行,核心字段:`name` / `description` / `instructions`(系统提示/人设)、`provider`(绑定哪个外部 CLI)、`runtime_id`、`runtime_config`、`mcp_config`、`visibility`、`max_concurrent_tasks`、`owner_id`、`status`。

证据:`server/pkg/db/queries/agent.sql:22,37,56`、`task.go:2252-2276`(`agentToMap`)、`server/pkg/agent/agent.go:24-47`(`ExecOptions` 含 `SystemPrompt`/`Model`/`CustomArgs`/`McpConfig`/`ThinkingLevel`)。

外部 agent 的统一抽象层是 `Backend` 接口——这是"无缝接入成熟外部 agent"的关键设计。来源:外部仓库 `F:\Multica\multica\server\pkg\agent\agent.go:16-21`:

```go
// Backend is the unified interface for executing prompts via coding agents.
type Backend interface {
	// Execute runs a prompt and returns a Session for streaming results.
	Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

`agent.go:1-4` 明确"mirrors the happy-cli AgentBackend pattern"。每个 provider(`codex.go`、`cursor.go`、`hermes.go`、`openclaw.go`、`kimi.go`、`kiro.go`…)各自把对应 CLI 的输出归一化为统一的 `Message`/`Result` 流(`agent.go:58-100`)。Multica 不实现自己的推理循环——外部 agent 拥有自己的内循环,Multica 只拥有执行边界、输入输出、产物。

角色/能力定义来自三处可组合资源:`instructions`(每个 agent 的人设/系统提示)、Agent Templates(预制角色)、Skills(可复用知识包)。

### B.2 编排/协作模型:事件驱动的"issue 黑板 + @mention 路由",不是 DAG
最重要的判断:Multica 没有 DAG、没有图画布、没有固定流水线。协作是事件驱动的:

1. 触发源(任务如何产生)全部经由"事件 → 任务入队"(`task.go` 的多个 `Enqueue*`):指派 issue 给 agent → `EnqueueTaskForIssue`(`task.go:389-454`);评论 @mention agent → `EnqueueTaskForMention`(`task.go:459-461`);@mention squad → `EnqueueTaskForSquadLeader`(`task.go:463-471`);普通评论命中触发规则 → 唤醒 assignee(`comment.go:821-835`);Chat 消息 → `EnqueueChatTask`(`task.go:626-655`);Quick-create → `EnqueueQuickCreateTask`(`task.go:564-622`);Autopilot 定时/webhook → `DispatchAutopilot`(`autopilot.go:58-80`)。
2. agent 间通信 = issue 评论时间线(类黑板模型)。Agent 之间不直接 RPC,而是在 issue 上发评论;评论里的 `[@Name](mention://<type>/<UUID>)` 链接经 `util.ParseMentions` 解析后触发下一个 agent(`comment.go:972-1059`)。
3. 如何决定下一步:没有中央调度器决定;下一步由接收方 agent 自己读 issue 后用 LLM 推理决定,或由 squad leader 委派决定。系统层只负责"把符合触发条件的事件转成排队任务"。

### B.3 是否有中心编排者?——只有"Squad Leader"这一个 LLM 编排者
- 没有规则/计划式的中央 orchestrator。任务分发是拉模型:每个 daemon 轮询认领属于自己 runtime 的任务(`ClaimTaskForRuntime` `task.go:839-943`),受 `max_concurrent_tasks` 限制(`ClaimTask` `task.go:792-796`)。
- 唯一的"编排者 agent"是 Squad 的 leader(详见 D 节)——它是真正在运行时用 LLM 推理来决定"把活派给谁"的角色。其决策方式是 LLM 推理,不是规则,也不是预生成计划(`squad_briefing.go:19-89`)。

### B.4 任务分解与分派机制
- 分解:由 leader agent 或任意 agent 通过"创建子 issue 并指派"或"@mention 委派"来做(`squad_briefing.go:83-89` 明确二选一,避免双触发)。没有系统级的自动任务分解器。
- 分派:两条等价路径——(a) @mention 在当前 issue 上委派;(b) 创建 `--status todo` 且指定 agent assignee 的子 issue(指派本身即触发)。
- 去重/防环:`HasPendingTaskForIssueAndAgent` 去重(`comment.go:1011-1016,1046-1050`);agent→agent 纯致谢评论不回复以避免死循环(`prompt.go:154-156`);member 线程的回复抑制规则(`comment.go:882-921`)。

### B.5 状态/上下文管理
关键设计:不存任务上下文快照,agent 运行时自取(pull, not push)。来源:外部仓库 `F:\Multica\multica\server\internal\service\task.go:389-391`:

```go
// EnqueueTaskForIssue creates a queued task for an agent-assigned issue.
// No context snapshot is stored — the agent fetches all data it needs at
// runtime via the multica CLI.
```

- Agent 在执行时通过 `multica issue get / comment list` 等 CLI 自行拉取 issue、评论、附件(`prompt.go:32-34,161-172`)。
- 每个任务一个隔离的执行环境(`execenv.go:1-4`"Each task gets its own directory with injected context files")。
- 共享上下文经 prompt/上下文文件注入:`AgentInstructions`、`AgentSkills`、`WorkspaceContext`、`RequestingUser` profile、project resources(`execenv.go:59-90`)。
- 会话/记忆:通过 `session_id` 续接——任务完成时把 `session_id`+`work_dir` 固化到任务行与 chat_session(`task.go:1020-1053`),下次同 `(agent, issue)` 或 chat 续接;用户点 rerun 则 `force_fresh_session=true` 丢弃旧会话(`task.go:405-409,1432-1461`)。模板/定义状态与运行时状态分离:agent 定义与运行时状态分属不同列/表。

### B.6 执行与调度:异步、并发、流式
- 异步:任务进 `agent_task_queue`,daemon 轮询/被 WS 唤醒后认领(`task.go:1766-1782` `notifyTaskAvailable`)。
- 并发:每 agent `max_concurrent_tasks` 上限(`task.go:792-796`);多 runtime/多 daemon 横向并发。
- 流式:执行过程经 WebSocket 实时广播(`ReportProgress` `task.go:1637-1651`;`task:dispatch/running/completed/failed`、`chat:done` 等事件 `task.go:1816-1837`)。
- 状态机:`queued → dispatched → running → completed/failed/cancelled`,外加 `waiting_local_directory`(路径锁等待)(`task.go:967-1010`);失败按原因分类自动重试(仅基础设施类失败:`runtime_offline/timeout` 等,`task.go:1320-1401`)。
- 可靠性细节:失联任务回收(`ReclaimStaleDispatchedTaskForRuntime` `task.go:867-884`)、空队列缓存快路径(`EmptyClaim` `task.go:33-38,886-912`)、claim 幂等与竞态处理(`task.go:1056-1084`)。

## C. 可复用与组合模型
Multica 的"可复用"体现在三层资源,但 agent 本身是有持久身份的实例,而非无状态类。

1. Agent Templates(可复用的角色定义,最接近 ACC 的 ClassTemplate 思想):静态 JSON、构建期内嵌、走 PR 评审、无运行时变更(`agenttmpl/types.go:1-11`)。一个模板 = `name + description + instructions + skills 引用列表`(`types.go:15-73`)。示例 `code-reviewer.json`:把"代码审查专家"人设 + Vercel React 最佳实践 skill 打包(`code-reviewer.json:8-15`)。共 ~26 个内置模板。
2. Skills(可复用知识/能力包,跨 agent、跨团队复用):`README.md:61`"every solution becomes a reusable skill for the whole team"。Skill = `name + description + content(SKILL.md)+ files`(`task.go:1684-1715` `LoadAgentSkills`/`AgentSkillData`);可从 GitHub/skills.sh URL 导入(`types.go:59-72`)。运行时注入到 agent 执行环境(`execenv.go:67`)。
3. Squad(可复用的团队/路由单元):把多个 agent(和人)编成一组、设一个 leader,对外用 `@FrontendTeam` 稳定路由(`README.md:35,58`)。

"定义 vs 实例"分离的实情:有部分分离(模板/skill 无状态可复用;agent 实例携带运行时状态);但与 ACC 不同的是,Multica 的 agent 是一个持久命名实体(数字员工),不是"在 workflow 里实例化一次的无状态类"。最接近 ACC"无状态 ClassTemplate"的,是 Agent Template。

## D. 动态/智能编排能力(重点)——Squad Leader = ACC 未来 supervisor 的现成范式
Multica 的 Squad-Leader 机制,几乎就是 ACC 设想的"编排者 agent 运行时动态决定调用哪些预注册可复用 agent"的落地形态。

机制全貌:
1. 触发:用户把 issue 指派给 squad,或在评论里 @squad。系统解析后,把任务派给 squad 的 leader agent,并打上 `is_leader_task=true`(`comment.go:978-1021`、`task.go:463-471`)。
2. 运行时注入"编排者人设":leader 认领任务时,系统把一段硬编码的 Squad Operating Protocol + Squad Roster 拼到它的 instructions 上(`squad_briefing.go:104-117`)。Roster 列出每个成员的可直接粘贴的 mention markdown(`squad_briefing.go:121-218`)。
3. leader 用 LLM 推理决定派给谁(动态、非规则)。来源:外部仓库 `F:\Multica\multica\server\internal\handler\squad_briefing.go:19-34`:

```go
const squadOperatingProtocol = `## Squad Operating Protocol

You are the LEADER of a squad. Your job is to **coordinate**, not to execute
the work yourself.

Your responsibilities, in order:

1. **Read the issue** … and decide which squad member is best suited to do the work.
2. **Delegate by @mention.** Post a single comment on this issue that
   @mentions the chosen member(s) and tells them what to do.
```

4. 派单即"调用":leader 发出的 @mention 评论,经评论触发链 `enqueueMentionedAgentTasks` 解析,为被点名成员入队新任务(`comment.go:972-1059`)——即"运行时动态调用一个预先注册、可复用的 agent"。
5. "派完即停 + 被唤醒再评估"的循环:leader 派单后必须结束本轮(`squad_briefing.go:49-55`);当成员更新/提问/完成时被自动重新触发,再决定下一步、上报人类或收尾(`squad_briefing.go:56-60`)。每轮强制记录决策 `multica squad activity <issue> action|no_action|failed`(`squad_briefing.go:41-48,81-82`),并有 no_action 静默退出机制(`prompt.go:157-159`、`squad_no_action.go`)。

关键结论(对 ACC 的直接启示):被调用的 agent 是预先注册、可复用的(squad 成员是已存在的 agent),不是临时生成的。编排者的"智能"完全由 LLM 推理提供;系统层只提供:角色协议注入 + roster + @mention→任务的可靠路由 + 防环去重 + 决策审计。"整合结果"靠 issue 时间线(黑板):成员把结果发回评论,自动重新唤醒 leader。没有预定义计划/DAG,流程是涌现式的,由 leader 每轮重新决策——这正是 supervisor 形态,但代价是可预测性/可重放性弱(见 H 节)。

另一条"半动态"路径是 Autopilot:定时/webhook/手动触发,自动建 issue 并路由给 agent 或 squad(`autopilot.go:45-80`、`README.md:60`),含"触发时准入"门(runtime 离线则记 `skipped` 不堆积任务)。这是调度驱动而非推理驱动的编排。

## E. 用户体验设计(重点)

### E.1 用户如何定义 agent 与编排
全部通过 Web/Desktop GUI + 配置,而非代码/DSL/图画布。
- 建 runtime:`multica setup` 启动 daemon,自动探测本机已装的 CLI(`README.md:111-123`)。
- 建 agent:Settings → Agents → New Agent,选 runtime + provider + 命名(`README.md:125-127`);或"从模板创建"。
- 编排不是"画流程",而是"像分配给同事一样指派 issue"(`README.md:129-131`)+ 配 squad + 配 autopilot(cron/webhook)。
- 前端是 headless core + 视图分层架构(`packages/core` 业务逻辑 / `packages/ui` 原子组件 / `packages/views` 业务页面),Web/Desktop/Mobile 三端共享(`CLAUDE.md:30-39,75-84`)。

### E.2 可视化与信息架构
信息架构 = Linear 式任务管理,而非 agent 编排画布。视图域(`packages/views/`):`issues`(看板/列表)、`agents`、`squads`、`autopilots`、`chat`、`skills`、`runtimes`、`inbox`、`projects`、`members`、`dashboard`、`search`、`settings`。
- 核心隐喻:agent 出现在看板上、有头像、发评论、建 issue、报阻塞,与人类同事并列(`README.md:49,57`;`CLAUDE.md:424-426`:assignee 多态 member|agent,agent 用紫底+机器人图标区分)。
- 没有节点/连线画布,也没有"workflow 编辑器"。编排意图通过 issue 关系(父子)、指派、@mention、squad 配置间接表达。

### E.3 可观测性与调试
- 实时:WebSocket 把 `task:*`、`agent:status`、`comment:*`、`chat:done`、`inbox:new` 等事件推到前端(`task.go:1816-1837,2242-2248`)。
- 决策可见:squad leader 的每个决策强制落到 issue 时间线(`squad activity` action/no_action/failed),"让人类看到它评估过这个触发"(`squad_briefing.go:41-48`)。
- 执行日志/重跑:有 execution log + 逐行 retry 按钮(`task.go:1403-1431`);失败原因分类(`task.go:353-373`)。
- 产物/会话:每任务隔离目录含 `output/`、`logs/`(`execenv.go:50-55`),session 续接指针可观测。

### E.4 上手成本与接入外部 agent 的方式
- 上手低:一行 `multica setup`(`README.md:113-117`);daemon 自动探测本机 CLI。
- 接入外部 agent:用户只要本机装好并登录好 Claude Code/Codex/Cursor 等,Multica 的 `Backend` 适配层即可在其各自工作区中复用其原生能力(`agent.go:1-4,102-110`)——让成熟 agent 在自己的 workspace 下复用原本能力,与 ACC 目标一致。
- MCP、自定义 CLI 参数、thinking level 等都能在 agent 上配(`agent.go:35-47`)。

## F. 与 ACC 理念的异同点(逐条)

| ACC 理念 | Multica 的对应 | 异同判断 |
|---|---|---|
| 面向对象:agent 节点=无状态可复用 ClassTemplate | agent 是持久命名实体(数字员工),有 status/队列/session;无状态可复用的是 Agent Template + Skill | 部分相同:复用单元存在,但运行单元是有状态实例 |
| workflow=函数,节点=类的实例声明 | 无 workflow/函数概念;编排=指派 issue + @mention + squad + autopilot | 不同:无声明式 workflow 函数,流程事件涌现式 |
| 模板与运行时状态严格分离 | 定义与运行时分离;但 agent 实体本身混合身份与 runtime 绑定 | 大致相同但更松 |
| 人固定流程,agent 按流程执行(机械 DAG) | 人不固定流程:人指派任务/配 squad/配 autopilot,流程由 agent 运行时推理涌现 | 本质不同:ACC=人控 DAG;Multica=人控边界+agent 控流程 |
| 无缝接入成熟外部 agent,各自 workspace 复用原能力 | `Backend` 接口统一封装 12+ 种外部 CLI,各自隔离目录执行,不实现自有推理循环 | 高度相同:Multica 最强、与 ACC 同向的设计 |
| 节点间数据经 port/inbox/outbox/artifact 显式流转,sender 不直接写 receiver | 数据经 issue 评论(黑板)+ @mention 流转;agent 运行时自取;每任务隔离目录 | 理念相近机制不同:都避免直写对方工作区 |
| 未来 supervisor:编排者 agent 运行时动态选调可复用 agent | Squad Leader 已实现:LLM leader 读 issue→@mention 委派预注册成员→派完即停→被唤醒再评估 | 几乎完全命中:Multica 已落地 ACC 的未来形态 |
| `--emit-json` 单 JSON、日志走 stderr 等机器可读契约 | CLI 有 `--output json`;agent 被要求只 emit 单条结果行(`prompt.go:124-129`) | 相同方向 |
| 本地优先、轻量、不引入重型基础设施 | 本地 daemon + 自托管;但后端依赖 PostgreSQL+pgvector、WS、Redis | 部分不同:Multica 更重 |

## G. 最值得借鉴清单

### 架构层
1. 统一 `Backend` 适配接口封装外部 agent(★最高优先级)。理由:与 ACC"无缝接入成熟外部 agent"目标完全同向。用一个 `Execute(prompt, ExecOptions) → Session{Messages, Result}` 接口把 12+ 种 CLI 差异归一化(`agent.go:16-100`),且明确"不实现自有推理循环"。对 ACC 适配:agent 节点 ClassTemplate 可定义等价 Backend 契约层,把 codex/claude/hermes 的调用、流式归一化、session resume、超时/取消统一收敛;新增 provider 只需实现一个适配器,不动编排层。
2. "不存上下文快照,agent 运行时自取(pull-based context)"。理由:`task.go:389-391` 显式不存快照,避免快照陈旧、避免 sender 直写 receiver,天然支持长会话增量读取。对 ACC 适配:inbox/outbox/artifact 保留为"权威数据源 + 显式契约",下游节点可按需懒加载而非全量推送。
3. Squad-Leader 作为 supervisor 的"协议注入 + roster + @mention 路由"三件套(★对 ACC 未来 supervisor 直接可抄)。理由:把"让 LLM 当编排者"拆成三个系统层可靠保障:(a) 注入"你是协调者,只派单不干活"硬协议;(b) 提供可直接调用的成员 roster(带 ID 的 mention link);(c) 把"派单"可靠翻译成"给被注册 agent 入队任务"+ 去重防环(`squad_briefing.go:19-89`、`comment.go:972-1059`)。对 ACC 适配:给编排 agent 注入"可调用 agent 清单(含稳定 ID)"+"调用=发结构化指令到路由器,由路由器实例化预注册 ClassTemplate"+ 强制决策审计。
4. 决策审计强制化(`squad activity action|no_action|failed`)。理由:强制 leader 每轮把决策(含"不行动")写进时间线,解决"LLM 编排黑盒、人看不到它为何不动"的可观测性痛点(`squad_briefing.go:41-48`)。对 ACC 适配:supervisor 每次"选择调用/不调用某 agent"都产出结构化可审计决策记录,写进 run manifest/events。
5. 拉模型任务队列 + 容量限制 + 失联回收(可靠执行底座)。理由:`ClaimTaskForRuntime` 拉取、`max_concurrent_tasks` 限流、stale dispatch 回收、空队列快缓存(`task.go:839-943`)是经实战打磨的并发/容错底座。对 ACC 适配:支持并发/异步运行多节点时,这套"队列+认领+容量+回收+幂等"可参考。

### UX 层
6. "agent 即同事"的统一信息架构(★)。理由:把 agent 收敛进既有任务管理范式(看板/指派/评论/@mention/inbox),用户无需学习新的"编排"心智模型(`README.md:49,57`、多态 assignee `CLAUDE.md:424-426`)。对 ACC 适配:即便以 DAG 为主,也可借鉴"agent 有身份、有头像、产物以人类可读的活动流呈现"。
7. 从模板/技能快速创建可复用资产(Templates + Skills 复用闭环)。理由:预制角色模板 + 可导入 Skill(SKILL.md from URL)让最佳实践组合可一键复用、随团队积累(`agenttmpl/types.go`、`code-reviewer.json`、`README.md:61`)。对 ACC 适配:ClassTemplate 配套"模板市场/技能注入"机制。
8. WebSocket 实时事件 + 失败分类/可重跑的可观测性。理由:实时进度、逐行 retry、失败原因分类(`task.go:353-373`),让"黑盒 agent 跑批"可监控可干预。对 ACC 适配:在 run/manifest 之上叠加实时事件流投影与按节点重跑。

## H. 局限 / 不适用之处
1. 流程不可预测、难重放(对 ACC"人固定流程"是根本性背离)。Squad-Leader 是涌现式编排,没有声明式可重放的流程定义。
2. 数据流是隐式的"黑板 + @mention",不是显式 port/类型化契约,缺少严格数据契约,易产生噪音评论、误触发,需大量启发式抑制(`comment.go:837-921`)。
3. 比 ACC"本地优先轻量"更重:需要 PostgreSQL+pgvector、WS、可选 Redis、服务端 + daemon 双进程。
4. agent 是有状态持久实体,与 ACC"无状态可复用类"哲学冲突。ACC 应只取其 Template/Skill 这层无状态复用。
5. 防环/触发抑制逻辑复杂且脆弱(member 线程抑制、parent mention 继承、self-trigger 守卫、leader/worker 双角色判定 `comment.go:882-954,990-997`)。
6. "编排"无独立编辑面:没有可视化编排/流程编辑器,复杂多步协作只能靠 issue 父子关系 + 评论隐式表达。

## I. 关键证据索引(文件:行号)
定位与技术栈:`README.md:15-33,156-176,67-131`;`CLAUDE.md:22-27,30-39,420-426`;`package.json:1-55`、`pnpm-workspace.yaml:1-62`、`AGENTS.md:11-21`。
Agent 建模/外部抽象:`server/pkg/agent/agent.go:1-4,16-21,24-47,58-100,102-110`;`server/pkg/db/queries/agent.sql:22,37,56`、`task.go:2252-2276`;`server/internal/agenttmpl/types.go:1-73`、`templates/code-reviewer.json:1-16`。
任务生命周期/调度/状态:`task.go:389-454,459-508,564-655,767-829,839-943,967-1010,1012-1185,1198-1401,1636-1701,1816-1837`。
协作/@mention/触发:`comment.go:821-835,837-954,972-1059`;`daemon/prompt.go:17-36,139-174,45-131`。
Supervisor/Squad:`handler/squad_briefing.go:19-89,104-218`;`task.go:463-471`、`service/squad_no_action.go:10-21`;`service/autopilot.go:45-80`。
执行环境/数据流:`daemon/execenv/execenv.go:1-4,33-90`;`daemon/daemon.go:80-120`。
UX 信息架构:`packages/views/`、`packages/core/`;`apps/web/app/[workspaceSlug]/(dashboard)`、`apps/desktop`、`apps/mobile`。

一句话总结:Multica 把"编排控制权交给人"体现为人控边界(指派、squad 配置、autopilot)而非人控流程,流程本身由 agent(尤其 squad leader)运行时 LLM 推理涌现;它对 ACC 最大的价值是已经跑通了 ACC"未来 supervisor"的工程范式(协议注入 + 可复用 agent roster + 可靠 @mention 路由 + 决策审计)和"统一 Backend 封装成熟外部 agent"的接入层,而 ACC 应保留自己"显式声明式、可重放、轻量本地优先"的内核,只在 supervisor、外部 agent 适配、可观测性这三处选择性吸收。
