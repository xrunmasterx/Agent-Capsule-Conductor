# V1 to V2 Changes

## Keep from V1

- Conductor as deterministic workflow topology.
- `acc` as capsule execution boundary.
- External mature agents own internal tool loops.
- Artifact store.
- Schema validation.
- Hermetic default tests.
- stdout JSON contract.

## Add in V2

1. Rename and clarify:

```text
Capsule -> Capsule Template / Agent Class
Run     -> Session / Agent Instance
```

2. Add required `session_manifest.json`.

3. Add session isolation tests.

4. Add GraphOps Control Plane:

```text
validate-patch
dry-run apply
human-approved apply
```

5. Add workflow-editor capsule that proposes graph patches.

6. Add Brain-Hand decoupling guidance.

## Do not add in V2 MVP

- visual canvas,
- full MCP server,
- database artifact store,
- dynamic autonomous graph scheduler,
- persistent global agent memory.

These can be future phases.
