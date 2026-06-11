# Test Plan V2

## 1. Test philosophy

Default tests must be hermetic. They must not call real Codex, Claude, Gemini, Cursor, network, or external paid services.

External integration tests are allowed only when explicitly enabled by environment variables.

## 2. Test commands

Default:

```bash
uv run pytest -q
uv run ruff check .
uv run python -m json.tool capsules/echo-test.generic/output_schema.json > /dev/null
uv run python -m json.tool schemas/session_manifest_schema.json > /dev/null
uv run python -m json.tool schemas/graphops_patch_schema.json > /dev/null
```

Optional:

```bash
ACC_RUN_EXTERNAL_AGENT_TESTS=1 uv run pytest -q tests/external
ACC_RUN_CONDUCTOR_TESTS=1 uv run pytest -q tests/conductor
```

## 3. Unit tests

### `tests/unit/test_schemas.py`

Cases:

1. Valid `CapsuleTemplateSpec` loads.
2. Missing `id` fails.
3. Unknown runtime type fails.
4. Invalid workspace mode fails.
5. Missing timeout uses default or fails according to schema.
6. `allow_dangerous=false` rejects `danger-full-access`.
7. Valid `SessionManifest` loads.
8. Session manifest requires `session_id`, `capsule_id`, `status`, and `run_dir`.
9. Valid GraphOps patch loads.
10. Forbidden GraphOps operation fails validation.

### `tests/unit/test_registry.py`

Cases:

1. Discovers capsules under `capsules/*/capsule.yaml`.
2. `get("echo-test.generic")` returns correct template.
3. Duplicate capsule id fails.
4. Missing capsule id raises clear error.
5. Broken YAML produces readable validation error.

### `tests/unit/test_session.py`

Cases:

1. Creating a session from one template creates unique session id.
2. Two sessions from the same template have different directories.
3. Session A output does not overwrite Session B output.
4. Session manifest is updated from `created` to `running` to final state.
5. `acc session inspect` reads session manifest.

### `tests/unit/test_prompting.py`

Cases:

1. Renders `prompt_template.md` with input JSON.
2. Missing variable produces readable error.
3. Rendered prompt is written to `resolved_prompt.md`.
4. Large input payload does not crash.

### `tests/unit/test_artifact_store.py`

Cases:

1. Creates expected session directory files.
2. Writes `input.json`.
3. Writes `capsule.yaml.snapshot`.
4. Writes `session_manifest.json`.
5. Creates `artifacts/`.
6. Existing run dir behavior is deterministic: either clean failure or explicit overwrite flag.

### `tests/unit/test_validation.py`

Cases:

1. Valid `output.json` passes JSON Schema validation.
2. Missing required output field fails.
3. Wrong field type fails.
4. Required artifact missing fails.
5. Optional artifact missing passes.
6. Artifact manifest path traversal is rejected.

### `tests/unit/test_workspace.py`

Cases:

1. `existing_dir` resolves absolute path.
2. Missing existing dir fails.
3. `git_worktree_readonly` constructs expected git command.
4. `git_worktree_write` constructs expected branch name.
5. Repo path traversal outside allowed root is rejected if allowed root is configured.

## 4. CLI tests

### `tests/integration/test_cli_list_show_validate.py`

Cases:

1. `acc list` exits 0.
2. `acc show echo-test.generic` exits 0.
3. `acc validate echo-test.generic` exits 0.
4. `acc validate broken-capsule` exits non-zero with useful message.

### `tests/integration/test_cli_run_stdout_contract.py`

Cases:

1. `acc run echo-test.generic --emit-conductor-json` prints exactly one JSON object to stdout.
2. No log lines appear in stdout.
3. JSON object contains:
   - status
   - summary
   - session_id
   - output_path
   - artifact_dir
   - event_log
   - session_manifest
4. stderr may contain logs.
5. `conductor_output.json` matches stdout JSON.

### `tests/integration/test_cli_session_inspect.py`

Cases:

1. Run `echo-test.generic`.
2. `acc session inspect <run_dir>` prints session id, capsule id, status, artifact path.
3. `acc inspect <run_dir>` remains backward-compatible.

## 5. Adapter tests

### `tests/unit/test_generic_cli_adapter.py`

Cases:

1. Runs fake agent successfully.
2. Captures stdout.log.
3. Captures stderr.log.
4. Uses generated `output.json`.
5. Non-zero exit returns failed.
6. Timeout returns timeout.
7. Missing `output.json` returns failed.

### `tests/unit/test_codex_cli_adapter.py`

Use mocked `asyncio.create_subprocess_exec`.

Cases:

1. Command includes `codex exec`.
2. Command includes `--cd <workspace>`.
3. Command includes `--sandbox read-only` by default.
4. Command includes `--json`.
5. Command includes `--output-schema <schema>`.
6. Command includes `-o <run_dir>/output.json`.
7. stdout is written to `events.jsonl`.
8. stderr is written to `stderr.log`.
9. Non-zero exit returns failed.
10. Missing `output.json` returns failed.
11. `danger-full-access` is rejected unless capsule explicitly allows dangerous mode.

### `tests/unit/test_claude_sdk_adapter.py`

Cases:

1. If package unavailable, adapter returns unavailable error.
2. Adapter does not crash during validation.
3. Fake SDK message stream can be captured to `events.jsonl`.
4. Real external call is skipped unless `ACC_RUN_EXTERNAL_AGENT_TESTS=1`.

## 6. Batch runner tests

### `tests/integration/test_batch_run.py`

Cases:

1. Runs three fake-agent tasks.
2. Respects max_concurrency.
3. Each task gets isolated session dir.
4. Writes `bundle.json`.
5. One failed task marks batch as partial or failed according to spec.
6. `--emit-conductor-json` stdout is exactly one JSON object.

## 7. GraphOps tests

### `tests/unit/test_graphops_patch_validation.py`

Cases:

1. Valid `add_node` patch passes.
2. Valid `connect_nodes` patch passes.
3. Valid `update_capsule_prompt` patch passes.
4. Patch that enables `danger-full-access` fails by default.
5. Patch that removes a human gate fails unless explicit override is present.
6. Patch with path traversal fails.

### `tests/integration/test_graphops_dry_run.py`

Cases:

1. `acc graphops validate-patch examples/graph_patch.json` exits 0.
2. `acc graphops apply-patch examples/graph_patch.json --dry-run` does not mutate files.
3. Dry-run output lists changed files and operations.
4. Applying without `--apply --human-approved` fails.

## 8. Example capsule tests

Cases:

1. `echo-test.generic` validates.
2. `fake-agent.generic` validates.
3. `source-reality-check.codex` validates without real Codex execution.
4. `critical-review.claude` validates without real Claude execution.
5. `workflow-editor.codex` validates and outputs patch artifact schema.

## 9. Optional real Codex smoke test

Skipped unless:

```bash
ACC_RUN_EXTERNAL_AGENT_TESTS=1
```

Case:

```bash
uv run acc run source-reality-check.codex \
  --input capsules/source-reality-check.codex/examples/input.json \
  --run-dir runs/smoke_codex \
  --emit-conductor-json
```

Expected:

- exits 0 or cleanly reports external unavailable,
- no logs in stdout,
- output path exists if success,
- event log exists.

## 10. Optional Conductor test

Skipped unless:

```bash
ACC_RUN_CONDUCTOR_TESTS=1
```

Case:

```bash
conductor validate workflows/engine-architecture-research.v2.yaml
```

If Conductor is installed:

- workflow validates,
- script step examples point to `uv run acc run`,
- strict stdout JSON contract is documented.
