# ACC SDD 07: Control Modes

## 1. Conclusion

ACC has three control modes:

- `fixed`: static workflow DAG control.
- `supervisor`: one controller node may propose dynamic `PlanStep` records, but only within a roster and policy-approved target set.
- `handoff`: one ordinary node may select downstream execution, but only within declared outgoing edges or policy-approved targets.

The modes must not become three runtimes. They are three control strategies that all converge into the same runtime ledger path:

```text
control decision
  -> DecisionRecord
  -> PlanStep
  -> DispatchEnvelope
  -> Core v2 callable execution
  -> run-scoped evidence
```

In plain terms: `fixed`, `supervisor`, and `handoff` decide **why a node is allowed to run**. They do not decide **how a node is executed**. Execution remains owned by Core v2 dispatch, callable adapters, isolated scope frames, and evidence writers.

### 1.1 Unified Control Strategy Model

The required architecture is:

```text
WorkflowTemplate
  -> Control Strategy
       fixed      : static graph compiler
       supervisor : controller decision compiler
       handoff    : local routing decision compiler
  -> PlanStep[]
  -> DispatchEnvelope
  -> SessionInstance / child FunctionInvocation
  -> Evidence
```

The control strategy layer is the only part that differs by mode.

- `fixed` compiles static workflow graph structure into `PlanStep[]`.
- `supervisor` compiles an approved controller decision into `PlanStep[]`.
- `handoff` compiles an approved local routing decision into `PlanStep[]` or selects existing route steps.

After `PlanStep[]` exists, the mode-specific layer is finished. Dispatch, execution, output materialization, failure recording, artifact handling, and run summary generation must use the same Core v2 scheduler, ledger, and evidence path.

### 1.2 Architectural Payoff

The unified model is required because it preserves ACC's debuggability and human authority.

Benefits:

- `fixed`, `supervisor`, and `handoff` do not become three competing executors.
- Workbench can use one inspector model to explain why a node executed.
- Replay can reuse the same `DecisionRecord` model instead of re-asking an LLM by default.
- Human approval, policy validation, audit, and dry-run evidence can converge into one governance chain.
- Tests can assert one execution substrate: `PlanStep -> DispatchEnvelope -> Core v2 callable execution`.
- Future control modes can be added by introducing a new strategy compiler, not by creating another runtime.

Architecture rule:

```text
mode-specific compiler MAY vary
runtime execution substrate MUST NOT vary
```

## 2. Scope

This spec defines the product and architecture contract for ACC control modes.

Covered:

- Static `fixed` DAG execution.
- `supervisor` dynamic dispatch through approved `SupervisorPlan` records.
- `handoff` route selection through approved `HandoffRequest` records.
- Shared ledger objects: `DecisionRecord`, `PlanStep`, `DispatchEnvelope`.
- Required boundaries for human approval, replay, evidence, and Workbench projection.
- Migration direction for existing supervisor scaffold code.

Not covered:

- Agent internal reasoning loops.
- Provider-specific execution adapters.
- GraphOps transaction schema details, except where workflow mutation interacts with control modes.
- Workbench visual design details beyond required control-mode projection facts.
- Distributed/cloud scheduling.

## 3. Code Facts

Current code already has the shared domain shape:

- `acc/models.py` defines `ControlPolicyMode = Literal["fixed", "supervisor", "handoff"]`.
- `acc/models.py` defines `RunPlan`, `PlanStep`, `DispatchEnvelope`, `DecisionRecord`, `ControlPolicy`, `SupervisorPlan`, `HandoffRequest`, and `HandoffControlPolicy`.
- `acc/engine/supervisor.py` parses and validates `SupervisorPlan`, then compiles an approved plan into dynamic `PlanStep` records.
- `acc/app/supervisor.py` materializes supervisor plan steps and appends `DecisionRecord` and `PlanStep` transition evidence.
- `acc/engine/handoff.py` validates `HandoffRequest` and compiles it into either a new `PlanStep` or a `route_only` selection.
- `acc/app/handoff.py` writes handoff payload snapshots, decision records, and plan-step transitions.
- `acc/app/runtime/dispatch_gate.py` exposes `dispatch_ready_supervisor_plan_steps()` and `dispatch_ready_handoff_plan_steps()` as thin wrappers over shared dispatch logic.
- `acc/ledger_writer.py` owns mutable run control ledger writes for normal fixed execution.

