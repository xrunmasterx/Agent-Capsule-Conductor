# UI and API Boundary Spec

## UI is a projection

UI must not be the source of truth.

Source of truth:

```text
WorkflowTemplate IR
EnvironmentBinding
Run manifests
Event logs
Artifact bundles
```

React Flow or any visual canvas state must be converted to/from WorkflowTemplate.

## Required UI principles if UI exists

- Chinese labels by default.
- Graph-first layout.
- Nodes and edges reflect WorkflowTemplate IR.
- Clicking node shows inbox, outbox, output, artifacts, events.
- Run state is reconstructed from events/manifests, not ad-hoc file crawling.

## API boundary

UI should use API/CLI services, not parse arbitrary internal files directly.

Required machine-readable commands if CLI exists:

```bash
acc workflow validate <file> --json
acc workflow run <file> --binding <binding> --emit-json
acc run show <run_id> --json
acc artifacts show <artifact_ref> --json
```
