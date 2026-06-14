# Global Acceptance Contract

## Product-level invariants

The whole plan package is complete only when these invariants hold:

1. Templates do not store runtime state.
2. Run evidence is local, inspectable, and exportable.
3. `run_id` is not a filesystem path and is not reused for destructive reruns.
4. Durable writes go through one storage boundary.
5. Browser state is not durable truth.
6. Artifact reads use registered refs.
7. Full logs, provider events, credentials, and local paths are not uploaded by default.
8. Local runner owns workspace resolution and permission decisions.
9. Cloud, if present, stores projections and job intent, not full local execution facts.
10. Every cleanup is explainable through tombstone or GC manifest.
11. Run creation is claim-before-write: failed validation leaves no partial run evidence or runtime
    specs.
12. Runtime startup never deletes or overwrites an existing run directory as a setup step.
13. SQLite is the query/lease/index layer; evidence files and markers remain rebuildable local truth.
14. Product APIs return refs/projections by default, not absolute local paths.
15. Security mode is explicit, and product modes fail closed on missing auth or invalid origin.
16. Cloud job delivery is idempotent and fenced by receipt, intent digest, lease epoch, and token.

## Local EXE acceptance

- ACC can run fully offline after installation and initial dependency setup.
- User can select or create a workspace.
- Workbench tasks survive browser refresh and localStorage clearing.
- A workflow run creates an immutable `runs/<run_id>` evidence directory.
- Run projection, node output, logs, and artifact previews load through refs.
- Storage doctor reports a healthy fresh workspace.
- GC dry-run reports candidates without deleting files.
- Pinned runs are never selected for GC.
- Canvas snapshots persist only authoring state and strip runtime/log/provider identifiers.
- Task delete tombstones durable task state and does not physically delete run evidence.
- Active, queued, waiting, resuming, and cancel-requested runs are protected from GC.
- Run-bound sessions follow run retention; long-lived assistant/authoring sessions follow task or
  session retention.

## Local Runner acceptance

- Runner exposes health and capabilities.
- Runner resolves `workspace_alias` locally.
- Runner rejects jobs requiring unavailable providers.
- Runner rejects dangerous permissions unless local policy permits them.
- Runner can submit, cancel, stream, and inspect runs through refs/projections.
- Runner does not expose full local paths in normal product API responses.
- Rejected jobs caused by missing provider, workspace-unbound, queue-full, capability mismatch, or
  permission denial do not create run evidence.
- `job_id` and `run_id` are distinct; queued jobs can be cancelled before a run exists.
- Mutating APIs, artifact reads, event streams, folder picker, and GraphOps apply require auth in
  product mode.

## Cloud-control acceptance, future

- Cloud can pair with a runner.
- Cloud can create a job intent.
- Runner leases the job idempotently.
- Runner validates locally before execution.
- Runner writes local evidence.
- Cloud receives run projection deltas.
- Artifact content is not uploaded under `local_only`.
- Runner disconnect/reconnect does not duplicate a run.
- Cloud cancellation becomes a local cancel marker, not a remote process kill.
- Same idempotency key plus same intent digest returns the same receipt; same key plus different
  digest returns conflict.
- Stale lease epoch cannot heartbeat, upload projection deltas, or acknowledge cancellation.
- Cloud lease timeout does not mark the local run failed without runner reconciliation.
- Local GC tombstones project to cloud as unavailable/deleted state, not silent missing data.

## Verification commands

Backend:

```bash
uv run pytest -q
uv run ruff check .
```

Frontend:

```bash
cd web
npm run test -- --run
npm run build
```

Storage-specific future commands:

```bash
uv run acc storage doctor
uv run acc storage rebuild-index
uv run acc storage gc --dry-run
```

Cloud/runner tests should use fake cloud and fake runner services by default. No default test may
require real Codex, Claude, Cursor, Gemini, Hermes, paid services, or network access.
