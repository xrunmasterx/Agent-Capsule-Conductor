# ACC GraphOps Governance

## Status

This document defines governed durable mutation rules for ACC callable/workflow assets. Runtime dispatch and GraphOps are separate concerns.

## SPEC

GraphOps governs durable callable/workflow mutation through:

1. proposal;
2. validation;
3. dry-run;
4. human approval when required;
5. apply;
6. evidence/audit record.

GraphOps must not become runtime dispatch. A supervisor may propose changes or plan future execution, but executing a node remains the responsibility of the runtime scheduler and callable invocation substrate.

## DESIGN

### Boundary

GraphOps owns persistent asset changes:

- create/update/delete workflow nodes;
- create/update callable templates;
- update graph edges/bindings/policies;
- validate mutation impact;
- produce dry-run diff;
- apply approved durable mutation.

GraphOps does not own:

- runtime `PlanStep` dispatch;
- per-run node execution;
- adapter invocation;
- Workbench local UI state;
- raw provider conversation state;
- unapproved hidden mutation.

### Governance Flow

```text
GraphOperationProposal
  -> semantic validation
  -> safety validation
  -> dry-run diff
  -> approval decision
  -> apply through governed repository
  -> mutation evidence / audit projection
```

### Supervisor / GraphOps Interaction

Supervisor output can become a GraphOps proposal only when the intended effect is durable asset mutation. Runtime supervisor decisions that merely authorize current-run execution should become `DecisionRecord` / `PlanStep`, not GraphOps operations.

### Workbench Interaction

Workbench authoring actions should generate normalized operation proposals. Canvas local state is not durable truth until a governed GraphOps apply writes canonical assets.

## Known Deviations / Risks

- GraphOps helpers and app-level supervisor bridges can become coupled if app/runtime concepts are imported into pure governance layers.
- Workbench-generated graph state can be confused with durable asset state if projection boundaries are weak.
- Runtime dispatch must not call GraphOps apply as part of normal execution.

## IMPLEMENTATION_ORDER

1. Keep GraphOps validation/dry-run/apply APIs separate from runtime dispatch.
2. Move app/runtime-specific GraphOps bridge code into `acc.app` if needed.
3. Ensure route handlers delegate to GraphOps app services rather than manipulating files directly.
4. Normalize Workbench authoring requests into GraphOps proposals.
5. Add proof obligations that runtime scheduler does not depend on GraphOps apply.

## ACCEPTANCE / TEST_PLAN

- GraphOps dry-run produces machine-readable diff without mutating durable assets.
- Apply requires explicit approval path where policy requires it.
- Runtime dispatch tests pass without invoking GraphOps apply.
- Supervisor current-run dispatch uses control ledger, not GraphOps mutation.
- Workbench authoring save path writes through governed mutation, not raw UI state persistence.
