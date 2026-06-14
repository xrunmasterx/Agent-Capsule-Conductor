# Plan 04: Local Runner Boundary

## Objective

Make the current local ACC server an explicit Local Runner.

This is the bridge between the local EXE product and a future browser/cloud control plane. The
runtime should remain local-first, but APIs must stop assuming that browser, server, workspace, and
run evidence are all the same trust boundary.

## Current behavior

Today the Workbench effectively talks to a local FastAPI process:

```text
web/api.ts relative /api calls
  -> acc.server routes
  -> project_root from server process
  -> local filesystem paths
  -> local subprocess agents
  -> runs/<run_id>/ evidence
```

This is fine for an EXE, but too implicit for a product that may expose a browser UI and local
execution separately.

## Target model

```text
Workbench UI
  calls a Runner API or Cloud Control API

Local Runner
  owns local workspace aliases, credentials, execution, evidence, artifacts
  exposes refs and projections

Cloud Control Plane, optional later
  owns job intent and projection only
```

## Runner boundary contracts

### Public DTOs

Default runner/control-plane DTOs must not expose absolute filesystem paths.

Allowed stable fields include:

- `runner_id`;
- `workspace_alias`;
- `binding_ref`;
- `job_id`;
- `run_id`;
- `node_id`;
- `artifact_id` or `artifact_ref`;
- `stream_url`.

`debug_path` is returned only when `local_debug=true` and the caller is authenticated as the local
runner owner.

### Legacy Workbench adapter

Old Workbench endpoints remain compatibility adapters:

- `/api/workflows/run-graph/submit`;
- `/api/workflows/run-graph`;
- `/api/workflows/{workflow_id}/run`.

They may accept old `run_dir` or `workspace` fields only under Plan 01 path-safety rules. Internally
they should convert to `RunnerJobRequest`. New UI code should call a `runnerApi.submitJob()` boundary
instead of depending on legacy run DTOs.

### Workspace resolution

- `workspace_alias -> local_path` resolves only inside the local runner.
- `binding_ref` points to runner-owned binding metadata, not to a raw path.
- Cloud/control-plane payloads never contain `local_path`.
- Directory picker APIs are local-only, authenticated, and return alias/display metadata by
  default. Raw paths are local debug data.

### Auth and origin policy

Product local runner mode binds to `127.0.0.1` by default.

The following require local auth:

- all mutating APIs;
- artifact content reads;
- log/event streams;
- folder picker/open-folder actions;
- GraphOps approve/apply.

Origin allowlist must include only the packaged app origin, Vite dev origin in dev mode, and
explicit configured origins.

### Capability gate before evidence

Before creating run evidence, the runner validates:

- graph callable runtime requirements;
- provider availability;
- runner capability;
- workspace binding;
- permission profile;
- shell/network/dangerous-operation requirements.

Capability rejection returns structured errors such as `unsupported_provider`,
`capability_mismatch`, `workspace_unbound`, or `permission_denied`. A rejected job may produce a job
receipt/projection, but must not create a run directory or run evidence.

### Projection compatibility

Local evidence may keep absolute paths for debug and recovery. Runner projection converts those
paths to refs before crossing the UI/cloud boundary. Legacy Workbench APIs may keep old path fields
temporarily; new Runner APIs must not.

### Sessions and providers

- `/api/agent-sessions` should accept `workspace_alias` or `workspace_ref` and resolve it locally.
- Old `workspace_ref` raw path behavior is debug/compatibility only.
- Runner capability describes installed providers and provider health separately from callable
  template capability.
- Add a provider availability endpoint so UI can fail early with structured `unsupported_provider`
  diagnostics.

### Runner lifecycle

`pairing.json` should model `unpaired`, `local_only`, `paired`, and `revoked`. It stores runner
identity, token metadata, pairing endpoint, `last_seen`, and token rotation state. Raw tokens are
local-only and protected by local file permissions or OS credential storage.

`max_active_runs` is a runner capability with an environment override. Queue-full behavior returns a
structured rejection or queued job projection before run evidence exists.

`job_id` and `run_id` are distinct. A queued job may exist before a run is claimed. Cancel behavior
must cover queued jobs, running jobs, and already-terminal jobs.

## Runner identity

Add a local runner record:

