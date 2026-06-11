# Performance Budget

## Graph algorithms

- Graph validation: O(V + E)
- Topological levels: O(V + E)
- Cycle detection: O(V + E)
- Data edge planning: O(D), where D is number of data edges

No algorithm may scan all artifacts to schedule graph execution.

## File handling

- Large artifacts must be streamed or referenced.
- UI/API must not load full large logs by default.
- Event replay should support pagination or bounded read.

## Scheduler

- Bounded concurrency must be configurable.
- Workspace write lock must not block read-only nodes unnecessarily.
- Nested workflow execution must not duplicate entire workspaces unless required by materialization mode.

## Startup

- CLI validation commands should avoid launching external agents.
- Default tests must not incur external API calls.

## Acceptance expectation

Codex should add performance-oriented tests or microbenchmarks for:

- validation on synthetic 1000-node DAG,
- topological sort on synthetic 1000-node DAG,
- event replay with large JSONL file using bounded memory or paging strategy.
