# Agent Capsule Workbench Web

Read-only React/TypeScript UI for inspecting Agent Capsule Conductor runs, capsules, artifacts, and workflows.

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
npm test
npm run build
```

## Read-only boundary

The UI consumes `acc-server` endpoints only. It does not parse repository files directly and does not expose workflow save, edge editing, GraphOps apply, or capsule mutation controls.

