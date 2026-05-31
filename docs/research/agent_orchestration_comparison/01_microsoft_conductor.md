# Conductor(微软)深度架构与 UX 画像报告

> 研究对象:`F:\conductor\conductor`,**只读**分析,未修改任何文件。
> 一句话定性:这是 **微软开源的 Conductor**(包名 `conductor-cli`),一个 **CLI 优先、YAML 声明式的多 agent 工作流编排器**,与 Netflix/Orkes Conductor **无关**(那是 Java 的分布式任务编排服务)。它与 ACC 的理念**高度同源**——确定性编排、人定流程、编排环不放 LLM。
> 调研性质:只读静态分析,未修改任何文件。
> 生成日期:2026-05-29
> 相关文档:[返回索引 README](README.md) · [Multica 调研](02_multica.md) · [Paperclip 调研](03_paperclip.md) · [三方综合对比](04_synthesis_vs_acc.md)

---

## 目录

- [A. 项目定位与技术栈](#a-项目定位与技术栈)
- [B. 核心架构](#b-核心架构)
  - [B1. 编排模型:YAML DSL + 确定性状态机](#b1-编排模型yaml-dsl--确定性状态机)
  - [B2. 控制流原语(齐全)](#b2-控制流原语齐全)
  - [B3. 调度与执行:进程内单 async 循环](#b3-调度与执行进程内单-async-循环)
  - [B4. 状态管理:失败检查点 + 恢复(非通用暂停/恢复)](#b4-状态管理失败检查点--恢复非通用暂停恢复)
  - [B5. 数据流:共享上下文总线 + Jinja2 拉取](#b5-数据流共享上下文总线--jinja2-拉取)
- [C. 可复用与组合模型](#c-可复用与组合模型)
- [D. 动态 / 智能编排能力(对 ACC supervisor 最相关)](#d-动态--智能编排能力对-acc-supervisor-最相关)
- [E. 用户体验设计(重点)](#e-用户体验设计重点)
  - [E1. 开发者体验(DSL)](#e1-开发者体验dsl)
  - [E2. 可视化 Web 仪表盘(亮点)](#e2-可视化-web-仪表盘亮点)
  - [E3. 可观测性](#e3-可观测性)
  - [E4. 接入外部系统/worker 的难易度](#e4-接入外部系统worker-的难易度)
- [F. 与 ACC 理念的异同点(逐条)](#f-与-acc-理念的异同点逐条)
- [G. 最值得借鉴清单](#g-最值得借鉴清单)
  - [架构类](#架构类)
  - [UX 类](#ux-类)
- [H. 局限 / 不适用之处](#h-局限--不适用之处)
- [I. 关键证据索引(文件:行号)](#i-关键证据索引文件行号)

---

## A. 项目定位与技术栈

**身份证据(确凿,非 Netflix Conductor):**
- `README.md:1-3`:"Conductor — A CLI tool for defining and running multi-agent workflows with the GitHub Copilot SDK and Anthropic Claude."
- `README.md:5` / `pyproject.toml:51`:仓库为 `github.com/microsoft/conductor`,CI badge 指向 `microsoft/conductor`。
- `pyproject.toml:2-3`:`name = "conductor-cli"`,`version = "0.1.17"`;`classifiers` 含 `Development Status :: 4 - Beta`(`:20-21`)。
- Netflix Conductor 是 Java + Spring + DB 的 server 系统;本项目是 Python、纯本地、无 DB——完全不同的同名项目。

**技术栈(`pyproject.toml:33-48`):**
- 语言:Python ≥ 3.12(`:6`)。
- CLI:`typer` + `rich`;数据模型:`pydantic` v2;YAML:`ruamel.yaml`;模板:`jinja2`;安全表达式:`simpleeval`。
- Provider:`github-copilot-sdk`、`anthropic`、`mcp`(工具)。
- Web:`fastapi` + `uvicorn` + `websockets`(实时仪表盘);前端 React + Vite(`src/conductor/web/frontend/`)。
- 入口:`conductor = "conductor.cli.app:app"`(`pyproject.toml:58`)。

**运行形态:** 纯 CLI / 库,进程内单机执行(无 server 常驻、无 worker 集群、无 SaaS)。安装通过 `uv tool install` / `pipx` / `pip`(`README.md:80-116`)。可选的 `--web` 仪表盘是进程内 FastAPI(`web/server.py:1-16`),不是独立后端。也作为 Claude Code / Copilot CLI 的 skill 插件分发(`README.md:118-138`)。

## B. 核心架构

### B1. 编排模型:YAML DSL + 确定性状态机
- workflow 由单个 YAML 文件定义(`docs/workflow-syntax.md:17-58`),顶层结构:`workflow`(元数据/runtime/limits)、`input`、`agents[]`、`parallel[]`、`for_each[]`、`output`(`config/schema.py:982-1003`)。
- 核心设计宣言(`README.md:10-14`):"Deterministic — Routing uses Jinja2 templates and expression evaluation. First matching condition wins. No LLM in the orchestration loop, no tokens spent deciding what runs next." —— 这与 ACC "人固定流程、agent 按流程执行" 几乎逐字对应。
- agent ≠ 一个常驻自治体,而是一个 call-site:`{name, model, prompt(Jinja2), input, output schema, routes}`(`config/schema.py:450-509`)。

### B2. 控制流原语(齐全)
节点有 4 种 `type`(`config/schema.py:461`):`agent | human_gate | script | workflow`,加上两类并行组:

| 原语 | 实现证据 | 说明 |
|---|---|---|
| 顺序 / 条件分支 / 循环回边 | `engine/router.py:62-111`,`engine/workflow.py:4185-4218` | `routes[].when` 首个匹配胜出;`to` 可指回已执行节点形成 loop |
| 静态并行 fork/join | `config/schema.py:111-143`,`engine/workflow.py:3455-3741` | 固定 agent 列表并发,`failure_mode: fail_fast/continue_on_error/all_or_nothing` |
| 动态并行 for-each | `config/schema.py:145-261`,`engine/workflow.py:3772-4184` | 运行时按数组 fan-out,`max_concurrent` 分批,`key_by` 字典聚合 |
| 子工作流(嵌套/递归) | `docs/workflow-syntax.md:284-372`,`engine/workflow.py:1032-1261` | 黑盒复用,`input_mapping` 显式传参,`MAX_SUBWORKFLOW_DEPTH=10` |
| Human-in-the-loop gate | `docs/workflow-syntax.md:112-173`,`engine/workflow.py:2168-2242` | 暂停等人选,选项驱动路由,支持 Markdown/可点击文件链接 |
| Script step | `docs/workflow-syntax.md:175-282`,`executor/script.py` | 跑 shell,按 `exit_code` 或 stdout JSON 路由 |
| Dialog mode | `engine/dialog_evaluator.py`,`gates/dialog.py` | agent 不确定时暂停多轮对话 |
| wait/timer | 未找到专门的 wait/sleep 原语 | 只有 timeout/限流,无定时等待 |

### B3. 调度与执行:进程内单 async 循环
- 无 server/worker 解耦:核心是 `WorkflowEngine._execute_loop` 的单个 `while True`(`engine/workflow.py:1954-1983`),在一个进程的 asyncio 事件循环里:找节点 → 执行 → 存上下文 → 评估路由 → 跳下一个。
- 无任务队列、无持久化 DB:状态在内存(`WorkflowContext`)。并行靠 `asyncio` 任务并发(`engine/workflow.py:3503+`),不是分布式 worker。
- 失败/重试/超时/补偿:
  - 重试:per-agent `RetryPolicy`(`config/schema.py:359-395`),`max_attempts`、`fixed/exponential` backoff、`retry_on: [provider_error, timeout]`;校验错误不重试。
  - 超时:三层——workflow 级 `limits.timeout_seconds`、per-request、per-agent `timeout_seconds`(硬取消,`config/schema.py:570-607`)。
  - 限流:`max_iterations`(默认 10,上限 500,`config/schema.py:301`)。
  - 补偿/回滚:无。没有 saga/补偿事务概念,失败即中止 + 存检查点。

### B4. 状态管理:失败检查点 + 恢复(非通用暂停/恢复)
- `CheckpointManager`(`engine/checkpoint.py`)在失败时序列化 `WorkflowContext` + `LimitEnforcer` + 当前 agent + session_ids + 指令前言 到 `$TMPDIR/conductor/checkpoints/<name>-<ts>.json`(`:150-257`)。
- 恢复:`conductor resume`(`engine/workflow.py:1356-1382`),用 workflow SHA-256 哈希校验文件未变(`:137-148`);仪表盘可回放原 JSONL 事件重建时间线(`AGENTS.md:219`)。
- 能力边界:
  - 长时间运行:✅(无强制总超时,默认 `None`,`config/schema.py:304-310`)。
  - 暂停/恢复:仅"失败后恢复" + 交互式 Esc 中断(`interrupt/listener.py`);没有主动 suspend-to-disk 的任意挂起。
  - 回放(replay):✅ UI 层时间线回放(`web/replay.py`),但不是重新执行,而是事件重放观测。

### B5. 数据流:共享上下文总线 + Jinja2 拉取
- 这是与 ACC 最大的架构差异。Conductor 用一个全局共享的 `WorkflowContext`(`engine/context.py:62-108`),每个 agent 输出存进 `agent_outputs[name]`,下游 agent 用 Jinja2 模板拉取 `{{ upstream.output.field }}`(`docs/workflow-syntax.md:500-553`)。
- 三种上下文模式(`config/schema.py:279-289`,`context.py:160-260`):
  - `accumulate`(默认):看到所有先前输出。
  - `last_only`:只看上一个。
  - `explicit`:只看 `input:` 里显式声明的依赖(最接近 ACC 的显式数据流)。
- 表达式两套并存(`router.py:113-159`):Jinja2(`{{ }}`)+ simpleeval(算术);均沙箱化(`design.md:320`,`779-796`)。
- 关键:没有 workspace 隔离、没有 inbox/outbox/artifact 文件流。数据是进程内内存对象,通过模板"拉"而非 sender "推"。for-each 各分片拿到 context 深拷贝快照实现隔离(`docs/dynamic-parallel.md:458-496`)。

## C. 可复用与组合模型

| 维度 | Conductor 的做法 | 证据 |
|---|---|---|
| agent 是否可独立复用 | 否。agent 定义内联在每个 workflow 的 `agents[]` 里,无独立 agent 资产文件 | `config/schema.py:993` |
| 复用的最小单位 | 整个 workflow(经子工作流引用 + registry) | `docs/workflow-syntax.md:284-372` |
| workflow 版本化 | Git tag 驱动:registry 里按 git tag/branch/SHA 引用,SHA 缓存 | `docs/design/registry.md:152-217` |
| 引用语法 | `workflow@registry#ref`,本地路径,或 ad-hoc `workflow@owner/repo#ref` | `docs/design/registry.md:92-130, 301-342` |
| 片段复用 | `!file` 标签内联外部 prompt/schema/tools | `docs/workflow-syntax.md:755-933` |
| 无状态模板 vs 运行实例分离 | 部分:WorkflowConfig(Pydantic)是模板,`WorkflowContext`/checkpoint 是运行态;但模板与实例没有 ACC 那样的"类/实例"显式建模 | `schema.py` vs `context.py` |

与 ACC "类/函数/实例" 的核心异同:
- ACC:agent 节点 = 可复用无状态 ClassTemplate;workflow = 函数;放节点 = 类实例化。agent 本身是一等复用资产。
- Conductor:没有可复用的 agent 类。它的"函数级复用"= 子工作流(workflow 即函数,`type: workflow` 调用 = 函数调用,`input_mapping` = 实参绑定),这点与 ACC 的 `WorkflowFunctionTemplate` 思路一致;但缺少 ACC 的 agent-as-class 层——同一个"reviewer agent"要在多个 workflow 用,必须复制 prompt 或抽成子工作流。
- 模板/运行态分离:两者都做了,但 Conductor 的模板里仍内联了 prompt 等行为定义,不像 ACC 强调"模板不存运行目录/会话记忆"那样彻底的资产化。

## D. 动态 / 智能编排能力(对 ACC supervisor 最相关)

结论:Conductor 是"运行时数据驱动的动态展开",但坚决不是"LLM 决定下一步"。这恰好是 ACC supervisor 要补的方向,可作为反面/边界参照。

1. 动态 fan-out(for-each):运行时根据上游产出的数组决定并发实例数 N(`docs/dynamic-parallel.md:11-16`,`engine/workflow.py:3223-3329` 解析数组、`3772+` 执行)。N 在定义时未知,运行时定。
2. 数据驱动分支:`routes[].when` 基于上游输出值选路(`router.py`);script step 可输出 JSON 让下游按字段路由(`docs/workflow-syntax.md:207-224`)。
3. 动态子工作流选择:`workflow:` 字段可被 Jinja2/环境变量参数化,for-each 内可对每个 item 跑子工作流(`docs/workflow-syntax.md:355-370`)。
4. 唯一的 LLM 参与控制的地方——Dialog mode:`DialogEvaluator` 用一次 LLM 调用判断 agent 是否该"暂停问人"(`dialog_evaluator.py:88-155`)。但它只决定"暂停/继续",绝不决定"下一个跑谁"——路由仍 100% 确定性。
5. 面向 LLM/agent 的编排原语:无。没有"编排者 agent 运行时挑选可复用 agent"的 supervisor 能力。`README.md:13` 明确把"不让 LLM 进编排环"当卖点。

> 对 ACC 的启示:Conductor 证明了"确定性骨架 + 运行时数据驱动展开(for-each/conditional)"能覆盖大量真实场景,且可调试、可复现。ACC 未来 supervisor 若引入 LLM 决策,值得保留 Conductor 这种"确定性兜底 + 数据驱动展开"作为非 LLM 路径,避免每步都烧 token。

## E. 用户体验设计(重点)

### E1. 开发者体验(DSL)
- DSL 可读性高:扁平 YAML,`entry_point` + `agents[].routes[].to` 直接表达图;prompt 用 `|` 多行 + Jinja2(`README.md:144-165`)。
- `!file` 外置长 prompt/schema,保持 YAML 简洁(`docs/workflow-syntax.md:794-866`)。
- 强校验:`config/validator.py`(58KB)+ Pydantic 在运行前抓出:未知路由目标、缺失输入、悬空模板引用、保留变量名冲突(`config/schema.py:1005-1063`、`212-228`)。`conductor validate` 不执行即校验(`README.md:259-267`)。
- 本地调试:`--dry-run` 看执行计划(`build_execution_plan`,`engine/workflow.py:4397-4430`);`--log-file`;`-q/-s` 控噪;`--emit-json` 风格的结构化输出。
- MCP 工具:`mcp_servers` 声明,`tools` 过滤(`config/schema.py:778-821`,`docs/mcp-tools.md`)。

### E2. 可视化 Web 仪表盘(亮点)
- `conductor run --web`(或 `--web-bg` 后台)起进程内 FastAPI + WebSocket(`README.md:181-206`,`web/server.py`)。
- 信息架构(`README.md:191-198`,前端组件 `web/frontend/src/components/`):
  - 交互式 DAG 图(React + 自定义布局 `graph-layout.ts`):可缩放拖拽,动画边显示执行流与条件路由;节点类型化(Agent/Gate/Script/Group/End,见 `graph/*Node.tsx`)。
  - 三栏布局:图 + agent 详情 + 标签页输出(Log/Activity/Output),可调宽(`ResizableLayout.tsx`,`OutputPane.tsx`)。
  - 实时流式:agent 推理/工具调用/输出实时流入(`ActivityStream.tsx`,`use-websocket.ts`)。
  - 浏览器内 human gate:直接在 UI 应答决策点(`GateDetail.tsx`,`engine/workflow.py:1486-1586`)。
  - 子工作流面包屑钻取(`BreadcrumbBar.tsx`)、回放条(`ReplayBar.tsx` + `web/replay.py`)、深链(`use-deep-link.ts`,`docs/dashboard-deep-links.md`)。
  - 每节点显示 prompt、model、tokens、cost(`MetadataGrid.tsx`,`engine/pricing.py`)。

### E3. 可观测性
- pub/sub 事件系统(`events.py`)解耦执行与渲染;多订阅者:控制台、JSONL 日志(`engine/event_log.py`)、Web。
- 事件粒度细:`agent_started`、`agent_turn_start`、`agent_reasoning`、`agent_tool_start/complete`、`route_taken`、`gate_presented/resolved`、`script_started/failed`、`workflow_completed/failed`(`AGENTS.md:179-189`,`engine/workflow.py:2049-2266`)。
- 失败定位:`.events.jsonl` + `--web-bg` 子进程 stderr/stdout 日志三件套同名时间戳归档;`faulthandler` 捕原生崩溃(`AGENTS.md:131-151`)。
- 成本/token 追踪:`CostConfig` + `engine/usage.py` + `pricing.py`,per-agent 与汇总(`config/schema.py:330-343`)。

### E4. 接入外部系统/worker 的难易度
- Provider 抽象(`providers/base.py:110-216`):`execute / validate_connection / close` 三方法,新增 SDK 即实现一个子类。已有 Copilot、Claude(各 ~88KB,功能对等约束见 `AGENTS.md:175-191`)。
- 注意:这里"接入外部"指 接 LLM SDK(API 级),agent 内部的 agentic 工具循环交给外部 SDK(`max_agent_iterations` 等),Conductor 只管边界——这点与 ACC "接成熟外部 agent" 方向一致,但粒度更细(SDK 级而非整个外部 agent 进程 + workspace)。
- 外部协作:registry / ad-hoc GitHub 引用做跨团队 workflow 组合(`docs/design/registry.md:301-409`)。

## F. 与 ACC 理念的异同点(逐条)

| # | 维度 | ACC | Conductor | 异同 |
|---|---|---|---|---|
| F1 | 编排控制权归人 | 人固定流程,机械 DAG | 同左,且明确"编排环不放 LLM"(`README.md:13`) | 高度一致 ✅ |
| F2 | 确定性/可复现 | 强调 | "Repeatable/Deterministic/Source-controlled"(`README.md:10-14`) | 一致 ✅ |
| F3 | agent = 可复用无状态类 | 核心(ClassTemplate) | 无此层,agent 内联在 workflow | 重大差异 ❌ |
| F4 | workflow = 函数 | WorkflowFunctionTemplate | `type: workflow` 子工作流 + `input_mapping` | 一致(函数级) ✅ |
| F5 | 模板 vs 运行态分离 | 严格(模板不存运行目录/会话) | 部分(模板内联 prompt;运行态在 context/checkpoint) | 方向一致,彻底度低 ◐ |
| F6 | 数据显式流转 port/inbox/outbox/artifact;sender 不写 receiver | 核心 | 共享内存 context + Jinja2 拉取;`explicit` 模式最接近;无 workspace/文件流 | 重大差异 ❌ |
| F7 | 无缝接入成熟外部 agent,复用其 workspace 能力 | 核心目标 | 接的是 LLM SDK(Copilot/Claude/MCP),非整个外部 agent + 独立 workspace | 方向像,粒度不同 ◐ |
| F8 | 未来 supervisor(LLM 运行时挑可复用 agent) | 规划中 | 刻意不做;仅 for-each/conditional 数据驱动动态 | 理念分叉 ⚠ |
| F9 | 可视化工作台 | 有(Workbench) | 有(只读监控 + gate 应答,非可视编辑) | 都有 UI,定位不同 ◐ |
| F10 | 人审/治理(GraphOps proposal→approval) | 强 | 仅 human_gate(运行时人审),无 graph 变更治理 | ACC 更重治理 ◐ |
| F11 | 并发多 run | run-scoped 状态 | CLI 可并行多进程;`--web-bg` + PID 管理 | 思路一致 ✅ |

## G. 最值得借鉴清单

### 架构类
1. "确定性骨架 + 运行时数据驱动展开"作为 supervisor 的非 LLM 底座(借鉴 D 节 + F8)。理由:Conductor 用 for-each(运行时定 N)+ conditional routing 覆盖了大量"看起来需要智能"的场景,零 token、可复现、可调试。对 ACC 建议:supervisor 落地时,把"LLM 选 agent"作为可选上层,底层保留 Conductor 式确定性展开;LLM 只产出"调用计划/参数",由确定性引擎执行 + 人审兜底,契合 ACC GraphOps 治理。
2. 运行前强校验 + `--dry-run` 执行计划(借鉴 E1)。理由:`validator.py` 在执行前抓悬空引用/缺输入/未知路由,把 LLM 编排里最痛的"跑到一半才炸"前移到秒级校验(`config/schema.py:1005-1063`)。对 ACC 建议:为 callable graph 增加"提交即校验"(端口绑定完整性、artifact 引用存在性、类型匹配),与现有 GraphOps dry-run 结合。
3. 失败检查点 + 哈希校验恢复(借鉴 B4)。理由:`CheckpointManager` 在失败点序列化全部运行态,`resume` 用 workflow SHA-256 防止"文件改了还硬恢复"(`engine/checkpoint.py:137-148`)。对 ACC 建议:ACC 已有 run-scoped 制品,可补一层"失败即检查点 + 模板哈希校验",让长流程从断点续跑而非重头。
4. Provider 对等契约(借鉴 E4)。理由:`AGENTS.md:175-191` 强制所有 provider 事件类型、重试语义、输出结构完全对等,保证 UI/日志跨 provider 一致。对 ACC 建议:ACC 接多种外部 agent(codex/claude/hermes)时,定义统一的"会话事件 + artifact 输出对等契约",避免 UI 对不同 agent 各写一套。

### UX 类
5. 进程内零配置实时仪表盘(借鉴 E2)。理由:`--web` 一个 flag 起 DAG 可视化 + 实时流 + 浏览器内 gate + 成本展示,无需独立部署(`README.md:181-206`)。对 ACC 建议:ACC Workbench 可吸收其"动画边显示当前路由/执行流""节点 token+cost 内联""子工作流面包屑钻取"的信息架构;尤其"浏览器内 human gate"对 ACC 人审环节非常契合。
6. 事件流 → JSONL + 多订阅者解耦(借鉴 E3)。理由:`events.py` 单一事件源喂控制台/JSONL/Web,失败时三件套日志同名归档便于事后取证(`AGENTS.md:131-151`)。对 ACC 建议:把 ACC 运行事件统一成单一 append-only JSONL 真相源,UI 与控制台都是其投影,天然支持回放与"晚加入"客户端补状态。

## H. 局限 / 不适用之处

1. 无可复用 agent 资产层(对 ACC 最关键的缺口):agent 内联在每个 workflow,跨流程复用 reviewer/researcher 必须复制 prompt 或抽子工作流。ACC 的 ClassTemplate 在此明显更优,不应照搬 Conductor 的内联模型(`config/schema.py:993`)。
2. 数据流是共享内存 + 模板拉取,无 workspace/文件级隔离:不适合 ACC "agent 在各自 workspace 复用原能力、产物经 artifact 显式流转"的目标。Conductor 没有 sender→receiver 的显式制品边界(`engine/context.py:62-108`)。这对"接整个外部 agent(带自己工作目录)"是硬伤。
3. 单进程、无分布式:无任务队列、无 DB、无 worker 集群(`AGENTS.md:79-84`)。大规模/跨机/持久排队场景不适用——但这恰好与 ACC "轻量本地优先"一致,不是缺点而是边界对齐。
4. 无补偿/事务回滚:失败即中止 + 检查点,没有 saga。涉及外部副作用(写库/发消息)的流程需自行幂等。
5. 刻意不做 LLM 编排(对 ACC supervisor 是反向参照):它不能动态"挑 agent",所以不能直接拿来当 supervisor 蓝本,只能借其确定性引擎作为 supervisor 的执行底座。
6. 无专门 wait/timer/事件等待原语:只有 timeout/中断;长流程里"等外部事件再继续"需用 human_gate 或 script 轮询绕。
7. provider = LLM SDK 级,非"成熟外部 agent 进程":与 ACC "承载 codex/claude code 整个 agent" 的粒度不同;Conductor 自己持有 SDK 会话与 agentic 循环参数(`config/schema.py:599-617`),没有 ACC 那种"外部 agent 拥有自己内部循环、ACC 只管边界"的彻底解耦(虽然方向相同)。

## I. 关键证据索引(文件:行号)

定位 / 技术栈:`README.md:1-14, 181-206, 208-231, 269-290`;`pyproject.toml:2-3, 33-48, 51-58`;`AGENTS.md:3-5, 63-121, 175-191`;`docs/projects/initial-implementaiton/copilot-conductor.design.md:23-64, 97-119, 290-320`。
DSL / 控制流:`docs/workflow-syntax.md:17-58, 70-110, 112-173, 175-282, 284-372, 374-409, 410-553, 555-595`;`config/schema.py:88-108, 111-261, 359-395, 450-775, 824-915, 917-1063`。
调度/执行/状态/数据流:`engine/workflow.py:1954-2293, 3223-3329, 3455-3741, 3772-4184, 4185-4218, 4270-4300, 4397-4430`;`engine/router.py:62-159`;`engine/context.py:62-108, 160-260, 506-540`;`engine/checkpoint.py:116-148, 150-257, 259-349`。
复用/组合/版本化:`docs/design/registry.md:92-217, 301-409`;`docs/workflow-syntax.md:755-933`。
动态/智能编排:`docs/dynamic-parallel.md:11-16, 166-196, 458-496`;`engine/dialog_evaluator.py:21-40, 88-155`。
UX/可观测性:`web/server.py:1-90`;`events.py:27-112`;`web/frontend/src/components/{graph,detail,layout}/*`;`AGENTS.md:131-151, 219`。
Provider/外部接入:`providers/base.py:110-246`;`config/schema.py:778-821, 599-617`。

未确认 / 说明:`engine/workflow.py` ~4460 行,精读核心循环与分派及方法签名全表,未逐行通读 provider 实现(`claude.py`/`copilot.py` 各 ~88KB),属 SDK 适配细节,不影响编排架构结论。"无 wait/timer 原语""无补偿事务"是基于 schema 全字段 + 控制流文档 + 方法签名全表的否定性判断。目录可正常访问,前端有已构建产物,源码齐全。
