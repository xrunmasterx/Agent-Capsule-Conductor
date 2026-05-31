# Quality Report: Visual Workbench UX Refactor

Status: partial milestone complete, full goal not complete.

This report must be completed before marking the goal done.

Required final sections:

- What was deleted.
- What was kept.
- What was renamed.
- Task persistence implementation.
- Resource/class vs node/instance boundary.
- Inspector input/output evidence mapping.
- Exact test evidence.
- Browser evidence.
- Remaining risks.

## Current Milestone Evidence

Implemented:

- Versioned browser-local task persistence for Workbench tasks.
- Empty default task canvas instead of automatic demo canvas.
- Explicit `加载示例` action for the historical demo graph.
- Task delete/trash action.
- Desktop left navigation with icon + readable Chinese label.
- Dark restrained sidebar styling.
- Agent/Tool inspector input and output tabs read real run artifacts inline.
- Internal Agent/Tool nodes map to run evidence through `parent_node_id`, `ui_node_id`, and scoped node ids.
- Task Agent instances no longer expose a system-prompt editor; the overview states that system prompts belong to the resource-library Agent Class.
- Internal evidence path buttons open the shared evidence dock instead of a dead callback.

Tests:

```bash
cd web && npm run test -- --run
cd web && npm run build
uv run pytest -q
uv run ruff check .
```

Results:

- Frontend tests: 44 passed.
- Frontend build: passed with existing Vite chunk-size warning.
- Python tests: 308 passed.
- Ruff: passed.

Browser evidence:

```text
runs/browser_e2e/visual_workbench_ux_refactor/2026-05-28T17-43-16-278Z/journey-report.json
```

Browser smoke result:

- Status: pass.
- Screenshots captured.
- Console errors: none.
- Network errors: none.

Remaining risks:

- This milestone covers the task-persistence/navigation/default-demo slice and the first inspector evidence slice.
- Semiconductor Journey A now has a successful browser-started real run at `runs/ui_workflow_task_canvas_1779991411099_1779995176660`.
- Semiconductor Journey B is not complete; the nested Workflow container insertion flow is still too awkward and needs a focused UX fix before final acceptance.
- Resource-library class editing still needs the full semiconductor Agent Class creation flow through the UI, though the three class definitions exist and were corrected at the capsule-file level.
- Some lower-priority legacy UI/test strings still include mojibake compatibility patterns and should be cleaned incrementally with focused test updates.

## Final Evidence Update

Implemented after the earlier partial milestone:

- Explicit resource actions for selected Workflow insertion and root-canvas insertion.
- Inline Workflow output binding generation for Workbench-authored Workflow containers.
- Runtime propagation of a single nested Workflow public output as the parent Workflow node's `output.json`.
- Browser-verified nested Workflow handoff into an outer Agent.

What was deleted:

- No required hermetic fixtures were deleted.
- No historical examples were removed because tests still reference example workflows/capsules. The default Workbench no longer loads demo nodes automatically; old examples remain explicit fixtures.

What was kept:

- Existing `acc run` and `workflow run` contracts.
- Existing fake/hermetic default test strategy.
- Existing capsule runner and external mature-agent adapter boundary.
- Historical demo workflow files required by tests and manual demos.

What was renamed:

- No public CLI/API concepts were renamed.
- UI copy was clarified around selected Workflow insertion and root-canvas insertion.

Task persistence implementation:

- Workbench tasks are stored in a versioned browser-local payload.
- New tasks survive main navigation switches and browser refresh.
- Task deletion is explicit through the task-row trash action.

Resource/class vs node/instance boundary:

- System prompt remains a class-level resource-library concern.
- Task nodes expose invocation/user prompt, static input, mappings, run evidence, and real `input.json`/`output.json`.
- The semiconductor Agent Classes exist as reusable capsule resources; task canvas nodes are runtime instances.

Inspector input/output evidence mapping:

- Root Agent/Tool/Workflow nodes resolve their run result entry and display real run artifacts.
- Internal Workflow container nodes resolve evidence through parent node id, `ui_node_id`, and scoped node ids.
- Browser Journey B clicked collector, cleaner, and advisor nodes and observed `真实输入`/`真实输出` with full JSON content.

Exact test evidence:

```bash
uv run pytest -q tests/unit/test_clean_workflow_engine.py::test_nested_workflow_single_output_binding_becomes_parent_node_output tests/server/test_workflows_api.py::test_post_workflow_materializes_inline_workflow_boundary_edges
# 2 passed

cd web && npm run test -- --run
# 46 passed
```

Earlier full-suite evidence before the final Journey B fix:

```bash
uv run pytest -q
# 308 passed

uv run ruff check .
# passed

cd web && npm run build
# passed with existing Vite chunk-size warning
```

Browser journey evidence:

```text
Journey A: runs/ui_workflow_task_canvas_1779991411099_1779995176660
Journey B: runs/ui_workflow_task_canvas_1779997640823_1779997716734
Report: runs/browser_e2e/visual_workbench_ux_refactor/2026-05-29T03-52-51-249Z/journey-report.json
Screenshots: runs/browser_e2e/visual_workbench_ux_refactor/2026-05-29T03-52-51-249Z/screenshots/
```

Remaining risks:

- Some low-priority legacy UI/test strings still contain mojibake and should be cleaned in a separate focused pass.
- Real-agent browser validation requires starting the local API server with `ACC_RUN_EXTERNAL_AGENT_TESTS=1`; default automated tests remain hermetic and do not require this.
- The final full acceptance command set still needs one last clean rerun after this report update before the goal can be marked complete.

## Final Acceptance Command Rerun

```bash
uv run pytest -q
# 309 passed

uv run ruff check .
# All checks passed

cd web && npm run test -- --run
# 46 passed

cd web && npm run build
# passed; existing Vite chunk-size warning remains
```

## Follow-up Cleanup Update

Additional cleanup:

- Removed duplicate Journey B PNG screenshots from `docs/codex_goal_visual_workbench_ux_refactor/`; canonical browser evidence remains under `runs/browser_e2e/visual_workbench_ux_refactor/2026-05-29T03-52-51-249Z/screenshots/`.
- This keeps the goal documentation package text-first and avoids committing transient binary evidence twice.

Additional follow-up verification:

```bash
uv run pytest -q tests/server/test_workflows_api.py::test_inline_workflow_output_binding_uses_parent_output_port_id tests/server/test_workflows_api.py::test_post_workflow_materializes_inline_workflow_boundary_edges
# 2 passed

uv run pytest -q
# 310 passed

uv run ruff check .
# All checks passed

cd web && npm run test -- --run
# 46 passed
```

Coverage added:

- Workbench-generated parent output port ids such as `out_main` are preserved in inline Workflow `workflow_call_output_bindings`.
- Workbench save tests no longer accept mojibake fallback for the `保存` button.
