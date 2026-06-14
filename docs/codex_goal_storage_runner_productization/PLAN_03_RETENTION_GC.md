# Plan 03: Retention and Garbage Collection

## Objective

Prevent unbounded local resource growth without losing auditability.

ACC should provide a conservative, inspectable retention and GC system:

- every cleanup candidate has metadata;
- GC starts with dry-run;
- destructive cleanup writes evidence;
- pinned/exported/active resources are protected;
- local user policy is authoritative.

## Problem

Long-term ACC usage can grow these areas indefinitely:

- `runs/<run_id>/`;
- `runs/_agent_sessions`;
- `runs/_authoring_sessions`;
- `runs/_workflow_function_specs`;
- `runs/_graphops_proposals`;
- `runs/_workbench_canvas_snapshots`;
- node logs and artifacts;
- copied provider homes such as isolated `codex_home`;
- future cloud sync outboxes/inboxes.

Without retention metadata, cleanup becomes unsafe because ACC cannot distinguish:

- user-owned evidence from scratch data;
- active runs from stale runs;
- exported/pinned runs from ordinary successful runs;
- sensitive local-only artifacts from uploaded previews;
- proposal evidence from disposable staging data.

GC must not ship as an isolated cleanup script. It depends on Plan 01: all durable delete and
overwrite paths for ACC-owned run state must already go through storage, and runtime startup must
refuse an existing run directory unless storage created a fresh owned handle.

## Candidate and protection contracts

### Candidate discovery

GC candidate discovery is root-limited:

- `<project>/runs/<safe_run_id>`;
- known internal `runs/_...` namespaces with explicit handlers;
- `.acc/*` objects with marker or index rows.

GC must never traverse or delete:

- `workspace_root`;
- `workspace_ref`;
- binding target paths;
- absolute artifact refs;
- symlink targets;
- arbitrary project directories outside ACC-owned roots.

### Protection order

Protection checks run in this order:

1. Pinned or exported objects.
2. Active lease or active manager handle.
3. Non-terminal durable status.
4. Parent ownership protection.
5. Retention policy.

Unknown, malformed, or partially migrated objects are quarantine candidates only. They are not
direct purge candidates.

Protected statuses include `queued`, `running`, `waiting_interaction`, `resuming`, and
`cancel_requested`. Terminal status must be confirmed from durable run state and active leases, not
only from UI projection.

### Deletion groups

Deleting a run deletes only the run-owned group:

- run record and summary;
- node directories;
- result-store entries;
- run artifacts and workflow outputs;
- behavior snapshot evidence;
- run-bound sessions;
- runtime workflow specs in `_workflow_function_specs`.

Long-lived task, assistant, and authoring sessions are deleted only by their own owner retention
policy.

### Legacy internal stores

- `_agent_sessions` entries with `bound_run_id` follow the run.
- `_agent_sessions` entries with `session_kind=workbench_assistant` and no `bound_run_id` follow
  task/session retention.
- `_authoring_sessions` follows authoring/session retention.
- `_workflow_function_specs` for queued/running work are protected. Terminal specs are removed with
  their owning run tombstone.

### GraphOps retention

GraphOps objects in `drafted`, `validated`, `awaiting_human_approval`, `approved`, or `applying`
are protected from direct purge. `applying` is always protected. Expired abandoned drafts and
staging leftovers move to quarantine first, then trash after a grace period.

## Retention metadata

Every durable object that may be cleaned later should have a record:

```json
{
  "schema_version": "acc.retention.v1",
  "kind": "run",
  "object_id": "run_...",
  "owner_ref": "task:task_...",
  "state": "success",
  "created_at": "...",
  "last_accessed_at": "...",
  "ended_at": "...",
  "size_bytes": 0,
  "pinned": false,
  "exported": false,
  "retention_class": "normal",
  "expires_at": null,
  "local_only": true
}
```

Default policy keys should include:

- `success_after_days`;
- `failed_after_days`;
- `cancelled_after_days`;
- `draft_proposal_after_days`;
- `staging_after_hours`;
- `trash_grace_days`;
- `max_total_bytes`.

Minimum supported object kinds:

```text
run
run_node
artifact
task
session
runtime_workflow_spec
graphops_proposal
canvas_snapshot
staging_dir
sync_record
trash_entry
```

## Default policy

