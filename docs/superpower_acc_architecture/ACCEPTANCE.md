# ACC Superpower Architecture ACCEPTANCE

生成日期: 2026-06-21

本文件定义 ACC 架构收敛完成时必须满足的验收条件。

## 1. Documentation Acceptance

- [ ] `AGENTS.md`、`README.md`、`docs/README.md`、`docs/CURRENT_ARCHITECTURE.md` 中引用的 active architecture docs 全部存在。
- [ ] `docs/architecture/00-constitution.md` 到 `08-architecture-proof-obligations.md` 覆盖使命、对象模型、runtime kernel、control modes、dataflow/capability、projection、runtime services、compatibility、proof obligations。
- [ ] `docs/superpower_acc_architecture/*` 与 active architecture docs 不冲突。
- [ ] 所有 known deviations 有 owner、target state、deletion condition。

## 2. Product Boundary Acceptance

- [ ] ACC 不实现自定义 LLM reasoning loop。
- [ ] ACC 不教 agent 如何执行内部任务。
- [ ] Agent/tool/child workflow 内部行为由外部 worker 拥有。
- [ ] ACC 只负责 orchestration boundary、control decision、explicit data movement、evidence、artifact、projection、governed mutation。

## 3. Stateless Definition Acceptance

- [ ] `AgentClassTemplate`、`ToolClassTemplate`、`WorkflowFunctionTemplate`、`NodeInvocationSpec` 不允许 runtime/session/workspace/provider/conversation/UI state。
- [ ] runtime identity 只存在于 invocation/scope/session/run evidence。
- [ ] open metadata 不再作为 executable behavior channel。
- [ ] active loaders reject legacy/runtime-like metadata keys。

## 4. Explicit Dataflow Acceptance

- [ ] control edge 不携带数据。
- [ ] 每个 node payload key 可追踪到 workflow input、data edge、input binding、result ref、artifact ref 或 explicit snapshot input。
- [ ] implicit `control_main_default` / `control_main_aggregate` 被删除或仅作为登记的 compatibility warning。
- [ ] supervisor/handoff 不通过 hidden `static_input` 注入未声明 payload。

## 5. Unified Runtime Substrate Acceptance

- [ ] workflow、supervisor、handoff、human gate、nested workflow 都通过同一 callable invocation substrate dispatch。
- [ ] supervisor/handoff 不直接创建 node dir、不直接 invoke agent、不绕过 common scheduler/executor。
- [ ] human gate resume 使用同一 scheduler state machine。
- [ ] `dispatch_gate` mini-orchestrator 被删除或只剩临时兼容路径并有删除条件。

## 6. Low-Coupling Runtime Acceptance

- [ ] top-down `ExecutionContext` / `ProjectContext` 替代 ambient `Path.cwd()` service locator。
- [ ] Orchestrator 只做 composition，不内联全部 storage protocol。
- [ ] `RunRepository` / `NodeExecutionRecorder` / `ControlLedgerPort` / `ResultStorePort` / `EventSink` 负责 evidence side effects。
- [ ] `CallableInvocationPort` 是唯一 callable dispatch boundary。
- [ ] `AdapterProcessHarness` 复用 subprocess timeout/cancel/log/output plumbing。

## 7. High-Concurrency Acceptance

- [ ] node task 返回 immutable `NodeExecutionResult`。
- [ ] scheduler 汇总 outputs；node executor 不直接 mutate workflow-wide shared dict。
- [ ] cancellation/failure/waiting 不破坏 result aggregation。
- [ ] max concurrency 行为有测试覆盖。

## 8. Adapter Boundary Acceptance

- [ ] agent/tool 默认不接收 raw run/workspace/session topology。
- [ ] 默认 env 不暴露 `ACC_RUN_DIR`、`ACC_NODE_ID`、`ACC_RUN_ID` 等内部 topology。
- [ ] adapter request 通过 `AdapterCapabilityEnvelope` 暴露声明 capability。
- [ ] provider session reuse 是 explicit policy，workflow-bound nodes 默认不隐式继承 provider memory。

## 9. Projection / Workbench Acceptance

- [ ] Workbench 标准视图使用 projection schema，不直接解析 raw runtime manifests。
- [ ] raw evidence/debug 信息只通过显式 debug/evidence API 和 UI disclosure 展示。
- [ ] live event API 暴露 projected domain events 和 server-owned recovery semantics。
- [ ] browser canvas snapshot 不作为 durable runtime truth；authoring assistant 使用 normalized intent/graph ops proposal。

## 10. Performance Acceptance

- [ ] ordinary run mutation 不触发 full storage index rebuild。
- [ ] run summary update 不同步重建所有 run index。
- [ ] run stream idle path 不每 500ms 全量扫描 run tree。
- [ ] nested event tail 不从头解析全部 JSONL 历史。
- [ ] result projection metadata listing 不默认 materialize payload blobs。

## 11. Compatibility Removal Acceptance

- [ ] `acc/app/core_v2_runtime.py` shim 已删除或所有 import 迁移并有删除日期。
- [ ] legacy graph/YAML 只存在 migration/import/rejection/historical/test fixture 中。
- [ ] active runtime loader 只接受 canonical `.accflow.json` / strict callable schema。
- [ ] duplicate run submission surfaces 已收敛。
- [ ] duplicate run status sets 已收敛。
- [ ] duplicated adapter process management 已收敛。

## 12. Verification Commands

Backend:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```

Full gate:

```bash
uv run python scripts/quality_gate.py
```

Completion requires commands to pass or documented blockers with exact failing output and remediation plan.
