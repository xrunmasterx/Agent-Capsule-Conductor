# Progress Log: Workflow Kernel Upgrade

Codex should update this file after each milestone.

## Template

```text
Milestone:
Status:
Files changed:
Tests run:
Result:
Next step:
Blocked by:
```

## 2026-05-25 - Milestone 1: Baseline audit and regression lock

Milestone: Baseline audit and regression lock
Status: In progress
Files changed: docs/codex_goal_workflow_kernel/PROGRESS.md
Tests run:
- uv run pytest -q
- uv run ruff check .
Result:
- ruff passed.
- pytest currently has 142 passing tests and 4 failing tests.
- Failing tests are existing GraphOps tests caused by the checked-in v3 example patch using `add_control_edge` and `add_data_edge` while `schemas/graphops_patch_schema.json` still only accepts the older operation enum.
- Current workflow implementation files are `acc/workflow_graph.py`, `acc/workflow_runner.py`, `acc/graphops.py`, `acc/cli.py`, and `acc/server/routes/workflows.py`.
Next step: Implement event emitters and WorkflowGraph v3 compatibility/semantic validation.
Blocked by: None.

## 2026-05-25 - Milestones 2-9: Kernel upgrade implementation

Milestone: Event emitters, WorkflowGraph v3 validation, DAG scheduler, failure modes, data edges, capsule kinds, GraphOps semantic validation, and Conductor export
Status: Implemented
Files changed:
- acc/events.py
- acc/workflow_graph.py
- acc/workflow_runner.py
- acc/runner.py
- acc/schemas.py
- acc/registry.py
- acc/graphops.py
- acc/conductor_export.py
- acc/cli.py
- acc/fake_agents.py
- schemas/capsule_template_schema.json
- schemas/graphops_patch_schema.json
- capsules/fake-agent.generic/input_schema.json
- capsules/acc-subworkflow.example/**
- capsules/codex-agent-workflow.example/**
- capsules/external-conductor.example/**
- examples/workflows/demo_level_parallel.graph.json
- examples/workflows/demo_branch_failure.graph.json
- examples/workflows/demo_nested_workflow.graph.json
- examples/graphops/add-review-node.patch.json
- tests/integration/test_graphops_dry_run.py
Tests run:
- uv run pytest -q
- uv run ruff check .
- uv run acc workflow validate examples/workflows/demo_level_parallel.graph.json
- uv run acc workflow validate examples/workflows/demo_branch_failure.graph.json
- uv run acc workflow validate examples/workflows/demo_nested_workflow.graph.json
- uv run acc workflow run examples/workflows/demo_level_parallel.graph.json --run-dir runs/tmp_level_parallel --emit-json
- uv run acc workflow run examples/workflows/demo_branch_failure.graph.json --run-dir runs/tmp_branch_failure --emit-json
- uv run acc workflow run examples/workflows/demo_nested_workflow.graph.json --run-dir runs/tmp_nested_workflow --emit-json
- uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json --semantic
- uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run --semantic
- uv run acc conductor export examples/workflows/demo_level_parallel.graph.json --out runs/tmp_conductor_export/demo_level_parallel.conductor.yaml
Result:
- Full pytest passed: 146 passed.
- Ruff passed.
- v3 examples validate.
- Level-parallel, branch failure, and nested workflow demos run hermetically.
- GraphOps semantic dry-run validates resulting WorkflowGraph without mutation.
- Conductor export writes YAML without requiring Conductor.
Next step: Run every command in docs/codex_goal_workflow_kernel/ACCEPTANCE.md and fix any remaining gaps.
Blocked by: None.

## 2026-05-25 - Final acceptance

Milestone: Acceptance verification
Status: Completed
Files changed:
- docs/codex_goal_workflow_kernel/PROGRESS.md
Tests run:
- uv run pytest -q
- uv run ruff check .
- uv run acc list
- uv run acc validate echo-test.generic
- uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/workflow_kernel_regression_echo --emit-conductor-json
- uv run acc workflow validate examples/workflows/demo_level_parallel.graph.json
- uv run acc workflow validate examples/workflows/demo_branch_failure.graph.json
- uv run acc workflow validate examples/workflows/demo_nested_workflow.graph.json
- uv run acc workflow validate examples/workflows/demo_for_each_research.graph.json
- uv run acc workflow run examples/workflows/demo_level_parallel.graph.json --run-dir runs/acceptance_level_parallel --emit-json
- uv run acc workflow run examples/workflows/demo_branch_failure.graph.json --run-dir runs/acceptance_branch_failure --emit-json
- uv run acc validate acc-subworkflow.example
- uv run acc workflow run examples/workflows/demo_nested_workflow.graph.json --run-dir runs/acceptance_nested_workflow --emit-json
- uv run acc validate codex-agent-workflow.example
- uv run acc validate external-conductor.example
- uv run acc workflow events runs/acceptance_level_parallel --json
- uv run acc workflow inspect runs/acceptance_level_parallel --json
- uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json --semantic
- uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run --semantic
- uv run acc conductor export examples/workflows/demo_level_parallel.graph.json --out runs/acceptance_conductor_export/demo_level_parallel.conductor.yaml
- MVP acceptance smoke commands from docs/codex_goal/ACCEPTANCE.md for show/validate/run/session inspect/fake run/batch/GraphOps dry-run
Result:
- All Workflow Kernel acceptance commands passed.
- Existing MVP/workbench test suite passed: 146 passed.
- Ruff passed.
- Conductor export YAML contains `uv run acc run`, `--emit-conductor-json`, and all graph node ids.
Next step: None.
Blocked by: None.
