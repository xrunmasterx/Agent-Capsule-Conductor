# Acceptance Criteria

This goal is complete only when all required criteria pass.

## 1. Existing regression must pass

```bash
uv run pytest -q
uv run ruff check .
```

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_environment_regression_echo \
  --emit-conductor-json > /tmp/acc_env_echo_stdout.json 2> /tmp/acc_env_echo_stderr.log

python -m json.tool /tmp/acc_env_echo_stdout.json > /dev/null
```

Acceptance:

- stdout is one JSON object.
- no log text appears in stdout.
- output_path exists.
- artifact_dir exists.
- event_log exists.

## 2. Stateless workflow run

```bash
uv run acc workflow validate examples/workflows/stateless_template_demo.graph.json
uv run acc workflow run examples/workflows/stateless_template_demo.graph.json \
  --run-dir runs/acceptance_environment_stateless \
  --emit-json
```

Acceptance:

- workflow template contains no local absolute workspace path.
- runtime creates ephemeral workspace under run directory.
- environment manifest exists.
- input inbox exists.
- output outbox exists.

## 3. Bound workspace run

```bash
uv run acc workflow bind examples/workflows/environment_stateful_demo.graph.json \
  --workspace . \
  --out runs/acceptance_environment_binding/binding.local.json

uv run acc workflow run examples/workflows/environment_stateful_demo.graph.json \
  --binding runs/acceptance_environment_binding/binding.local.json \
  --run-dir runs/acceptance_environment_bound \
  --emit-json
```

Acceptance:

- agent node cwd equals bound workspace or declared relative subdir.
- saved workflow template is not modified with local path.
- binding file contains local path.
- effective behavior pack snapshot is written.

## 4. Inbox / outbox materialization

```bash
uv run acc ports inspect runs/acceptance_environment_bound --json
```

Acceptance:

- upstream node has outbox manifest.
- downstream node has inbox manifest.
- inbox manifest references source node/session/artifact.
- sender did not write receiver workspace directly.

## 5. Nested workflow rule

```bash
uv run acc workflow validate examples/workflows/nested_environment_demo.graph.json
```

Acceptance:

- stateless child workflow is accepted.
- stateful-inside-stateful example is rejected by validation or marked invalid in a negative test.

## 6. UI acceptance if UI exists

If web UI exists:

```bash
cd web && npm run build
```

Manual/browser acceptance:

- workflow shows environment boundary;
- UI displays bound/unbound state;
- agent node shows cwd;
- input/output ports are visible;
- inbox/outbox artifacts can be inspected;
- binding workspace does not write local path into portable graph file.

## 7. Documentation

Required docs updated or created:

```text
docs/codex_goal_environment_kernel/
docs/human/ACC_ENVIRONMENT_WORKFLOW_PLAIN_LANGUAGE.md
```

## 8. No scope regression

Do not introduce:

- custom LLM tool loop;
- mandatory real Codex/Claude dependency in default tests;
- mutable ACC install directory default workspace;
- direct upstream writes into downstream inbox;
- hidden session context sharing.
