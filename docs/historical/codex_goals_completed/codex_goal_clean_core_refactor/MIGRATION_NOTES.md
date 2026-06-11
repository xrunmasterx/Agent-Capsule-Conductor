# Clean Core Refactor Migration Notes

Updated: 2026-05-26

## Summary

Clean Core introduces `.accflow.json` as the active WorkflowTemplate format.

Legacy `.graph.json` files and capsule-backed graph nodes remain supported for compatibility, but they are no longer the preferred authoring model for new clean-core workflows.

## Preferred New Commands

Validate a WorkflowTemplate:

```bash
uv run acc workflow validate examples/workflows/stateless_template_demo.accflow.json --json
```

Create a local EnvironmentBinding:

```bash
uv run acc workflow bind examples/workflows/environment_stateful_demo.accflow.json \
  --workspace . \
  --out runs/acceptance_clean_binding/binding.local.json \
  --json
```

Run a stateless workflow with an ephemeral workspace:

```bash
uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json \
  --run-dir runs/acceptance_clean_stateless \
  --emit-json
```

Run a workflow with an explicit binding:

```bash
uv run acc workflow run examples/workflows/environment_stateful_demo.accflow.json \
  --binding runs/acceptance_clean_binding/binding.local.json \
  --run-dir runs/acceptance_clean_bound \
  --emit-json
```

## Format Migration

Old compatibility shape:

```json
{
  "nodes": [
    {
      "id": "echo",
      "capsule_id": "echo-test.generic"
    }
  ],
  "edges": [
    {
      "from": "echo",
      "to": "next"
    }
  ]
}
```

New Clean Core shape:

```json
{
  "id": "stateless_template_demo",
  "version": "0.1.0",
  "nodes": [
    {
      "id": "producer",
      "kind": "tool",
      "tool": "fake_producer",
      "ports": {
        "outputs": {
          "main": {"type": "artifact"}
        }
      }
    }
  ],
  "control_edges": [],
  "data_edges": [],
  "policies": {
    "max_concurrency": 2,
    "failure_mode": "fail_fast"
  }
}
```

Key changes:

- Use `kind: "agent" | "tool" | "workflow"` as the primary node model.
- Use `control_edges` for execution ordering.
- Use `data_edges` for artifact/port transfer.
- Use `ports.inputs` and `ports.outputs` for node contracts.
- Do not store local workspace paths in the template.
- Store local workspace paths only in EnvironmentBinding files.

## Workspace Migration

Old behavior may use the current working directory through capsule workspace configuration.

Clean Core behavior:

- No binding: creates `runs/<run_id>/environments/root_env/workspace`.
- With binding: uses `workspace_root` from the binding as effective cwd.
- Run metadata always remains under `runs/<run_id>/`.

Binding to the ACC project root is allowed only as an explicit stateful binding and records a warning in the binding payload.

## Old Command Regression

The old command remains supported:

```bash
uv run acc run echo-test.generic \
  --input capsules/echo-test.generic/examples/input.json \
  --run-dir runs/acceptance_clean_old_echo \
  --emit-conductor-json
```

It still emits one JSON object on stdout.

## Windows Redirection Note

Windows PowerShell 5 style redirection can write native stdout as UTF-16LE. If a validation step redirects stdout and then runs `python -m json.tool`, use `cmd /c` or another byte-preserving shell for the redirected acceptance command.

Example:

```cmd
cmd /c "uv run acc workflow run examples/workflows/stateless_template_demo.accflow.json --run-dir runs/acceptance_clean_stateless --emit-json > \tmp\acc_clean_stateless_stdout.json && python -m json.tool \tmp\acc_clean_stateless_stdout.json > nul"
```

## Compatibility Policy

Kept for now:

- `.graph.json`
- `capsule_id` workflow nodes
- `acc run <capsule_id>`
- old capsule/session artifacts

Preferred for new work:

- `.accflow.json`
- `WorkflowTemplate`
- `EnvironmentBinding`
- `EnvironmentFrame`
- `NodeSpec`
- `PortContract`
- `Inbox/Outbox`
- `ArtifactBundle`
