# Findings: Visual Workbench UX Refactor

Status: historical audit log with fixes appended. Do not treat every finding below as a current
defect.

Current reading rule:

- This file records the Workbench UX audit trail and the fixes applied during the goal.
- For current final evidence, read `docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md`.
- For current Workbench architecture, read `docs/CURRENT_ARCHITECTURE.md` and `web/README.md`.

## Critical

None recorded yet.

## High

### H1: Task state is stored in component memory and is lost when the Workbench unmounts

Status: fixed in current milestone.

Evidence:

- `web/src/components/WorkflowViewer.tsx` initializes `tasks` with `useState`.
- `web/src/App.tsx` conditionally renders `WorkflowViewer` only when the active view is `tasks`.
- Switching to another navigation view unmounts `WorkflowViewer`, so newly created tasks are reinitialized when returning.

Root cause:

- UI task state lacks a persistent source of truth.

First-principles violation:

- A user-owned task is durable authoring state, not transient render state.

Smallest safe fix:

- Introduce a small task persistence boundary and store tasks outside component lifetime.

Implemented fix:

- `WorkflowViewer` now loads and saves a versioned task payload in browser local storage.
- New tasks persist across main navigation switches because the task source no longer depends on component lifetime.
- Task rows now include an explicit trash action.
- Added UI test coverage for create -> switch nav -> restore -> delete.

### H2: Default Workbench startup loads demo canvas nodes instead of a clean user task

Status: fixed in current milestone.

Evidence:

- `WorkflowViewer` initializes from `workspaceDemoCanvas()`.
- The UI message references `Workspace Canvas Demo`.

Root cause:

- Demo data is treated as the default task source.

First-principles violation:

- Examples are fixtures; they should not become implicit user state.

Smallest safe fix:

- Start from an empty persistent task and make demo loading an explicit action if still needed.

Implemented fix:

- The default task canvas is empty.
- Historical workspace demo is still available through an explicit `加载示例` action for tests/manual demos.
- Existing graph demo behavior remains testable without polluting the default task.

### H3: Chinese UI text contained mojibake in source-visible strings

Status: fixed for the goal-critical Workbench paths.

Evidence:

- Earlier Workbench navigation, task, resource, and toolbar tests had to tolerate mojibake fallback labels.
- Primary Workbench UI paths now render valid Simplified Chinese labels for navigation, task creation/deletion, resource insertion, toolbar actions, and inspector evidence.

Root cause:

- Previous encoding or copy/write path corrupted UTF-8 Chinese strings.

First-principles violation:

- The phase requires Chinese-first UI; unreadable text breaks the primary interaction contract.

Smallest safe fix:

- Replace corrupted primary UI strings with valid Simplified Chinese and add tests for required labels.

Implemented fix:

- Left navigation visible labels are readable Chinese and covered by tests.
- Task/resource/toolbar tests now target valid Chinese labels and no longer accept mojibake fallback for `保存`.

Remaining:

- Non-goal historical docs may still mention mojibake examples as defect history. Keep code-level cleanup focused on visible Workbench paths so behavior is not accidentally changed.

## Medium

### M1: Node inspector mixes graph/class/runtime concepts

Status: partially fixed in current milestone.

Evidence:

- The current inspector has tabs for config/raw data, but selected node runtime evidence is mostly path-based unless opened separately.
- System/class prompt and invocation input boundaries are not enforced strongly in the visible UX.

Root cause:

- The UI model grew from graph editing and run inspection incrementally, without a strict class-instance-evidence split.

Smallest safe fix:

- Refactor inspector display around class reference, invocation config, effective input, real output, and evidence.

Implemented fix:

- Executable workflow nodes now resolve their matching `WorkflowRunResult.nodes` entry and show real `input.json` and `output.json` inline.
- Internal Agent/Tool nodes now resolve run evidence through `parent_node_id`, `ui_node_id`, or scoped node id.
- Internal node evidence buttons now use the same evidence dock reader as workflow-level history instead of a no-op callback.
- The Agent instance overview now states that system prompts belong to the reusable Agent Class in the resource library; task nodes expose only invocation/user input, mappings, status, capsule/runtime, and evidence.
- Added frontend regression coverage for selecting an internal Agent instance after a run and reading real input/output artifacts.

Remaining:

- The resource library editor still needs the full class-side prompt/schema editing UX for the semiconductor Journey A/B.
- Runtime evidence for nested workflow-to-external-agent output should be validated in browser E2E once the semiconductor journey fixtures are implemented.

### M2: Demo and fixture cleanup needs an inventory before deletion

Evidence:

- The repo contains many `demo_*`, `example`, and semiconductor-related capsules/workflows.
- Existing tests reference examples and fixtures.

Root cause:

- Multiple historical goals accumulated examples and generated artifacts.

Smallest safe fix:

- Build a deletion allowlist from test references before removing anything.

