# Phase 2 - Authoring Agent Service

## Decision

Phase 2 moves the authoring assistant from a UI-local proposal surface to a backend-mediated
authoring service. The service selects an `AgentClassTemplate`, constructs a bounded authoring
context, invokes an external mature agent once per request, and returns a structured proposal plus
validation output.

The service still does not implement a custom LLM loop.

```text
Workbench message
  -> AuthoringSessionService
  -> selected AgentClassTemplate runtime
  -> structured proposal artifact
  -> validate/dry-run
  -> UI review
```

## Scope

Phase 2 supports existing backend runtime families only:

```text
codex_cli
claude_sdk
generic_cli
```

Other provider labels may remain UI presets or generic CLI wrappers, but the product must not imply
native Cursor/Gemini/Hermes adapters until they exist.

## Existing Code Anchors

- `acc/domain.py`
  - `AgentClassTemplate`, `NodeInvocationSpec`, `SessionInstance`, permission models.
- `acc/callable_registry.py`
  - project callable discovery.
- `acc/callable_runner.py`
  - external agent dispatch and hermetic stub behavior.
- `acc/adapters/codex_cli.py`
  - Codex CLI adapter and isolated Codex home preparation.
- `acc/runtime/policy.py`
  - `ACC_RUN_MODE`, external-agent execution gates.
- `acc/server/run_manager.py`
  - server-scoped async execution handle model.
- `acc/environment.py`
  - behavior paths such as `AGENTS.md`, `.claude/skills`, and `skills`.

## Service Boundary

Add an app-layer service, for example:

```text
acc.app.authoring.AuthoringSessionService
```

Responsibilities:

- create and store authoring sessions;
- select an authoring `AgentClassTemplate`;
- construct an `AuthoringContextSnapshot`;
- invoke the selected external agent through existing runtime adapters;
- parse the agent output into a strict proposal schema;
- call validation and dry-run helpers;
- return proposal, explanation, warnings, and required human actions.

Non-responsibilities:

- no persistent workflow writes;
- no direct callable writes;
- no custom LLM tool loop;
- no hidden long-lived memory;
- no bypass of GraphOps or Workbench validation.

## Suggested API

```text
GET  /api/authoring/agents
POST /api/authoring/sessions
GET  /api/authoring/sessions/{session_id}
POST /api/authoring/sessions/{session_id}/messages
POST /api/authoring/proposals/validate
POST /api/authoring/proposals/dry-run
```

The `messages` endpoint should return either a proposal or a required human action:

```json
{
  "session_id": "authoring_001",
  "message_id": "msg_002",
  "assistant_message": "I drafted a two-node workflow and one temporary reviewer agent template.",
  "proposal": {},
  "validation": {
    "status": "valid",
    "errors": [],
    "warnings": []
  },
  "required_actions": [
    {
      "kind": "approve_temporary_resource_persistence",
      "resource_draft_id": "temp_reviewer",
      "reason": "This workflow cannot run until the reviewer template exists in the callable registry."
    }
  ]
}
```

## Interaction Kinds

The authoring service should return typed interactions instead of relying on free-form prose.

Recommended kinds:

```text
ask
confirm_canvas_apply
approve_ephemeral_run
approve_resource_persistence
approve_workflow_save
reject_or_revise
```

These are authoring interactions, not automatically the same thing as runtime human gates. Existing
runtime human-gate concepts such as `InteractionRequest` and `DecisionRecord` are scoped to
"pause before or during execution". Authoring approvals are scoped to "may this proposal change the
canvas or persist a resource".

This split matters:

- applying a Phase 1 proposal to the current canvas is a UI confirmation;
- submitting a run with real external agents is a run-scoped decision;
- creating or updating `callables/agents/*.yaml` or `workflows/*.accflow.json` is a persistence
  approval;
- answering a clarifying question is not approval to mutate anything.

If existing answer endpoints are human-gate-specific, Phase 2 should not overload them for all
authoring decisions. It should either add authoring-session actions or explicitly bridge into the
runtime decision model only for run-scoped decisions.

## Authoring Session State

Authoring session state is not workflow truth. It may store:

- selected authoring agent ID;
- conversation messages;
- compact conversation summary;
- context snapshot refs;
- proposal refs;
- validation and dry-run summaries;
- pending human actions.

It must not store:

- runtime-only node outputs as template state;
- run directories as template fields;
- absolute workspace bindings as reusable template fields;
- unapproved persistent mutation state;
- hidden agent memory outside auditable session records.

## Agent Output Contract

The selected external agent should return one JSON object matching an authoring output schema:

```json
{
  "schema_version": "acc.authoring.output.v1",
  "assistant_message": "string",
  "proposal_kind": "canvas | graphops_transaction",
  "proposal": {},
  "questions": [],
  "risk_notes": [],
  "confidence": "low | medium | high"
}
```

Free-form prose is allowed only inside explicit string fields. The service should reject responses
that do not parse to the schema.

## Behavior Pack and Skills