Current gaps are also explicit:

- `SupervisorRouter.invoke_from_intent()` still exists as an MVP scaffold and may directly call `CallableInvocationService.execute_node()`.
- `handoff` mode rejects `resume_session` with an explicit P0 error.
- `handoff` acceptance and handoff-level human approval are deferred in P0.
- `waiting_handoff` and `waiting_timer` exist as run-level lifecycle ideas, but they are not currently `PlanStepStatus` values.

## 4. First Principles

### 4.1 Control Is Not Execution

A control mode only answers:

```text
Which callable may run next, with what payload, under which policy, based on what evidence?
```

It must not answer:

```text
How does ACC execute the callable?
Where are stdout/stderr/artifacts written?
How is node failure recorded?
How is workflow output materialized?
```

Those questions belong to Core v2 execution, `ScopeFrame`, `SessionInstance`, artifact contracts, result store, and run evidence.

### 4.2 Dynamic Does Not Mean Unbounded

`supervisor` and `handoff` are dynamic only inside explicit boundaries.

Dynamic control is acceptable when the decision is:

- typed;
- validated;
- policy bounded;
- evidence backed;
- replayable;
- inspectable by a human;
- materialized as ledger facts before execution.

Dynamic control is not acceptable when an agent can silently create arbitrary nodes, call unknown tools, mutate workflow templates, or bypass approval.

### 4.3 Human Control Is A Runtime Fact, Not UI Decoration

Human review must produce durable evidence when it affects execution or persistent assets.

Examples:

- GraphOps approval belongs to GraphOps proposal evidence.
- Human gate answers belong to `DecisionRecord` / interaction evidence.
- Supervisor approval belongs to `DecisionRecord(kind="supervisor_plan")`.
- Handoff approval, once implemented, must belong to `DecisionRecord(kind="handoff")` or a directly linked interaction record.

Workbench may show decision cards, but Workbench state is not the source of truth.

## 5. Shared Control Ledger Contract

All modes must converge into the same control ledger objects.

### 5.1 `DecisionRecord`

`DecisionRecord` answers why a control action was selected.

Required meaning:

- `actor`: who made the decision, such as `system`, `human`, `supervisor:<node_id>`, or `node:<node_id>`.
- `kind`: `compile_plan`, `dispatch`, `approval`, `supervisor_plan`, `handoff`, `retry`, `cancel`, or `no_action`.
- `input_evidence_refs`: run-relative evidence used to make the decision.
- `policy_snapshot`: the policy in force at decision time.
- `candidates`: options considered.
- `selected`: selected option.
- `rejected`: rejected options when relevant.
- `rationale`: human-readable reason.
- `result_refs`: files written as a result of the decision.
- `replay_binding`: how replay should treat this decision.

### 5.2 `PlanStep`

`PlanStep` answers what ACC is allowed to dispatch.

Required meaning:

- `source="fixed"`: generated from static workflow compilation.
- `source="supervisor"`: generated from an approved `SupervisorPlan`.
- `source="handoff"`: generated or selected from a `HandoffRequest`.
- `depends_on`: plan-step dependencies.
- `dependency_node_ids`: human/debug projection of dependency nodes.
- `input_snapshot_refs`: run-relative payload or evidence snapshots.
- `decision_id`: decision that authorized the step when dynamic.

### 5.3 `DispatchEnvelope`

`DispatchEnvelope` answers what ACC actually dispatched.

Required meaning:

- `callable_ref`: resolved callable target.
- `input_ref`: run-relative payload snapshot.
- `policy_snapshot_ref`: run-relative policy snapshot.
- `created_by_decision_id`: decision authorizing dispatch.
- `status`: `pending`, `started`, `completed`, `failed`, or `cancelled`.
- `result_refs`: output, artifact, failure, or session evidence refs.

## 6. Mode: `fixed`

### 6.1 Purpose

`fixed` is the default ACC workflow mode. The workflow template statically defines nodes, control edges, data edges, exposed ports, and bindings.

This mode fits workflows where the human or authoring process has already decided the structure:

