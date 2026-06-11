# Acceptance Criteria: Workflow Kernel Upgrade

The goal is complete only when every required item below passes.

## 1. Existing regression remains green

Required:

```bash
uv run pytest -q
uv run ruff check .
```

Existing MVP smoke path must still work:

```bash
uv run acc list
uv run acc validate echo-test.generic
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/workflow_kernel_regression_echo \
  --emit-conductor-json
```

Acceptance:

- stdout is exactly one JSON object;
- output path exists;
- event log exists;
- no logs appear in stdout.

## 2. WorkflowGraph v3 examples validate

Required:

```bash
uv run acc workflow validate examples/workflows/demo_level_parallel.graph.json
uv run acc workflow validate examples/workflows/demo_branch_failure.graph.json
uv run acc workflow validate examples/workflows/demo_nested_workflow.graph.json
```

If `demo_for_each_research.graph.json` is implemented:

```bash
uv run acc workflow validate examples/workflows/demo_for_each_research.graph.json
```

Acceptance:

- all implemented examples validate;
- validation reports are human-readable;
- `--json` output is available or existing JSON output behavior is preserved.

## 3. DAG level parallel execution works

Required:

```bash
uv run acc workflow run examples/workflows/demo_level_parallel.graph.json \
  --run-dir runs/acceptance_level_parallel \
  --emit-json
```

Acceptance:

- `runs/acceptance_level_parallel/workflow_run_manifest.json` exists;
- `workflow_events.jsonl` exists;
- `workflow_summary.json` exists;
- summary shows multiple topological levels;
- at least one level has more than one scheduled node;
- every node has an isolated `node_runs/<node_id>/` directory;
- final status is `success`.

## 4. Failure modes work

Required:

```bash
uv run acc workflow run examples/workflows/demo_branch_failure.graph.json \
  --run-dir runs/acceptance_branch_failure \
  --emit-json
```

Acceptance:

- workflow summary records failure policy;
- failed node has structured error;
- event log contains `node_failed`;
- workflow final state matches configured failure mode;
- no stdout log pollution.

## 5. Nested ACC workflow capsule works

Required:

```bash
uv run acc validate acc-subworkflow.example
uv run acc workflow run examples/workflows/demo_nested_workflow.graph.json \
  --run-dir runs/acceptance_nested_workflow \
  --emit-json
```

Acceptance:

- parent workflow run succeeds;
- nested workflow run directory exists under parent run artifacts or node run directory;
- nested workflow output is mapped to parent node output;
- events include nested workflow start/completion markers.

## 6. Capsule kind validation works

Required:

```bash
uv run acc validate acc-subworkflow.example
uv run acc validate codex-agent-workflow.example
uv run acc validate external-conductor.example
```

Acceptance:

- all three validate without requiring real Codex/Hermes/Conductor;
- missing behavior pack or missing workflow file fails with clear error.

## 7. Event commands work

Required:

```bash
uv run acc workflow events runs/acceptance_level_parallel --json
uv run acc workflow inspect runs/acceptance_level_parallel --json
```

Acceptance:

- events command returns valid JSON or JSONL parsed summary;
- inspect command reports workflow status, node statuses, event log path, summary path.

## 8. GraphOps semantic validation works

Required:

```bash
uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json --semantic
uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run --semantic
```

Acceptance:

- dry-run does not mutate source files;
- semantic diff is produced;
- resulting graph/capsule semantic validation is performed;
- invalid patch fixture, if present, fails with clear error.

## 9. Conductor export works

Required:

```bash
mkdir -p runs/acceptance_conductor_export
uv run acc conductor export examples/workflows/demo_level_parallel.graph.json \
  --out runs/acceptance_conductor_export/demo_level_parallel.conductor.yaml
```

Acceptance:

- exported YAML exists;
- YAML contains `uv run acc run`;
- YAML contains `--emit-conductor-json`;
- YAML contains the graph node ids;
- Conductor is not required for this test.

## 10. Documentation updated

Required docs exist:

```text
docs/codex_goal_workflow_kernel/GOAL.md
docs/codex_goal_workflow_kernel/SPEC.md
docs/codex_goal_workflow_kernel/DESIGN.md
docs/codex_goal_workflow_kernel/ACCEPTANCE.md
docs/human/ACC_WORKFLOW_KERNEL_PLAIN_LANGUAGE.md
```

Codex must update:

```text
docs/codex_goal_workflow_kernel/PROGRESS.md
```

## 11. No scope creep

The implementation must not:

- replace ACC WorkflowGraph with Conductor YAML as internal IR;
- copy Conductor full DSL;
- implement a new LLM tool loop;
- require real external agent credentials in default tests;
- auto-apply LLM graph patches without human approval;
- remove existing stdout JSON contract.