## Low

### L1: Browser QA journey needs goal-specific evidence output

Evidence:

- Existing browser scripts and example journey reports exist, but this goal requires two semiconductor journeys and explicit friction fixes.

Smallest safe fix:

- Extend the browser script or add a focused journey report under `runs/browser_e2e/visual_workbench_ux_refactor/`.

### M3: Prompt templates could silently omit task input

Status: fixed.

Evidence:

- `runs/ui_workflow_task_canvas_1779991411099_1779993528829/nodes/semiconductor_stock_news_cleaner_codex/input.json` contained `upstream_context[0].output_inline.news`.
- The same node's `resolved_prompt.md` did not contain the runtime input, so the Codex model reported that `upstream_context[0].output_inline.news` was missing.

Root cause:

- `render_prompt()` only exposed `input_json` as a Jinja variable. Templates that did not explicitly include `{{ input_json }}` sent only static instructions to external agents.

First-principles violation:

- A task node instance must receive its invocation input. Writing `input.json` is not enough if the external agent prompt never includes it.

Implemented fix:

- `render_prompt()` now appends an `ACC Runtime Input` JSON block when a template does not explicitly render `input_json`.
- Added regression coverage in `tests/unit/test_prompting.py`.

### M4: Control-edge context truncated normal agent outputs

Status: fixed.

Evidence:

- The semiconductor collector produced a 27-38 KiB output.
- Downstream input previously contained `output_inline: null`, forcing the cleaner to see only a path and summary.

Root cause:

- `inline_upstream_output()` used a hard-coded 8 KiB cutoff.

Implemented fix:

- Replaced the magic cutoff with `MAX_UPSTREAM_CONTEXT_INLINE_BYTES = 256 * 1024`.
- Added a clean workflow regression test proving outputs larger than 8 KiB but within the bounded limit are passed inline.

### M5: Resource drawer workflow insertion is discoverable but mechanically awkward

Status: superseded by the fixed M5 entry below.

Evidence:

- Dragging resource cards into a Workflow container through browser-controlled mouse movement did not reliably create internal nodes.
- Clicking `加入` while the resource drawer overlays the canvas can miss the selected Workflow because the drawer obscures the container.
- The workable sequence is: close drawer -> select Workflow -> reopen resources -> click `加入`.

Root cause:

- The drawer occupies the same horizontal region as the left side of the canvas and does not provide an explicit `加入到选中 Workflow` affordance.

Smallest safe fix:

- Keep the current selected-Workflow insertion path, but surface it explicitly in the resource card copy/button state and avoid requiring the user to close/reopen the drawer to establish selection.

### M5: Resource drawer workflow insertion was discoverable but mechanically awkward

Status: fixed.

Evidence:

- Browser Journey B required adding two internal Workflow nodes and then adding an outer root Agent while the Workflow remained selected.
- Without an explicit root action, the user had to infer how to clear selection before adding the outer Agent.

Implemented fix:

- Newly created Workflow containers are auto-selected.
- Resource cards now show `加入到选中 Workflow` when a Workflow target exists.
- Resource cards also show `根画布` so an outer root node can be added without losing the selected
  Workflow context.
- Added frontend tests for both selected-Workflow insertion and root insertion while a Workflow is selected.

### H4: Inline Workflow nodes returned status summaries instead of public child outputs

Status: fixed.

Evidence:

- First Journey B run completed, but `nodes/New_Workflow/output.json` contained only `status`, `summary`, `child_workflow_id`, and `child_workflow_run_dir`.
- The outer analysis Agent received `upstream_context[0].output_inline` without `top_news`, even though the nested cleaner produced 5 `top_news` items.

Root cause:

- Generated inline Workflow parent nodes did not include `workflow_call_output_bindings`.
- Runtime wrote the nested workflow call status summary as the Workflow node output, so default control-edge propagation passed metadata instead of the Workflow function's public return value.

First-principles violation:

- A WorkflowFunctionTemplate call should expose its declared output contract to downstream nodes; status metadata is execution evidence, not the function return value.

Implemented fix:

- `acc.server.routes.workflows.materialize_inline_workflow_nodes()` now writes `workflow_call_output_bindings` from child exposed outputs to parent output ports.
- `acc.app.workflow_node_output_payload()` now surfaces a single child workflow public output as the parent Workflow node `output.json`.
- Added regression coverage in `tests/unit/test_clean_workflow_engine.py` and `tests/server/test_workflows_api.py`.

Validated evidence:

- `runs/ui_workflow_task_canvas_1779997640823_1779997716734/nodes/New_Workflow/output.json` contains 5 `top_news` items.
- `runs/ui_workflow_task_canvas_1779997640823_1779997716734/nodes/semiconductor_stock_analysis_advisor_codex/input.json` contains 5 `upstream_context[0].output_inline.top_news` items.
