> Current note: this document describes the deprecated compatibility path for `codex exec`.
> Workbench/Core v2 Codex agent nodes now use `codex_app_server`, launched as
> `codex app-server --listen stdio://`. See `docs/ACC_CODEX_APP_SERVER_RUNTIME.md`.

# ACC 调用 Codex CLI 的形式：第一性原理与费曼式拆解

> 结论先行：ACC 当前不是直接调用 OpenAI API，也不是自己实现一个 LLM agent loop。ACC 把一个 workflow 里的 Codex agent 节点包装成一次本地 `codex exec` 子进程调用。`codex`、`exec`、`--sandbox`、`--json`、`--output-schema`、`-o`、`--search`、`--cd`、`-` 这些是 Codex CLI 官方/本机 CLI 提供的命令或参数；`ACC_RUN_MODE`、`ACC_ENABLE_EXTERNAL_AGENT_EXECUTION`、`ACC_CODEX_TIMEOUT_SECONDS`、`resolved_prompt.md`、`agent_payload.json`、`runtime.json`、`events.jsonl` 等是 ACC 自己定义的运行控制和证据文件。

本文基于当前仓库代码、当前本机 `codex --help` / `codex exec --help` 输出，以及通过 `openai-docs` skill 拉取的 Codex manual。当前工作区存在未提交改动，所以本文描述的是当前磁盘代码事实。

## 1. 第一性原理：ACC 到底需要解决什么问题？

从最底层看，ACC 要解决的不是“让模型回答问题”这么简单，而是一个工程调度问题：

1. 一个 workflow 里有多个节点，每个节点可能依赖上游节点输出。
2. 每个节点都要有明确输入、工作目录、权限、超时、输出 schema、日志和失败证据。
3. 外部 agent 比如 Codex 应该只负责“在一个明确上下文里完成任务”，不要反过来掌控整个 ACC runtime。
4. 默认测试必须 hermetic，不能因为没有真实 Codex 登录、网络、付费服务而失败。
5. 真正调用外部 agent 必须显式打开，否则本地开发和 CI 会变得不可控。

所以 ACC 的设计不是：

```text
Workflow 直接把一堆上下文塞给 Codex，让 Codex 自己决定一切
```

而是：

```text
ACC 负责边界：
  - 什么时候调 Codex
  - 给 Codex 什么输入
  - Codex 在哪个目录工作
  - Codex 有什么权限
  - Codex 必须写出什么 JSON
  - stdout/stderr/events/output 保存到哪里

Codex 负责能力：
  - 理解 prompt
  - 在 sandbox 约束下读代码、运行命令、生成结果
  - 按 schema 输出最后结果
```

换成渲染管线类比：ACC 像 render graph / frame graph，它决定 pass 的依赖、资源绑定、执行顺序和 barrier；Codex 像某个具体 pass 的 shader/compute kernel。ACC 不替 kernel 写算法，但它必须决定输入 attachment、输出 attachment、执行环境和错误记录。

## 2. 费曼式白话：一次 Codex 节点调用像什么？

可以把一次 Codex 节点运行想成 ACC 临时雇一个外包工程师：

1. ACC 先准备一张任务单：`resolved_prompt.md`。
2. ACC 再准备输入材料：`agent_payload.json` / `input.json`。
3. ACC 规定交付格式：`output_schema.json`。
4. ACC 指定办公地点：`--cd <workspace_dir>`。
5. ACC 规定权限：只能看、能改 workspace，还是完全放开。
6. ACC 启动本地 `codex exec`，把任务单从 stdin 塞进去。
7. Codex 工作时的 stdout/stderr 被 ACC 收进节点目录。
8. Codex 最后必须把结果写到 `output.json`。
9. ACC 读回 `output.json`，确认是 JSON object，并用 schema 再校验一遍。

关键点：Codex 不是从 ACC 的 Python 对象里“感知”节点输入的。它看到的是 ACC 写好的 prompt、文件、环境变量和工作目录。

## 3. 真实调用什么时候发生？

真实 Codex 子进程只在两个条件同时满足时发生：

```text
ACC_RUN_MODE=production
ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1
```

代码路径：

