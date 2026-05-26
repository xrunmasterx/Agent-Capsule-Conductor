# Clean Core Refactor Quality Report

Updated: 2026-05-26

## Status

Clean Core acceptance commands now have a working `.accflow.json` path for:

- WorkflowTemplate validation.
- EnvironmentBinding creation.
- Stateless workflow run with run-scoped ephemeral workspace.
- Stateful bound workflow run.
- Inbox/outbox data transfer.
- Nested workflow node execution.
- Optional old `acc run echo-test.generic --emit-conductor-json` regression.

This report is intentionally precise: the old runtime has not been deleted wholesale. A clean-core path was introduced alongside the existing compatibility path so existing tests and behavior remain stable while the new acceptance contract becomes executable.

## Architecture Implemented

New modules:

- `acc.domain`
  - Pure dataclass domain concepts:
    - `WorkflowTemplate`
    - `EnvironmentBinding`
    - `EnvironmentFrame`
    - `NodeSpec`
    - `PortContract`
    - `ControlEdge`
    - `DataEdge`
    - `ArtifactBundle`

- `acc.clean_workflow`
  - Clean `.accflow.json` loader and validator.
  - Stateless template path validation.
  - Environment binding file creation and loading.
  - Runtime EnvironmentFrame creation.
  - Run-scoped ephemeral workspace default.
  - Stateful binding support.
  - Control-edge topological levels.
  - Data-edge port validation.
  - Inbox/outbox materialization.
  - ArtifactBundle vNext-like output.
- Deterministic level scheduler with bounded concurrency.
- Per-environment write lock for nodes marked as workspace writers.
- Retry and timeout handling for clean nodes.
- Data edges must point to an upstream control dependency, so data transfer cannot race a same-level or downstream producer.
- Retry attempts clear stale `output.json`, `artifacts/`, and `outbox/` before re-execution.
- Every clean node writes `nodes/<node_id>/events.jsonl`.
- Workflow policy validation rejects unsupported `failure_mode` values and invalid `max_concurrency`.
- `continue_on_error` keeps the workflow status successful while preserving per-node errors in the run summary.
- Tool, fake-agent, and nested workflow node runners for hermetic tests.

CLI changes:

- `acc workflow validate <path> --json`
  - Routes `.accflow.json` to the clean WorkflowTemplate validator.
  - Keeps legacy `.graph.json` validation path unchanged.

- `acc workflow bind <path> --workspace <dir> --out <file> --json`
  - Routes `.accflow.json` to Clean Core EnvironmentBinding creation.
  - Records a warning when binding to the project root, because this is explicit stateful binding rather than a stateless default.

- `acc workflow run <path> --run-dir <dir> --emit-json [--binding <file>]`
  - Routes `.accflow.json` to the clean workflow runner.
  - Keeps legacy `.graph.json` runner path unchanged.

## Public Behavior Preserved

Kept:

- Existing `acc run <capsule_id> --emit-conductor-json` behavior.
- Existing capsule registry, adapter, prompt, artifact, and validation tests.
- Existing legacy `.graph.json` workflow runner.
- Existing workbench/server code paths.
- Hermetic default tests.

Regression evidence:

```bash
uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_clean_old_echo --emit-conductor-json
```

The command produced valid JSON when redirected through `cmd /c` to avoid Windows PowerShell UTF-16 redirection.

## Modules Kept

- `acc.adapters.*`
  - Kept as mature-agent adapter layer.
  - They are not pulled into the clean domain model.

- `acc.runner`
  - Kept for old capsule/session command compatibility.
  - Not used as the primary clean `.accflow.json` engine.

- `acc.workflow_graph` and `acc.workflow_runner`
  - Kept for `.graph.json` compatibility and existing tests.
  - Clean `.accflow.json` execution routes through `acc.clean_workflow`.

- `acc.environment` and `acc.port_io`
  - Kept because existing `.graph.json` environment tests depend on them.
  - New clean path implements its own typed EnvironmentFrame and port materialization.

- `acc.server`, `web/`
  - Kept out of the clean-core runtime path.

## Modules Moved or Split Conceptually

No physical package move was done in this increment. Instead:

- `acc.domain` now holds the new pure model.
- `acc.clean_workflow` now separates the new WorkflowTemplate execution path from the older capsule graph runner.

This keeps the change low-risk while establishing the dependency direction needed for later cleanup.

## Modules Rewritten

None were fully rewritten in place.

New replacement path:

- `.accflow.json` workflow execution is now implemented by `acc.clean_workflow` rather than forcing the old `capsule_id` graph runner to understand every new concept.

## Modules Deleted

None.

Reason:

- The working tree contains many pre-existing uncommitted changes.
- Existing baseline tests were already passing and older public behavior remains required unless explicitly deprecated.
- Deleting old modules before the new clean path fully replaces all UI/API/debugger integrations would be higher risk than this increment warrants.

