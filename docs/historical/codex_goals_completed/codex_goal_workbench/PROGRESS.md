# Workbench Progress Log

Codex should update this file after each Phase 2 milestone.

## Template

```text
Phase:
Milestone:
Status:
Files changed:
Tests run:
Result:
Next step:
Blocked by:
```

```text
Phase: 2A Usability Core
Milestone: A1-A6 run summaries, indexing, inspect JSON, ArtifactManifest v2, capsule authoring, acceptance
Status: Complete
Files changed: acc/run_index.py, acc/artifact_manifest.py, acc/capsule_authoring.py, acc/runner.py, acc/validation.py, acc/cli.py, tests/unit/test_run_index.py, tests/unit/test_node_run_summary.py, tests/unit/test_artifact_manifest_v2.py, tests/integration/test_cli_runs.py, tests/integration/test_cli_capsule_authoring.py, docs/codex_goal_workbench/PROGRESS.md
Tests run: uv run pytest -q; uv run ruff check .; uv run acc list; uv run acc show echo-test.generic; uv run acc validate echo-test.generic; uv run acc validate fake-agent.generic; uv run acc validate workflow-editor.codex; uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo --emit-conductor-json; uv run acc session inspect runs/acceptance_echo; uv run acc run fake-agent.generic --input capsules/fake-agent.generic/examples/input.json --run-dir runs/acceptance_fake --emit-conductor-json; uv run acc batch-run --spec capsules/fake-agent.generic/examples/batch.json --run-dir runs/acceptance_batch --max-concurrency 2 --emit-conductor-json; uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json; uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run; uv run acc run fake-agent.generic --input capsules/fake-agent.generic/examples/input.json --run-dir runs/workbench_acceptance_fake --emit-conductor-json; uv run acc runs list; uv run acc runs list --json; uv run acc runs show workbench_acceptance_fake; uv run acc runs show workbench_acceptance_fake --json; uv run acc inspect runs/workbench_acceptance_fake --json; uv run acc capsule doctor echo-test.generic; uv run acc capsule test echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/workbench_acceptance_capsule_test --emit-conductor-json; uv run python -m json.tool runs/index.json
Result: MVP regression and Phase 2A acceptance passed; pytest 88 passed; ruff passed
Next step: Phase 2B Local Workbench Server, only after user asks to continue
Blocked by: None
```

```text
Phase: 2B Local Workbench Server
Milestone: B1-B3 server package, health/version, capsules/runs/artifacts/workflows APIs, acceptance
Status: Complete
Files changed: pyproject.toml, uv.lock, acc/cli.py, acc/server/__init__.py, acc/server/app.py, acc/server/context.py, acc/server/routes/__init__.py, acc/server/routes/health.py, acc/server/routes/capsules.py, acc/server/routes/runs.py, acc/server/routes/artifacts.py, acc/server/routes/workflows.py, tests/server/conftest.py, tests/server/test_health.py, tests/server/test_capsules_api.py, tests/server/test_runs_api.py, tests/server/test_artifacts_api.py, tests/server/test_workflows_api.py, tests/server/test_core_decoupling.py, docs/codex_goal_workbench/PROGRESS.md
Tests run: uv run pytest -q tests/server; uv run ruff check .; uv run pytest -q; uv run acc server --host 127.0.0.1 --port 8765 with HTTP health/version checks; TestClient smoke checks for required endpoints; MVP and Phase 2A CLI acceptance commands
Result: Phase 2B acceptance passed; server tests 21 passed; full pytest 109 passed; ruff passed
Next step: Phase 2C Visual Workbench Read-only MVP, only after user asks to continue
Blocked by: None
```

```text
Phase: 2C Visual Workbench Read-only MVP
Milestone: C1-C3 web skeleton, Run Inspector, Artifact Viewer, Capsule Browser, Workflow Viewer, read-only acceptance
Status: Complete
Files changed: web/package.json, web/package-lock.json, web/.gitignore, web/README.md, web/index.html, web/tsconfig.json, web/tsconfig.node.json, web/vite.config.ts, web/src/main.tsx, web/src/App.tsx, web/src/App.test.tsx, web/src/api.ts, web/src/types.ts, web/src/format.ts, web/src/styles.css, web/src/components/RunList.tsx, web/src/components/RunInspector.tsx, web/src/components/ArtifactViewer.tsx, web/src/components/CapsuleBrowser.tsx, web/src/components/WorkflowViewer.tsx, web/src/components/CodeBlock.tsx, web/src/test/setup.ts, docs/codex_goal_workbench/PROGRESS.md
Tests run: cd web && npm install; npm test; npm run build; uv run acc run fake-agent.generic --input capsules/fake-agent.generic/examples/input.json --run-dir runs/ui_acceptance_fake --emit-conductor-json; uv run acc server --host 127.0.0.1 --port 8765 plus cd web && npm run dev with curl checks for /, /api/runs/ui_acceptance_fake, and /api/artifacts/read; uv run pytest -q tests/server; uv run pytest -q; uv run ruff check .
Result: Phase 2C acceptance passed; UI tests 6 passed; UI build passed; server/full Python tests and ruff passed
Next step: Future work only after user asks; possible next scope is non-mutating UI refinement or Phase 3 planning
Blocked by: None
```