- `acc_run_mode()` 默认返回 `hermetic`：`acc/runtime/policy.py`
- `external_agent_execution_enabled()` 读取 `ACC_ENABLE_EXTERNAL_AGENT_EXECUTION`
- `CallableClassRunner.run_agent_class()` 在 hermetic 模式直接写 stub `output.json`
- 只有 production 且 external-agent gate 打开后，才创建 `AgentRunRequest` 并调用 `CodexCliAdapter`

说人话：`ACC_RUN_MODE=production` 表示“我现在允许进入真实运行模式”；`ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1` 表示“我明确允许启动外部 agent 进程”。这两个开关是双保险，避免本地测试或 CI 不小心跑真实 Codex。

## 4. ACC 实际拼出来的 Codex 命令

当前 `build_codex_command()` 生成的普通形态：

```powershell
codex `
  [--search] `
  exec `
  --cd <workspace_dir> `
  --sandbox <read-only|workspace-write> `
  --json `
  --output-schema <run_dir>/nodes/<node_id>/output_schema.json `
  -o <run_dir>/nodes/<node_id>/output.json `
  -
```

如果权限是 dangerous，ACC 不再传 `--sandbox ...`，而是传：

```powershell
codex `
  [--search] `
  exec `
  --cd <workspace_dir> `
  --dangerously-bypass-approvals-and-sandbox `
  --json `
  --output-schema <schema> `
  -o <output.json> `
  -
```

这里最后的 `-` 很重要：它表示 `codex exec` 的 prompt 从 stdin 读取。ACC 会读取 `resolved_prompt.md`，然后写入 Codex 子进程 stdin。

## 5. 哪些是 Codex 官方提供，哪些是 ACC 自己定义？

