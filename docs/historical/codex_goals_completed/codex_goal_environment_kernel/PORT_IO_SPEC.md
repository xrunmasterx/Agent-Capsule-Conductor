# Port / Inbox / Outbox / ArtifactBundle Spec

## 1. Why this exists

Workflow inputs and outputs are not just JSON values. They can be reports, patches, code refs, logs, screenshots, benchmark data, or complete artifact folders.

Therefore ACC needs file-backed ports.

## 2. PortSpec

```json
{
  "id": "external_findings",
  "direction": "input",
  "required": true,
  "cardinality": "many",
  "accepted_artifact_types": ["json", "markdown", "directory"]
}
```

## 3. Inbox

Downstream node reads input from:

```text
<run_dir>/environments/<env_id>/.acc/inbox/<node_id>/<port_id>/<source_ref>/
```

Every inbox folder must have:

```text
inbox_manifest.json
```

## 4. Outbox

Node writes output to:

```text
<run_dir>/environments/<env_id>/.acc/outbox/<node_id>/<port_id>/
```

Every outbox folder must have:

```text
outbox_manifest.json
```

## 5. ArtifactBundle

```json
{
  "bundle_id": "bundle_node_a_main",
  "producer_node_id": "node_a",
  "producer_session_id": "session_xxx",
  "artifacts": [
    {
      "name": "report",
      "type": "markdown",
      "path": "artifacts/report.md",
      "sha256": "...",
      "size_bytes": 1234
    }
  ]
}
```

## 6. Materialization

The scheduler materializes:

```text
source outbox -> target inbox
```

by copy, hardlink, symlink, or reference manifest.

Default should be copy/reference-safe. The choice must be recorded.

## 7. Multiple upstreams to one input

Allowed.

Example:

```text
paper_agent_1.out -> merge.input.research_sources/source_1
paper_agent_2.out -> merge.input.research_sources/source_2
blog_agent.out    -> merge.input.research_sources/source_3
```

## 8. Security

Reject paths escaping run directory unless explicitly allowed as a read-only artifact reference.
