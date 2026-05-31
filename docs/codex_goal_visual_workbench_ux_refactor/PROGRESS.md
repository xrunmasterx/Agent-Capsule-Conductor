# Progress: Visual Workbench UX Refactor

## 2026-05-29

- Created active Codex goal for the user request.
- Read mandatory baseline goal/concept docs.
- Attempted to delegate OpenAI/Codex Goal mode research to the available subagent, but the local MultiAgentLF target pane was not mounted (`pane title marker not found`).
- Confirmed public guidance from official OpenAI Codex docs: use `/goal` for persistent objective and completion criteria; keep detailed contracts in repository docs; use measurable acceptance commands.
- Created the initial goal package:
  - `GOAL.md`
  - `SPEC.md`
  - `DESIGN.md`
  - `TEST_PLAN.md`
  - `ACCEPTANCE.md`
  - `IMPLEMENTATION_ORDER.md`
  - `USAGE_WITH_GOAL.md`
  - `GOAL_COMMAND.txt`
  - `FINDINGS.md`

Next:

- Run baseline tests.
- Inventory demo/generated artifacts and test references.
- Implement Milestone 2/3 after confirming baseline.

## 2026-05-29 Baseline

Commands:

```bash
uv run pytest -q
uv run ruff check .
cd web && npm run test -- --run
cd web && npm run build
```

Result:

- `uv run pytest -q`: 306 passed.
- `uv run ruff check .`: passed.
- `cd web && npm run test -- --run`: 40 passed before changes.
- `cd web && npm run build`: passed with existing Vite chunk-size warning.

## 2026-05-29 Milestone 2/3 Slice

Implemented:

- Desktop sidebar now shows icon + readable Chinese labels instead of icon-only navigation.
- Sidebar visual style changed to a restrained dark engineering-tool surface.
- Workbench default task is now empty; historical demo canvas is explicit via `加载示例`.
- Added browser-local versioned task persistence.
- Added task delete/trash action.
- Added tests for readable Chinese nav labels and task persistence/delete across navigation switches.

Verification:

```bash
cd web && npm run test -- --run
cd web && npm run build
uv run pytest -q
uv run ruff check .
```

Result:

- Frontend tests: 42 passed.
- Frontend build: passed with existing Vite chunk-size warning.
- Python tests: 306 passed.
- Ruff: passed.

Remaining:

- Full inspector evidence refactor.
- Resource-library/class vs task-node instance UX hardening.
- Semiconductor Journey A/B implementation and browser evidence.

## 2026-05-29 Browser Smoke

Journey:

```text
Visual Workbench task persistence smoke
```

Evidence:

```text
runs/browser_e2e/visual_workbench_ux_refactor/2026-05-28T17-43-16-278Z/journey-report.json
runs/browser_e2e/visual_workbench_ux_refactor/2026-05-28T17-43-16-278Z/screenshots/
```

Result:

- Status: pass.
- Console errors: none.
- Network errors: none.
- Verified default canvas is clean.
- Verified left navigation icon + readable Chinese labels.
- Verified new task persists across navigation switch.
- Verified trash button deletes task.

## 2026-05-29 Inspector Evidence Slice

Implemented:

- Added run-node matching helpers for root executable workflow nodes and internal Agent/Tool nodes.
- Agent/Tool inspector input tab now reads and displays the real `input.json` artifact when a run exists.
- Agent/Tool inspector output tab now reads and displays the real `output.json` artifact when a run exists.
- Internal node artifact/log/event buttons now call the shared evidence dock reader instead of a placeholder callback.
- Agent instance overview now keeps system prompt ownership in the resource-library Agent Class and shows task invocation state/evidence instead.
- Added a frontend regression test for selecting the `Codex CLI` internal Agent after running the workspace fixture and verifying real input/output evidence.

Verification:

```bash
cd web && npm run test -- --run
cd web && npm run build
uv run ruff check .
uv run pytest -q
```

Result:

- Frontend tests: 43 passed.
- Frontend build: passed with existing Vite chunk-size warning.
- Ruff: passed.
- Python tests: 306 passed.

Remaining:

- Resource-library class editor must support creating the three semiconductor Agent Classes cleanly.
- The two requested semiconductor journeys still need implementation plus browser screenshots/console/network evidence.

## 2026-05-29 Semiconductor Journey A Runtime Validation

Implemented and fixed while validating:

- Fixed root Agent palette placement so consecutive root agents stay in the visible row instead of jumping far outside the viewport.
- Raised task Agent instance overview evidence so the default Inspector view shows real `input.json` and `output.json`, not only static input.
- Changed control-edge upstream context from an 8 KiB inline cutoff to a named 256 KiB bounded inline payload so normal agent outputs can flow into downstream prompts.
- Reworked the three semiconductor Agent Class contracts so the collector emits structured `news[]` and the cleaner emits structured `top_news[]`.
- Fixed prompt rendering so templates that do not explicitly include `{{ input_json }}` still receive an `ACC Runtime Input` JSON block. This was the actual reason downstream Codex agents could not see `upstream_context`.
- Fixed a global Codex skill frontmatter YAML error in `C:\Users\dezhengu\.codex\skills\mr-visual-digest\SKILL.md` that polluted every Codex agent launch.

Successful browser-started run:

```text
runs/ui_workflow_task_canvas_1779991411099_1779995176660
```

Observed runtime evidence:

- Workflow status: success.
- Collector output: 31 structured news items.
- Cleaner input: received 31 inline upstream news items.
- Cleaner output: 5 structured `top_news` items.
- Advisor input: received 5 inline upstream `top_news` items.
- Advisor output: completed with semiconductor market analysis and risk-aware operation suggestions.
- Cleaner `resolved_prompt.md` contains `ACC Runtime Input`, proving the model received task/upstream data in the prompt.

Verification run during this slice:

```bash
uv run pytest tests\unit\test_prompting.py tests\unit\test_clean_workflow_engine.py -q
cd web && npm run test -- --run
```

Result:

- Prompting + clean workflow focused tests: 24 passed.
- Frontend tests: 44 passed.

Remaining:

- Superseded by the nested Workflow Journey B validation below; the awkward insertion path was fixed with explicit `加入到选中 Workflow` and `根画布` actions.

## 2026-05-29 Nested Workflow Journey B Validation

Implemented and fixed while validating:

- Added an explicit `根画布` action to resource cards when a Workflow container is selected, so the user can add an outer root Agent without learning how to clear selection.
- Auto-selected newly created Workflow containers so `加入到选中 Workflow` immediately targets the new container.
- Added frontend regression coverage for selected-Workflow insertion and root insertion while a Workflow remains selected.
- Fixed inline Workflow container save logic so generated parent Workflow nodes include `workflow_call_output_bindings`.
- Fixed clean workflow runtime output semantics for single-output workflow calls: the parent Workflow node `output.json` now surfaces the child workflow public output instead of only a nested status summary.
- Added a regression test proving a nested workflow's single public output becomes the parent node output and is passed through default control-edge `upstream_context`.

Successful browser-started nested run:

```text
runs/ui_workflow_task_canvas_1779997640823_1779997716734
```

Observed runtime evidence:

- Workflow status: success.
- Internal collector output: 28 structured news items.
- Internal cleaner output: 5 structured `top_news` items.
- Workflow container output: 5 `top_news` items surfaced at `nodes/New_Workflow/output.json`.
- Outer advisor input: `upstream_context[0].output_inline.top_news` contains 5 items.
- Outer advisor output: completed with semiconductor market analysis and operation suggestions based on the 5 upstream items.
- Clicking collector, cleaner, and advisor nodes in the browser showed `真实输入` and `真实输出` in the right inspector.

Browser evidence:

```text
runs/browser_e2e/visual_workbench_ux_refactor/2026-05-29T03-52-51-249Z/journey-report.json
runs/browser_e2e/visual_workbench_ux_refactor/2026-05-29T03-52-51-249Z/screenshots/
```

Focused verification:

```bash
uv run pytest -q tests/unit/test_clean_workflow_engine.py::test_nested_workflow_single_output_binding_becomes_parent_node_output tests/server/test_workflows_api.py::test_post_workflow_materializes_inline_workflow_boundary_edges
cd web && npm run test -- --run
```

Result:

- Focused Python regression tests: 2 passed.
- Frontend tests after UX fix: 46 passed.

## 2026-05-29 Follow-up Cleanup

Low-priority gaps addressed after the main goal:

- Tightened Workbench tests so `保存` button assertions no longer accept mojibake fallback text.
- Updated findings/progress docs to mark the Journey B insertion issue as superseded by the explicit `加入到选中 Workflow` / `根画布` UX fix.
