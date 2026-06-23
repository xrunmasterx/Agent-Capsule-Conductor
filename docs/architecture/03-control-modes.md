# ACC Control Modes

## Status

This document expands `docs/architecture/00-constitution.md` for workflow, supervisor, handoff, human gate, and nested workflow control semantics.

## SPEC

Control modes are authorization and scheduling strategies over one runtime substrate. They are not separate runtimes.

A control mode may:

- validate whether work is allowed;
- produce or update orchestration intent;
- materialize `RunPlan`, `PlanStep`, `DispatchEnvelope`, and `DecisionRecord` evidence through a control-ledger port;
- declare explicit inputs, result refs, artifact refs, and snapshot refs;
- pause/resume scheduler state.

A control mode must not:

- invoke agent/tool callables directly;
- create node runtime directories directly;
- write runtime evidence outside repository/recorder ports;
- move data through hidden control-edge side channels;
- make reusable templates aware of the current control mode.

## DESIGN

Target interface:

```text
ControlModeStrategy
  -> validate(intent, context)
  -> initial_plan(intent, context)
  -> ready_steps(state, repository)
  -> resume(decision, repository)
```

### Fixed Workflow

Fixed workflow compiles a stateless `WorkflowFunctionTemplate` into static orchestration intent. The scheduler executes ready nodes with bounded concurrency and explicit data bindings.

### Supervisor

Supervisor authorizes dynamic plan steps. It may decide what should run next, but the decision must become explicit plan/evidence before dispatch. Supervisor mode must use the same callable invocation port as fixed workflow.

Current deviation: `acc/app/supervisor.py` still contains procedural execution seams. This must converge into a `ControlModeStrategy`.

### Handoff

Handoff transfers control through explicit source/target/mode/context records. It is not implicit provider-session continuation. Receiving nodes see declared inputs and capabilities only.

Current deviation: `acc/engine/handoff.py` keeps P0 limitations and rejects some target semantics such as resume/human-approval paths.

### Human Gate

Human gate is a node control policy interpreted by the scheduler before dispatch. UI is projection; `DecisionRecord` is durable decision evidence.

Current deviation: resume dispatch rehydrates persisted state through `acc/app/runtime/dispatch_gate.py` rather than one scheduler state machine.

### Nested Workflow

Nested workflow is a callable node that creates a child `FunctionInvocation` and `ScopeFrame`. It is not a separate execution model.

## IMPLEMENTATION_ORDER

1. Define `ControlModeStrategy` protocol beside existing implementation.
2. Adapt fixed workflow as the first strategy.
3. Move human-gate approval/rejection into repository-backed scheduler resume.
4. Convert supervisor P0 to produce plan/decision records only.
5. Dispatch supervisor-approved steps through common scheduler/callable invocation port.
6. Convert handoff to typed decision + explicit context/result refs.
7. Remove dynamic template overlay reconstruction in `dispatch_gate.py`.
8. Add tests that fail when supervisor/handoff bypass common executor ports.

## ACCEPTANCE / TEST_PLAN

- Fixed workflow, supervisor, handoff, human gate, and nested workflow produce compatible evidence shapes.
- Supervisor/handoff cannot invoke agents directly in tests.
- Human gate resume uses the same scheduler driver as initial execution.
- Every control-mode data transfer has explicit binding/result/artifact/snapshot evidence.
- Reusable nodes cannot detect whether they were launched by workflow, supervisor, handoff, or human gate except through explicitly declared task input.
