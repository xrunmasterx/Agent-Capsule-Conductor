# 三方对比综合:Conductor / Multica / Paperclip vs ACC

> 一句话定位:在第一性原理框架下,把 Conductor / Multica / Paperclip 三方调研与 ACC 横向对比,提炼可选择性吸收的架构与 UX 清单。
> 调研对象:`F:\conductor\conductor`、`F:\Multica\multica`、`F:\paperclipai\paperclip`(均只读分析,未修改任何文件)。
> 调研性质:只读横向对比综合。
> 生成日期:2026-05-29
> 相关文档:[返回索引 README](README.md) · [Conductor 调研](01_microsoft_conductor.md) · [Multica 调研](02_multica.md) · [Paperclip 调研](03_paperclip.md)

---

## 目录

- [一、先回到第一性原理:这四个系统到底在解同一个问题的哪一层?](#一先回到第一性原理这四个系统到底在解同一个问题的哪一层)
- [二、ACC 的独特性在哪里(先确认护城河,再谈借鉴)](#二acc-的独特性在哪里先确认护城河再谈借鉴)
- [三、最值得借鉴清单(按 ACC 两条主线 + 优先级组织)](#三最值得借鉴清单按-acc-两条主线--优先级组织)
  - [A. 架构类](#a-架构类)
  - [B. 用户体验类](#b-用户体验类)
- [四、明确不要借鉴的(守住内核)](#四明确不要借鉴的守住内核)
- [五、落到 ACC 路线图的建议(承接已完成的 P0)](#五落到-acc-路线图的建议承接已完成的-p0)

---

## 一、先回到第一性原理:这四个系统到底在解同一个问题的哪一层?
把"多 agent 编排"拆到不可再分,核心只有四个问题:谁来决定做什么(任务定义)、谁来决定谁来做/下一步是谁(控制流)、数据怎么在 agent 间流动(数据流)、什么东西可以被存下来复用(复用单元)。四个系统的根本分歧全在这四问的答案上:

| 第一性问题 | ACC | Conductor(微软) | Multica | Paperclip |
|---|---|---|---|---|
| 谁决定下一步是谁 | 人(固定 DAG) | 人(YAML,首匹配路由,明确"编排环不放 LLM") | LLM(squad leader 运行时推理) | LLM(上级 agent 在心跳里委派) |
| 控制流形态 | 静态 DAG | 静态 DAG + 运行时数据驱动展开(for-each/conditional) | 事件驱动黑板 + @mention 路由 | 组织树委派 + 工单 + 心跳 |
| 数据流 | 显式 port/inbox/outbox/artifact,sender 不写 receiver | 共享内存 context + Jinja2 拉取 | issue 评论黑板 + 运行时按需拉取 | issue/comment/work-product,worktree 隔离 |
| 复用单元 | 无状态 ClassTemplate / WorkflowFunctionTemplate | 整个 workflow(子工作流 + git 版本) | Agent Template + Skill(agent 实例本身有状态) | 整组织导出(ClipHub,"导结构不导状态") |
| 控制面 vs 执行面 | acc 管边界,外部 agent 拥内循环 | 管边界,接 LLM SDK(粒度细) | 管边界,接整个 CLI agent(粒度同 ACC) | 管边界,接整个外部 agent(粒度同 ACC) |

一句话定位:
- Conductor 是 ACC 的"同源兄弟"——确定性、人定流程、编排环不放 LLM,几乎是 ACC 当前形态的另一种实现(YAML vs OO 模板)。它替 ACC 验证了"纯确定性编排"路线的工程完备度。
- Multica 是 ACC 的"未来镜像"——它已经把 ACC 规划中的 supervisor 跑通了(squad leader),且接入层(统一 `Backend` 封装 12+ 外部 CLI)与 ACC 目标高度一致,粒度也一致(整个 CLI agent + 各自 workspace)。
- Paperclip 是 ACC 的"反面参照"——它刻意不做工作流(明确 "Not a workflow builder"),用"经营公司"取代图论。它的编排范式 ACC 不该抄,但它把调度收敛、活性/恢复、可观测 UI、人审原语、复用包这些工程资产打磨得最成熟。

> 关键洞察:你关心的两条主线,正好各有一个最佳参照。"人掌控的确定性编排"看 Conductor;"未来 supervisor 动态调用可复用 agent"看 Multica。 Paperclip 提供的是横切两者的工程化范本。

## 二、ACC 的独特性在哪里(先确认护城河,再谈借鉴)
对比后,ACC 有三个别人都没有同时具备的设计,这是必须守住的内核:
1. agent = 无状态可复用类:Conductor 把 agent 内联进 workflow(跨流程复用要复制 prompt);Multica/Paperclip 的 agent 是有状态持久实体。只有 ACC 把"可复用无状态 agent 类"做成一等公民——这恰恰是"主控 agent 按需直接调用,而不是从零生成、用完即删"的前提。三家里没有一个做到了这点,这是 ACC 面向 supervisor 的真正差异化资产。
2. 显式类型化数据流 + workspace 隔离:其余三家的数据流都是隐式的(共享内存 / 评论黑板 / 工单)。ACC 的 port/inbox/outbox/artifact + sender 不写 receiver,是唯一能给出可重放、可审计、防误用数据契约的。Multica 自承黑板模型要堆大量启发式抑制误触发——这正是 ACC 显式契约天然规避的税。
3. GraphOps 人审治理(proposal→validate→dry-run→approval):Conductor 只有运行时 human gate、Multica/Paperclip 偏运行时审批,没有一家有 ACC 这种"对编排结构变更本身的治理"。当 supervisor 引入 LLM 改图时,这是 ACC 独有的安全垫。

结论:借鉴要做"选择性吸收",绝不能侵蚀这三条内核。

## 三、最值得借鉴清单(按 ACC 两条主线 + 优先级组织)

### A. 架构类
A1.〔★最高〕统一外部 agent 适配契约 —— 同时来自 Multica `Backend` 和 Paperclip `agent-run/v1`。证据:Multica `agent.go:16-21` 一个 `Execute(prompt, ExecOptions)→Session{Messages,Result}` 归一化 12+ CLI;Paperclip `agent-run/v1`(`doc/spec/agent-runs.md:115-178`)带能力位(`resumableSession/statusUpdates/logStreaming/tokenUsage`)+ hooks + `runtimeStatePatch`。为何借:这正是 ACC P0 已落地的 `CallableInvocationService` 应继续标准化的方向。下一步该把"capsule 执行"定义成带能力位的稳定协议——新增 codex/claude/hermes/cursor 只实现一个适配器,编排层和 UI 完全不动。ACC 适配:在 `acc/runner` 的 adapter 层引入能力位声明,`CallableInvocationService` 据此决定是否启用会话续接、是否流式投影。直接接续已完成的阶段 1/2。

A2.〔★最高,面向 supervisor〕Squad-Leader 三件套 = supervisor 的现成范式 —— 来自 Multica。证据:`squad_briefing.go:19-89`——(a) 运行时给 leader 注入"你只协调不干活"的硬协议;(b) 提供带稳定 ID 的成员 roster(可直接 @mention);(c) `comment.go:972-1059` 把"派单"可靠翻译成"给预注册 agent 入队任务"+ 去重防环。LLM 只负责"选谁",可靠性由系统兜底。为何借:几乎逐字命中 supervisor 设想。ACC 适配:ClassTemplate 注册表天然就是 roster。supervisor 落地时不要让编排 agent 直接拼调用,而是:注入"可调用 agent 清单(ClassTemplate id + 能力描述)"→ 编排 agent 输出结构化调用意图 → 由 ACC 路由器去实例化预注册的 ClassTemplate(走已建的 `CallableInvocationService.invoke`)。

A3.〔★高〕确定性兜底,LLM 只产计划 —— 来自 Conductor。证据:Conductor for-each(运行时定并发数 N)+ conditional routing 覆盖大量"看似需要智能"的场景,零 token、可复现(`docs/dynamic-parallel.md`),且明确把"不让 LLM 进编排环"当卖点。为何借:防止 ACC 的 supervisor 走向"每步都烧 token、不可重放"。Multica 自承涌现式编排可预测性/可重放性弱。ACC 适配:supervisor 分两层——LLM 产出调用计划/参数(提案),底层用 ACC 现有确定性 DAG 引擎执行 + GraphOps 人审兜底。把"动态"限制在"运行时决定实例化哪些节点 + 参数",而非"每步现想"。

A4.〔★高〕调度收敛 + 活性/恢复契约 —— 来自 Paperclip(+ Multica 拉模型队列)。证据:Paperclip 单一 `enqueueWakeup` 入口 + DB 队列 + coalesce + 优先级,三级恢复 auto-recover→recovery action→human escalation(`doc/execution-semantics.md:155-447`);Multica `ClaimTaskForRuntime` + `max_concurrent_tasks` + stale 回收(`task.go:839-943`)。为何借:supervisor 需要"ready-queue + 完成事件回灌"而非"逐 level gather"。ACC 适配:supervisor 调用决策只产生 wakeup/调用请求,由统一协调器消费;为 ScopeFrame/SessionInstance 定义"健康/卡死"判定 + 恢复原语,落进 run manifest。

A5.〔中〕日志分层存储 —— 来自 Paperclip。证据:轻量事件进 DB,full log 进可插拔 RunLogStore,只留 `logRef`+excerpt(`agent-run/v1`)。为何借:与 ACC "manifests/events 轻、artifacts 重"理念一致,呼应"事件逐行 append、artifact 多次物化"的性能点。

### B. 用户体验类
B1.〔★高〕渐进式披露 + output-first 的 Run/节点视图 —— 来自 Paperclip(Multica 印证)。证据:Paperclip 三层披露(`doc/PRODUCT.md:136-143`);Multica 实时事件流 + 失败分类 + 逐行重跑。为何借:正中 ACC Workbench "节点 inspector 展示真实 input/output/artifact 证据"的诉求。ACC 适配:节点 inspector 默认显示结构化摘要 + 产物,raw 日志折叠到底层;叠加 run-scoped 实时事件投影 + 按节点重跑。

B2.〔★高,面向 supervisor〕决策审计强制化 —— 来自 Multica。证据:squad leader 每轮强制写 `squad activity action|no_action|failed` 到时间线(`squad_briefing.go:41-48`)。为何借:解决 LLM 编排黑盒最大的可观测痛点。ACC 适配:supervisor 每次"选择调用/不调用某 agent"都产出结构化可审计决策记录,写进 run manifest/events。

B3.〔★高〕human-in-the-loop 交互原语标准化 —— 来自 Paperclip(Conductor 浏览器内 gate 印证)。证据:Paperclip typed 交互对象(`tools.ts:483-595`);Conductor 浏览器内应答 gate(`GateDetail.tsx`)。为何借:把"人介入"从散落弹窗变成结构化、可审计、可在 UI 渲染的交互对象。ACC 适配:节点/supervisor 需要人确认时,产出 typed interaction 落到 run-scoped 状态,Workbench 据此渲染审批/追问卡。

B4.〔★最高ROI〕运行前强校验 + `--dry-run` 执行计划 —— 来自 Conductor。证据:`config/validator.py`(58KB)在执行前抓悬空引用/缺输入/未知路由,`conductor validate` 不执行即校验(`README.md:259-267`)。为何借:把"跑到一半才炸"前移到秒级。ACC 适配:为 callable graph 增加端口绑定完整性、artifact 引用存在性、类型匹配的提交期校验,与 GraphOps dry-run 结合。低成本高收益,可近期做。

B5.〔中〕"导结构不导状态"的可复用包 + 模板/技能复用 —— 来自 Paperclip(ClipHub)+ Multica(Templates/Skills)。证据:ClipHub agent/team/company 三粒度 + semver + fork(`doc/CLIPHUB.md:21-42`);Multica 模板 + 可从 URL 导入的 Skill。为何借:ACC 已主张"模板与运行态分离",这是该理念在生态层的落地范本。ACC 适配:为 ClassTemplate/WorkflowFunctionTemplate 提供导出/导入 + 版本 + 分享,导出时强制校验模板不含 run 目录/绝对路径/session。

## 四、明确不要借鉴的(守住内核)
1. Paperclip 整套控制平面:数十个服务、`heartbeat.ts` 372KB、嵌入 Postgres——直接违反 ACC "轻量本地优先、不引入数据库"。只取局部模式。
2. Multica/Paperclip 的有状态 agent 实体:会破坏 ACC "无状态可复用类"的纯净性。只取其 Template/Skill 这层无状态复用,运行时状态保留在 ACC 的 ScopeFrame。
3. Conductor 的内联 agent 模型:跨流程复用要复制 prompt——ACC 的 ClassTemplate 明显更优,不要倒退。
4. Conductor 的共享内存数据流 / Multica 的评论黑板:都没有 ACC 的显式 port + workspace 隔离,不适合"接整个外部 agent(带自己工作目录)"。ACC 的显式契约是优势。
5. 纯涌现式编排(Multica/Paperclip):用确定性换灵活性。ACC 应保留"可重放、可审计、确定性骨架",supervisor 只在其上叠加。

## 五、落到 ACC 路线图的建议(承接已完成的 P0)
已完成 P0 双运行时/双格式收敛(阶段 1–3 + 收尾)。结合本次对比,建议下一步优先级:
1. 近期(低成本高收益):B4 提交期强校验 + A5 日志分层 + B1 渐进式披露节点视图——都不动核心架构,直接提升当前确定性 workflow 的体验与性能。
2. 中期(承接 A1):把 capsule 执行标准化为带能力位的 adapter 协议(借 Multica `Backend` + Paperclip 能力位),为多 backend 和流式/会话续接打基础。
3. 面向 supervisor(A2+A3+B2):用 Multica 的"协议注入 + roster + 路由"三件套作为骨架,但坚持 Conductor 的"LLM 只产计划、确定性引擎执行 + GraphOps 人审"——让 supervisor 成为 ACC 确定性内核之上的一层,而非替代它。这样既拿到动态灵活性,又守住可重放/可审计/无状态可复用这三条护城河。