Technical debt reduced:

- Clean Core acceptance no longer depends on the old `.graph.json` examples.
- `.accflow.json` no longer fails because of missing `capsule_id`.
- CLI JSON flags required by acceptance now exist.
- Stateless workflows no longer need the ACC install directory as an implicit workspace.

## Remaining Risks

1. Legacy and clean workflow engines coexist.
   - Risk: behavior can diverge between `.graph.json` and `.accflow.json`.
   - Mitigation: keep `.accflow.json` as the active Clean Core path and document old `.graph.json` as compatibility.

2. Agent node support in clean path is currently hermetic fake-agent only.
   - Risk: real Codex/Claude/Cursor/Hermes node runners still need reconnection behind `AgentNodeRunner`.
   - Mitigation: existing adapter code remains available and tested; next increment should wrap adapters behind clean runtime node runners.

3. Workspace write locking relies on node metadata.
   - Risk: a node that writes workspace but does not declare `write_workspace` will not acquire the write lock.
   - Mitigation: add permission/effect classification to NodeSpec before enabling real external agent execution in the clean path.

4. EnvironmentBinding allows explicit binding to the ACC project root.
   - Risk: stateful runs can mutate the project if a future real runner writes.
   - Mitigation: binding emits a warning; stateless default remains ephemeral and under run dir.

5. Windows PowerShell redirection writes UTF-16LE.
   - Risk: acceptance commands using `> /tmp/file && python -m json.tool file` fail under Windows PowerShell even when CLI stdout is valid JSON.
   - Mitigation: acceptance evidence used `cmd /c` for redirected commands; direct stdout is valid JSON.

## Test Evidence

Commands run after implementation:

```bash
uv run pytest -q
uv run ruff check .
```

Result:

- `uv run pytest -q`: passed, 200 tests.
- `uv run ruff check .`: passed.

Focused test files added:

- `tests/integration/test_clean_core_accflow.py`
  - `.accflow.json` validate supports `--json`.
  - Stateless run uses ephemeral workspace under run dir.
  - Stateful binding supports `--json` and uses explicit workspace.
  - Nested workflow runs and materializes parent inbox.

- `tests/unit/test_clean_workflow_engine.py`
  - Rejects absolute workspace paths in WorkflowTemplate.
  - Rejects missing data ports.
  - Rejects data edges that do not have a matching upstream control dependency.
  - Rejects invalid workflow policy.
  - Computes topological levels for a 1000-node DAG.
  - Respects bounded concurrency.
  - Serializes workspace writers with a write lock.
  - Retries failed node execution.
  - Clears stale failed-attempt outputs before retry.
  - Times out slow node execution.
  - Writes node-level event logs.
  - Verifies `continue_on_error` semantics.

Acceptance commands run:

```bash
uv run acc workflow validate examples/workflows/stateless_template_demo.accflow.json --json
uv run acc workflow validate examples/workflows/environment_stateful_demo.accflow.json --json
uv run acc workflow validate examples/workflows/nested_environment_demo.accflow.json --json
cmd /c "if not exist \tmp mkdir \tmp && uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json --run-dir runs/acceptance_clean_stateless --emit-json > \tmp\acc_clean_stateless_stdout.json && python -m json.tool \tmp\acc_clean_stateless_stdout.json > nul"
uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json --workspace . --out runs/acceptance_clean_binding/binding.local.json --json
cmd /c "if not exist \tmp mkdir \tmp && uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json --binding runs/acceptance_clean_binding/binding.local.json --run-dir runs/acceptance_clean_bound --emit-json > \tmp\acc_clean_bound_stdout.json && python -m json.tool \tmp\acc_clean_bound_stdout.json > nul"
uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json --run-dir runs/acceptance_clean_ports --emit-json
uv run acc workflow run examples/workflows/nested_environment_demo.accflow.json --run-dir runs/acceptance_clean_nested --emit-json
cmd /c "if not exist \tmp mkdir \tmp && uv run acc run echo-test.generic --input capsules/echo-test.generic/examples/input.json --run-dir runs/acceptance_clean_old_echo --emit-conductor-json > \tmp\acc_clean_old_echo_stdout.json && python -m json.tool \tmp\acc_clean_old_echo_stdout.json > nul"
```

All listed commands passed.

## Final Architecture Boundary for This Increment

The active Clean Core runtime path is:

```text
acc.cli
  -> acc.clean_workflow
    -> acc.domain
    -> filesystem run store under runs/<run_id>/
```

The compatibility runtime path remains:

```text
acc.cli
  -> acc.workflow_runner / acc.workflow_graph
    -> acc.runner
    -> acc.adapters
```

The next cleanup should move `acc.clean_workflow` internals into the intended long-term package layout:

```text
acc.domain
acc.engine
acc.runtime
acc.store
```
