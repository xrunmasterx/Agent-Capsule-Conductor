# ACC Superpower Architecture DESIGN

生成日期: 2026-06-21

## 1. Design Goal

把 ACC 从“不断叠功能的应用脚本集合”收敛为“低耦合、高并发、可扩展、基于面向对象原则的轻量编排内核”。

目标不是让 ACC 变成更复杂的 agent 框架，而是让它成为稳定的 orchestration substrate：

```text
Reusable stateless definitions
  -> pure orchestration intent
  -> run-scoped invocation/scope
  -> scheduler-owned concurrent dispatch
  -> explicit data/result/artifact movement
  -> evidence-first persistence
  -> projection-first Workbench/API
```

## 2. Target Dependency Flow

```text
acc.cli / acc.server / web
        |
        v
acc.app services
        |
        +--> acc.engine        # pure validation/planning only
        +--> acc.runtime       # adapter/process/workspace execution primitives
        +--> acc.app.runtime   # orchestration kernel composition
        +--> acc.store         # repositories, manifests, path safety
        +--> acc.result_store  # result refs and artifact/value persistence
        +--> acc.projection    # stable read models and live events
        +--> acc.graphops      # durable asset mutation governance
```

Rules:

- `acc.engine` 不做 filesystem IO、不 spawn subprocess、不 import server/UI、不读取 host env。
- `acc.runtime` 不解释 workflow semantics。
- `acc.app.runtime` 不直接散落 storage protocol；通过 repository/recorder/ports 操作。
- `acc.server` 是 thin transport：request parsing -> app service -> response / HTTPException。
- `web/` 是 projection and authoring surface，不是 runtime truth。

## 3. Runtime Kernel Collaborators

### 3.1 ExecutionContext / ProjectContext

替代 `Path.cwd()` 和 process-global lookup。

Contains:

- `project_root`；
- `runs_root` / `.acc` roots；
- callable registry；
- workspace binding registry；
- environment policy；
- request identity；
- projection invalidator；
- adapter policy defaults。

### 3.2 WorkflowSubmissionService

唯一 run submission 入口。

Responsibilities:

- validate request；
- allocate/claim run id；
- load canonical `.accflow.json`；
- prepare runtime graph；
- construct `ExecutionContext`；
- enqueue or run workflow；
- create receipt/projection。

Used by:

- CLI；
- `/api/workflows/run*`；
- runner endpoints；
- Workbench submit path。

### 3.3 Orchestrator

Composition only, not a God object.

Responsibilities:

- create `FunctionInvocation` / `ScopeFrame` through `RunRepository`；
- ask engine for `ExecutionPlan` / abstract intent；
- ask control mode strategy for initial authorization；
- call scheduler；
- finalize through repository/projection ports。

Should not:

- create all dirs/files inline；
- know raw JSON manifest protocol；
- decide adapter env；
- rebuild global indexes。

### 3.4 Scheduler

Owns:

- ready-set；
- max concurrency；
- cancellation；
- waiting/human gate barriers；
- dispatch lifecycle；
- result aggregation；
- stop/failure semantics。

Scheduler starts node tasks, but node tasks return `NodeExecutionResult` instead of mutating shared `outputs`.

### 3.5 Binder

Two-layer binder:

1. pure binder: computes declared data requirements from template + plan + result refs；
2. runtime evidence binder: materializes payloads and binding manifests with evidence refs/hashes/debug handles。

The binder is the only place that can explain “why did this node receive this data?”

### 3.6 NodeExecutionRecorder / RunRepository

Owns filesystem evidence protocol:

- invocation/scope manifests；
- node session manifests；
- runtime payload snapshots；
- binding manifests；
- stdout/stderr handles；
- failure records；
- run summaries；
- event append；
- result/artifact refs。

This keeps orchestrator/executor from becoming transaction scripts.

### 3.7 CallableInvocationPort

Single callable execution boundary.

```text
CallableInvocationPort.invoke(envelope: NodeExecutionEnvelope) -> NodeExecutionResult
```

It selects:

- tool class；
- agent class；
- child workflow function；
- hermetic fake；
- external adapter protocol。

It replaces fragmentation between `AgentTurnService`、`CallableClassRunner`、`CallableInvocationService`、nested workflow special cases and hermetic fallback branching.

