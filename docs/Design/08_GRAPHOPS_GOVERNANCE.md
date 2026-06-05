# Design 08: GraphOps Governance Boundary

生成日期: 2026-06-02

## 结论

GraphOps 是 authoring/control-plane, 不是 runtime scheduler。Supervisor 或 handoff 运行时调用
worker 时, 正确路径是:

```text
DecisionRecord -> PlanStep -> DispatchEnvelope -> SessionInstance
```

只有当 LLM 或 supervisor 提出“持久 workflow/template/resource 应该怎么改”时, 才走 GraphOps:

```text
proposal -> validate -> dry-run -> human approval -> apply
```

## 当前事实

GraphOps 已有:

- patch schema validation。
- workflow target 必须是 canonical `.accflow.json`。
- 禁止 schema/output schema mutation。
- 禁止 legacy shorthand。
- 禁止 danger-full-access/network/write_files escalation。
- 禁止删除 `human_gate`。
- dry-run / semantic validation scaffold。

缺口:

- real apply 当前未实现。
- supervisor proposal fallback 不能当完整 GraphOps apply。
- Workbench/API 不能让用户误以为 GraphOps 已有自动 self-modification 闭环。

## 目标

1. 固化 GraphOps 不参与 runtime dispatch/handoff。
2. Supervisor 只能产生 GraphOps proposal, 默认只 validate/dry-run。
3. 如果短期不实现 apply, 所有 API/Workbench 文案明确 proposal/dry-run only。
4. 如果实现 apply, 必须有 human approval、transaction、rollback、audit。

## 非目标

- 不允许 supervisor 自动 apply GraphOps patch。
- 不允许 runtime step 通过 GraphOps 临时改图再执行。
- 不允许 GraphOps library 直接写 run evidence。
- 不允许 GraphOps 处理 non-canonical workflow runtime path。

## 两条路径

### Runtime dispatch path

```text
supervisor wants worker
  -> SupervisorPlan / DynamicInvocationIntent
  -> DecisionRecord
  -> PlanStep
  -> DispatchEnvelope
  -> Core v2 execution
```

不进入 GraphOps。

### Persistent mutation path

```text
supervisor/user proposes template change
  -> DynamicInvocationProposal.graph_patch
  -> GraphOps validate
  -> GraphOps dry-run
  -> human review
  -> apply only if implemented and approved
```

## Apply 选项

### Option A: Deferred apply

短期推荐。

要求:

- CLI/API/Workbench 明确显示 `apply_status = not_implemented` 或 `dry_run_only`。
- `apply_patch_request(... --apply --human-approved)` 继续 fail with explicit error。
- Supervisor proposal 只能生成 inbox item 和 dry-run evidence。
- Tests 覆盖 no mutation。

优点:

- 风险低。
- 不阻塞 runtime control from 0 to 1。

代价:

- 用户需要手动改图或等待后续 apply design。

### Option B: Implement human-approved apply

必须满足:

- atomic write。
- target path protection。
- schema validation before/after。
- semantic validation before/after。
- dry-run evidence persisted。
- human approval record。
- backup or rollback story。
- apply manifest。
- audit event。
- no runtime state in template。

如果做 Option B, 应单独开 goal, 不和 runtime dispatch 混做。

## GraphOps Evidence Ownership

GraphOps evidence 分两类:

1. Run-scoped supervisor proposal:
   - 如果 supervisor 在某次 run 中提出 GraphOps proposal, 由 app/runtime coordination 写
     `DecisionRecord(kind="graphops_proposal")`。
   - record 引用 GraphOps validate/dry-run evidence。
   - GraphOps library 不直接写 `decisions.jsonl`。

2. Independent authoring proposal:
   - 如果用户或独立 authoring flow 提出 GraphOps proposal, 写 proposal manifest/inbox。
   - 不写 run-scoped `decisions.jsonl`。

边界:

- `DecisionRecord(kind="graphops_proposal")` 不代表 runtime dispatch。
- selected action 默认是 `dry_run` 或 `no_action`。
- apply 必须另有 `DecisionRecord(kind="graphops_apply", actor="human")` 或 authoring apply
  manifest, 取决于是否 run-scoped。

## Workbench

Workbench 可以展示:

- proposal rationale。
- operations。
- validation result。
- dry-run diff。
- human approval requirement。

Workbench 不应:

- 默认显示 “Apply” 为可用, 如果 real apply 未实现。
- 让 supervisor proposal 自动修改 canvas/template。
- 把 graphops proposal 当 runtime edge。

## 验收标准

- Runtime supervisor/handoff 不调用 GraphOps apply。
- GraphOps dry-run 不 mutate `.accflow.json`。
- apply without approval fails。
- apply not implemented 时错误明确。
- dangerous operations 保持拒绝。
- Workbench/DecisionInbox 明确 proposal/dry-run only。

## 建议测试

- unit: valid patch passes validation。
- unit: schema mutation / output schema mutation rejects。
- unit: danger-full-access/network/write_files rejects。
- unit: remove human_gate rejects。
- unit: dry-run does not mutate target file。
- unit/server: apply without approval fails。
- integration: supervisor proposal -> GraphOps dry-run only -> target file unchanged。
- web: destructive apply disabled or marked unavailable。
