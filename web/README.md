# Agent Capsule Workbench Web

React/TypeScript Workbench for editing local task canvases, saving workflows, submitting async
workflow runs, and inspecting Agent Capsule Conductor run evidence.

## Run locally

From the repository root:

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

In another shell:

```bash
cd web
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8765`.

## Test

```bash
npm run test -- --run
npm run build
```

## Architecture boundary

The UI consumes `acc-server` endpoints. It should not become runtime truth and should not parse run
directories as its primary data path.

Current Workbench responsibilities:

- create browser-local tasks;
- edit graph-first task canvases;
- insert resource-library Agent/Tool/Workflow classes as invocation nodes;
- save validated workflow graphs through server APIs;
- submit runs through `/api/workflows/run-graph/submit`;
- poll `/api/runs/{run_id}` and `/api/runs/{run_id}/events`;
- show real `input.json`, `output.json`, events, and artifact evidence in inspectors.

Boundary rules:

- System prompts belong to reusable resource-library Agent/Tool classes.
- Task canvas nodes are invocation instances and may configure invocation-scoped user prompt,
  static input, and bindings.
- Multiple tasks/runs must be represented by run-scoped projections. Do not collapse run state back
  into one global `isRunning` singleton.
- GraphOps apply must remain validation/dry-run/human-approval first.