| 项 | ACC 是否使用 | 来源归属 | 官方/自定义判断 | 在 ACC 中的作用 | 关键代码/来源 |
|---|---:|---|---|---|---|
| `codex` | 是 | Codex CLI | Codex 官方 CLI 可执行文件 | 启动 Codex 命令行程序 | `acc/adapters/codex_cli.py::build_codex_command()`；本机 `codex --help` |
| `exec` | 是 | Codex CLI | Codex 官方子命令 | 非交互运行 Codex，适合脚本和流水线 | Codex manual：Non-interactive mode；本机 `codex exec --help` |
| `--cd <DIR>` | 是 | Codex CLI | Codex 官方参数 | 告诉 Codex 以哪个目录作为 working root | `build_codex_command()`；本机 `codex exec --help` |
| `--sandbox read-only` | 是 | Codex CLI | Codex 官方参数 | 只读 sandbox；ACC 默认低权限 | `codex_sandbox_for_permissions()`；本机 `codex exec --help` |
| `--sandbox workspace-write` | 是 | Codex CLI | Codex 官方参数 | 允许 Codex 写 workspace | `codex_sandbox_for_permissions()` |
| `--sandbox danger-full-access` | 当前不直接拼 | Codex CLI | Codex 官方参数 | Codex 支持，但 ACC 当前 dangerous 分支改用 bypass flag | 本机 `codex exec --help`；ACC 代码分支 |
| `--dangerously-bypass-approvals-and-sandbox` | 条件使用 | Codex CLI | Codex 官方高风险参数 | 当 `PermissionProfile.dangerous=true` 时跳过 sandbox/approval | `acc/adapters/codex_cli.py::build_codex_command()` |
| `--search` | 条件使用 | Codex CLI | Codex 官方参数 | 开启 live web search；ACC 用 `network=true` 映射 | `AgentRunRequest.enable_search`；本机 `codex --help` |
| `--json` | 是 | Codex CLI | Codex 官方参数 | 让 Codex stdout 输出 JSONL event stream，便于机器消费 | `build_codex_command()`；Codex manual non-interactive JSONL |
| `--output-schema <FILE>` | 是 | Codex CLI | Codex 官方参数 | 要求最终结果符合 JSON Schema | `output_schema_for_agent()` + `build_codex_command()`；Codex manual structured outputs |
| `-o <FILE>` / `--output-last-message <FILE>` | 是 | Codex CLI | Codex 官方参数 | 把 Codex 最后一条消息写到文件；ACC 把它当 `output.json` | 本机 `codex exec --help` 显示 `-o, --output-last-message` |
| `-` | 是 | Codex CLI prompt 参数约定 | Codex 官方 stdin 约定 | prompt 不作为 argv 传，而是从 stdin 读 | 本机 `codex exec --help`：`-` 时从 stdin 读取 instructions |
| `ACC_RUN_MODE` | 是 | ACC | ACC 自定义环境变量 | 控制 hermetic / production 模式 | `acc/runtime/policy.py` |
| `ACC_ENABLE_EXTERNAL_AGENT_EXECUTION` | 是 | ACC | ACC 自定义环境变量 | production 下是否允许启动外部 agent | `acc/runtime/policy.py` |
| `ACC_CODEX_TIMEOUT_SECONDS` | 是 | ACC | ACC 自定义环境变量 | 覆盖生产 Codex timeout；默认 900 秒 | `acc/runtime/policy.py` |
| `CODEX_HOME` | 是 | Codex CLI 环境变量，ACC 会设置 | Codex 官方环境变量；ACC 自己做隔离复制 | 指向本次节点的隔离 Codex home | Codex manual environment variables；`prepare_isolated_codex_home()` |
| `CODEX_API_KEY` | 当前 ACC 不主动设置 | Codex CLI | Codex 官方环境变量 | 可供 `codex exec` 单次 API key auth 使用 | Codex manual environment variables |
| `ACC_RUN_DIR` | 是 | ACC | ACC 自定义注入给外部进程 | 告诉外部 agent 当前 ACC run dir | `acc/adapters/base.py::build_shared_acc_env()` |
| `ACC_INBOX_DIR` | 是 | ACC | ACC 自定义 | 告诉外部 agent inbox 路径 | `build_shared_acc_env()` |
| `ACC_OUTBOX_DIR` | 是 | ACC | ACC 自定义 | 告诉外部 agent outbox 路径 | `build_shared_acc_env()` |
| `ACC_ENVIRONMENT_ID` | 是 | ACC | ACC 自定义 | 标识当前 scope/environment | `build_shared_acc_env()` |
| `ACC_NODE_ID` | 是 | ACC | ACC 自定义 | 标识当前 workflow node | `build_shared_acc_env()` |
| `ACC_RUN_ID` | 是 | ACC | ACC 自定义 | 标识当前 workflow run | `build_shared_acc_env()` |
| `resolved_prompt.md` | 是 | ACC | ACC 自定义文件 | ACC 渲染后的最终 prompt，写入 Codex stdin | `render_agent_prompt()` |
| `agent_payload.json` / `input.json` | 是 | ACC | ACC 自定义文件 | 节点 materialized input 证据 | `execute_core_v2_node()` / `run_agent_class()` |
| `output_schema.json` | 是 | ACC 文件，内容传给 Codex 官方参数 | 文件由 ACC 生成；参数是 Codex 官方 | Codex 最终输出 schema | `output_schema_for_agent()` |
| `output.json` | 是 | ACC 约定输出路径，通过 Codex 官方 `-o` 写入 | 文件路径由 ACC 定；`-o` 是 Codex 官方 | 节点机器可读结果 | `AgentRunRequest.output_json_path` |
| `runtime.json` | 是 | ACC | ACC 自定义证据文件 | 记录 adapter、命令、权限、路径、binding materialization | `runtime_payload()` |
| `stdout.log` / `stderr.log` | 是 | ACC | ACC 自定义日志文件 | 保存 Codex stdout/stderr | `stream_process()` |
| `events.jsonl` | 是 | ACC | ACC 自定义事件文件 | 保存 adapter event、timeout、failed 等 ACC 事件 | `CodexCliAdapter.run()` |
| `auth.json` | ACC 复制，不解释内容 | Codex state | Codex 状态文件；ACC 只复制 | 隔离 Codex 登录态 | `prepare_isolated_codex_home()`；Codex manual auth/state |
| `config.toml` | ACC 复制，不解释内容 | Codex config | Codex 官方配置文件；ACC 只复制 | 隔离 Codex 配置 | `prepare_isolated_codex_home()`；Codex manual config |
| `AGENTS.md` | ACC 复制 | Codex instruction surface | Codex 官方 instruction 文件；项目本身也有 ACC 的 AGENTS.md | 给 Codex durable guidance | `prepare_isolated_codex_home()`；Codex manual AGENTS.md |

### 关键判断

ACC 只“借用”Codex CLI 的官方命令行能力，不定义 `--sandbox`、`--json`、`--output-schema` 这些 flag。ACC 自己定义的是：

- 何时允许调用外部 agent。
- 怎么把 workflow/node/input/binding 转成 prompt。
- 运行目录和证据文件结构。
- 权限模型如何映射成 Codex CLI 参数。
- Codex 输出必须落在哪个文件，并如何二次校验。

