# Goal 4: Browser E2E UX Optimization

## Objective

Use browser automation to validate and optimize the real ACC Workbench user experience.

## Problem

A workflow system can pass CLI tests but still be painful in the browser. The user specifically wants Codex to use browser control, simulate mouse clicks and keyboard input, and iteratively fix UX problems.

## Required UX principles

1. UI defaults to Chinese.
2. Core labels must be Chinese:
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
   - 自动布局
   - 重跑节点
   - 从此节点重跑
   - Fork 运行
   - 对比运行
3. Graph must be graph-first, not button-only.
4. Node dependencies must be visible as edges.
5. Serial and parallel workflows must be visually distinguishable.
6. Each node should expose input/output/artifact/log inspection.

## Browser journeys

Codex should use available browser automation. If Playwright exists, use it. If Codex browser-control tools are available, use them. If neither is available, document the gap and still provide test specs.

### Journey 1: Create custom Capsule

Steps:

1. Open Workbench.
2. Navigate to Capsule page.
3. Click 创建 Capsule.
4. Fill id, name, runtime, prompt, input field, output field.
5. Save.
6. Validate Capsule.
7. Run test input.
8. Inspect output and artifacts.

Pass criteria:

- no manual file editing required,
- validation result visible,
- test run result visible,
- UI labels are Chinese,
- no console errors.

### Journey 2: Build two-node workflow

Steps:

1. Open Workflow Builder.
2. Drag or add two Capsules to the canvas.
3. Connect node A to node B by an edge.
4. Configure B to consume A output.
5. Save workflow.
6. Validate workflow.
7. Run workflow.
8. Inspect node A output.
9. Inspect node B input and output.

Pass criteria:

- edge is visible,
- data dependency is clear,
- run succeeds,
- node statuses visible,
- artifacts accessible.

### Journey 3: Inspect parallel workflow

Steps:

1. Load demo parallel workflow.
2. Use auto layout.
3. Verify fan-out/fan-in shape is visible.
4. Run workflow.
5. Inspect parallel node statuses.
6. Inspect merge node output.

Pass criteria:

- parallel structure is visually obvious,
- nodes in same level can run concurrently if backend supports it,
- failed branch behavior is displayed.

### Journey 4: Debug and replay

Steps:

1. Open a failed or fixture run.
2. Inspect failed node.
3. Open stderr/events/artifacts.
4. Click 重跑节点 or 从此节点重跑.
5. Compare original and rerun results.

Pass criteria:

- failure reason visible within two clicks from node,
- rerun action available,
- diff or comparison visible.

### Journey 5: Agent control-plane smoke

Steps:

1. Use UI or CLI to list workflows.
2. Run an existing workflow.
3. Inspect run.
4. Retrieve artifact.
5. Validate a sample graph patch.
6. Dry-run the patch.

Pass criteria:

- all outputs are machine-readable,
- dangerous apply is not exposed by default,
- UI explains that patch needs approval.

## Required evidence

Codex must produce a browser E2E report:

```text
runs/browser_e2e/<timestamp>/browser_e2e_report.json
runs/browser_e2e/<timestamp>/screenshots/
runs/browser_e2e/<timestamp>/console.log
runs/browser_e2e/<timestamp>/network.log
```

## Optimization loop

For each failed journey:

1. Record failure.
2. Identify cause.
3. Patch implementation.
4. Rerun the journey.
5. Repeat until pass or document blocker.

## Acceptance summary

The goal passes when:

- required browser journeys pass or documented blockers exist,
- core UI labels are Chinese,
- no severe console errors remain,
- graph dependencies are visible,
- capsule creation no longer requires manual multi-file writing,
- node output/artifact inspection works from the browser.