### 3.8 AdapterProcessHarness

Shared substrate for adapters:

- subprocess lifecycle；
- timeout/cancellation；
- stdout/stderr capture；
- output presence validation；
- logging；
- protocol-specific parsing hooks。

Adapters should differ in protocol, not repeat process management.

## 4. ControlModeStrategy Design

```python
class ControlModeStrategy:
    def validate(self, intent, context): ...
    def initial_plan(self, intent, context) -> ControlDecisionBatch: ...
    def ready_steps(self, scheduler_state, repository) -> tuple[PlanStep, ...]: ...
    def resume(self, decision, repository) -> SchedulerResumeRequest: ...
```

### FixedWorkflowStrategy

- wraps current DAG plan；
- compiles static steps；
- no dynamic node construction at dispatch time。

### SupervisorStrategy

- produces plan/decision records；
- validates dynamic expansions；
- declares input refs/snapshot refs；
- uses common scheduler to dispatch。

### HandoffStrategy

- validates source/target/mode/payload policy；
- translates handoff into control decision + explicit input refs；
- rejects undeclared provider-session continuation。

### HumanGateStrategy

- scheduler barrier；
- approval/rejection transitions in repository/ledger；
- resume request goes back to same scheduler driver。

## 5. Projection Design

### 5.1 Endpoint Tiering

| Tier | Example | Rule |
| --- | --- | --- |
| orchestration/write | submit run, answer human gate | route delegates to app service |
| projection/read | run timeline, node inspector | route delegates to projection service |
| evidence/debug | raw manifest/log/artifact | explicit debug/evidence API |
| transport/live | SSE/WebSocket stream | projected events + recovery contract |

### 5.2 Workbench Standard Projections

- `WorkflowCanvasProjection`
- `RunTimelineProjection`
- `NodeInspectorProjection`
- `BindingSummaryProjection`
- `ArtifactPreviewProjection`
- `LiveEventProjection`
- `AuthoringIntentProjection`

Standard UI may not parse raw `runtime.json`、`binding_manifest.json`、absolute filesystem paths or process-local bus details.

### 5.3 Live Events

Target:

- server-owned monotonic ids；
- event vocabulary is domain/projection level；
- recovery/gap handling is API contract；
- file-tail mechanics hidden behind service；
- cache node topology and offsets per stream。

## 6. Storage / Performance Design

### 6.1 Incremental Storage Index

Replace full rebuild on dirty marker with:

- object change journal；
- `upsert_object(object_ref)`；
- `delete_object(object_ref)`；
- batched/debounced flush；
- full rebuild only explicit maintenance/repair。

### 6.2 Run Index / Summary

- run-local summary writes update that run only；
- global index update is incremental；
- terminal event triggers one final projection update；
- intermediate status updates are coalesced。

### 6.3 JSONL / Event Tail

- track byte offsets or line checkpoints；
- avoid from-zero parse for tail request；
- maintain merged nested event tail or fan-in append log。

### 6.4 ResultStore Projection

- list metadata without loading payload blobs；
- batch manifest reads per request；
- separate manifest enumeration from value materialization。

## 7. Deletion / Consolidation Targets

1. `acc/app/core_v2_runtime.py` wide compatibility shim after import migration。
2. legacy graph/YAML runtime/UI fallbacks after migration command and tests。
3. duplicate run submission code in runner/workflow routes。
4. duplicate `TERMINAL_RUN_STATUSES` and raw status strings without typed boundaries。
5. duplicated subprocess lifecycle in adapters。
6. implicit control-main forwarding。
7. dispatch_gate mini-orchestrator after common resume scheduler exists。
8. route-level graph compilation and runtime assembly。
9. raw Workbench inspector dependency on runtime side-channel files。
10. full storage-index rebuild for ordinary run mutations。

## 8. Design Non-Goals

- Do not add database/cloud/distributed worker as a required core.
- Do not implement an LLM reasoning loop.
- Do not make GraphOps runtime dispatch.
- Do not make Workbench local state durable runtime truth.
- Do not make supervisor/handoff separate runtimes.
- Do not preserve legacy formats as first-class active runtime models.
