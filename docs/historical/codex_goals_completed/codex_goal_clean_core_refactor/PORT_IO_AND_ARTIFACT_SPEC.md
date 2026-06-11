# Port, Inbox, Outbox, and Artifact Spec

## PortContract

Nodes declare input and output ports.

```json
{
  "inputs": {
    "research_bundle": {"type": "artifact", "required": true}
  },
  "outputs": {
    "source_report": {"type": "artifact", "required": true}
  }
}
```

## Inbox

Before node execution, scheduler materializes all data edges into:

```text
nodes/<node_id>/inbox/<port_name>/
```

## Outbox

A node writes outputs to:

```text
nodes/<node_id>/outbox/<port_name>/
```

## ArtifactBundle

Every node produces:

```text
artifact_bundle.json
```

Required fields:

- bundle_id
- node_id
- run_id
- outputs
- files
- created_at
- provenance

## Materialization modes

Supported:

```text
copy
symlink
reference
```

Default:

```text
copy
```

## Security

- Data edge materialization must prevent path traversal.
- Upstream cannot choose arbitrary downstream paths.
- Downstream nodes only read from their inbox and effective workspace according to permissions.
