# Security Checklist

## File path safety

- [ ] Reject `../` traversal in capsule/workflow/artifact file APIs.
- [ ] Resolve paths before reading/writing.
- [ ] Enforce allowed roots.
- [ ] Do not let artifact viewer read arbitrary host files.
- [ ] Do not let GraphOps patch modify arbitrary paths.

## Subprocess safety

- [ ] Prefer argument lists over shell strings.
- [ ] Avoid `shell=True` unless justified and tested.
- [ ] Sanitize or validate user-provided command args.
- [ ] Enforce timeout on subprocesses.
- [ ] Capture stdout/stderr safely.

## Permission safety

- [ ] Default sandbox is read-only.
- [ ] `danger-full-access` is forbidden by default.
- [ ] `write_files` and `network` are opt-in.
- [ ] Dangerous GraphOps modifications are high-risk.
- [ ] Human approval is required for risky apply operations.

## Secret safety

- [ ] Do not log `.env` contents.
- [ ] Do not log SSH keys.
- [ ] Do not log tokens/cookies/API keys.
- [ ] Add redaction filters where logs/artifacts may contain secrets.
- [ ] Tests cover at least one redaction case if redaction exists.

## Browser/API safety

If a server/UI exists:

- [ ] Artifact read API enforces workspace/root restrictions.
- [ ] File write API only edits whitelisted capsule/workflow files.
- [ ] No arbitrary command execution endpoint is exposed.
- [ ] CORS/default binding is safe for local-first use.
- [ ] Errors do not expose secrets.

## GraphOps safety

- [ ] Validate patch schema.
- [ ] Validate target paths.
- [ ] Validate resulting graph/capsule after dry-run.
- [ ] Reject or flag dangerous permission escalation.
- [ ] Produce semantic diff before apply.
- [ ] Record audit log for apply.
