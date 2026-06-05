# Design 02: Fixed RunPlan Dispatch

生成日期: 2026-06-02

## 结论

fixed workflow 是当前 ACC 唯一成熟热路径。落地控制架构时, 第一条可验证路径必须是:

```text
WorkflowFunctionTemplate
  -> ExecutionPlan
  -> RunPlan(source="fixed")
  -> PlanStep[]
  -> DispatchEnvelope
  -> execute_core_v2_node()
  -> SessionInstance / ArtifactBundle
```

目标是让 fixed DAG 行为等价, 但新增可审计控制账本。
`01_RUNTIME_CONTROL_LEDGER.md` 只定义 ABI 和 store/projection; 本 design 才开始修改 runtime
hot path。

## 当前路径

当前热路径:

```text
WorkflowAppService.run()
  -> run_core_v2_workflow_path()
  -> load_workflow_function_template()
  -> compile_execution_plan()
  -> run_workflow_function_invocation()
  -> for level in plan.levels
  -> asyncio.gather(execute_core_v2_node(...))
```

`execute_core_v2_node()` 负责:

- 创建 node run dir。
- 写 `session_instance_manifest.json`。
- resolve node payload。
- 写 `agent_payload.json` / `input.json` / `runtime_payload.json`。
- 调用 Core v2 callable execution。
- 写 `output.json`、artifact payload、`artifact_bundle.json`。
- 写 result store 和 workflow output。
- 失败时写 `FailureRecord`。

因此 fixed design 不能重写节点执行, 只能在它前后包 ledger。

## 目标

1. 保留 `ExecutionPlan` 的 pure topological compile。
2. 新增 pure conversion: `ExecutionPlan -> RunPlan + PlanStep[]`。
3. 在 level loop 中使用 `PlanStep` 和 `DispatchEnvelope` 记录控制事实。
4. 保持 `plan.levels` 并发语义不变。
5. 保持 artifact、output、result store、failure record、run summary 行为不变。

## 非目标

- 不引入 ready queue 替换 fixed level scheduler。
- 不把 `acc/app/scheduler.py` 的 wakeup queue 当 PlanStep scheduler。
- 不实现 supervisor 或 handoff。
- 不改 Workbench submit 入口。
- 不解决所有历史 event writer 分裂, 但 fixed path 新增 control ledger event 必须使用 Design 01
  定义的 canonical writer。

## 设计

### 纯转换

新增 engine 层 pure function:

```text
build_fixed_run_plan(
  execution_plan: ExecutionPlan,
  *,
  run_id,
  invocation_id,
  workflow_function_id,
  control_policy
) -> tuple[RunPlan, tuple[PlanStep, ...]]
```

规则:

- `RunPlan.source = "fixed"`。
- 每个 `ExecutionNode` 对应一个 `PlanStep`。
- `PlanStep.node_id = ExecutionNode.node_id`。
- `PlanStep.callable_ref = ExecutionNode.invocation.callable_ref`。
- `PlanStep.depends_on` 由 `ExecutionNode.depends_on` 映射到 dependency step ids。
- `PlanStep.status` 初始为 `pending`, 无依赖节点可转为 `ready`。
- `ExecutionPlan.levels` 仍保留为调度顺序来源, 不需要重新计算 ready set。

### Fresh run 初始化

在 `run_workflow_function_invocation()` 初始化 run dir 后:

1. 写 `run_plan.json`。
2. 写所有 initial `PlanStep` 到 `plan_steps.jsonl`。
3. 写 `DecisionRecord(kind="compile_plan", actor="system")`。
4. 写 `events.jsonl: decision_recorded`。

注意:

- 当前 `run_workflow_function_invocation()` 会删除现有 `run_dir`; fixed fresh run 可保留该行为。
- 未来 replay/resume/human wait 必须另有非 destructive 路径, 不能直接复用 fresh init。

### Dispatch wrapper

在每次调用 `execute_core_v2_node()` 前:

