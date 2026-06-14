# Plan 05: Cloud Control Plane Sync

## Objective

Define the future website product as a cloud control plane that coordinates local runners without
owning local execution facts.

This is a future-facing plan. It should not be implemented before local storage, retention, and the
Local Runner boundary are stable.

## Product model

```text
Browser
  renders templates, tasks, run projections, approvals, artifact previews

Cloud Control Plane
  stores account/project metadata, runner registry, job intent, projections

Local Runner
  executes workflow, owns local workspace/credentials/evidence/artifacts
```

The cloud can request work. The local runner decides whether it is safe and possible to execute.

## Cloud-owned data

```text
users / accounts / teams
projects
template library projection
runner registry
runner heartbeat
job_intents
job_leases
run_projections
run_event_projections
artifact_manifests
artifact_previews/blobs, optional
approval_records
sync_cursors
```

Postgres is appropriate for this cloud control plane. Object storage may be used for uploaded
previews/blobs. This does not replace local evidence.

## Runner-owned data

```text
workspace aliases -> local paths
local provider credentials
permission decisions
full run evidence
full logs
provider events
full artifact content
GraphOps apply evidence
local GC decisions
```

The cloud may store projections or tombstones, not the authoritative local files by default.

## Job intent

Use a job protocol rather than sending the current Workbench submit body across the network.

```json
{
  "schema_version": "acc.cloud.job_intent.v1",
  "job_id": "job_...",
  "idempotency_key": "idem_...",
  "target_runner": {
    "runner_id": "runner_...",
    "required_capabilities": ["codex_cli", "workspace:default"]
  },
  "workflow_template_ref": {
    "kind": "bundle_digest",
    "digest": "sha256:..."
  },
  "input_manifest": {},
  "requested_permission_profile": {
    "network": "ask",
    "shell": "ask",
    "dangerous": false
  },
  "artifact_upload_policy": "preview",
  "created_at": "..."
}
```

Rules:

- delivery is at-least-once;
- runner handles idempotency by `job_id` and `idempotency_key`;
- runner creates a new immutable `run_id`;
- cloud cannot force a specific local path;
- cloud cannot silently upgrade local permissions.

## Hard protocol contracts

### Local job receipt ledger

The runner atomically persists `job_receipts/<job_id>.json` before creating run evidence:

```json
{
  "job_id": "job_...",
  "idempotency_key": "...",
  "intent_digest": "sha256:...",
  "run_id": null,
  "lease_id": null,
  "lease_epoch": 0,
  "status": "received",
  "created_at": "2026-06-13T00:00:00Z",
  "last_synced_at": null
}
```

Duplicate delivery with the same `idempotency_key` and same `intent_digest` returns the same
receipt and must not create a duplicate run. Same key with different digest returns
`409 idempotency_conflict`.

### Lease fencing

Every job lease has `lease_id`, `lease_epoch`, and a fencing token. Heartbeat, projection delta,
artifact upload, and cancel acknowledgement must carry the current fencing token. Cloud rejects
stale epochs; runner rejects commands for superseded leases.

Cloud lease timeout alone is not proof that the local run failed. It may mark the projection as
`lease_expired_unconfirmed`, but final run status must come from runner reconciliation.

### Validate before run creation

Before claiming a `run_id`, the runner validates:

- workflow bundle digest and local cache availability;
- runner capability and minimum runner version;
- requested permission profile and local downgrade/approval rules;
- workspace alias binding;
- artifact upload policy;
- GraphOps restrictions.

Validation failures write only receipt/projection state, not run evidence. Failure classes include
`rejected_policy`, `missing_bundle`, `capability_mismatch`, and `workspace_unbound`.

### Projection cursor and idempotency

Projection sync needs a multi-source cursor, not one global file offset:

```json
{
  "sources": [
    {
      "source_kind": "events",
      "stable_source_id": "run:run_123:events",
      "relative_path": "events.jsonl",
      "byte_offset": 12345,
      "line_seq": 42,
      "last_event_id": "evt_...",
      "last_digest": "sha256:...",
      "truncated_or_rotated": false
    }
  ]
}
```

Sources include top-level events, node events, nested workflow events, agent turn events, and
stdout/stderr projections.

Cloud upserts projected events by `(runner_id, run_id, source_id, event_id)`. If an event has no
stable `event_id`, use `(source_id, line_seq, line_sha256)`. Timestamp is never the idempotency key.

### Artifact manifest

Cloud receives artifact manifests and previews, not arbitrary local files:

- relative path;
- `sha256`;
- size;
- mime/viewer type;
- sensitivity classification;
- availability;
- upload policy;
- preview ref.

Absolute paths, raw provider ids, and secret-like names are stripped. Local-only artifacts appear as
available on the runner, not as failed uploads.

### GraphOps, cancellation, and reconciliation

Cloud stores GraphOps projection and intent only. Local runner apply still performs validate,
dry-run, human approval verification, digest/base-hash checks, and local audit recording.

Cancel intent state is explicit:

1. `requested`;
2. `observed_by_runner`;
3. `local_marker_written`;
4. `terminal_synced`.

Cancelling an already-terminal job returns the current terminal state idempotently.

On reconnect, sync in this order:

1. Job receipts and run summaries.
2. Events by cursor.
3. Artifact manifests and previews.

Runner-side GC tombstones project as `local_gc_deleted` or `unavailable_on_runner`, not silent
missing data.

## Runner lease and heartbeat

Runner should maintain:

```text
heartbeat interval
capability version
active job leases
last synced event cursor per run
last synced artifact manifest digest per run
```

Network failure is normal. Use timeouts, exponential backoff, and idempotent retries.

Cloud statuses should distinguish:

```text
queued
leased
runner_validating
running
sync_pending
runner_offline
waiting_interaction
resuming
validating_failed
lease_expired_unconfirmed
projection_stale
sync_gap_detected
success
failed
cancel_requested
cancelled
crashed
unknown
```

Do not convert `runner_offline` into `failed` without evidence from the runner or lease expiry policy.

## Projection sync

Local runner produces deltas:

```json
{
  "schema_version": "acc.cloud.run_projection_delta.v1",
  "runner_id": "runner_...",
  "run_id": "run_...",
  "job_id": "job_...",
  "summary": {},
  "events": [],
  "event_cursor": {
    "events_jsonl_offset": 1234,
    "last_event_seq": 42
  },
  "artifact_manifests": [],
  "tombstones": [],
  "created_at": "..."
}
```

Sync only projections by default:

| Local source | Cloud default |
| --- | --- |
| `run_summary.json` | status snapshot |
| `events.jsonl` | normalized events after cursor |
| `artifact_bundle.json` | manifest only |
| `result_store/*.json` | small structured values if policy allows |
| `stdout.log` / `stderr.log` | excerpt only |
| provider events | local-only, unless normalized and redacted |
| artifact content | policy-driven optional upload |

Provider events, full stdout/stderr, and full artifacts are local-only unless the artifact upload
policy explicitly allows a redacted preview or selected upload.

## Artifact upload policy

Supported upload policies:

```text
local_only
preview
on_demand
always
```

Default should be `local_only` or `preview`.

Cloud UI should show local-only artifacts as available on the runner, not as missing.

## Cancellation

Cloud cancellation is an intent:

```text
cloud cancel request
  -> runner receives cancel intent
  -> runner writes local cancel marker
  -> runtime reaches terminal status
  -> runner syncs projection
```

Cloud should not model cancellation as direct process kill.

## Offline behavior

Rules:

- jobs already leased by the runner may continue offline;
- local evidence remains append-only;
- cloud marks projection as `sync_pending` or `runner_offline`;
- reconnect sync uses cursors and idempotency keys;
- if cloud template bundle is not cached locally, new job cannot start offline;
- local EXE fallback should allow user operation without cloud availability.

## Acceptance criteria

This plan is complete when a prototype can:

- pair a runner with a cloud account/project;
- register runner capabilities;
- create a cloud job intent;
- lease the job from the local runner;
- execute locally into `runs/<run_id>`;
- sync run summary and event projection;
- sync artifact manifests without content upload;
- handle runner disconnect/reconnect without duplicate runs;
- cancel through intent and local marker;
- show local-only artifact state in cloud UI.

## Verification

Add integration tests with a fake local runner and fake cloud service:

- duplicate job delivery is idempotent;
- network timeout retries do not duplicate runs;
- runner offline does not lose local events;
- reconnect sync resumes from cursor;
- artifact content is not uploaded under `local_only`;
- cloud cannot submit a local absolute path as workspace.
- same idempotency key with different intent digest returns conflict;
- stale lease epoch cannot heartbeat, upload deltas, or acknowledge cancel;
- projection replay is idempotent across event resend and reconnect;
- cursor gap or file rotation reports `sync_gap_detected`;
- validation failures create receipt/projection but no run directory;
- artifact manifests redact absolute paths and sensitive/provider identifiers;
- cloud lease timeout produces `lease_expired_unconfirmed`, not local `failed`.
