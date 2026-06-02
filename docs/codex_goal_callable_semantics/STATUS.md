# Callable Semantics Package Status

This directory is a goal-run evidence package, not the top-level runtime contract.

Current architecture facts defer to:

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md`
- `docs/concepts/CAPSULE_TEMPLATE_SESSION.md`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`

## Current Interpretation

The active product architecture is Core v2 callable-only:

```text
AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> events, manifests, result store, artifacts
```

Legacy `CapsuleSpec`, `CapsuleRegistry`, `CapsuleRunner`, `WorkflowTemplate`, `NodeSpec`,
`.graph.json` runtime paths, and capsule YAML executable assets are not current product runtime
concepts. In this package they should be read as historical migration or acceptance context unless a
current entry-point document explicitly reintroduces them.

## Known Drift To Watch

- Some goal-run files mention `function_invocation_manifest.json` and
  `scope_frame_manifest.json`. Current Core v2 runtime writes `function_invocation.json` and
  `scope_frame.json`.
- Some acceptance notes describe legacy capsule compatibility adapters. Current product runtime
  treats legacy graph/capsule material as migration input, rejection evidence, or historical
  fixtures, not as an active hot path.
- `FINDINGS.md`, `PROGRESS.md`, and `GOAL_COMMAND.txt` are chronological evidence. Prefer
  `QUALITY_REPORT.md` for that goal's final state, then reconcile it with
  `docs/CURRENT_ARCHITECTURE.md`.

## Update Rule

When code and this package disagree, do not patch the whole package mechanically. Add a local status
note or a targeted correction, and keep `docs/CURRENT_ARCHITECTURE.md` as the concise current
contract.
