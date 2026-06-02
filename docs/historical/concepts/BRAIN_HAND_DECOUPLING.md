# Brain-Hand Decoupling Pattern

## 1. Concept

Do not let one long-lived session do everything.

Separate:

```text
Brain:
  planning, routing, reviewing, critique, workflow patch proposal

Hand:
  sandboxed execution, source analysis, code modification, test running
```

## 2. Why this matters

If one Agent session is responsible for planning, executing, remembering, reviewing, and editing the workflow, failure modes compound:

- memory bloat,
- environment pollution,
- config drift,
- accidental self-modification,
- stale assumptions,
- hard-to-debug state.

Killing a bad session and starting a clean one becomes harder.

## 3. Recommended roles

```text
Planner Capsule
  creates plan and task split

Research Capsule
  processes papers/blogs/talks

Source Reality Capsule
  reads local source in sandbox

Executor Capsule
  modifies code in write worktree

Reviewer Capsule
  critiques outputs

Workflow Editor Capsule
  proposes GraphOps patches

Human Gate
  approves/rejects important transitions
```

## 4. Engineering analogy

```text
Brain = planner/controller
Hand  = worker process in sandbox
```

In game engine terms:

```text
Brain = high-level scheduler / gameplay task controller
Hand  = isolated worker job / commandlet / build step
```

## 5. Impact on design

This pattern reinforces:

- Template/Session separation,
- short-lived sessions by default,
- explicit artifacts between sessions,
- human gates for graph mutation,
- fresh workspace per execution where possible.
