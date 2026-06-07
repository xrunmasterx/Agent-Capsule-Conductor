# Phase 3 - GraphOps v3 Persistence Governance

## Decision

Phase 3 turns authoring proposals into governed persistent resource mutations. It extends GraphOps
from single-file dry-run patches to multi-target transactions that can safely create or update
workflow templates and callable templates after human approval.

This is the first phase where AI-generated changes may persist into:

```text
workflows/*.accflow.json
callables/agents/*.yaml
callables/tools/*.yaml
```

Persistent mutation remains human-governed:

```text
proposal -> schema validation -> semantic validation -> dry-run -> human approval -> staged apply
```

Persistence approval is separate from runtime human gates. A runtime gate decides whether a running
workflow may continue. A GraphOps v3 approval decides whether durable project resources may change.
The two may share UI affordances, but they must not share an ambiguous state machine.

## Why Phase 3 Is Separate

The current GraphOps implementation is dry-run only. It validates patch files and computes semantic
diffs, but real apply is intentionally unavailable.

Because AI-created agent templates and workflows can affect future executions, persistence needs a
stronger transaction model than Phase 1 canvas drafts.

## Existing Code Anchors

- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`
  - current GraphOps governance model.
- `acc/graphops.py`
  - current patch validation, policy checks, dry-run, semantic diff.
- `schemas/graphops_patch_schema.json`
  - current single-target patch schema.
- `acc/server/routes/graphops.py`
  - current API accepts `patch_path`, not inline transaction payloads.
- `acc/server/routes/workflows.py`
  - workflow save path uses staging and replacement.
- `acc/app/workbench_adapter.py`
  - Workbench draft compilation and Core v2 validation.
- `acc/control_plane.py`
  - callable template authoring and path validation.

## Current Gaps

GraphOps v2/current limitations:

- single `target_type` and single `target_path`;
- patch schema still lists legacy names such as `connect_nodes` and `update_node_input`;
- API requires patch files, so AI cannot safely submit inline proposals without writing files;
- no multi-target validation for "create agent template then reference it in workflow";
- no real apply;
- no transaction audit manifest;
- no first-class DecisionInbox approval flow for AI-authored resource mutation.

## Transaction Proposal Model

GraphOps v3 should accept a transaction:

```json
{
  "proposal_id": "graphops_tx_001",
  "author": "authoring-agent.codex",
  "base": {
    "content_hashes": {
      "workflows/research.accflow.json": "sha256:..."
    }
  },
  "rationale": "Create a research workflow and a reviewer agent template.",
  "targets": [
    {
      "target_type": "agent_class",
      "target_path": "callables/agents/reviewer.codex.yaml",
      "operation": "create_agent_class",
      "template": {}
    },
    {
      "target_type": "workflow",
      "target_path": "workflows/research.accflow.json",
      "operations": []
    }
  ]
}
```

The transaction dry-run must build an overlay catalog so new callables can be validated before they
exist on disk.

## Typed Operations

GraphOps v3 should remove legacy shorthand from the accepted proposal schema.

Workflow operations:

```text
create_workflow
replace_workflow
add_node
replace_node
remove_node
add_control_edge
remove_control_edge
add_data_edge
remove_data_edge
set_workflow_inputs
set_workflow_outputs
set_workflow_input_bindings
set_workflow_output_bindings
set_workbench_layout_metadata
```

Callable operations:

```text
create_agent_class
update_agent_class
create_tool_class
update_tool_class
```

Forbidden by default:

```text
enable_danger_full_access
remove_human_gate
disable_tests
write_secret_files
change_git_remote
remove_schema_validation
network=true for generated runtime policies
write_files=true for generated runtime policies
absolute paths
../ path escapes
```

## State Machine

Temporary resource drafts usually enter Phase 3 from:

```text
draft
  -> approved_for_canvas
  -> pending_save
  -> GraphOpsTransactionProposal
