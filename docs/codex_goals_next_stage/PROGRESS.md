# Progress Log

Codex should update this file after each milestone.

## Template

```text
Milestone:
Status:
Files changed:
Commands run:
Result:
Issues found:
Fixes applied:
Browser evidence:
Next step:
Blocked by:
```

Milestone: Goal 1 Workflow Debugger & Replay
Status: completed
Files changed:
- acc/debugger.py
- acc/cli.py
- acc/workflow_runner.py
- acc/adapters/codex_cli.py
- acc/server/routes/capsules.py
- acc/server/routes/runs.py
- examples/workflows/debugger_replay_demo.graph.json
- examples/workflows/fork_override.json
- tests/unit/test_debugger.py
- tests/integration/test_cli_debugger_replay.py
- tests/unit/test_codex_cli_adapter.py
Commands run:
- uv run pytest -q tests/unit/test_debugger.py tests/integration/test_cli_debugger_replay.py tests/integration/test_cli_run_stdout_contract.py tests/integration/test_workflow_graph_runner.py tests/integration/test_cli_runs.py
- uv run pytest -q tests/unit/test_codex_cli_adapter.py tests/server/test_runs_api.py
- uv run pytest -q
- uv run ruff check .
- uv run acc list
- uv run acc validate echo-test.generic
- uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_next_regression_echo --emit-conductor-json
- uv run acc workflow run examples/workflows/debugger_replay_demo.graph.json --run-dir runs/acceptance_debugger_demo --emit-json
- uv run acc events replay runs/acceptance_debugger_demo --json
- uv run acc workflow rerun-node runs/acceptance_debugger_demo demo_node_a --out runs/acceptance_rerun_node
- uv run acc workflow rerun-from runs/acceptance_debugger_demo demo_node_a --out runs/acceptance_rerun_from
- uv run acc workflow fork runs/acceptance_debugger_demo --from-node demo_node_a --input examples/workflows/fork_override.json --out runs/acceptance_fork
- uv run acc run diff runs/acceptance_debugger_demo runs/acceptance_fork --json
- uv run acc artifacts diff runs/acceptance_debugger_demo/node_runs/demo_node_a/output.json runs/acceptance_fork/node_runs/demo_node_a/output.json --json
Result:
- Added `acc events replay`, `acc workflow rerun-node`, `acc workflow rerun-from`, `acc workflow fork`, `acc run diff`, and `acc artifacts diff`.
- Preserved existing `acc run` behavior and `--emit-conductor-json` stdout contract.
- Added workflow graph snapshots to workflow run directories for stable replay/rerun lineage.
- Added hermetic unit and integration tests plus a runnable debugger demo workflow and fork override input.
Issues found:
- `examples/workflows/debugger_replay_demo.graph.json` still used an old `data_edges` shape and could not run against the current workflow graph semantics.
- A first attempt to model `acc run diff` as a `Typer` subcommand broke the existing `acc run <capsule_id>` contract because `Typer` treated the capsule id as a subcommand.
- `ruff check .` surfaced pre-existing line-length/import-order issues that blocked acceptance even after Goal 1 logic passed.
Fixes applied:
- Normalized the debugger demo workflow to the current graph schema and aligned fork override semantics with `--from-node demo_node_a`.
- Reworked `acc run` dispatch so `acc run diff ...` and legacy `acc run <capsule_id>` both work without changing the user-facing entrypoint.
- Cleaned the repo-level lint blockers so full `ruff check .` passes.
Browser evidence:
- not applicable for Goal 1
Next step:
- move to the next-stage Goal 2 work while keeping Goal 1 commands and tests green
Blocked by:
- none