```text
WorkflowFunctionTemplate
  -> compile_execution_plan()
  -> RunPlan(source="fixed")
  -> PlanStep(source="fixed")[]
  -> ready-queue dispatch
```

### 6.2 Allowed Decisions

`fixed` may:

- compile static nodes into `PlanStep` records;
- run ready nodes when dependencies are satisfied;
- pause on human gate;
- skip downstream nodes after dependency failure;
- cancel pending/running work according to run lifecycle.

`fixed` must not:

- create new callable targets at runtime;
- reinterpret data edges as permissions to read arbitrary upstream workspaces;
- write runtime outputs back into reusable workflow templates;
- silently mutate `.accflow.json`.

### 6.3 Evidence

At minimum, `fixed` runs must leave:

```text
run_plan.json
plan_steps.jsonl
dispatches.jsonl
decisions.jsonl
events.jsonl
function_invocation.json
scope_frame.json
nodes/<node_id>/...
result_store/...
workflow_outputs/...
run_summary.json
```

## 7. Mode: `supervisor`

### 7.1 Purpose

`supervisor` allows one controller node to make bounded dynamic dispatch decisions.

The controller does not own arbitrary execution. It may only produce a structured `SupervisorPlan` or decision payload. ACC then validates the plan against a roster and policy before materializing `PlanStep` records.

Required path:

```text
supervisor agent output
  -> parse SupervisorPlan
  -> validate roster/policy
  -> optional human approval
  -> materialize PlanSteps
  -> dispatch_ready_supervisor_plan_steps()
```

### 7.2 Roster Boundary

The supervisor target set must come from a roster or equivalent policy-approved target list.

The roster should include:

- `CallableRef`;
- title or human-readable name;
- capabilities;
- input ports;
- output ports;
- optional version/hash metadata.

The supervisor must not invent a new durable callable asset during a run. If the system needs a new reusable agent/tool/workflow, that is GraphOps authoring, not supervisor dispatch.

### 7.3 Policy Boundary

`ControlPolicy(mode="supervisor")` governs dynamic dispatch.

Required policy fields:

- `actor = "supervisor:<node_id>"`;
- `allowed_targets`;
- `allow_dynamic_dispatch`;
- `max_dispatch_depth`;
- `max_repeat_per_target`;
- `max_concurrency`;
- `requires_human_approval` when plan execution requires explicit review.

Validation rules:

- `SupervisorPlan.status` must be `approved` before materialization.
- Every `DynamicInvocationIntent.target_callable_ref` must exist in roster or policy.
- Repeated target dispatch must obey `max_repeat_per_target`.
- Total dynamic depth must obey `max_dispatch_depth`.
- Unsupported callable kinds must be rejected before dispatch.

### 7.4 Required Degradation Of `SupervisorRouter.invoke_from_intent()`

`SupervisorRouter.invoke_from_intent()` must be degraded or removed from the main execution path.

Reason:

It bypasses the unified route:

```text
PlanStep
  -> DispatchEnvelope
  -> Core v2 callable execution
  -> run-scoped evidence
```

If expanded, it risks becoming a second runtime with different dispatch semantics, incomplete callable support, different evidence shape, and unclear replay behavior.

Allowed temporary status:

- It may remain as a legacy/MVP compatibility helper only if it is not used by the main workflow runtime.
- It must not gain support for new production callable execution paths.
- It must not become the route used by Workbench `supervisor` mode.

Target architecture:

```text
supervisor agent output
  -> parse SupervisorPlan
  -> validate roster/policy
  -> optional human approval
  -> materialize PlanSteps
  -> dispatch_ready_supervisor_plan_steps()
```

Acceptance rule:

Any new supervisor feature must prove that dispatch reaches callable execution through `PlanStep` and `DispatchEnvelope`, not through direct invocation.

### 7.5 Supervisor Replay

Replay must not ask the supervisor LLM to re-decide by default.

Default replay behavior:

```text
reuse recorded DecisionRecord
  -> verify template snapshot compatibility
  -> verify selected PlanStep ids
  -> reuse or re-materialize equivalent dynamic steps
```

If the user wants a fresh supervisor decision, replay mode must be explicit.

## 8. Mode: `handoff`

