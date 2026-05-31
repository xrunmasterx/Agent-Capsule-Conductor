# Agent Capsule Conductor

Agent Capsule Conductor (`acc`) is a local-first workflow runtime and Workbench for wrapping mature
external agents or local tools as reusable callable assets.

ACC does not implement a new LLM reasoning/tool loop. Codex CLI, Claude Code, Cursor, Gemini, or a
generic local command owns its internal behavior. ACC owns the execution boundary: callable
definitions, runtime invocations, ports, inbox/outbox materialization, manifests, events, artifacts,
and human-governed workflow edits.

## Current Architecture

The current model is callable-first:

```text
AgentClassTemplate / ToolClassTemplate / WorkflowFunctionTemplate
  -> NodeInvocationSpec
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance or child FunctionInvocation
  -> events, manifests, inboxes, outboxes, artifacts
```

Legacy `Capsule Template`, `Session`, `CapsuleSpec`, `NodeSpec`, `.graph.json`, and `.accflow.json`
names remain supported through compatibility layers. They should not be removed without migration
notes and regression tests.

Read the current contract before making architecture changes:

```text
AGENTS.md
docs/README.md
docs/CURRENT_ARCHITECTURE.md
docs/concepts/FIRST_PRINCIPLES_ANALYSIS.md
docs/concepts/CAPSULE_TEMPLATE_SESSION.md
docs/concepts/GRAPHOPS_CONTROL_PLANE.md
```

## Install

This repository uses `uv`.

```bash
uv sync
uv run acc list
```

The Workbench UI lives in `web/`:

```bash
cd web
npm install
```

## Core CLI Commands

List and inspect reusable capsule resources:

```bash
uv run acc list
uv run acc show echo-test.generic
uv run acc validate echo-test.generic
```

Run one legacy capsule session:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_echo \
  --emit-conductor-json
```

When `--emit-conductor-json` is used, stdout must be exactly one JSON object. Runtime logs go to
stderr or files.

Inspect run evidence:

```bash
uv run acc session inspect runs/acceptance_echo
uv run acc inspect runs/acceptance_echo
```

Run a deterministic workflow:

```bash
uv run acc workflow validate examples/workflows/callable_main_function_demo.accflow.json --json
uv run acc workflow run examples/workflows/callable_main_function_demo.accflow.json \
  --run-dir runs/acceptance_callable_main \
  --emit-json
```

When `--emit-json` is used, stdout must also be exactly one JSON object.

Run a batch of isolated sessions:

```bash
uv run acc batch-run \
  --spec capsules/fake-agent.generic/examples/batch.json \
  --run-dir runs/acceptance_batch \
  --max-concurrency 2 \
  --emit-conductor-json
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
GET  /api/capsules
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

`POST /api/workflows/run-graph` is the synchronous compatibility path. The Workbench should use
`POST /api/workflows/run-graph/submit`, then poll run summaries/events by `run_id`.

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

GraphOps is the controlled interface for workflow/capsule edits. LLMs may propose patches, but
persistent mutation requires validation, dry-run evidence, and explicit human approval.

```bash
uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json
uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run
```

Real apply is rejected unless both `--apply` and `--human-approved` are present.

## Example Capsules

The repository keeps several historical and current examples because tests and migration docs still
reference them.

Legacy two-capsule semiconductor handoff:

```powershell
uv run acc run semiconductor-news-research.codex `
  --input capsules/semiconductor-news-research.codex/examples/input.json `
  --run-dir runs/semiconductor_news `
  --emit-conductor-json

uv run acc run semiconductor-investment-analysis.codex `
  --input capsules/semiconductor-investment-analysis.codex/examples/input.json `
  --run-dir runs/semiconductor_analysis `
  --emit-conductor-json
```

Workbench-oriented semiconductor classes:

```text
semiconductor-stock-news-collector.codex
semiconductor-stock-news-cleaner.codex
semiconductor-stock-analysis-advisor.codex
```

Real market-news research requires a working external agent login and network-capable environment.
Default tests use fake/hermetic behavior and do not require real credentials.

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

Legacy `acc run` writes evidence such as:

```text
input.json
resolved_prompt.md
capsule.yaml.snapshot
session_manifest.json
run_manifest.json
stdout.log
stderr.log
events.jsonl
output.json
conductor_output.json
artifacts/
```

Clean workflow runs add callable evidence such as:

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

`session_manifest.json` remains the canonical legacy session artifact for `acc run`.
`SessionInstance` manifests are the clean workflow evidence for agent/tool node executions.