## 6. ACC 当前用了哪些 Codex 命令？

当前产品运行路径只使用一个 Codex 子命令：

```text
codex exec
```

并使用这些 `codex exec` / global 参数：

| Codex CLI 项 | 当前 ACC 是否使用 | 为什么用 |
|---|---:|---|
| `exec` | 是 | 非交互模式，适合 workflow runtime 自动调度 |
| `--cd` | 是 | 绑定 Codex 工作目录到 `ScopeFrame.workspace_root` |
| `--sandbox` | 是 | 把 ACC 权限模型落到 Codex sandbox |
| `--dangerously-bypass-approvals-and-sandbox` | 条件使用 | dangerous 权限时使用，风险最高 |
| `--search` | 条件使用 | `PermissionProfile.network=true` 时开启 live search |
| `--json` | 是 | 捕获 Codex JSONL 事件流到 stdout log |
| `--output-schema` | 是 | 强约束最终输出 JSON shape |
| `-o` / `--output-last-message` | 是 | 把最终消息写到 ACC 的 `output.json` |
| `-` prompt | 是 | prompt 从 `resolved_prompt.md` 通过 stdin 传入 |

当前 ACC 没有在这条路径里使用：

| Codex CLI 项 | 当前 ACC 是否使用 | 说明 |
|---|---:|---|
| `codex` interactive TUI | 否 | ACC 不打开交互 TUI |
| `codex review` | 否 | ACC 当前没有把 agent 节点调度成官方 review 子命令 |
| `codex login/logout` | 否 | ACC 假设 Codex auth 已经存在，最多复制 `auth.json` |
| `codex mcp` | 否 | ACC 不通过该路径管理 Codex MCP server |
| `codex plugin` | 否 | ACC 不通过该路径管理 Codex plugins |
| `codex mcp-server` | 否 | ACC 不把 Codex 当 MCP server 启动 |
| `codex app/app-server/remote-control` | 否 | ACC 不启动 Codex 桌面 app 或 app server |
| `codex completion/update/doctor` | 否 | 安装、补全、诊断类命令不属于 workflow 节点执行 |
| `codex sandbox` | 否 | ACC 使用 `exec --sandbox`，不是单独 `codex sandbox` |
| `codex apply/resume/archive/unarchive/fork/cloud/exec-server/features/debug` | 否 | 当前 adapter 没有调这些子命令 |
| `--model` / `-m` | 否 | UI metadata 有 model，但当前 ACC 没有映射到 Codex CLI 参数 |
| `--profile` | 否 | 当前 ACC 使用隔离 `CODEX_HOME`，没有传 profile |
| `--ask-for-approval` | 否 | 当前 ACC 只传 sandbox 或 dangerous bypass，不传 approval policy |
| `--add-dir` | 否 | 当前 ACC 没有给 Codex 额外 writable dir |
| `--ephemeral` | 否 | 当前 ACC 依赖节点目录里的运行证据，不用 ephemeral |
| `--ignore-user-config` / `--ignore-rules` | 否 | 当前 ACC 反而复制 `config.toml` / `AGENTS.md` 到隔离 home |

## 7. Codex CLI 还提供哪些命令？

下面是当前本机 `codex --help` 暴露的 root commands。官方 Codex manual 的 CLI command reference 也列出了核心命令；本机 help 是当前安装版本的直接事实。

