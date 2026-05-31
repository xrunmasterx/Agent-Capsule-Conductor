# Acceptance: Visual Workbench UX Refactor

Do not mark this goal complete until every required command and journey below has passed, or a concrete blocker is recorded in `INTEGRATION_GAPS.md`.

## 1. Baseline contracts

```bash
uv run pytest -q
uv run ruff check .
```

The following must still hold:

- `acc run ... --emit-conductor-json` stdout remains exactly one JSON object.
- Default tests require no real Codex, Claude, Cursor, Gemini, Hermes, Conductor, browser cloud service, network, or paid credentials.
- Existing graph/workflow/capsule acceptance behavior remains intact unless a migration is documented.

## 2. Frontend tests

```bash
cd web
npm run test -- --run
npm run build
```

Acceptance:

- left navigation labels are readable Chinese;
- task persistence tests pass;
- task delete tests pass;
- inspector evidence tests pass;
- no primary UI text required by this goal is mojibake.

## 3. Workbench task persistence

Manual or automated acceptance:

```text
Open Workbench
  -> create task
  -> switch to 资源
  -> switch back to 任务
  -> task still exists
  -> refresh browser
  -> task still exists
  -> click trash
  -> task is deleted
```

## 4. Cleanup

Acceptance:

- default Workbench task canvas does not load old demo nodes automatically;
- stale intermediate artifacts generated only by prior manual demos are removed or listed as intentionally retained;
- no required hermetic fixture is deleted.

## 5. Resource/class and node/instance separation

Acceptance:

- resource library can edit system prompt/class configuration;
- task node inspector does not edit system prompt by default;
- task node inspector supports user prompt and invocation input/mapping;
- saved class configuration and task invocation configuration do not overwrite each other.

## 6. Semiconductor serial workflow

Acceptance:

```text
Create/save agents:
  半导体股市信息收集
  半导体股市信息清洗
  半导体股市分析和建议

Create task:
  collect -> clean -> analyze

Run:
  all nodes success
  collector output contains at least 20 news items in hermetic test mode
  cleaner output contains 5 selected high-value items
  analysis output contains market analysis and operation suggestions
```

Clicking each node must show correct real input and full real output in the right inspector.

## 7. Nested workflow handoff

Acceptance:

```text
Create new task
  -> create workflow container
  -> bind workflow workspace to F:\ACCTest\1
  -> inside workflow add collect -> clean
  -> outside workflow add analysis agent
  -> connect workflow output to analysis input
  -> run
```

Clicking internal collect/clean nodes and outer analysis node must show correct real input and full real output.

The reusable workflow template must not save `F:\ACCTest\1` as template state; the path belongs to a local binding.

## 8. Browser evidence

Required evidence directory:

```text
runs/browser_e2e/visual_workbench_ux_refactor/<timestamp>/
```

Must contain:

- `journey-report.json`;
- screenshots for Journey A and Journey B;
- console log;
- network log;
- list of usability issues found and whether each was fixed/rerun.

## 9. Final report

Before completion, update:

```text
docs/codex_goal_visual_workbench_ux_refactor/FINDINGS.md
docs/codex_goal_visual_workbench_ux_refactor/PROGRESS.md
docs/codex_goal_visual_workbench_ux_refactor/QUALITY_REPORT.md
```

`QUALITY_REPORT.md` must include:

- what was deleted;
- what was kept;
- what was renamed;
- task persistence implementation;
- resource/class vs node/instance boundary;
- exact test command evidence;
- browser journey evidence;
- remaining risks.