1. 根据当前 `PlanStep` 生成 `DispatchEnvelope`。
2. 写 `DecisionRecord(kind="dispatch", actor="system")`。
3. 追加 `dispatches.jsonl(status="started")`。
4. 追加 `plan_steps.jsonl(status="dispatching")`。
5. 追加 `events.jsonl(dispatch_started)`。

执行成功后:

1. 从 `SessionInstance` / node dir 推导 `session_id`。
2. 从 `artifact_bundle.json` 推导 `artifact_bundle_id`。
3. 追加 `dispatches.jsonl(status="completed")`。
4. 追加 `plan_steps.jsonl(status="success")`。
5. 追加 `events.jsonl(dispatch_completed)`。

执行失败后:

1. 保留当前 `FailureRecord` 写入。
2. 追加 `dispatches.jsonl(status="failed", failure_id=...)`。
3. 追加 `plan_steps.jsonl(status="failed", failure_id=...)`。
4. 追加 `events.jsonl(dispatch_failed)`。
5. 继续让当前 workflow failure handling 接管终态。

### 并发语义

仍按现有 `plan.levels` 调度:

```text
for level in execution_plan.levels:
  gather(dispatch step for node_id in level)
```

新增 ledger 不改变:

- 同层并发。
- 任一节点失败导致 workflow failed。
- cancel marker 检查点。
- workflow output 写入时机。

## 失败路径

必须明确处理:

- `ExecutionPlan` 中 node 缺失。
- dependency 指向不存在 node。
- duplicate node/step id。
- dispatch idempotency key 冲突。
- `execute_core_v2_node()` 成功但 `artifact_bundle.json` 缺失。
- node failure 已写 failure record, 但 ledger update 失败。
- workflow cancel 发生在某一 level 前。
- run dir fresh init 删除旧内容对 replay/resume 不安全。

ledger 写入失败的策略:

- P0 阶段建议视为 `crashed` 或明确的 `audit_failed` projection, 因为 audit truth 缺失不是
  普通业务节点失败。
- 如果 `execute_core_v2_node()` 已经成功并写了 artifact/result store, 不能简单标成普通
  `failed`, 否则会产生“节点输出存在但 audit 缺失”的混合状态。
- 如果未来允许 degraded audit, 必须有单独 ADR, 不能隐式吞掉。

## 验收标准

- fixed `.accflow.json` 仍通过当前 `WorkflowAppService.run()` 跑通。
- 成功 run 下:
  - `run_plan.json` 存在。
  - `plan_steps.jsonl` 至少包含每个 node 的 initial 和 success 记录。
  - `dispatches.jsonl` 至少包含每个 node 的 started 和 completed 记录。
  - `decisions.jsonl` 包含 compile 和 dispatch decision。
  - `events.jsonl` 能通过 id 引用 decisions/dispatches。
- 失败 run 下:
  - 当前 failure evidence 仍存在。
  - failed node 的 `PlanStep` 和 `DispatchEnvelope` 都是 failed。
- nested `workflow_function` 调用仍走 Core v2 nested path, 不走 `CallableInvocationService`。
- `run_summary.json` 和 workflow outputs 与现有 tests 期望兼容。

## 建议测试

- focused unit: `ExecutionPlan -> RunPlan` pure conversion。
- integration: one-node fixed workflow ledger。
- integration: two-level workflow level order 和 dependency step ids。
- integration: same-level two-node 并发仍成功, ledger 包含两个 dispatch。
- integration: failing node writes failure ledger。
- integration: fake ledger writer failure after node success -> run `crashed` 或 `audit_failed`,
  不标成普通 successful/failed node。
- integration: nested workflow function 不被 `CallableInvocationService` 接管。
- CLI/API focused: 原有 machine-readable JSON stdout 合同不被 ledger logging 污染。

## 后续依赖

完成本 design 后, human gate、supervisor、handoff 都不应再绕开 fixed dispatch substrate。
它们只需要产生或更新 `PlanStep`, 最终 dispatch 仍走本 design 的 wrapper。
