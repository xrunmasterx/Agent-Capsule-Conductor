# First-Principles Analysis: Why V2 Needs Template/Session and GraphOps

## 1. Core problem

The original design already solved the main problem:

```text
Conductor owns workflow topology.
acc owns capsule execution boundary.
External agents own their internal reasoning/tool loop.
```

But the new idea exposes two missing abstractions:

1. **A node is not merely one run.**
   It is a reusable behavior template that can create many independent runtime sessions.

2. **The workflow can be edited by an LLM, but should not be governed by an LLM by default.**
   Human remains the author/approver. LLM may propose changes through a controlled interface.

## 2. What should change

We should not redesign from scratch.

We should extend the existing design:

```text
V1:
  Capsule
  Run

V2:
  Capsule Template / Agent Class
  Session / Agent Instance
  GraphOps Control Plane
```

## 3. Why this matters

Without Template/Session separation:

- one node's runtime state may pollute another run,
- repeated executions are hard to reason about,
- many independent conversations from the same agent template are not modeled cleanly,
- debugging becomes unclear: is the bug in the template or in one session?

Without GraphOps:

- Codex cannot safely assist workflow authoring,
- LLM editing becomes ad-hoc file manipulation,
- self-modification risks increase,
- there is no validation/dry-run/review path.

## 4. What should not change

Do not turn the system into a dynamic autonomous scheduler.

The workflow remains deterministic by default:

```text
Human-authored DAG
  -> Conductor runs it
  -> acc executes sessions
  -> LLM can propose modifications
  -> human approves changes
```

## 5. Correct mental model

```text
Capsule Template = class
Session          = object instance
Workflow         = deterministic call graph
GraphOps Patch   = code review diff for workflow/capsule assets
Human Gate       = commit approval
```