Milestone: Goal 2 Workflow Capsule & Agent Workflow Adapter
Status: completed
Files changed:
- acc/schemas.py
- acc/artifact_store.py
- acc/session.py
- acc/registry.py
- acc/runner.py
- acc/workflow_runner.py
- schemas/capsule_template_schema.json
- schemas/session_manifest_schema.json
- capsules/codex-workflow-capsule.example/**
- capsules/acc-subworkflow-capsule.example/**
- capsules/external-workflow-capsule.example/**
- examples/capsules/acc-subworkflow-capsule.example.yaml
- examples/capsules/codex-workflow-capsule.example.yaml
- examples/capsules/external-workflow-capsule.example.yaml
- examples/capsules/acc-subworkflow-capsule.example/input.json
- examples/capsules/codex-workflow-capsule.example/input.json
- examples/capsules/external-workflow-capsule.example/input.json
- examples/workflows/workflow_capsule_nested_demo.graph.json
- tests/unit/test_workflow_capsules.py
- tests/integration/test_cli_workflow_capsules.py
- tests/integration/test_example_capsules.py
Commands run:
- uv run pytest -q tests/unit/test_workflow_capsules.py tests/integration/test_cli_workflow_capsules.py tests/integration/test_example_capsules.py
- uv run pytest -q tests/integration/test_cli_run_stdout_contract.py tests/integration/test_cli_list_show_validate.py tests/integration/test_cli_session_inspect.py tests/integration/test_workflow_graph_runner.py tests/integration/test_cli_debugger_replay.py tests/unit/test_artifact_store.py tests/unit/test_schemas.py tests/unit/test_registry.py tests/unit/test_validation.py tests/unit/test_generic_cli_adapter.py
- uv run pytest -q
- uv run ruff check .
- uv run acc validate codex-workflow-capsule.example
- uv run acc validate acc-subworkflow-capsule.example
- uv run acc validate external-workflow-capsule.example
- uv run acc run codex-workflow-capsule.example --input examples/capsules/codex-workflow-capsule.example/input.json --run-dir runs/acceptance_codex_workflow_capsule --emit-conductor-json
- uv run acc run external-workflow-capsule.example --input examples/capsules/external-workflow-capsule.example/input.json --run-dir runs/acceptance_external_workflow_capsule --emit-conductor-json
- uv run acc run acc-subworkflow-capsule.example --input examples/capsules/acc-subworkflow-capsule.example/input.json --run-dir runs/acceptance_acc_subworkflow --emit-conductor-json
- uv run acc workflow run examples/workflows/workflow_capsule_nested_demo.graph.json --run-dir runs/acceptance_workflow_capsule_nested_demo --emit-json
- uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_next_regression_echo_goal2 --emit-conductor-json
- uv run acc workflow run examples/workflows/debugger_replay_demo.graph.json --run-dir runs/acceptance_debugger_demo_goal2 --emit-json
- uv run acc events replay runs/acceptance_debugger_demo_goal2 --json
Result:
- Added runtime support for workflow capsule kinds `agent_workflow`, `acc_workflow`, and `external_workflow` without rewriting the existing Capsule Runtime.
- Added `lifecycle` stages `setup/run/collect/cleanup` with timeout-limited execution, stage logs, and best-effort cleanup semantics.
- Added materialized `template_snapshot/` output and session manifest fields for snapshot/lifecycle directories.
- Added Goal 2 example capsules, fake local workflow scripts, nested workflow demo, and hermetic tests that actually run all three capsule kinds.
- Nested `acc_workflow` capsules now run child graphs in isolated run directories and can propagate parent input into the child workflow graph.
Issues found:
- Workflow capsule lifecycle execution initially failed because the new path used `asyncio` without importing it.
- A first pass at validation/examples had stale example YAML fields (`interface`, `required_files`) that did not match the live capsule schema used by the registry.
- Running unrelated acceptance commands in parallel can race on run-directory creation; command sequencing matters for debugger/diff evidence.
Fixes applied:
- Imported and wired `asyncio` into the lifecycle runner, then re-ran the new Goal 2 tests and full regression suite.
- Normalized Goal 2 example capsules and example YAML files to the current capsule schema while preserving the requested ids and acceptance inputs.
- Kept Goal 1 and baseline paths green with full `pytest`, `ruff`, baseline `echo-test.generic`, and debugger replay smoke commands.
Browser evidence:
- not applicable for Goal 2
Next step:
- move to Goal 3 control-plane work on top of the now-runnable workflow capsule substrate
Blocked by:
- none

Milestone: Goal 3 Agent-callable ACC Control Plane
Status: completed
Files changed:
- acc/control_plane.py
- acc/cli.py
- acc/graphops.py
- tests/integration/test_cli_control_plane.py
- tests/unit/test_graphops_patch_validation.py
- docs/codex_goals_next_stage/tasks.md
- docs/codex_goals_next_stage/INTEGRATION_GAPS.md
- docs/codex_goals_next_stage/PROGRESS.md
Commands run:
- uv run pytest -q tests/integration/test_cli_control_plane.py tests/unit/test_graphops_patch_validation.py
- uv run pytest -q tests/integration/test_cli_control_plane.py tests/integration/test_cli_runs.py tests/integration/test_graphops_dry_run.py tests/integration/test_cli_run_stdout_contract.py tests/unit/test_graphops_patch_validation.py
- uv run pytest -q
- uv run ruff check acc/control_plane.py acc/cli.py acc/graphops.py tests/integration/test_cli_control_plane.py tests/unit/test_graphops_patch_validation.py
- uv run ruff check .
- uv run acc capsules list --json
- uv run acc capsules show echo-test.generic --json
- uv run acc workflows list --json
- uv run acc workflows show examples/workflows/control_plane_demo.graph.json --json
- uv run acc workflow run examples/workflows/control_plane_demo.graph.json --run-dir runs/acceptance_control_plane --emit-json
- uv run acc runs show runs/acceptance_control_plane --json
- uv run acc artifacts get acceptance_control_plane:control_echo:output.json --json
- uv run acc graphops validate examples/graphops/add-review-node.patch.json --json
- uv run acc graphops dry-run examples/graphops/add-review-node.patch.json --json
- uv run acc list
- uv run acc validate echo-test.generic
- uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_next_regression_echo_goal3 --emit-conductor-json
Result:
- Added Goal 3 agent-callable CLI commands `acc capsules list/show --json`, `acc workflows list/show --json`, `acc artifacts get --json`, and `acc graphops validate/dry-run --json` without changing the existing `acc run` entrypoint or stdout contract.
- Extended `acc runs show` so it accepts a run id or a run directory path, which matches the Goal 3 acceptance shape.
- Added a control-plane helper module that resolves workflow references, run references, and artifact references inside the project root and emits stable machine-readable JSON payloads.
- Strengthened GraphOps default safety so schema/output-schema mutations are disabled by default in the agent-callable path.
- Documented the optional MCP server gap and kept the default deliverable hermetic with JSON CLI plus the existing local FastAPI server.
Issues found:
- The first `capsules show` payload tried to expose a non-existent `session_policy` field from `CapsuleSpec`.
- The first `artifacts get` shorthand only searched `artifacts/` and could not fetch run-level files such as `node_runs/<node>/output.json`.
- Goal 3 safety requirements were stricter than the older GraphOps schema path and required an explicit default block for schema mutations.
Fixes applied:
- Removed the invalid `session_policy` assumption from the control-plane capsule description payload.
- Expanded artifact reference resolution so `run_id:node_id:relative_path` falls back from `artifacts/` to the node run root when needed.
- Rejected `target_type=schema`, `replace_schema`, and `output_schema.json` mutations by default in GraphOps validation.
Browser evidence:
- not applicable for Goal 3
Next step:
- move to Goal 4 browser E2E UX work on top of the completed JSON control plane
Blocked by:
- optional MCP integration intentionally deferred and documented in `docs/codex_goals_next_stage/INTEGRATION_GAPS.md`

Milestone: Goal 4 Browser E2E UX Optimization
Status: completed
Files changed:
- acc/server/app.py
- acc/server/routes/capsules.py
- acc/server/routes/debugger.py
- acc/server/routes/graphops.py
- acc/server/routes/workflows.py
- acc/debugger.py
- acc/run_index.py
- tests/server/test_capsules_api.py
- tests/server/test_debugger_api.py
- tests/server/test_graphops_api.py
- tests/server/test_runs_api.py
- web/src/App.tsx
- web/src/api.ts
- web/src/types.ts
- web/src/components/CapsuleBrowser.tsx
- web/src/components/ControlPlanePanel.tsx
- web/src/components/RunInspector.tsx
- web/src/components/WorkflowViewer.tsx
- web/src/i18n/zh-CN.ts
- web/src/styles.css
- web/package.json
- web/tsconfig.node.json
- web/vite.config.ts
- web/scripts/browser-e2e.mjs
- docs/codex_goals_next_stage/INTEGRATION_GAPS.md
- docs/codex_goals_next_stage/PROGRESS.md
Commands run:
- uv run pytest -q tests/server/test_capsules_api.py tests/server/test_debugger_api.py tests/server/test_graphops_api.py tests/server/test_runs_api.py tests/server/test_workflows_api.py
- uv run pytest -q
- uv run ruff check .
- npm test
- npm run build
- npm run test:e2e
- uv run acc list
- uv run acc validate echo-test.generic
- uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_next_regression_echo --emit-conductor-json
- uv run acc workflow run examples/workflows/debugger_replay_demo.graph.json --run-dir runs/acceptance_debugger_demo --emit-json
- uv run acc events replay runs/acceptance_debugger_demo --json
- uv run acc workflow rerun-node runs/acceptance_debugger_demo demo_node_a --out runs/acceptance_rerun_node
- uv run acc workflow rerun-from runs/acceptance_debugger_demo demo_node_a --out runs/acceptance_rerun_from
- uv run acc workflow fork runs/acceptance_debugger_demo --from-node demo_node_a --input examples/workflows/fork_override.json --out runs/acceptance_fork
- uv run acc run diff runs/acceptance_debugger_demo runs/acceptance_fork --json
- uv run acc validate codex-workflow-capsule.example
- uv run acc validate acc-subworkflow-capsule.example
- uv run acc validate external-workflow-capsule.example
- uv run acc run acc-subworkflow-capsule.example --input examples/capsules/acc-subworkflow-capsule.example/input.json --run-dir runs/acceptance_acc_subworkflow --emit-conductor-json
- uv run acc capsules list --json
- uv run acc capsules show echo-test.generic --json
- uv run acc workflows list --json
- uv run acc workflows show examples/workflows/control_plane_demo.graph.json --json
- uv run acc workflow run examples/workflows/control_plane_demo.graph.json --run-dir runs/acceptance_control_plane --emit-json
- uv run acc runs show runs/acceptance_control_plane --json
- uv run acc graphops validate examples/graphops/add-review-node.patch.json --json
- uv run acc graphops dry-run examples/graphops/add-review-node.patch.json --json
- python -m json.tool runs/browser_e2e/2026-05-25T14-22-46-139Z/browser_e2e_report.json
Result:
- Added browser-callable debugger and GraphOps server routes so replay, rerun, fork, diff, validate, and dry-run are reachable from the Workbench UI.
- Added a dedicated control-plane panel plus a run debugger panel in the browser UI, covering Goal 4 journeys for replay/rerun/fork/diff and GraphOps safety inspection.
- Added a Playwright-based browser E2E runner that launches the local ACC server plus Vite dev server, records screenshots, console logs, network logs, and emits a machine-readable journey report.
- Preserved hermetic default testing and reran the full next-stage acceptance chain after the browser fixes.
Issues found:
- Workflow capsule detail requests crashed because the server assumed every capsule had a prompt template, which is false for `acc_workflow` and `external_workflow`.
- Debugger rerun/fork routes crashed on legacy workflow runs without `workflow_graph.json` snapshots because lineage replay passed a non-normalized graph into workflow output writing.
- Workbench browser journeys exposed several UX/runtime issues: duplicate `run_id` entries from stale `runs/index.json`, React Flow minimap intercepting node clicks, workflow save temp-file races under rapid save/validate/run clicks, and brittle node-handle / toolbar targeting in the E2E path.
Fixes applied:
- Made capsule detail responses workflow-kind-safe and added regression tests for workflow capsule metadata.
- Normalized legacy debugger lineage writes and added regression coverage for rerun paths without a graph snapshot.
- Deduplicated `RunIndex` on load/rebuild, made workflow saves use unique temp files, disabled minimap pointer interception, enlarged graph handles for edge creation, and tightened the browser E2E selectors around actual DOM scopes.
- Updated the Capsule Browser test path so generated capsules can be validated and test-run without manually switching the editor to `examples/input.json`.
Browser evidence:
- runner: Playwright fallback (`npm run test:e2e`)
- report: `runs/browser_e2e/2026-05-25T14-22-46-139Z/browser_e2e_report.json`
- screenshots: `runs/browser_e2e/2026-05-25T14-22-46-139Z/screenshots/`
- console log: `runs/browser_e2e/2026-05-25T14-22-46-139Z/console.log`
- network log: `runs/browser_e2e/2026-05-25T14-22-46-139Z/network.log`
- final journey status: A/B/C/D/E/F all `pass`
Next step:
- none
Blocked by:
- none
