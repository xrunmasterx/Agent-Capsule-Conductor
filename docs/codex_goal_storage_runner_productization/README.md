# ACC Storage and Runner Productization Plans

## Purpose

This package splits the storage and product-shape work into independent implementation plans.
The target product direction is:

```text
Local EXE / Local Runner first
  -> hardened local storage, evidence, retention, and task/session durability
  -> explicit Runner API boundary
  -> optional cloud control plane that syncs projections, not local execution facts
```

The plans are intentionally ordered. Do not start cloud sync before the local storage and runner
boundary plans are complete; otherwise local paths, credentials, and unbounded run artifacts will
leak into the remote protocol.

## First-principles decision

ACC's durable value is the execution evidence capsule:

```text
WorkflowFunctionTemplate
  -> FunctionInvocation
  -> ScopeFrame
  -> SessionInstance / child FunctionInvocation
  -> events, manifests, result store, artifacts
  -> inspect / replay / projection
```

For a product, the local runner should remain the owner of:

- workspace bindings and local paths;
- local agent credentials;
- real process execution;
- full run evidence;
- full logs and provider events;
- full artifact content;
- GraphOps apply against local files.

The cloud, if introduced later, should own only:

- account/team/project metadata;
- runner registry and capabilities;
- job intent;
- template library projection;
- run projection;
- artifact manifests and optional previews;
- approval UI state.

## Plan files

| File | Scope | Depends on |
| --- | --- | --- |
| `PLAN_01_STORAGE_FOUNDATION.md` | Safe run IDs, StorageService, atomic writes, locks, refs, SQLite index | none |
| `PLAN_02_TASK_SESSION_DURABILITY.md` | Durable Workbench tasks, canvas snapshots, assistant/authoring sessions | Plan 01 |
| `PLAN_03_RETENTION_GC.md` | Retention metadata, dry-run GC, tombstone/trash/purge, storage doctor | Plans 01-02 |
| `PLAN_04_LOCAL_RUNNER_BOUNDARY.md` | Make the current local server an explicit Local Runner API | Plans 01-03 |
| `PLAN_05_CLOUD_CONTROL_PLANE_SYNC.md` | Future cloud control plane, job intent, projection sync, artifact policy | Plan 04 |
| `PLAN_06_SECURITY_PRIVACY_POLICY.md` | Cross-cutting security, privacy, permission, upload, and GraphOps rules | Plans 01-05 |
| `IMPLEMENTATION_ORDER.md` | Recommended milestones and exit criteria | all plans |
| `ACCEPTANCE.md` | Global acceptance and verification contract | all plans |

## Current code facts that motivate this package

- Workbench run submit accepts `run_dir`, `workspace`, and `binding_path`, then resolves them on the
  server machine in `acc/server/routes/workflows.py`.
- `acc/app/runtime/orchestrator.py` currently deletes an existing `run_dir` before recreating it.
- `acc/server/run_manager.py` keeps active run handles in process memory while durable facts live
  under `runs/<run_id>`.
- Workbench task state is still partly browser-local, while service-side canvas snapshots are stored
  under `runs/_workbench_canvas_snapshots`.
- Agent and authoring sessions use global run-adjacent directories such as `runs/_agent_sessions`
  and `runs/_authoring_sessions`.
- Runtime workflow specs, GraphOps proposals, canvas snapshots, and sessions do not yet have a
  complete retention/GC model.
- Artifact reading still exposes path-shaped references across API boundaries.

## Non-goals for this package

- Do not replace ACC's local-first runtime with a cloud execution backend.
- Do not make cloud storage the source of truth for full run evidence.
- Do not upload local credentials, provider events, full logs, or artifacts by default.
- Do not move execution semantics into React state.
- Do not introduce a database as the only durable truth for run evidence.