| 命令 | 本机 help 是否列出 | 官方 manual 是否覆盖 | 用途 | ACC 当前是否使用 |
|---|---:|---:|---|---:|
| `codex` | 是 | 是 | 交互 TUI | 否 |
| `codex exec` / `codex e` | 是 | 是 | 非交互运行 Codex | 是 |
| `codex review` | 是 | manual 有 review 章节/行为 | 非交互 code review | 否 |
| `codex login` | 是 | 是 | 登录/auth 管理 | 否 |
| `codex logout` | 是 | 是 | 删除认证 | 否 |
| `codex mcp` | 是 | 是 | 管理 MCP servers | 否 |
| `codex plugin` | 是 | manual 有 plugin 相关内容 | 管理 Codex plugins | 否 |
| `codex mcp-server` | 是 | 是 | 以 stdio MCP server 形式启动 Codex | 否 |
| `codex app-server` | 是 | 是，experimental | 启动 Codex app server | 否 |
| `codex remote-control` | 是 | 是，experimental | 管理 remote-control app-server daemon | 否 |
| `codex app` | 是 | 是 | 启动 Codex desktop app | 否 |
| `codex completion` | 是 | 是 | 生成 shell completion | 否 |
| `codex update` | 是 | 是 | 更新 Codex CLI | 否 |
| `codex doctor` | 是 | 是 | 本地安装/config/auth/runtime 诊断 | 否 |
| `codex sandbox` | 是 | 是，experimental | 在 Codex sandbox 中运行命令 | 否 |
| `codex debug` | 是 | 是，experimental 子项 | 调试工具 | 否 |
| `codex apply` / `codex a` | 是 | 是 | 应用 Codex Cloud task 的 diff | 否 |
| `codex resume` | 是 | 是 | 恢复交互 session | 否 |
| `codex archive` | 是 | 本机 help 列出；manual 当前片段未重点列 | 归档 session | 否 |
| `codex unarchive` | 是 | 本机 help 列出；manual 当前片段未重点列 | 取消归档 session | 否 |
| `codex fork` | 是 | 是 | 从历史 session fork 新线程 | 否 |
| `codex cloud` | 是 | 是，experimental | 浏览/提交 Codex Cloud tasks | 否 |
| `codex exec-server` | 是 | 本机 help 列出，experimental | 独立 exec-server service | 否 |
| `codex features` | 是 | 是 | 查看/启用/禁用 feature flags | 否 |
| `codex help` | 是 | CLI 通用 | 打印帮助 | 否 |

注意：`本机 help 是否列出` 表示当前安装的 `codex` 二进制确认支持；`官方 manual 是否覆盖` 表示本次拉取的 Codex manual 中有对应公开说明。两者都来自 Codex 官方产品面，但粒度不同：manual 更稳定、用于解释；本机 help 更贴近当前安装版本。

## 8. prompt 是怎么从 workflow 变成 stdin 的？

ACC 的 prompt 组装发生在 `render_agent_prompt()`，不是在 `CodexCliAdapter` 里。

当前模板固定为：

~~~markdown
# Agent Methodology

<AgentClassTemplate.default_prompt>

# User Task

<NodeInvocationSpec.prompt_policy.user_prompt 或 node.overrides.prompt>

# ACC Runtime Input

```json
<本节点 materialized input_payload>
```

# Output Contract

Return exactly one JSON object matching the provided output schema.
~~~

这个结构的第一性原理是把三类信息分开：

| prompt 区块 | 来源 | 作用 |
|---|---|---|
| `Agent Methodology` | `AgentClassTemplate.default_prompt` | 可复用 agent class 的长期方法论 |
| `User Task` | 节点级 `prompt_policy.user_prompt` 或 `overrides.prompt` | 这一次 invocation 的具体任务 |
| `ACC Runtime Input` | materialized `input_payload` | 结构化数据输入，包括静态输入、workflow input、上游输出 |
| `Output Contract` | ACC 固定文本 + `--output-schema` 文件 | 告诉 Codex 最终必须输出一个符合 schema 的 JSON object |

### input_payload 的来源

`resolve_node_payload()` 会按这些来源合成当前节点输入：

1. `node.overrides.static_input`
2. workflow exposed input 通过 `workflow_input_bindings` 绑定进来的值
3. 节点自己的 `input_bindings`
4. workflow `data_edges` 搬运来的上游节点输出

Workbench 转 Core v2 时，`node.input.user_prompt`、`node.input.prompt`、`node.input.topic` 会被抽出去作为 `prompt_policy.user_prompt`，不会进入 `static_input`。其他字段才进入 `overrides.static_input`。

例如前端输入：

```json
{
  "topic": "分析渲染管线",
  "limit": 5,
  "files": ["Renderer.cpp"]
}
```

会大致变成：

```json
{
  "prompt_policy": {
    "user_prompt": "分析渲染管线"
  },
  "overrides": {
    "static_input": {
      "limit": 5,
      "files": ["Renderer.cpp"]
    }
  }
}
```

最终 `resolved_prompt.md` 中会有：

~~~markdown
# User Task

分析渲染管线

# ACC Runtime Input

```json
{
  "files": [
    "Renderer.cpp"
  ],
  "limit": 5
}
```
~~~

