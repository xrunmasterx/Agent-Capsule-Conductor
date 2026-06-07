# Phase 4 - MCP Wrapper

## Decision

Phase 4 exposes Workbench authoring and GraphOps capabilities through MCP tools for external agents.
MCP is a transport and tool protocol, not the safety boundary.

The safety boundary remains:

```text
ACC app/server validation
GraphOps dry-run and approval
path protection
permission policy
runtime evidence
```

## Purpose

MCP lets external agents inspect and propose Workbench changes without needing direct browser or
filesystem control.

The desired behavior is:

```text
external mature agent
  -> MCP read/validate/dry-run tools
  -> structured proposal
  -> ACC validates and displays proposal
  -> user approves in Workbench
```

## Non-Goals

- Do not implement GraphOps semantics in MCP.
- Do not expose direct workflow/callable write tools by default.
- Do not expose GraphOps apply unless it requires an already approved proposal and ACC-side checks.
- Do not expose arbitrary shell or filesystem write.
- Do not let MCP bypass Workbench/GraphOps human approval.
- Do not use MCP to reintroduce a hidden legacy workflow registry.

## Tool Surface

Safe read tools:

```text
acc_list_callables
acc_show_callable
acc_list_workflows
acc_show_workflow
acc_get_canvas_snapshot
acc_get_run_summary
acc_get_run_events
acc_read_artifact
```

Authoring tools:

```text
acc_validate_canvas_proposal
acc_dry_run_canvas_proposal
acc_validate_graphops_proposal
acc_dry_run_graphops_proposal
acc_create_authoring_session
acc_send_authoring_message
```

Run tools:

```text
acc_submit_ephemeral_run
acc_get_run_status
acc_cancel_run
```

Restricted tools:

```text
acc_request_human_approval
acc_apply_approved_graphops_proposal
```

The restricted tools should fail unless the corresponding ACC-side proposal is already approved.

## Tool Result Shape

Every MCP mutating or near-mutating tool should return:

```json
{
  "status": "valid | invalid | dry_run | submitted | rejected | requires_approval",
  "proposal_id": "optional",
  "run_id": "optional",
  "summary": "human readable summary",
  "errors": [],
  "warnings": [],
  "links": []
}
```

Never return raw filesystem paths as authority to write. Paths are evidence links and must still be
validated by ACC endpoints.

## Integration With Authoring Phases

MCP depends on earlier phases:

- Phase 1 provides `CanvasAuthoringProposal` and canvas reducer validation.
- Phase 2 provides `AuthoringSessionService`.
- Phase 3 provides inline/multi-target GraphOps proposals and approval state.
- Phase 4 wraps those services without changing their semantics.

If Phase 3 apply is not implemented, MCP apply tools must not exist or must always return
`requires_approval` / `apply_unavailable`.

If the optional run-scoped temporary resource overlay is not implemented, MCP run tools must reject
workflows that reference temporary callable IDs. MCP must not make temporary resources runnable by
smuggling template payloads through arbitrary tool arguments.

## Prompt Injection Boundary

External agents calling MCP may read untrusted run output, logs, artifacts, and documents. Those
contents can influence proposals, but they cannot grant permission.

MCP tools must enforce:

- operation allowlists;
- path safety;
- proposal schemas;
- forbidden-operation checks;
- base hash checks;
- human approval state.

## Temporary Resources

MCP may expose temporary resource drafts, but only as proposal data:

```text
acc_list_temporary_resources
acc_validate_temporary_resource
acc_promote_temporary_resource_dry_run
```

Promotion must route through GraphOps transaction approval. MCP cannot directly persist temporary
resources.

Temporary draft IDs are not durable callable IDs. MCP responses should clearly distinguish:

```text
temporary_resource_id
persistent_callable_id
proposal_id
run_id
```

Mixing these IDs is a correctness and auditability bug.

## Observability

Each MCP tool call that creates a proposal, submits a run, or requests approval should produce
auditable metadata:

- external agent identity if available;
- tool name;
- request ID;
- proposal ID or run ID;
- target task/workflow;
- validation result;
- timestamp.

This audit metadata should be projected in Workbench rather than hidden in MCP logs only.

## Acceptance Criteria

- External agents can inspect current callable/workflow catalogs through MCP.
- External agents can submit canvas or GraphOps proposals through MCP without direct writes.
- Invalid proposals are rejected by ACC-side validation, not by MCP prompt wording.
- MCP apply cannot mutate anything unless the proposal is already approved in ACC.
- The same proposal accepted through MCP behaves identically to one created through the Workbench
  Assistant Panel.

## Tests

New tests should cover:

- MCP tool schemas;
- proposal validation through MCP wrapper;
- forbidden operation rejection;
- path escape rejection;
- unapproved apply rejection;
- temporary callable run rejection unless the explicit overlay feature exists;
- temporary ID and persistent callable ID separation;
- approved apply delegation to ACC GraphOps service when Phase 3 exists;
- hermetic operation without real external agents.
