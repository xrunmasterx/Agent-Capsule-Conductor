# Plan 06: Security and Privacy Policy

## Objective

Define the security rules that must hold across local EXE, local runner, and future cloud-visible
Workbench modes.

The key principle is simple:

```text
The local runner is the security boundary for local files, local credentials, local execution,
artifact content, and GraphOps apply.
```

## Trust boundaries

```text
Browser UI
  untrusted presentation/client state

Cloud Control Plane
  trusted for account/project/job intent after auth
  not trusted to access local files or credentials directly

Local Runner
  trusted local execution authority
  still validates every job and every path

External agents
  untrusted or partially trusted subprocesses
  constrained by ACC permission policy and workspace boundaries
```

## Security modes

ACC should make security mode explicit:

- `dev_local`: local development, explicit relaxed origin/auth settings.
- `product_local_exe`: packaged local runner with auth enforced.
- `paired_cloud_runner`: local runner paired to cloud/control plane with auth, lease, and policy
  enforcement.
- `test`: hermetic tests with explicit opt-out knobs.

Product modes fail closed. Dev/test opt-outs must be visible in config and logs.

## Non-negotiable rules

1. Cloud cannot send local absolute paths as execution authority.
2. Cloud cannot silently upgrade `PermissionProfile`.
3. Cloud cannot directly apply GraphOps changes to local files.
4. Local provider credentials never upload.
5. Full provider events and isolated provider homes are local-only by default.
6. Artifact content upload is policy-driven and explicit.
7. Browser/localStorage is not durable truth.
8. Every destructive operation writes audit evidence.

## Hard security contracts

### Runner auth contract

In product modes, local token auth is required for:

- all mutating APIs;
- artifact content reads;
- log/event deltas;
- folder open/select;
- GraphOps approve/apply.

Unauthenticated access is limited to health and minimal capabilities. Origin allowlist enforcement
is required in addition to token auth.

### Cross-boundary reference contract

Cross-boundary payloads carry refs, not authority paths:

- `workspace_alias`;
- `binding_ref`;
- `run_id`;
- `artifact_ref`;
- `session_ref`;
- `proposal_ref`.

Raw absolute paths may exist inside local runner evidence and authenticated local debug projection.
They are not accepted as authority by cloud/control-plane APIs.

### Artifact registration contract

Artifact preview/export must follow this order:

1. Verify run exists and is ACC-owned.
2. Verify node/session ownership.
3. Verify the artifact is registered in an `ArtifactBundle` or run evidence manifest.
4. Verify retention and upload policy.
5. Verify file type, size, and sensitivity classification.
6. Redact or transform preview.
7. Return a ref/projection.

The preview API must not read arbitrary paths supplied by the browser.

### Sensitive path and data contract

Positive registration policy is primary. A denylist is a last-resort guard for accidental exposure.

Sensitive names and path parts include:

- `codex_home`, `.codex`, `CODEX_HOME`;
- `auth.json`;
- `provider_events.jsonl`;
- provider ids in `session.json`;
- `config.toml` fields containing provider credentials;
- cookies and browser caches;
- OAuth, refresh token, access token, API key material;
- crash dumps;
- full raw stdout/stderr logs.

### Permission governance

Permission profile ordering:

```text
none < read_only < writes_run_only < writes_workspace < dangerous
```

Network and shell are separate gates. Cloud may request permissions, but the runner must accept,
downgrade, require local confirmation, or reject.

Upgrades to `dangerous`, shell execution, workspace writes, and GraphOps apply require local
approval evidence.

Current architecture already mentions `writes_run_only` in validation contexts, but runtime
validation must be unified so this profile is consistently accepted, enforced, or removed.

### GraphOps local apply

Cloud stores proposal and approval intent. Local runner still verifies:

- proposal digest;
- base graph/template hash;
- workspace binding fingerprint;
- runner identity;
- approval nonce;
- local validate/dry-run result.

Apply writes a local audit manifest before and after mutation.

### Provider evidence

Provider home directories, raw provider event streams, raw provider session ids, and provider
credential files are local-only. Cloud projection may include normalized event type, count, status,
redacted message, and hashes.

### Audit projection

Local audit is the source of truth. Cloud audit is a low-sensitive projection.

Audit events include:

- `event_id`;
- `runner_id`;
- `actor_ref`;
- `origin`;
- `action`;
- `decision`;
- `target_ref`;
- `policy_version`;
- `created_at`.

