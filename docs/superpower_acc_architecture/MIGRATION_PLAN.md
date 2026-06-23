# ACC Superpower Architecture MIGRATION_PLAN

生成日期: 2026-06-21

## Migration Strategy

迁移遵循四条原则：

1. **先证明再替换。** 先为现有健康路径建立测试，再迁移边界。
2. **并行引入端口。** 新 repository/port/service 先放在现有函数旁边，再逐步切流。
3. **每次只收敛一个维度。** dataflow、status、submission、projection、adapter 不混在同一批。
4. **兼容债必须有删除条件。** 不能用“为了兼容”无限期保留第二套模型。

## Phase 0 — Baseline and Docs

Actions:

- 生成 Superpower package。
- 补齐 active architecture docs 03-08。
- 更新 docs map。
- 记录当前 known deviations。

Exit criteria:

- active docs refs resolve。
- no doc points to missing active architecture file。

## Phase 1 — Contract Freeze

Actions:

- Define strict schemas for callable templates and node specs。
- Add typed metadata/status design。
- Add proof-obligation tests, even if initially marked known deviation。

Exit criteria:

- tests identify runtime/session/workspace/provider keys in definitions。
- single status taxonomy plan exists。

## Phase 2 — Dataflow Migration

Actions:

- Add explicit binding manifest coverage。
- Add snapshot input object for supervisor/handoff。
- Deprecate implicit control-main forwarding。
- Convert fixtures/workflows to explicit bindings。

Deletion condition:

- all canonical workflows pass without control-main fallback。

Exit criteria:

- implicit dataflow negative tests pass。

## Phase 3 — Runtime Ports Introduction

Actions:

- Add `ExecutionContext`。
- Add repository/recorder/port interfaces。
- Move manifest writes behind recorder in small batches。
- Keep public behavior stable。

Exit criteria:

- fixed workflow path can run through repository/recorder-backed code in tests。

## Phase 4 — Result Aggregation Refactor

Actions:

- Introduce `NodeExecutionResult`。
- Make node execution return result。
- Scheduler merges outputs and writes result refs。

Exit criteria:

- no concurrent node task mutates shared output dict。

## Phase 5 — Invocation Port Unification

Actions:

- Define `CallableInvocationPort`。
- Adapt agent/tool/workflow/hermetic paths。
- Move permission/prompt/schema/adapter selection to one service。

Exit criteria:

- fixed workflow and supervisor use same invocation port。
- old invocation shim is compatibility-only。

## Phase 6 — Adapter Capability Boundary

Actions:

- Introduce `AdapterCapabilityEnvelope`。
- Stop default raw topology env injection。
- Make provider session reuse explicit policy。
- Sanitize session evidence for standard projection。

Exit criteria:

- adapter boundary tests pass。

## Phase 7 — Resume / Control Modes Convergence

Actions:

- Implement `ControlModeStrategy`.
- Adapt fixed workflow.
- Replace human-gate resume mini-orchestrator.
- Replace supervisor procedural path.
- Replace handoff P0 static injection path.

Exit criteria:

- workflow/supervisor/handoff/human gate dispatch through same scheduler/invocation substrate。

## Phase 8 — Server Submission Consolidation

Actions:

- Create `WorkflowSubmissionService`.
- Use it from runner and workflow routes.
- Remove route-level runtime graph assembly.

Exit criteria:

- route tests pass; static checks detect route-level graph compilation regression。

## Phase 9 — Projection Migration

Actions:

- Add projection schemas.
- Migrate Workbench standard views to projection endpoints.
- Move raw manifests behind debug/evidence endpoints.
- Normalize authoring assistant input.

Exit criteria:

- UI components use projection fixtures.
- raw runtime side-channel fields absent from standard component props。

## Phase 10 — Projection Performance

Actions:

- Incremental storage index.
- Incremental run index.
- Event stream cache/offsets.
- Nested event tail/fan-in.
- ResultStore metadata-first listing.

Exit criteria:

- performance regression tests show no full rescan on ordinary mutation/idling stream/tail query。

## Phase 11 — Compatibility Deletion

Delete or restrict:

- `acc/app/core_v2_runtime.py` shim；
- legacy graph/YAML active UI/runtime paths；
- callable YAML aliases in live loader；
- duplicate run submission pipeline；
- duplicate status sets；
- duplicate adapter process lifecycle；
- implicit control-main forwarding；
- dispatch_gate mini-orchestrator；
- ambient cwd fallbacks。

Exit criteria:

- full quality gate passes。
- `docs/problem/RESOLUTION_MATRIX.md` updated with evidence。

## Deferred Decisions Requiring ADR

- Whether control ledger remains always-on or becomes optional verbose audit layer。
- How much raw evidence should standard Workbench expose for technical users。
- Exact lifecycle of provider conversation memory for non-workflow authoring sessions。
- Whether storage index remains SQLite or becomes simpler sidecar JSONL/index for local-only use.
