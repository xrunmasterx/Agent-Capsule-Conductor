# BLOCKER: Workflow Message Routing E2E stopped at AC1

## Status

Stopped after AC1 / T-047, per the requested immediate STOP rule:

- "修复需要跨 >=3 个模块边界"

## Truth Sources Read

Read in the required order:

1. `docs/codex_goal_workflow_message_routing/DESIGN.md`
2. `docs/codex_goal_workflow_message_routing/TEST_PLAN.md`
3. `docs/codex_goal_workflow_message_routing/IMPLEMENTATION_STRATEGY.md`
4. `docs/codex_goal_workflow_message_routing/AUDIT_PLAN.md`

The four contract documents were not edited.

## E2E Evidence Collected

- AC: `AC1`
- Main case: `T-047 test_ac1_control_edge_readiness_only`
- Run id: `e2e_ac1_1780247502236`
- Workflow id: `e2e_ac1_control_1780247502236`
- Screenshot: `tests/e2e/browser/_artifacts/e2e_ac1_1780247502236/ac1.png`
- Progress line appended: `tests/e2e/browser/_artifacts/progress.jsonl`

Workbench services used:

- API: `http://127.0.0.1:8765`
- Web: `http://127.0.0.1:5175`

## Assertions

Fixture shape:

- Two-node workflow: `A -> B`
- Edge type: only `ControlEdge`
- No `DataEdge`
- Metadata requested `binding_mode=explicit_only`

Observed `runs/e2e_ac1_1780247502236/nodes/B/input.json`:

```json
{
  "top_level_keys": ["inbox", "input", "node", "upstream_context", "workflow"],
  "forbidden_intersection": ["inbox", "node", "upstream_context", "workflow"],
  "upstream_context_count": 1,
  "has_output_summary": true,
  "has_output_inline": true,
  "prompt_exists": false
}
```

This fails TEST_PLAN T-047:

- Expected `B.input.bindings_resolved == {}`
- Expected forbidden orchestration fields absent from B agent-visible input
- Expected B prompt not to contain A `output_summary`, `output_inline`, or `inbox.records`

## Code Facts Behind The Failure

The current implementation still uses the pre-redesign routing behavior:

- `acc/app/node_invocation.py`
  - `build_clean_node_input_payload()` always writes `node`, `workflow`, `upstream_context`, and `inbox`.
  - `collect_upstream_context()` still reads `ControlEdge.context != "none"` and injects upstream node output into downstream input.
- `acc/prompting.py`
  - `render_prompt()` still auto-appends `## ACC Runtime Input` when the template does not reference `input_json`.
- `acc/runtime/__init__.py`
  - clean `generic_fake_agent` execution does not produce `resolved_prompt.md`; the node result therefore cannot satisfy the AC evidence path for resolved prompt inspection.
- `acc/store/__init__.py`
  - current `ArtifactBundle.provenance` is a loose dict with fields like `workflow_id/node_kind/node_run_dir`, not the structured `ProvenanceObject` required by AC13 and by the requested RunInspector provenance evidence.
- `acc/app/run_projection.py` and `web/src/components/*`
  - current Workbench projection/inspector does not expose the required AC10 fields: resolved prompt, applied bindings, provenance summary, materialization modes per edge, and degraded fallback details.

## Why This Is A STOP, Not A Surgical Fix

Making AC1 pass in isolation would already require changing more than one boundary:

1. `acc.app` input assembly must stop treating ControlEdge as data flow.
2. runtime/agent-visible payload generation must distinguish `AgentPayload` from `RuntimePayload`.
3. prompt artifacts must be generated/recorded consistently for Workbench inspection.
4. persistence/store must carry structured runtime-only provenance evidence.
5. server/Web projection must expose the evidence required by RunInspector.

That crosses at least app, runtime, store/persistence, server, and web boundaries. It also overlaps Phase 1/2/3 primitives from `IMPLEMENTATION_STRATEGY.md`, not a single local bug.

Per the user-provided rule, I am stopping instead of applying a partial patch that would make AC1 appear green while leaving AC2/AC3/AC4/AC9/AC10/AC13 structurally false.

## No Fixes Applied

No production code was changed.

Files created/updated for evidence only:

- `BLOCKER.md`
- `tests/e2e/browser/_artifacts/progress.jsonl`
- `tests/e2e/browser/_artifacts/e2e_ac1_1780247502236/ac1.png`

## Required Next Decision

To continue safely, this needs to be treated as an implementation phase, not a browser-only validation pass. The minimum viable next step is a scoped Phase 1/2 plan that explicitly covers:

- AgentPayload / RuntimePayload split
- ControlEdge readiness-only behavior
- prompt appendix policy
- structured ProvenanceObject
- RunInspector projection contract
- import-linter boundary updates
- T-047 plus supporting tests from TEST_PLAN
