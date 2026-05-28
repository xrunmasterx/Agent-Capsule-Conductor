# Termination Conditions

This goal is complete only when every condition below is true.

1. The new domain model exists and class/function/invocation/scope/session boundaries are explicit.
2. Existing `.accflow.json` files can normalize to `NodeInvocationSpec` without breaking current examples.
3. Agent/tool class templates do not save runtime state, run directories, output paths, or session memory.
4. Workflow function templates do not save local workspace paths or session state.
5. Every workflow run produces `function_invocation_manifest.json`.
6. Every workflow run produces `scope_frame_manifest.json`.
7. Every agent/tool node produces `session_instance_manifest.json`.
8. Workflow nodes produce workflow-call evidence and child invocation evidence.
9. Nested workflow calls use explicit input/output bindings instead of relying on `upstream_context` as the primary data protocol.
10. Child workflow outputs can flow through the parent workflow-node outbox into downstream inboxes.
11. Engine rejects illegal nested boundaries, recursion by default, excessive depth, stateful-in-stateful nesting by default, and absolute workspace paths in templates.
12. Store remains the only owner of inbox/outbox materialization.
13. Runtime remains execution-only and does not mutate graph semantics.
14. App coordination is split or structured so clean callable execution and legacy compatibility do not collapse into one unbounded runner.
15. New callable tests, old regression tests, ruff, and architecture boundary tests pass.
16. CLI acceptance proves `--emit-conductor-json` and `--emit-json` stdout remain single JSON object contracts.
17. Default tests remain hermetic.
18. `QUALITY_REPORT.md` records what changed, what was preserved, migration strategy, exact test evidence, and remaining risks.