`AGENTS.md` and skills must be run-scoped behavior inputs, not workflow template fields.

Desired flow:

```text
AgentClassTemplate.default_skills/default_rules
  -> behavior pack materialization
  -> run-scoped behavior snapshot
  -> adapter-specific launch context
  -> evidence manifest
```

Current gaps to close before treating skills as runtime-effective:

- `metadata.skills` is currently UI-friendly metadata and should not be treated as proof of runtime
  injection.
- callable registry parsing should explicitly populate `AgentClassTemplate.default_skills` if this
  field is used for execution.
- behavior snapshot logic in `acc/environment.py` should be connected to Core v2 authoring runs.
- adapter launch should reference the run-scoped behavior snapshot, not silently copy arbitrary host
  behavior files.

## Permissions

Default authoring agent permissions:

```yaml
workspace_access: read_only
network: false
shell: false
dangerous: false
env_policy: acc_whitelist
timeout_seconds: 60
```

The service should expose only allowlisted tools:

```text
list_callables
show_callable
list_workflows
show_workflow
get_canvas_snapshot
compile_workbench_draft
validate_proposal
dry_run_proposal
semantic_diff
submit_ephemeral_run
read_evidence
```

It must not expose direct persistent mutation tools to the agent:

```text
POST /api/callables/agents
PUT /api/callables/agents/*
DELETE /api/callables/agents/*
POST /api/workflows
PUT /api/workflows/*
/api/graphops/apply
arbitrary filesystem write
shell write
git mutation
```

## Prompt Injection Boundary

Untrusted content includes:

- user-provided task text;
- node outputs;
- artifacts;
- logs;
- prior agent messages;
- website or document contents embedded in artifacts.

These can be facts, but they cannot override authoring policy. The real defense is not prompt text
alone; it is the absence of dangerous tools plus schema validation and dry-run.

## Temporary Resource Handling

Phase 2 can support temporary resource drafts more explicitly than Phase 1:

```text
TemporaryAgentTemplateDraft
  draft_id
  proposed AgentClassTemplate payload
  referenced_by nodes
  validation status
  persistence status: temporary | pending_approval | persisted | rejected
```

Temporary resources are not resolvable by the default callable registry. A workflow using them must
either:

- ask the user to approve persistence before run/save;
- substitute an existing callable;
- run only through an explicitly designed future overlay registry path.

Do not add a hidden compatibility registry for temporary callables.

## Optional Phase 1.5 - Run-Scoped Temporary Resource Overlay

If the first product version must run AI-drafted agents before the user saves them as real
resources, that behavior needs an explicit backend overlay rather than a UI-only shortcut.

Required shape:

```text
Workbench submit payload
  -> temporary_callables[]
  -> run-scoped CallableRegistry overlay
  -> compile with overlay + project registry
  -> behavior snapshot in runs/<run_id>
  -> SessionInstance evidence references the snapped template
```

Minimum rules:

- temporary callables are valid only for one run;
- they do not appear in default callable discovery;
- they are not written to `callables/` unless a later persistence approval succeeds;
- their prompts, skills, permission policy, runtime backend, and output schema are captured in run
  evidence;
- saved workflow templates must not keep unresolved temporary IDs.

Without this feature, temporary resource nodes remain `unresolved` and non-runnable until the user
persists them or replaces them with existing `codex_cli`, `claude_sdk`, or `generic_cli` resources.

## Failure Paths

- Agent output is invalid JSON: show parser error, preserve raw output as run evidence.
- Proposal references unknown callables: mark invalid unless they are explicit temporary resource
  drafts.
- Proposal references stale canvas hash: require regeneration or user-confirmed rebase.
- External agent execution disabled: use hermetic stub or return a clear disabled-runtime error.
- External agent times out: preserve stderr/stdout logs and keep session recoverable.
- Human approval required: return `required_actions`, do not mutate resources.

## Acceptance Criteria

- The service can invoke `codex_cli`, `claude_sdk`, or `generic_cli` through existing runtime
  dispatch boundaries.
- Default tests remain hermetic and do not require real external agent accounts.
- Each authoring request has auditable evidence: input context, selected agent, raw output, parsed
  proposal, validation result.
- Invalid proposal output is rejected before it reaches the canvas reducer.
- Persistent resource creation returns a required human action instead of writing immediately.

## Tests

Focused backend tests:

```bash
uv run pytest -q tests/unit/test_callable_domain.py tests/unit/test_graphops_patch_validation.py
uv run pytest -q tests/server/test_workbench_core_v2_api.py
```

New tests should cover:

- `AuthoringSessionService` with hermetic fake output;
- invalid JSON output;
- forbidden operation output;
- stale snapshot rejection;
- temporary resource approval gating;
- temporary resource nodes fail run/compile unless an explicit overlay is implemented;
- allowed runtime families are limited to `codex_cli`, `claude_sdk`, and `generic_cli`;
- typed `ask` / `confirm` / `approval` interaction handling;
- no direct save API exposure to authoring agents;
- default permissions are read-only.
