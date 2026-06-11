# UX and Browser QA Plan

## Purpose

If a browser UI exists, Codex must test it like a real user rather than only running build commands.

## Required journeys

### Journey 1: Chinese UI smoke

Steps:

1. Open the app.
2. Verify major labels are Chinese.
3. Check top toolbar, node library, graph canvas, property panel, run inspector.

Expected:

- No English-only main action labels unless intentionally technical.
- No blank page.
- No console errors.

### Journey 2: Create or edit Capsule

Steps:

1. Open Capsule Library.
2. Create or open a demo capsule.
3. Edit prompt/schema/artifact manifest if supported.
4. Validate capsule.
5. Test run capsule.

Expected:

- Validation result is visible.
- Errors are understandable.
- Test run creates inspectable artifacts.

### Journey 3: Graph workflow creation

Steps:

1. Open Workflow Builder.
2. Add two nodes.
3. Connect nodes through graph edge drag/connection.
4. Edit node input mapping.
5. Save graph.
6. Validate graph.
7. Run graph.
8. Inspect node outputs.

Expected:

- Dependencies are visible as edges.
- Run status appears on nodes.
- Output/artifact/log views are accessible.

### Journey 4: Parallel workflow inspection

Steps:

1. Open demo parallel graph.
2. Verify fan-out/fan-in visually.
3. Run workflow.
4. Inspect node status and timing if available.

Expected:

- Parallel structure is obvious.
- User can tell which nodes are independent.

### Journey 5: Error handling

Steps:

1. Create an invalid graph or invalid capsule config.
2. Run validation.
3. Inspect error.

Expected:

- Error message tells what is wrong and where.
- User can navigate to the offending node/file/field.

## Evidence required

Store evidence under:

```text
runs/browser_e2e/<timestamp>/
```

Required files:

```text
browser_e2e_report.json
console.log
screenshots/
```

Optional:

```text
network.log
trace.zip
video.webm
```

## Report format

Each journey report must include:

- journey id;
- steps executed;
- pass/fail/blocked;
- screenshots;
- console errors;
- issues found;
- fixes applied;
- retest result.
