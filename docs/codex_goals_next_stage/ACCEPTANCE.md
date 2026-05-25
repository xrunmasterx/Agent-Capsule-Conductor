# ACC Next Stage Acceptance Criteria

The next-stage goals are complete only when all required criteria below pass.

## 1. Baseline regression

These must pass:

```bash
uv run pytest -q
uv run ruff check .
uv run acc list
uv run acc validate echo-test.generic
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_next_regression_echo \
  --emit-conductor-json
```

Acceptance:

- stdout is exactly one JSON object for `--emit-conductor-json`.
- no log text appears in stdout.
- event_log exists.
- artifact_dir exists.
- output_path exists if status is success.

## 2. Debugger & Replay acceptance

Required commands:

```bash
uv run acc workflow run examples/workflows/debugger_replay_demo.graph.json \
  --run-dir runs/acceptance_debugger_demo \
  --emit-json

uv run acc events replay runs/acceptance_debugger_demo --json

uv run acc workflow rerun-node runs/acceptance_debugger_demo demo_node_a \
  --out runs/acceptance_rerun_node

uv run acc workflow rerun-from runs/acceptance_debugger_demo demo_node_a \
  --out runs/acceptance_rerun_from

uv run acc workflow fork runs/acceptance_debugger_demo \
  --from-node demo_node_a \
  --input examples/workflows/fork_override.json \
  --out runs/acceptance_fork

uv run acc run diff runs/acceptance_debugger_demo runs/acceptance_fork --json
```

Acceptance:

- replay reconstructs workflow and node statuses.
- rerun-node creates a new run dir.
- rerun-from creates a new run dir.
- fork records parent run metadata.
- diff returns machine-readable JSON.

If exact node ids differ, Codex must update demo files and acceptance docs consistently.

## 3. Workflow Capsule acceptance

Required commands:

```bash
uv run acc validate codex-workflow-capsule.example
uv run acc validate acc-subworkflow-capsule.example
uv run acc validate external-workflow-capsule.example

uv run acc run acc-subworkflow-capsule.example \
  --input examples/capsules/acc-subworkflow-capsule.example/input.json \
  --run-dir runs/acceptance_acc_subworkflow \
  --emit-conductor-json
```

Acceptance:

- `agent_workflow`, `acc_workflow`, and `external_workflow` kinds validate.
- `acc_workflow` runs a nested workflow.
- materialized snapshot exists.
- lifecycle logs exist.
- parent run can consume child workflow output.

## 4. Control Plane acceptance

Required commands:

```bash
uv run acc capsules list --json
uv run acc capsules show echo-test.generic --json
uv run acc workflows list --json
uv run acc workflows show examples/workflows/control_plane_demo.graph.json --json

uv run acc workflow run examples/workflows/control_plane_demo.graph.json \
  --run-dir runs/acceptance_control_plane \
  --emit-json

uv run acc runs show runs/acceptance_control_plane --json
uv run acc graphops validate examples/graphops/add-review-node.patch.json --json
uv run acc graphops dry-run examples/graphops/add-review-node.patch.json --json
```

Acceptance:

- all JSON outputs parse.
- dangerous apply operations are not exposed by default.
- graphops dry-run reports resulting changes.
- no command requires real external credentials.

## 5. Browser E2E acceptance

If a browser automation path is available, run the required browser journeys from `BROWSER_E2E_PLAN.md`.

Required artifacts:

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
runs/browser_e2e/<timestamp>/console.log
runs/browser_e2e/<timestamp>/network.log
runs/browser_e2e/<timestamp>/screenshots/
```

Acceptance:

- browser report is valid JSON.
- journeys include pass/fail status.
- Chinese UI labels are checked.
- console errors are recorded.
- network errors are recorded.
- failed journeys include root cause and retest status.

If browser tooling is unavailable, Codex must record the gap in:

```text
docs/codex_goals_next_stage/INTEGRATION_GAPS.md
```

and still pass all hermetic tests.

## 6. UI Chinese acceptance

If Workbench UI exists, verify core labels:

```text
节点库
工作流
画布
属性面板
输入
输出
产物
日志
保存
校验
运行
自动布局
重跑节点
从此节点重跑
Fork 运行
对比运行
```

Core labels must be Chinese by default.

## 7. Documentation acceptance

Required docs exist:

```text
docs/human/ACC_NEXT_STAGE_PLAIN_LANGUAGE.md
docs/codex_goals_next_stage/ROADMAP.md
docs/codex_goals_next_stage/SPEC.md
docs/codex_goals_next_stage/DESIGN.md
docs/codex_goals_next_stage/TEST_PLAN.md
docs/codex_goals_next_stage/ACCEPTANCE.md
docs/codex_goals_next_stage/BROWSER_E2E_PLAN.md
docs/codex_goals_next_stage/UX_METRICS.md
```

## 8. No regression

The system must not:

- break existing `acc run`,
- break stdout JSON contract,
- require real external services by default,
- auto-apply dangerous graph mutations,
- replace the existing runtime with a new unrelated framework,
- hide test failures behind narrative summaries.
