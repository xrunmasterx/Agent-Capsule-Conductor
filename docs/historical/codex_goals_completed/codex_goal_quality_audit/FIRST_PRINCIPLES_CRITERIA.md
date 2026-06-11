# First-Principles Design Criteria

Use these criteria to judge whether ACC's architecture remains excellent.

## 1. Single-responsibility layers

Each layer must have a narrow job:

```text
CLI/API/UI: expose operations
Workflow Kernel: schedule graph execution
Capsule Runtime: run one capsule/session
Adapters: call external mature agents/tools
Artifact Store: persist evidence
GraphOps: validate and apply controlled edits
```

A layer should not absorb another layer's job.

## 2. External mature agents stay external

ACC should not implement a custom LLM reasoning loop.

Correct:

```text
ACC calls Codex/Claude/Hermes/Cursor/external workflow and captures outputs.
```

Wrong:

```text
ACC becomes an LLM planner/tool-calling framework.
```

## 3. Deterministic outer shell, intelligent inner node

The graph and runtime should be deterministic and auditable. Capsule internals may be non-deterministic, but their boundary must be typed and observable.

## 4. Artifact-first data flow

Do not rely on hidden conversational context. Persist inputs, prompts, outputs, events, and artifacts.

## 5. Explicit dependency graph

Workflow dependencies must be explicit. Avoid implicit global state.

## 6. Lightweight before complete

Prefer a small, clear implementation that covers core use cases over a large generic platform.

## 7. Failures are first-class

A good workflow engine must make failures inspectable, resumable, rerunnable, and testable.

## 8. Safety before autonomy

Upper-level agents may propose and dry-run changes. Structural changes require validation and human approval unless explicitly configured otherwise.

## 9. Local-first by default

Default mode should work locally without remote registry, cloud infra, paid external agents, or network access.

## 10. Performance by data structure, not cleverness

Use simple O(V+E) graph algorithms. Avoid unbounded memory loading for event/artifact inspection. Cache only when profiling or complexity justifies it.
