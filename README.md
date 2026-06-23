# Agent Callable Conductor

Agent Callable Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature external agents and local tools as reusable callable assets.

ACC does not implement a new LLM reasoning loop. Codex CLI, Claude Code, Cursor, Gemini, other external agents, and local tools own their internal behavior. ACC owns orchestration boundaries: callable definitions, invocations, control decisions, explicit data movement, evidence, artifacts, projections, and governed workflow edits.

## Architecture Authority

Start here before architecture-sensitive work:

```text
AGENTS.md
docs/architecture/00-constitution.md
docs/architecture/01-core-object-model.md
docs/architecture/02-runtime-kernel.md
docs/architecture/03-control-modes.md
docs/architecture/04-data-plane-and-evidence.md
docs/architecture/05-api-ui-boundaries.md
docs/architecture/06-graphops-governance.md
docs/architecture/07-compatibility-and-migration.md
docs/architecture/08-architecture-proof-obligations.md
```

Archived documents under `docs/historical/` are historical context only.

## Current Architecture Summary

Core v2 is callable-first:

```text
AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> ExecutionPlan
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> events, results, inboxes, outboxes, artifacts
```

Templates are reusable and stateless. Runtime identity and evidence are run-scoped. Data movement is explicit through ports, bindings, inbox/outbox materialization, result refs, and artifacts.

## Install

This repository uses `uv`.

```bash
uv sync
uv run acc callable list
```

The Workbench UI lives in `web/`:

```bash
cd web
npm install
```

## Core CLI Commands

```bash
uv run acc callable list
uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json --run-dir runs/acceptance_callable_main --emit-json
```

When `--emit-json` is used, stdout must contain exactly one JSON object. Runtime logs go to stderr or files.

## Local Workbench Server

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

Workbench frontend:

```bash
cd web
npm run dev
```

Open `http://127.0.0.1:5173`.

## Tests

Full local quality gate:

```bash
uv run python scripts/quality_gate.py
```

Backend:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```
