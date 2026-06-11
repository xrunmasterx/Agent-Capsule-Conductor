# Conductor Bridge Spec

## 1. Purpose

ACC should not copy Microsoft Conductor's internal DSL. But it should export ACC WorkflowGraph into Conductor-compatible YAML so Conductor can be used as a production orchestration backend.

## 2. Command

```bash
acc conductor export <workflow.graph.json> --out <workflow.conductor.yaml>
```

Optional:

```bash
acc conductor validate <workflow.conductor.yaml>
```

`validate` must be skipped or report unavailable if Conductor is not installed.

## 3. Export mapping

ACC graph node:

```json
{
  "id": "source_check",
  "capsule_id": "source-reality-check.codex"
}
```

becomes a Conductor script step that calls:

```bash
uv run acc run source-reality-check.codex \
  --input <generated-input.json> \
  --run-dir <generated-node-run-dir> \
  --emit-conductor-json
```

## 4. Required properties

Export must preserve:

- node id;
- capsule id;
- edge route order;
- stdout JSON contract;
- generated input file path comments or metadata;
- failure policy notes if exact mapping is not supported.

## 5. Unsupported features

If ACC graph uses a feature that cannot be faithfully exported to Conductor, export should:

- fail with clear error, or
- emit warning if safe approximation is used.

Never silently discard control/data semantics.

## 6. Test requirements

Default tests must not require Conductor to be installed.

Tests must assert:

- exported YAML file exists;
- YAML contains each node id;
- YAML contains `uv run acc run`;
- YAML contains `--emit-conductor-json`;
- invalid graph fails before export;
- feature gaps are reported.