### 8.1 Purpose

`handoff` allows an ordinary node to make a local routing decision after it completes.

The node may choose which downstream target should run and what payload should be handed off. It must not become a general-purpose dynamic node generator.

Correct mental model:

```text
source node output/evidence
  -> HandoffRequest
  -> validate outgoing edge or policy target
  -> optional human approval / acceptance
  -> DecisionRecord(kind="handoff")
  -> existing or new PlanStep(source="handoff")
  -> dispatch_ready_handoff_plan_steps()
```

### 8.2 Route Boundary

A handoff target is valid only if it is one of:

- a declared outgoing control-edge target from the source node;
- an explicit `HandoffControlPolicy.allowed_target_node_ids` entry;
- an explicit `HandoffControlPolicy.allowed_target_callable_refs` entry.

Default product rule:

`route_only` handoff must select an existing outgoing edge target. This preserves human-designed workflow topology and keeps handoff understandable on the canvas.

### 8.3 Handoff Is A Constrained Routing Decision

Handoff must be designed as a constrained routing decision, not arbitrary dynamic node generation.

The node may decide:

- which approved downstream target executes;
- which approved payload is passed;
- whether no target should run if policy allows it;
- whether a fallback should be used when the selected route fails validation or acceptance.

The node must not:

- call any arbitrary agent not present in outgoing edges or policy;
- create durable agent/tool/workflow templates;
- bypass human approval;
- share conversation memory by default;
- write directly into downstream workspaces;
- mutate workflow templates during a run.

### 8.4 Required Handoff Policy Fields

Handoff policy should be extended or normalized around these fields:

```text
selection_cardinality: one | many | none_allowed
fallback_target
requires_human_approval
max_handoff_depth
replay_mode
decision_output_schema
```

Field meanings:

- `selection_cardinality`: whether a source node may select exactly one target, multiple targets, or no target.
- `fallback_target`: target used when selection fails validation, times out, or is rejected.
- `requires_human_approval`: whether the selected route must pause for human confirmation before dispatch.
- `max_handoff_depth`: maximum chained handoff depth in one run.
- `replay_mode`: whether replay reuses recorded handoff decisions or requires reapproval.
- `decision_output_schema`: strict schema for the node's handoff decision payload.

Current mapping:

- `HandoffControlPolicy.fallback_target_node_id` maps to `fallback_target`.
- `HandoffControlPolicy.requires_human_approval` exists but P0 rejects approval/acceptance paths.
- `HandoffControlPolicy.max_handoff_depth` exists.
- `HandoffControlPolicy.replay_mode` exists.
- `decision_output_schema` is not yet a first-class field.
- `selection_cardinality` is not yet a first-class field.

### 8.5 Handoff Modes

Current mode names:

- `new_session`: create a new dynamic plan step for the target.
- `route_only`: select an existing target step from the workflow topology.
- `resume_session`: intended to resume an existing session, but currently not implemented in P0.

Required product interpretation:

- `route_only` is the safest default for human-designed workflows.
- `new_session` must stay policy bounded and should require stronger evidence because it changes the run plan.
- `resume_session` must not be enabled until session ownership, memory sharing, payload merge, replay, and cancellation semantics are specified.

### 8.6 Handoff Approval And Acceptance

When implemented, handoff approval must use the same control ledger model:

```text
HandoffRequest
  -> pending interaction or acceptance evidence
  -> DecisionRecord(kind="approval" or kind="handoff")
  -> PlanStep ready/skipped/failed transition
```

Rejected handoff should not disappear. It must leave:

- rejected candidate target;
- actor;
- rationale;
- policy snapshot;
- fallback behavior;
- final step status.

## 9. Workbench Projection Requirements

Workbench must make control mode visible to the user.

Required projection facts:

- workflow control mode: `fixed`, `supervisor`, or `handoff`;
- for `supervisor`, which node is the controller;
- for `supervisor`, the allowed roster/targets;
- for `handoff`, which outgoing edges are route candidates;
- whether a dynamic decision requires human approval;
- which `DecisionRecord` authorized a dynamic step;
- whether a node was static, supervisor-generated, or handoff-selected;
- whether replay reused or regenerated a decision.

