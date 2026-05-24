# GraphOps Control Plane

## 1. Purpose

GraphOps lets a higher-level LLM assist with workflow and capsule authoring.

It does not make the LLM the unrestricted owner of the system.

Correct boundary:

```text
LLM proposes graph patch.
acc validates patch.
Human approves patch.
acc applies patch.
```

## 2. Why this is needed

The user wants a recursive system:

```text
Workflow contains Codex nodes.
Codex can also help improve the workflow.
```

This is useful, but dangerous without a control plane.

Directly letting Codex edit arbitrary YAML files creates risks:

- deleting human gates,
- enabling dangerous sandbox permissions,
- breaking schema contracts,
- silently changing prompts,
- creating cycles,
- corrupting workflow assets.

GraphOps makes changes explicit, typed, reviewable, and testable.

## 3. Minimal patch format

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

## 4. CLI behavior

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

## 5. Forbidden operations by default

Reject by default:

```text
enable_danger_full_access
remove_human_gate
disable_tests
write_secret_files
change_git_remote
remove_schema_validation
```

## 6. Testing principle

Default tests must prove:

- valid patches pass,
- invalid patches fail,
- dry-run does not mutate files,
- applying without human approval fails.
