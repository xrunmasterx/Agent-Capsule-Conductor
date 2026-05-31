# GraphOps Control Plane

## 1. Purpose

GraphOps is the controlled path for workflow, capsule, and resource-library mutation.

It lets an LLM assist with authoring without making the LLM the unrestricted owner of persistent
state.

Correct boundary:

```text
LLM proposes patch
  -> acc validates schema and policy
  -> acc dry-runs the mutation
  -> human reviews evidence
  -> acc applies only with explicit approval
```

## 2. Why This Is Needed

ACC can run Codex/Claude/Cursor-like agents as workflow nodes. Those agents may also help improve
workflow definitions. That recursion is useful only if mutation remains explicit and reviewable.

Direct file editing creates risks:

- deleting human gates;
- enabling dangerous permissions;
- breaking schema or port contracts;
- silently changing class-level system prompts;
- creating cycles;
- writing runtime state into reusable templates;
- corrupting workflow assets.

GraphOps makes changes typed, reviewable, testable, and auditable.

## 3. Minimal Patch Shape

```json
{
  "patch_id": "patch_add_review_node",
  "author": "workflow-editor.codex",
  "target_type": "workflow",
  "target_path": "workflows/engine-architecture-research.v2.yaml",
  "rationale": "Add a reviewer node before final synthesis.",
  "operations": [
    {
      "op": "add_node",
      "node_id": "critical_review",
      "capsule_id": "critical-review.claude"
    },
    {
      "op": "connect_nodes",
      "from": "source_reality_check",
      "to": "critical_review"
    }
  ]
}
```

## 4. CLI Behavior

```bash
acc graphops validate-patch patch.json
```

Validates patch schema and policy.

```bash
acc graphops apply-patch patch.json --dry-run
```

Shows what would change. Does not mutate files.

```bash
acc graphops apply-patch patch.json --apply --human-approved
```

Actually mutates files. This is not used by default tests.

## 5. Forbidden Operations By Default

Reject by default:

```text
enable_danger_full_access
remove_human_gate
disable_tests
write_secret_files
change_git_remote
remove_schema_validation
```

## 6. Current Architecture Boundary

GraphOps is an authoring/control-plane feature. It must not:

- run a custom LLM loop;
- bypass workflow validation;
- mutate run evidence as if it were a reusable template;
- apply destructive changes without human approval;
- make Workbench UI state the durable workflow truth.

## 7. Testing Principle

Default tests must prove:

- valid patches pass,
- invalid patches fail,
- dry-run does not mutate files,
- applying without human approval fails.