```

The GraphOps transaction itself uses:

```text
drafted
  -> validated
  -> dry_run_ready
  -> awaiting_human_approval
  -> approved
  -> applying
  -> applied
```

Failure and terminal alternatives:

```text
rejected
cancelled
validation_failed
dry_run_failed
apply_failed
stale_base
```

Human approval must be explicit and scoped:

- proposal ID;
- target paths;
- operations summary;
- semantic diff;
- risk warnings;
- dry-run result;
- base hashes.

## API Shape

```text
POST /api/graphops/proposals
GET  /api/graphops/proposals
GET  /api/graphops/proposals/{proposal_id}
POST /api/graphops/proposals/{proposal_id}/validate
POST /api/graphops/proposals/{proposal_id}/dry-run
POST /api/graphops/proposals/{proposal_id}/approve
POST /api/graphops/proposals/{proposal_id}/apply
POST /api/graphops/proposals/{proposal_id}/reject
```

Applying without `approved` state should fail.

## Staged Apply

Apply should use a staging directory:

```text
load current targets
verify base hashes
materialize transaction into staging
validate all staged outputs
build semantic diff
write audit manifest
atomic replace target files
refresh catalogs
record decision/audit event
```

If validation fails, no target file is modified.

If base hashes are stale, return `stale_base` and require rebase/regeneration.

## Temporary Resource Promotion

Phase 3 converts Phase 1/2 temporary resource drafts into persistent resources.

Promotion flow:

```text
TemporaryAgentTemplateDraft
  -> GraphOpsTransactionProposal target create_agent_class
  -> dry-run overlay validates workflows referencing it
  -> human approval
  -> persisted callables/agents/<id>.yaml
```

The user should see exactly which temporary templates will become durable resources and which nodes
reference them.

## Decision Inbox Integration

AI-authored persistent mutations should appear in an authoring/persistence decision surface:

- "Approve generated agent template";
- "Approve workflow save";
- "Reject generated resource";
- "Open dry-run diff";
- "Run validation again".

The decision item should link to the proposal, dry-run result, affected files, and generated
semantic diff.

This decision surface can be projected in the same Workbench panel as runtime decisions, but the
stored record should identify it as an authoring persistence decision. It should include:

- proposal ID;
- requester identity;
- approver identity;
- target paths;
- base hashes;
- validation result;
- dry-run result;
- exact approved operation set.

Approving a runtime human gate must not imply approval to create callables or save workflows.
Approving GraphOps persistence must not imply approval to execute external agents.

## Safety Requirements

- No direct file writes from the authoring agent.
- No apply without human approval.
- No apply when base hashes are stale.
- No hidden compatibility registry.
- No legacy `.graph.json` product runtime path.
- No metadata smuggling of prompt policy, permission policy, run state, or conversation memory.
- No generated `danger-full-access`, `network=true`, or `write_files=true` unless a separate
  policy explicitly allows and audits it.

## Acceptance Criteria

- An inline multi-target proposal can create an agent template and a workflow referencing it in one
  dry-run.
- Invalid callable IDs, unknown ports, cycles, forbidden permissions, and path escapes are rejected.
- Applying without human approval fails.
- Applying with stale base hashes fails.
- Successful apply writes only staged, validated files.
- Decision/audit records identify who proposed, who approved, what changed, and what validation ran.

## Tests

Backend focused tests:

```bash
uv run pytest -q tests/unit/test_graphops_patch_validation.py tests/server/test_graphops_api.py
uv run pytest -q tests/unit/test_workbench_adapter.py tests/server/test_workbench_core_v2_api.py
```

New coverage:

- inline proposal validation;
- multi-target overlay catalog;
- create agent + workflow reference dry-run;
- base hash stale rejection;
- human approval required for apply;
- authoring persistence approval is distinct from runtime human gate approval;
- temporary draft promotion from `pending_save`;
- forbidden operations;
- atomic no-mutation on failure;
- DecisionInbox projection for pending approvals.
