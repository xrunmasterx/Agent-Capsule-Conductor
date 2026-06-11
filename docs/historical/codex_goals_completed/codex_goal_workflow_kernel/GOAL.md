# Goal: ACC Workflow Kernel and Workflow Capsule Upgrade

## Objective

Upgrade the existing Agent Capsule Conductor repository from a capsule runner plus simple graph demo into a lightweight, deterministic, observable workflow kernel for reusable Agent Workflow Capsules.

This goal must preserve the existing ACC core principles:

- Do not implement a new LLM agent loop.
- Do not rewrite mature external agents.
- Keep default tests hermetic.
- Preserve `acc run --emit-conductor-json` as exactly-one-JSON-object stdout.
- Keep `WorkflowGraph` as ACC's authoring IR.
- Treat Microsoft Conductor YAML as an export target, not ACC's internal source of truth.

## Why this goal exists

The current ACC MVP can run individual capsules and simple graphs. But complex workflows need stronger semantics:

- DAG level parallel execution;
- explicit failure modes;
- retry and timeout;
- control edges and data/artifact edges;
- event-driven observability;
- nested workflow capsules;
- capsules that wrap existing Codex/Claude/Hermes workflows;
- Conductor export bridge;
- GraphOps semantic validation after patch dry-run.

## Must deliver

1. **WorkflowGraph v3**
   - Supports node kinds and capsule kinds.
   - Supports control edges and data edges.
   - Supports workflow-level `failure_mode`.
   - Supports node-level `retry`, `timeout`, `on_failure`.
   - Supports topological level computation.
   - Supports semantic validation.

2. **Workflow Kernel v1**
   - Executes by DAG levels.
   - Executes nodes in the same level concurrently with max concurrency.
   - Preserves session isolation for every node.
   - Aggregates node outputs/errors.
   - Implements `fail_fast`, `continue_on_error`, `all_or_nothing`, and `manual_review` as deterministic policies.
   - Emits workflow events to JSONL.

3. **Workflow Capsule support**
   - Extend capsule schema with `kind`:
     - `atomic`
     - `agent_session`
     - `agent_workflow`
     - `acc_workflow`
     - `external_workflow`
   - Implement `acc_workflow` capsule execution by invoking nested ACC workflow runner.
   - Provide validation/scaffolding for `agent_workflow` and `external_workflow` without requiring real external tools.

4. **Event-driven observability**
   - Add `SessionEventEmitter`.
   - Add `WorkflowEventEmitter`.
   - Standardize event JSON schema.
   - Write append-only `events.jsonl` for sessions and workflows.
   - Add event replay/list command/API if the server exists.

5. **Data and artifact dependency semantics**
   - Support explicit upstream output references.
   - Support explicit upstream artifact references.
   - Validate that referenced upstream nodes and artifact names exist.
   - Make downstream node input materialization deterministic and logged.

6. **GraphOps semantic validation**
   - GraphOps patch flow must be:
     - schema validation;
     - policy validation;
     - dry-run materialization;
     - semantic validation of resulting workflow/capsule;
     - semantic diff report.
   - Do not allow LLM patches to auto-apply without explicit human approval.

7. **Conductor Bridge**
   - Add `acc conductor export <workflow.graph.json> --out <workflow.conductor.yaml>`.
   - Export graph nodes as Conductor script steps calling `uv run acc run ... --emit-conductor-json`.
   - Preserve stdout contract.
   - Do not require Conductor to be installed for default tests.

8. **Examples**
   - `examples/workflows/demo_level_parallel.graph.json`
   - `examples/workflows/demo_branch_failure.graph.json`
   - `examples/workflows/demo_nested_workflow.graph.json`
   - `examples/workflows/demo_for_each_research.graph.json` or a documented placeholder if full `for_each` is deferred
   - example capsule of `kind: acc_workflow`
   - example capsule of `kind: agent_workflow`
   - example capsule of `kind: external_workflow`

9. **Tests**
   - All existing tests must keep passing.
   - New tests must be hermetic.
   - No real Codex, Claude, Hermes, Cursor, network, or Conductor required by default.

## Non-goals

Do not build:

- a full Conductor clone;
- a Dify/LangGraph clone;
- a custom autonomous LLM scheduler;
- a new LLM tool-calling loop;
- remote registry or GitHub fetching by default;
- production distributed execution;
- full checkpoint/resume engine;
- automatic LLM patch apply;
- large UI redesign.

## Completion condition

This goal is complete only when every required command in `docs/codex_goal_workflow_kernel/ACCEPTANCE.md` passes, existing MVP acceptance tests still pass, and the repository demonstrates:

```text
WorkflowGraph v3
  -> semantic validation
  -> DAG level execution
  -> event log
  -> failure policy
  -> nested acc_workflow capsule
  -> Conductor YAML export
  -> GraphOps dry-run semantic validation
```

## Blocked stop condition

If an external tool is unavailable, keep default tests mocked/hermetic, record the gap in `docs/codex_goal_workflow_kernel/INTEGRATION_GAPS.md`, and continue implementing locally testable functionality.
