# Implementation Order

## Recommended sequence

### Milestone 0: Safety patch before larger refactor

Implement first if storage work will take multiple iterations:

- restrict `run_dir` compatibility to `runs/<safe_run_id>`;
- refuse duplicate queued/active run IDs;
- add ACC run marker for new runs;
- refuse `rmtree` without marker;
- disable arbitrary artifact path reads for non-debug product mode.

Exit criteria:

- malicious `run_dir` tests pass;
- duplicate active run tests pass;
- old local Workbench still runs a basic workflow.

### Milestone 1: Storage foundation

Implement `PLAN_01_STORAGE_FOUNDATION.md`.

Exit criteria:

- all durable writes needed by run submit go through storage helpers;
- JSON atomic write and JSONL locked append are tested;
- SQLite index can be rebuilt;
- run refs and artifact refs exist.

### Milestone 2: Durable tasks and sessions

Implement `PLAN_02_TASK_SESSION_DURABILITY.md`.

Exit criteria:

- clearing browser localStorage does not lose tasks;
- new assistant sessions have owner refs and retention metadata;
- run-bound sessions export with runs;
- compatibility reads old session folders.

### Milestone 3: Retention and storage doctor

Implement `PLAN_03_RETENTION_GC.md`.

Exit criteria:

- `acc storage doctor` reports issues read-only;
- `acc storage gc --dry-run` produces a stable plan;
- `acc storage gc --apply` uses tombstone/trash and writes manifest;
- active/pinned/exported resources are protected.

### Milestone 4: Local Runner boundary

Implement `PLAN_04_LOCAL_RUNNER_BOUNDARY.md`.

Exit criteria:

- runner capabilities API exists;
- submit can use runner job service;
- UI consumes refs/projections rather than internal paths;
- local token/origin rules are in place for product mode.

### Milestone 5: EXE packaging hardening

This is not a separate plan file here, but it should happen after Milestone 4.

Required decisions:

- user data directory vs project workspace directory;
- how to select/open a workspace;
- how to start/stop the local runner;
- how to locate external agents;
- how to show provider availability and missing dependency diagnostics;
- how to back up/export local evidence.

Exit criteria:

- EXE can start local runner and Workbench;
- user can select workspace;
- a basic workflow can run offline;
- storage doctor and GC are reachable from the product.

### Milestone 6: Cloud control plane prototype

Implement a narrow prototype from `PLAN_05_CLOUD_CONTROL_PLANE_SYNC.md`.

Exit criteria:

- cloud can register a runner;
- cloud can create job intent;
- runner leases and executes job locally;
- cloud shows run projection;
- artifact manifests sync without content upload;
- disconnect/reconnect is idempotent.

### Milestone 7: Security and privacy hardening

`PLAN_06_SECURITY_PRIVACY_POLICY.md` is cross-cutting, but final cloud-facing work must not ship
without this milestone.

Exit criteria:

- permission escalation tests pass;
- upload denylist and upload policy tests pass;
- GraphOps cloud approval still requires local dry-run/apply;
- audit events exist for sensitive operations.

## Dependency rule

Do not implement cloud sync before:

- immutable run IDs are enforced;
- artifact refs exist;
- task/session storage is durable;
- GC and retention metadata exist;
- runner boundary is explicit.

Skipping these dependencies will push local paths, credentials, and unbounded evidence folders into
the cloud protocol.
