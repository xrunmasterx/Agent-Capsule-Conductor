# Browser E2E Plan

## Objective

Use browser automation to validate ACC Workbench as a real user would use it.

Codex may use:

- built-in browser-control tools,
- Playwright if available,
- manual browser automation scripts if already present.

If none are available, document the gap and keep hermetic tests passing.

## Required browser journeys

### Journey A: Chinese UI smoke

Goal: verify Workbench defaults to Chinese.

Steps:

1. Open the Workbench home page.
2. Verify these labels exist:
   - 节点库
   - 工作流
   - 画布
   - 属性面板
   - 输入
   - 输出
   - 产物
   - 日志
   - 保存
   - 校验
   - 运行
3. Record screenshot.
4. Record console errors.

Pass criteria:

- all core labels visible,
- no severe console errors,
- no blank page.

### Journey B: Create Capsule without manual file editing

Steps:

1. Open Capsule page.
2. Click 创建 Capsule.
3. Fill id, name, runtime, prompt, input field, output field.
4. Save.
5. Validate.
6. Test run.
7. Open run inspector.

Pass criteria:

- no manual file editing required,
- generated capsule validates,
- test run completes or fails with clear reason,
- output/artifacts are accessible.

### Journey C: Build and run two-node graph

Steps:

1. Open Workflow Builder.
2. Add node A.
3. Add node B.
4. Connect A -> B using graph edge.
5. Configure B input from A output.
6. Save.
7. Validate.
8. Run.
9. Inspect A output.
10. Inspect B input/output.

Pass criteria:

- edge is visible,
- data mapping is visible or inspectable,
- run succeeds,
- node status visible,
- artifacts visible.

### Journey D: Parallel workflow inspection

Steps:

1. Load a parallel demo graph.
2. Use auto layout.
3. Verify fan-out/fan-in is visible.
4. Run graph.
5. Inspect parallel branch node statuses.
6. Inspect merge output.

Pass criteria:

- parallel topology is visually obvious,
- node statuses update,
- merge node waits for branches or reports failure policy.

### Journey E: Debugger / Replay browser path

Steps:

1. Open a completed or failed run.
2. Select a node.
3. Open input/output/prompt/artifacts/events.
4. Trigger 重跑节点.
5. Trigger 从此节点重跑 if available.
6. Compare original and rerun.

Pass criteria:

- failure or result can be understood within the UI,
- rerun action is available,
- diff/comparison is accessible or documented.

### Journey F: GraphOps safety path

Steps:

1. Open sample graph patch.
2. Validate patch.
3. Dry-run patch.
4. Inspect semantic diff.
5. Verify destructive apply is not available by default.

Pass criteria:

- patch diff is understandable,
- high-risk changes are flagged,
- apply requires explicit approval.

## Evidence format

Write:

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
```

Schema:

```json
{
  "started_at": "...",
  "ended_at": "...",
  "base_url": "...",
  "journeys": [
    {
      "id": "journey_a_chinese_ui_smoke",
      "status": "pass",
      "steps": [],
      "screenshots": [],
      "console_errors": [],
      "network_errors": [],
      "issues_found": [],
      "fixes_applied": []
    }
  ]
}
```

## Optimization loop

For each failed journey:

1. Capture evidence.
2. Diagnose root cause.
3. Patch implementation.
4. Rerun journey.
5. Record final status.

Do not mark the browser E2E goal complete with unresolved critical journeys unless the blocker is outside the repository and documented.
