# ACC Core Object Model

## Status

This document expands the object model required by `docs/architecture/00-constitution.md`.

## Object Layers

ACC separates objects into definition-time objects, invocation/runtime objects, control-ledger objects, and evidence/projection objects.

## Definition-Time Objects

| Object | Role | Current anchor | Forbidden knowledge |
| --- | --- | --- | --- |
| `AgentClassTemplate` | Reusable agent behavior class | `acc/models.py:266-385` | Run ids, run dirs, provider session memory |
| `ToolClassTemplate` | Reusable local/tool behavior class | `acc/models.py:266-385` | Run ids, runtime workspace bindings |
| `WorkflowFunctionTemplate` | Reusable workflow function body | `acc/models.py:374-385` | Invocation identity, output values, run status |
| `NodeInvocationSpec` | One call site inside a workflow function | `acc/models.py:353-370` | Session ids, previous outputs as hidden state |
| `CallableRef` | Reference to a callable target | `acc/models.py` | Runtime execution results |

## Runtime and Invocation Objects

| Object | Role | Current anchor |
| --- | --- | --- |
| `ExecutionPlan` | Compiled static execution shape | `acc/models.py:390-401`, `acc/engine/__init__.py:149-171` |
| `FunctionInvocation` | One runtime workflow call | `acc/models.py:405-421` |
| `ScopeFrame` | Runtime scope containing cwd, inbox, outbox, artifacts, and behavior snapshot evidence | `acc/models.py:424-438` |
| `SessionInstance` | One concrete agent/tool execution | `acc/models.py:441-452` |
| `RunRecord` | Run-level durable status record | `acc/models.py` |
| `EventRecord` | Append-only runtime event record | `acc/models.py` |

## Control-Ledger Objects

| Object | Role | Current anchor |
| --- | --- | --- |
| `RunPlan` | Run-level control plan | `acc/models.py:496-825` |
| `PlanStep` | Authorizable dispatch unit | `acc/models.py:496-825` |
| `DispatchEnvelope` | Dispatch authorization/evidence envelope | `acc/models.py:496-825` |
| `DecisionRecord` | Human or system decision record | `acc/models.py:496-825` |
| `SupervisorPlan` | Supervisor-mode plan representation | `acc/models.py:496-825` |
| `HandoffRequest` | Handoff-mode request representation | `acc/models.py:496-825` |

## Evidence and Projection Objects

Evidence includes node inputs, node outputs, runtime payloads, binding manifests, ResultStore values, artifacts, events, run records, and run summaries. Projections include server DTOs, run indexes, Workbench stores, and UI overlays.

## Allowed References

- Templates may reference callable ids, declared ports, declared inputs, declared outputs, metadata that is definition-time only, and workflow graph structure.
- Runtime objects may reference template ids and snapshots, run ids, scope paths, session ids, result refs, and artifact refs.
- Projections may reference evidence ids and sanitized summaries.

## Forbidden References

- Templates must not contain run directories, live workspace bindings, provider session ids, prior outputs as hidden state, conversation history, or UI-only run status.
- External callable adapters must not require knowledge of whether they are inside fixed workflow, supervisor, handoff, or nested workflow.
- Frontend stores must not become evidence truth.