如果上游节点输出通过 `data_edges` 进入当前节点，比如目标端口是 `evidence`，那么 `input_payload` 会再多出：

```json
{
  "evidence": {
    "...": "上游 output.json 内容"
  }
}
```

然后整个 JSON 被嵌入 `# ACC Runtime Input`。

## 9. 输出为什么要双重约束？

ACC 对输出有两层约束：

1. 调用 Codex 时传 `--output-schema <output_schema.json>`，让 Codex 按 schema 生成最终结果。
2. Codex 结束后，ACC 再读 `output.json`，确认它是 JSON object，并用同一个 schema 校验。

这类似图形管线里的 debug validation：shader 理论上应该按 render target 格式写，但 runtime 仍然要检查资源状态和输出格式。原因是 ACC 下游节点依赖这个输出，如果 Codex 自由输出一段 Markdown，下游数据边就没有稳定 contract。

## 10. 当前设计的风险边界

### 10.1 `--json` 和 `-o` 的组合要理解清楚

Codex manual 说明 `--json` 会让 stdout 成为 JSONL event stream，`-o/--output-last-message` 会把最后消息写到文件。ACC 当前同时使用两者：

- stdout JSONL event stream -> `stdout.log`
- final message -> `output.json`

因此 `output.json` 不是从 stdout 解析出来的，而是 Codex CLI 按 `-o` 写出的文件。

### 10.2 `--output-schema` 是官方参数，但 schema 文件内容是 ACC 的 contract

Codex 提供 `--output-schema` 能力；ACC 决定 schema 具体长什么样。默认 schema 要求 `status`、`summary`、`findings`、`analysis`、`sources`、`confidence`、`uncertainties`、`artifacts` 等字段。如果 callable 的 `artifact_contract.output_schema` 存在，ACC 用自定义 schema。

### 10.3 UI 里的 `model` / `reasoning_effort` 当前没有进入 CLI

当前 Workbench 里创建 Codex agent 时会保存 metadata，比如：

```yaml
metadata:
  agent_provider: codex
  model: ...
  reasoning_effort: medium
  skills: []
```

但当前 `build_codex_command()` 没有把 `metadata.model` 映射成 `--model`，也没有把 `reasoning_effort` 映射成 `-c` 配置项或其他 Codex CLI 参数。所以这些字段目前更像 UI/模板 metadata，不是实际 Codex 运行参数。

如果希望它们真正生效，最小改法不是改 prompt，而是在 `CallableClassRunner.adapter_args_base()` 或 `AgentRunRequest` 构造处明确做映射，并加测试验证生成的 command argv。

### 10.4 dangerous 权限是真危险

`--dangerously-bypass-approvals-and-sandbox` 是 Codex 官方提供的高风险参数。ACC 只有在 `PermissionProfile.dangerous=true` 时才传它，并且 `CodexCliAdapter.run()` 还要求 `allow_dangerous=true`。这不是性能优化开关，而是安全边界开关。

## 11. 如何验证本文结论？

### 查看 ACC 自己拼的命令

```powershell
uv run pytest tests/unit/test_codex_cli_adapter.py -q
```

重点测试点：

- `codex exec`
- `--cd`
- `--sandbox read-only`
- `--json`
- `--output-schema`
- `-o`
- `-`
- `CODEX_HOME` 隔离
- timeout / cancel / missing output / nonzero exit

### 查看 production gate

```powershell
uv run pytest tests/integration/test_core_v2_workflow_run.py -q
```

重点测试点：

- production 且 external gate 开启时才 mock-spawn Codex
- 未开启 `ACC_ENABLE_EXTERNAL_AGENT_EXECUTION=1` 时不会 spawn
- `network=true` 会映射到 `--search`
- `dangerous=true` 会映射到 `--dangerously-bypass-approvals-and-sandbox`

### 查看当前本机 Codex CLI 支持哪些命令

```powershell
codex --help
codex exec --help
```

这是确认“哪些 flag 是 Codex CLI 自己提供”的最快方式。

## 12. 一句话总括

ACC 对 Codex 的调用是一个“受控子进程 + 文件契约 + schema 校验”的 adapter，不是 Codex API SDK 调用，也不是 ACC 自研 agent loop。Codex 官方提供 CLI 能力；ACC 负责把 workflow 节点状态、权限、输入、prompt 和输出约束翻译成这次 `codex exec` 调用。