Workbench must not store these runtime decisions as durable template state unless the user explicitly saves a workflow/template change through the governed authoring path.

## 10. GraphOps Boundary

Control modes decide runtime dispatch. GraphOps decides durable workflow/callable mutation.

Examples:

- A supervisor may dispatch an existing `agent_class` to inspect code.
- A supervisor must not create a new persistent `agent_class` during a run.
- A handoff node may route to an existing downstream review node.
- A handoff node must not edit `.accflow.json` to add a new review node.
- If an AI suggests adding a node to a reusable workflow, that must become a GraphOps proposal or equivalent governed transaction.

This boundary prevents recursive self-modification:

```text
runtime decision != durable workflow mutation
```

## 11. Failure Modes

The following are architecture violations:

- `supervisor` dispatch executes callable work without creating `PlanStep` and `DispatchEnvelope` evidence.
- `SupervisorRouter.invoke_from_intent()` becomes the Workbench production path.
- `handoff` calls a target that is neither an outgoing edge target nor policy allowed.
- `handoff` silently creates durable callable assets.
- `handoff` shares conversation memory without explicit policy and evidence.
- A dynamic decision is replayed by asking the LLM again without explicit replay mode.
- Workbench displays a dynamic node without linking it to `DecisionRecord`.
- Approval exists only in UI state and is missing from run evidence.

## 12. Verification

Static checks:

```bash
rg -n "ControlPolicyMode|RunPlanSource|PlanStepSource|DecisionRecord|DispatchEnvelope" acc tests docs
rg -n "compile_supervisor_plan_to_steps|dispatch_ready_supervisor_plan_steps|invoke_from_intent" acc tests docs
rg -n "compile_handoff_to_plan_step|dispatch_ready_handoff_plan_steps|resume_session|route_only" acc tests docs
```

Required unit tests:

- supervisor plan rejects unknown roster target;
- supervisor plan rejects target outside `allowed_targets`;
- supervisor plan rejects unapproved plan;
- supervisor plan enforces max dispatch depth;
- handoff rejects target outside outgoing edges and policy targets;
- handoff `route_only` requires existing outgoing target;
- handoff `resume_session` remains explicitly rejected until specified;
- handoff rejects absolute or `..` payload/artifact refs.

Required integration tests:

- approved supervisor plan materializes `DecisionRecord` and `PlanStep` records;
- supervisor dynamic steps dispatch through `dispatch_ready_supervisor_plan_steps()`;
- handoff materializes payload snapshot and `DecisionRecord`;
- handoff selected step dispatches through `dispatch_ready_handoff_plan_steps()`;
- Workbench/run projection can show decision id and source mode for dynamic steps.

## 13. Acceptance Criteria

This spec is satisfied when:

- `fixed`, `supervisor`, and `handoff` are documented as control strategies, not separate runtimes.
- Every mode converges into `DecisionRecord`, `PlanStep`, and `DispatchEnvelope`.
- `supervisor` dynamic dispatch is roster/policy bounded.
- `SupervisorRouter.invoke_from_intent()` is not used as the main production dispatch path and does not expand into a second runtime.
- `handoff` is constrained routing, not arbitrary dynamic node generation.
- Handoff policy defines or explicitly defers `selection_cardinality`, `fallback_target`, `requires_human_approval`, `max_handoff_depth`, `replay_mode`, and `decision_output_schema`.
- Dynamic control decisions are inspectable from run evidence.
- Replay can reuse recorded dynamic decisions without calling the LLM again by default.
- Workbench projection can explain why a dynamic node ran.

## 14. Migration Plan

1. Keep `fixed` as the default product path.
2. Document `supervisor` and `handoff` as opt-in modes until their Workbench/API path is complete.
3. Mark `SupervisorRouter.invoke_from_intent()` as compatibility scaffold or move it behind a non-product test/helper boundary.
4. Route new supervisor features through `SupervisorPlan -> PlanStep -> DispatchEnvelope`.
5. Route new handoff features through `HandoffRequest -> DecisionRecord -> PlanStep -> DispatchEnvelope`.
6. Add missing handoff policy fields or explicitly map them to existing `HandoffControlPolicy` fields.
7. Add projection fields so UI and API can explain dynamic decisions without reading private implementation state.
