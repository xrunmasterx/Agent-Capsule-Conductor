# Agent Capsule Conductor V2

Agent Capsule Conductor (`acc`) is a Python CLI that wraps mature external agents as reusable
**Capsule Templates** and runs each invocation as an isolated **Session**.

Microsoft Conductor owns workflow topology. `acc` owns the capsule execution boundary. External
agents such as Codex CLI, Claude SDK, or generic local commands own their internal reasoning and
tool loop.

## Install

This repository uses `uv`.

```bash
uv sync
```

Run the CLI through the project environment:

```bash
uv run acc list
```

The optional Workbench UI lives in `web/` and uses Node.js/npm:

```bash
cd web
npm install
```

## Core Commands

List and inspect Capsule Templates:

```bash
uv run acc list
uv run acc show echo-test.generic
uv run acc validate echo-test.generic
```

Create a Session from a Capsule Template:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_echo \
  --emit-conductor-json
```

When `--emit-conductor-json` is used, stdout is exactly one JSON object. Runtime logs go to files
or stderr.

Inspect a Session:

```bash
uv run acc session inspect runs/acceptance_echo
uv run acc inspect runs/acceptance_echo
```

Run a batch of isolated Sessions:

```bash
uv run acc batch-run \
  --spec capsules/fake-agent.generic/examples/batch.json \
  --run-dir runs/acceptance_batch \
  --max-concurrency 2 \
  --emit-conductor-json
```

## Two-Capsule Semiconductor Handoff

This repository includes a two-node Codex capsule example:

```text
semiconductor-news-research.codex
  -> runs/semiconductor_news/artifacts/
     news_dossier.md
     sources.json
     company_events.json
     risk_signals.md

semiconductor-investment-analysis.codex
  -> reads the first artifact directory
  -> runs/semiconductor_analysis/artifacts/
     investment_memo.md
     recommendation.md
     assumptions.md
     risks.md
```

Run the first Codex capsule:

```powershell
uv run acc run semiconductor-news-research.codex `
  --input capsules/semiconductor-news-research.codex/examples/input.json `
  --run-dir runs/semiconductor_news `
  --emit-conductor-json
```

Then set `research_artifact_dir` in
`capsules/semiconductor-investment-analysis.codex/examples/input.json` to the first command's
`artifact_dir`, and run the second Codex capsule:

```powershell
uv run acc run semiconductor-investment-analysis.codex `
  --input capsules/semiconductor-investment-analysis.codex/examples/input.json `
  --run-dir runs/semiconductor_analysis `
  --emit-conductor-json
```

Real market-news research requires a working Codex CLI login and network-capable environment.

## GraphOps

GraphOps is the controlled interface for workflow/capsule edits. LLMs may propose patches, but real
mutation requires explicit human approval.

```bash
uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json
uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run
```

Default behavior is proposal/dry-run only. Real apply is rejected unless both `--apply` and
`--human-approved` are present.

## Test

Default tests are hermetic: they do not require Codex login, Claude credentials, network,
Conductor, Gemini, Cursor, or other external agent tools.

```bash
uv run pytest -q
uv run ruff check .
uv run python -m json.tool capsules/echo-test.generic/output_schema.json > /dev/null
uv run python -m json.tool schemas/session_manifest_schema.json > /dev/null
uv run python -m json.tool schemas/graphops_patch_schema.json > /dev/null
```

Run the required acceptance commands from:

```text
docs/codex_goal/ACCEPTANCE.md
```

## Local Workbench Server

Start the local API server:

```bash
uv run acc server --host 127.0.0.1 --port 8765
```

Useful endpoints:

```text
GET /api/health
GET /api/capsules
GET /api/runs
GET /api/workflows
GET /api/artifacts/read?path=...
```

The server is a thin FastAPI layer over the existing `acc` runtime. It does not add a database and
artifact reads are constrained to the project root.

## Visual Workbench

In a second shell, run:

```bash
cd web
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The UI consumes `acc-server` APIs for Run List, Run Inspector, Capsule Library, Capsule Editor,
Artifact Viewer, and Workflow Builder. It does not parse repository files directly.

## Editable Workbench

Scaffold a hermetic demo capsule:

```bash
uv run acc capsule scaffold --blueprint examples/blueprints/simple_research_capsule.json --force
uv run acc validate demo-research.generic
uv run acc run demo-research.generic \
  --input capsules/demo-research.generic/examples/input.json \
  --run-dir runs/acceptance_demo_capsule \
  --emit-conductor-json
```

Validate and run a deterministic workflow graph:

```bash
uv run acc workflow validate examples/workflows/demo_two_node.graph.json
uv run acc workflow run examples/workflows/demo_two_node.graph.json \
  --run-dir runs/acceptance_demo_graph \
  --emit-json
```

In the web UI:

```text
Capsules -> Create Capsule -> edit prompt/schema/artifacts -> Validate/Test
Workflows -> Add Node -> Connect Last Two -> Save Graph -> Validate Graph -> Run Graph
Runs -> inspect node input, prompt, output, artifacts, events, stdout, stderr
```

Run UI checks:

```bash
cd web
npm test
npm run build
```

## Key Artifacts

Each successful `acc run` writes:

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

`session_manifest.json` is the canonical V2 Session artifact. `run_manifest.json` is retained as a
backward-compatible alias.
