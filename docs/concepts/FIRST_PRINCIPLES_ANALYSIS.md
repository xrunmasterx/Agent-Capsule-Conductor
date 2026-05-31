# First-Principles Analysis

## 1. Core Problem

ACC coordinates work done by mature external agents and local tools. The hard part is not "calling an
agent"; the hard part is keeping reusable behavior, runtime evidence, data flow, and human authority
separate enough that the system stays debuggable.

The current architecture answers that with a callable model:

```text
Reusable definitions:
  AgentClassTemplate
  ToolClassTemplate
  WorkflowFunctionTemplate

Runtime executions:
  FunctionInvocation
  ScopeFrame
  SessionInstance
  ArtifactBundle
```

## 2. First Principles

### Definition is not execution

A reusable agent/tool/workflow definition is like a class. A run is like an object instance plus its
logs, files, events, and outputs. Mixing them causes state pollution, unclear debugging, and accidental
reuse of old prompts or outputs.

### Control flow is not data flow

A control edge only says "B may run after A". It does not imply B can read every file A touched. Data
must move through ports, inboxes, outboxes, artifact references, and workflow-call bindings.

### Runtime evidence is not authoring state

Run summaries, events, node manifests, and artifacts are evidence. They should not be written back
into reusable workflow templates or class templates.

### LLM assistance is not authority

An LLM may propose a graph or capsule edit. It must not silently become the owner of persistent
workflow mutation. GraphOps keeps mutation typed, validated, dry-run, reviewable, and human-approved.

## 3. Why This Matters

Without these separations:

- one task's run state can overwrite another task's state;
- a completed Workbench task can appear grey or empty after switching views;
- node input/output inspectors drift away from real artifacts;
- nested workflows can accidentally read parent data that was never bound;
- GraphOps becomes ad-hoc file editing instead of a controlled change path;
- stdout JSON contracts can be polluted by logs.

## 4. Correct Mental Model

```text
AgentClassTemplate / ToolClassTemplate = reusable class
WorkflowFunctionTemplate               = reusable function body
NodeInvocationSpec                      = call site
FunctionInvocation                      = one workflow call
ScopeFrame                              = call stack frame and workspace boundary
SessionInstance                         = one agent/tool execution
ArtifactBundle                          = stable evidence output
GraphOps Patch                          = reviewable workflow/capsule diff
Human Gate                              = approval before persistent mutation
```

## 5. What Must Not Change

ACC must not become:

- a custom LLM agent loop;
- a Dify/LangGraph clone;
- a database-first artifact platform;
- a cloud or distributed worker system by default;
- a self-modifying workflow system without validation and human approval.
