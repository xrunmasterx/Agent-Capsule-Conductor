# Progress Log

Codex should update this file after each implementation milestone.

## Template

```text
Milestone:
Status:
Files changed:
Tests run:
Result:
Next step:
Blocked by:
```

```text
Milestone: Session manifest and session inspect
Status: Complete
Files changed: acc/session.py, acc/artifact_store.py, acc/runner.py, acc/cli.py, tests/unit/test_session.py, tests/integration/test_cli_session_inspect.py
Tests run: uv run pytest -q tests/unit/test_session.py tests/unit/test_artifact_store.py tests/integration/test_cli_run_stdout_contract.py tests/integration/test_cli_session_inspect.py
Result: 9 passed
Next step: Add schemas, workflow-editor capsule, V2 workflows, and GraphOps dry-run control plane
Blocked by: None
```

```text
Milestone: Schemas and V2 example assets
Status: Complete
Files changed: schemas/*.json, capsules/workflow-editor.codex/*, examples/graphops/add-review-node.patch.json, workflows/*.v2.yaml, tests/unit/test_schemas.py, tests/integration/test_example_capsules.py
Tests run: uv run pytest -q tests/unit/test_schemas.py tests/integration/test_cli_list_show_validate.py tests/integration/test_example_capsules.py; uv run python -m json.tool schemas/session_manifest_schema.json; uv run python -m json.tool schemas/graphops_patch_schema.json; uv run python -m json.tool schemas/capsule_template_schema.json
Result: 13 passed; JSON schemas parse
Next step: Implement GraphOps validate-patch and dry-run apply
Blocked by: None
```

```text
Milestone: GraphOps validate and dry-run
Status: Complete
Files changed: acc/graphops.py, acc/cli.py, tests/unit/test_graphops_patch_validation.py, tests/integration/test_graphops_dry_run.py
Tests run: uv run pytest -q tests/unit/test_graphops_patch_validation.py tests/integration/test_graphops_dry_run.py
Result: 9 passed
Next step: Run full test suite, ruff, and acceptance commands
Blocked by: None
```

```text
Milestone: Acceptance verification
Status: Complete
Files changed: docs/codex_goal/PROGRESS.md
Tests run: uv run acc list; uv run acc show echo-test.generic; uv run acc validate echo-test.generic; uv run acc validate fake-agent.generic; uv run acc validate workflow-editor.codex; uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo --emit-conductor-json; uv run acc session inspect runs/acceptance_echo; uv run acc run fake-agent.generic --input capsules/fake-agent.generic/examples/input.json --run-dir runs/acceptance_fake --emit-conductor-json; uv run acc batch-run --spec capsules/fake-agent.generic/examples/batch.json --run-dir runs/acceptance_batch --max-concurrency 2 --emit-conductor-json; uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json; uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run; uv run pytest -q; uv run ruff check .
Result: Required acceptance commands passed; pytest 63 passed; ruff passed
Next step: None
Blocked by: None
```

```text
Milestone: Completion audit hardening
Status: Complete
Files changed: README.md, tests/unit/test_session.py, tests/unit/test_codex_cli_adapter.py, docs/codex_goal/PROGRESS.md
Tests run: uv run pytest -q tests/unit/test_session.py tests/unit/test_codex_cli_adapter.py; uv run acc list; uv run acc show echo-test.generic; uv run acc validate echo-test.generic; uv run acc validate fake-agent.generic; uv run acc validate workflow-editor.codex; uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_echo --emit-conductor-json; uv run acc session inspect runs/acceptance_echo; uv run acc run fake-agent.generic --input capsules/fake-agent.generic/examples/input.json --run-dir runs/acceptance_fake --emit-conductor-json; uv run acc batch-run --spec capsules/fake-agent.generic/examples/batch.json --run-dir runs/acceptance_batch --max-concurrency 2 --emit-conductor-json; uv run acc graphops validate-patch examples/graphops/add-review-node.patch.json; uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json --dry-run; uv run acc graphops apply-patch examples/graphops/add-review-node.patch.json; uv run python -m json.tool capsules/echo-test.generic/output_schema.json; uv run python -m json.tool schemas/session_manifest_schema.json; uv run python -m json.tool schemas/graphops_patch_schema.json; uv run pytest -q; uv run ruff check .
Result: README repaired; session artifact isolation and Codex sandbox coverage strengthened; GraphOps unapproved apply rejected with exit code 1; pytest 64 passed; ruff passed
Next step: None
Blocked by: None
```

```text
Milestone: Two-Codex semiconductor handoff example
Status: Complete
Files changed: capsules/semiconductor-news-research.codex/*, capsules/semiconductor-investment-analysis.codex/*, workflows/semiconductor-research-analysis.v2.yaml, README.md, docs/codex_goal/PROGRESS.md
Tests run: uv run acc validate semiconductor-news-research.codex; uv run acc validate semiconductor-investment-analysis.codex; uv run pytest -q; uv run ruff check .
Result: Two codex_cli Capsule Templates and workflow example are present; temporary local shim/demo/test files were removed before continued development
Next step: Run real Codex CLI variant only when live market research is desired and Codex login/network are available
Blocked by: None
```