```json
{
  "schema_version": "acc.runner.v1",
  "runner_id": "runner_...",
  "device_name": "local-windows",
  "acc_version": "...",
  "created_at": "...",
  "last_seen_at": "...",
  "storage_root": ".acc",
  "project_root": "<local only>",
  "auth_mode": "local_token"
}
```

Store it under:

```text
.acc/runner/runner.json
.acc/runner/capabilities.json
.acc/runner/workspaces.json
.acc/runner/pairing.json
```

The full local project path is local-only. API responses can expose display labels but should avoid
returning full paths unless the UI is explicitly in local debug mode.

## Capabilities

Minimum capability payload:

```json
{
  "schema_version": "acc.runner.capabilities.v1",
  "runner_id": "runner_...",
  "os": "windows",
  "acc_version": "...",
  "available_runtimes": ["codex_cli", "codex_app_server", "generic_cli"],
  "provider_status": {
    "codex_cli": "available"
  },
  "max_active_runs": 3,
  "supports_graphops_apply": true,
  "supports_artifact_preview": true,
  "permission_policy": {
    "network": "ask",
    "shell": "ask",
    "dangerous": "deny_by_default"
  },
  "workspace_aliases": ["default"]
}
```

## Workspace aliases

Replace cross-boundary local paths with aliases:

```json
{
  "schema_version": "acc.runner.workspaces.v1",
  "aliases": [
    {
      "alias": "default",
      "display_name": "Default workspace",
      "local_path": "F:\\Agent-Capsule-Conductor-v2",
      "allowed": true,
      "created_at": "..."
    }
  ]
}
```

The `local_path` field must never be required by cloud APIs. It is resolved only by the local runner.

## Runner API shape

Add a runner namespace or converge existing APIs behind runner semantics:

```text
GET  /api/runner/health
GET  /api/runner/capabilities
GET  /api/runner/workspaces
POST /api/runner/workspaces

POST /api/runner/jobs
GET  /api/runner/jobs/{job_id}
POST /api/runner/jobs/{job_id}/cancel

GET  /api/runner/runs/{run_id}/projection
GET  /api/runner/runs/{run_id}/stream
GET  /api/runner/artifacts/{artifact_id}/preview
```

Existing `/api/workflows/run-graph/submit` can call into the runner job service internally during
migration.

## Frontend boundary

Refactor `web/src/api.ts` conceptually into:

```text
controlPlaneApi
  account/project/template/job/projection APIs

runnerApi
  local capabilities, local workspaces, local submit/cancel/stream/artifact preview
```

In the EXE/local product, both may point to the same local origin.

In the future website product:

- `controlPlaneApi` points to the website backend;
- `runnerApi` may be proxied through the cloud or resolved to a paired local runner;
- UI code should not assume both APIs share the same filesystem.

## Authentication

Even local runner APIs should require a local token once exposed beyond development mode.

Minimum rules:

- bind to `127.0.0.1` by default;
- generate a local token on first run;
- require token for mutating APIs;
- support origin allowlist;
- disable unauthenticated artifact reads;
- keep local folder open/select operations behind local-only checks.

## Acceptance criteria

- The UI can query runner capabilities before submitting a run.
- Submit uses `workspace_alias` or `binding_ref`, not arbitrary local paths across UI boundary.
- Run projection uses refs and IDs, not internal paths.
- Existing local Workbench still works through compatibility APIs.
- Local runner refuses jobs requiring unavailable providers or disallowed permissions.
- Local runner writes all execution evidence under local storage.
- No cloud-specific dependency is introduced in local runner mode.

## Verification

Add tests for:

- runner capabilities response;
- workspace alias resolution;
- local token enforcement for mutating APIs;
- submit through runner job service;
- projection response without absolute local paths;
- compatibility path for existing Workbench APIs.
- product-mode auth for mutating APIs, artifact reads, event streams, folder picker, and GraphOps
  apply;
- origin allowlist rejection for unexpected browser origins;
- no run evidence after capability mismatch, unsupported provider, queue-full, or workspace-unbound
  rejection;
- no absolute paths in new Runner DTOs unless authenticated `local_debug=true` is set;
- queued-job cancellation before `run_id` exists and idempotent cancellation after terminal state.
