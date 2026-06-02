# Agent Callable Conductor

Agent Callable Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature
external agents or local tools as reusable callable assets.

ACC does not implement a new LLM reasoning/tool loop. Codex CLI, Claude Code, Cursor, Gemini, or a
generic local command owns its internal behavior. ACC owns the execution boundary: callable
definitions, runtime invocations, ports, inbox/outbox materialization, manifests, events, artifacts,
and human-governed workflow edits.

## Current Architecture

The active model is Core v2 and callable-first:

```text
AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> events, manifests, inboxes, outboxes, artifacts
```

Pre-Core-v2 workflow graphs and YAML assets are not product runtime inputs. They are migration input
only through `acc workflow import-graph` or `acc migrate graph`, and active workflow templates are
stored as canonical `.accflow.json` files with `callable_ref` nodes.

Read the current contract before making architecture changes:

```text
AGENTS.md
docs/README.md
docs/CURRENT_ARCHITECTURE.md
docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md
docs/concepts/GRAPHOPS_CONTROL_PLANE.md
```

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

List and inspect reusable callable resources:

```bash
uv run acc callable list
uv run acc callable show fake-agent.generic
```

Run a deterministic workflow:

```bash
uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json \
  --run-dir runs/acceptance_callable_main \
  --emit-json
```

When `--emit-json` is used, stdout must be exactly one JSON object. Runtime logs go to stderr or
files.

Import a pre-Core-v2 graph into the canonical format:

```bash
uv run acc workflow import-graph tests/fixtures/legacy/demo_two_node.graph.json
```

## Local Workbench Server

Start the API server:

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

Useful endpoints:

```text
GET  /api/health
GET  /api/version
GET  /api/callables
GET  /api/callables/{callable_id}
GET  /api/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
POST /api/runs/{run_id}/cancel
GET  /api/workflows
POST /api/workflows
PUT  /api/workflows/{workflow_id}
POST /api/workflows/run-graph
POST /api/workflows/run-graph/submit
GET  /api/artifacts/read?path=...
```

`POST /api/workflows/run-graph` is the synchronous Workbench compatibility path. The Workbench uses
`POST /api/workflows/run-graph/submit`, then polls run summaries/events by `run_id`.

The server is a thin FastAPI layer over app/store/runtime services. It does not add a database, and
artifact reads are constrained by path-safety checks.

## Visual Workbench

Run the frontend in a second shell:

```bash
cd web
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Workbench is graph-first and Chinese-first. It can create local tasks, edit task canvases, insert
resource-library agent/tool/workflow classes as invocation nodes, save workflows, submit async runs,
and inspect real node input/output/artifact evidence.

Important boundary:

- Resource-library Agent/Tool definitions own class-level settings such as system prompts.
- Task canvas nodes are invocation instances and should only store invocation-scoped prompt/input
  and bindings.
- UI task state is a usability projection. Run directories, summaries, events, and artifacts remain
  the runtime evidence source of truth.

## GraphOps

GraphOps is the controlled interface for workflow/callable edits. LLMs may propose patches, but
persistent mutation requires validation, dry-run evidence, and explicit human approval.

```bash
uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json
uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run
```

Real apply is rejected unless both `--apply` and `--human-approved` are present.

## Tests

Default tests are hermetic: they do not require real Codex, Claude, Cursor, Gemini, Hermes,
Conductor, network, browser cloud services, or paid credentials.

Backend checks:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend checks:

```bash
cd web
npm run test -- --run
npm run build
```

Machine-readable CLI checks must prove stdout contains one JSON object and no logs when JSON emit
flags are used.

## Runtime Evidence

Core v2 workflow runs write callable evidence such as:

```text
function_invocation_manifest.json
scope_frame_manifest.json
workflow_run_manifest.json
workflow_summary.json
nodes/<node_id>/session_instance_manifest.json
nodes/<workflow_node>/workflow_call_manifest.json
nodes/<node_id>/input.json
nodes/<node_id>/output.json
events.jsonl
```