| Object | Default retention |
| --- | --- |
| queued/running/waiting/applying run | never auto-delete |
| failed/crashed run | retain longer than successful runs |
| successful run | eligible by age and total-size threshold |
| pinned/exported run | never auto-delete |
| run-bound session | follows parent run |
| long-lived assistant session | task/session TTL unless pinned |
| runtime workflow spec | follows parent run |
| canvas snapshot | follows task |
| GraphOps proposal | retain if applied/failed; shorter TTL for abandoned drafts |
| staging/temp dirs | short TTL after crash-safe quarantine |
| local-only artifact | local policy only; cloud cannot force purge |
| uploaded preview/blob | cloud policy governs cloud copy; local copy governed locally |

## Commands

Add storage inspection and cleanup commands:

```bash
uv run acc storage doctor
uv run acc storage rebuild-index
uv run acc storage gc --dry-run
uv run acc storage gc --apply
uv run acc storage pin <object_ref>
uv run acc storage unpin <object_ref>
uv run acc storage export-run <run_id> --out <archive>
```

`--apply` must require a dry-run plan ID or re-run the same plan and compare digest before deleting.

## GC flow

```text
scan local storage
  -> build candidates
  -> apply policy
  -> produce gc_plan.json
  -> user/app approval if destructive
  -> tombstone
  -> move/delete content
  -> write gc_manifest.json
  -> update index
```

Physical deletion should prefer:

1. tombstone;
2. move to `.acc/trash/<trash_id>/`;
3. purge after grace period.

Direct `rmtree` is allowed only inside the GC executor after path ownership and marker checks.

Trash entries should record original path, object ref, digest, size, `moved_at`, and `purge_after`.
Reapplying the same `gc_plan_id` must be idempotent. Permanent purge requires matching digest,
matching marker, expired grace period, and no active lease. After purge, keep a final tombstone
manifest. Index rebuild must skip trash and tombstoned objects and must not resurrect a tombstoned
run.

## Tombstone shape

```json
{
  "schema_version": "acc.tombstone.v1",
  "object_ref": "run:run_...",
  "object_kind": "run",
  "deleted_at": "...",
  "deleted_by": "local_user",
  "reason": "retention_policy",
  "gc_plan_id": "gc_...",
  "content_digest_before_delete": "sha256:..."
}
```

Cloud projection, if present later, should receive tombstones, not infer deletion from missing files.

## Storage doctor

`acc storage doctor` should report:

- missing run markers;
- malformed JSON;
- JSONL parse errors;
- index rows without files;
- files without index rows;
- orphan artifacts;
- orphan runtime specs;
- stale active/queued statuses after process crash;
- old compatibility folders that need migration;
- sensitive files that would be uploaded by an unsafe policy.
- malformed or unknown objects that require quarantine;
- residual `dry_run_staging` or `apply_staging` GraphOps directories;
- artifact refs that point outside registered artifact/object manifests.

Doctor should be read-only unless a `--fix` mode is explicitly added later.

If `--fix` is added, it should produce a separate dry-run/fix manifest instead of silently mutating
evidence. Normal GET/read APIs should not update durable `last_accessed_at`; if access tracking is
needed, write it asynchronously to a volatile or SQLite projection so reads do not perturb retention
facts.

## Acceptance criteria

- `gc --dry-run` can run on a populated workspace without deleting files.
- Active, queued, waiting, pinned, and exported resources are never selected for deletion.
- Runtime specs tied to deleted runs are selected with the run.
- Orphan objects are quarantined before purge.
- GC writes a manifest that explains what was removed and why.
- Rebuilding the index after GC does not resurrect deleted resources as active.
- Cloud sync plans can consume tombstones later.

## Verification

Add hermetic tests for:

- dry-run candidate generation;
- protected-object exclusion;
- tombstone creation;
- trash movement;
- orphan artifact quarantine;
- stale active run detection;
- index rebuild after GC.
- refusal to traverse workspace bindings, workspace roots, absolute artifact refs, and symlink
  targets;
- active lease protection for queued/running/waiting/resuming/cancel-requested runs;
- run deletion group removes run-bound sessions and runtime specs while preserving task-owned
  assistant/authoring sessions;
- GraphOps `applying` and approval-pending objects are protected;
- reapplying the same GC plan is idempotent;
- index rebuild does not resurrect tombstoned objects.