Sensitive fields are represented as hashes or refs.

### Stable security error codes

Use stable codes so UI, CLI, and cloud sync can reason about failures:

- `auth_missing`;
- `origin_denied`;
- `path_ref_unregistered`;
- `artifact_policy_denied`;
- `permission_upgrade_denied`;
- `approval_digest_mismatch`;
- `workspace_binding_changed`.

## Sensitive local data

Default denylist for upload and cloud projection:

```text
CODEX_HOME
codex_home/
~/.codex/auth.json
provider session ids
provider_events.jsonl
.env
*.pem
*.key
credentials.*
token.*
secret.*
stdout/stderr full logs unless user opted in
workspace source snapshots unless user opted in
crash dumps
browser cookies/cache
```

Use denylist plus positive upload policy. Denylist alone is not enough.

## Permission policy

Local runner owns the final permission decision.

Cloud job may request:

```json
{
  "workspace_access": "read_only",
  "network": "ask",
  "shell": "enabled",
  "dangerous": false,
  "allowed_env": []
}
```

Runner may:

- accept;
- downgrade;
- require local confirmation;
- reject.

Any `dangerous=true`, broad workspace write, shell execution, or GraphOps apply should require a
local approval path unless the user has created an explicit trusted policy.

## Path policy

Across API or cloud boundaries, use:

```text
workspace_alias
binding_ref
run_ref
artifact_ref
log_ref
evidence_ref
```

Avoid:

```text
C:\Users\...
F:\...
/home/...
../../...
runs/<run_id>/nodes/<node_id>/artifacts/file.txt as an API authority
```

Local runner resolves refs to paths only after:

- validating ownership;
- checking run marker;
- checking artifact registration;
- checking permission;
- checking size and content policy.

## Artifact preview policy

Preview should be treated as data disclosure.

Preview pipeline:

```text
artifact_ref
  -> local registration check
  -> size/type check
  -> classification check
  -> redaction scan
  -> preview generation
  -> optional cloud upload
```

Large files, binary files, logs, provider events, and unknown types should default to metadata-only.

## GraphOps policy

GraphOps keeps ACC safe only if its gate remains local:

```text
proposal
  -> validate
  -> dry-run
  -> human approval
  -> local apply
  -> apply manifest
```

For cloud mode:

- cloud may store proposal projection;
- cloud may show approval UI;
- local runner must rerun validation/dry-run;
- dry-run digest must match the approved digest;
- local runner writes apply evidence;
- apply cannot happen if local workspace binding is missing or changed unexpectedly.

## Local runner authentication

For EXE/localhost mode:

- bind to `127.0.0.1` by default;
- generate local token;
- require token for mutating APIs;
- restrict CORS/origin;
- disable arbitrary artifact path read;
- expose local folder open/select only in local UI mode.

For cloud mode:

- runner pairs with user/account through device flow or pairing code;
- runner stores token in OS credential storage or protected local config;
- runner initiates outbound connection to cloud where possible;
- cloud does not require inbound connection to user machine;
- all job messages are authenticated and versioned.

## Audit events

Write audit evidence for:

- runner pairing/unpairing;
- workspace alias creation/update/delete;
- permission approval/denial;
- job accepted/rejected;
- dangerous permission use;
- artifact preview/upload;
- GraphOps approval/apply;
- GC/tombstone/purge;
- cloud sync errors.

Audit should be queryable locally and syncable as low-sensitive projection where appropriate.

## Acceptance criteria

- No mutating local runner API works without auth in product mode.
- Cloud job cannot execute with a raw local absolute path.
- Cloud job cannot increase local permission without local policy approval.
- Sensitive provider files are never included in artifact manifests for upload.
- Artifact preview honors classification and upload policy.
- GraphOps apply is impossible without local validation/dry-run/approval evidence.
- Security tests cover path traversal, missing auth, over-permissioned job, and denied upload.
- Product modes fail closed when auth or origin is missing.
- Folder picker/open-folder APIs require auth and do not return raw paths by default.
- Permission upgrades to shell, workspace write, dangerous, or GraphOps apply require approval
  evidence.
- `writes_run_only` is consistently enforced or explicitly removed from the permission model.
- Provider home directories and raw provider events are excluded from cloud projection and export.
- Security errors use stable machine-readable codes.
