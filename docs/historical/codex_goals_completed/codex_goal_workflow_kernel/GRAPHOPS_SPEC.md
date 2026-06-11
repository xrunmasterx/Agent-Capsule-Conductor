# GraphOps Semantic Validation Spec

## 1. Purpose

GraphOps allows an LLM or human to propose workflow/capsule modifications. It must not allow unsafe or semantically broken changes to be applied blindly.

## 2. Required flow

```text
patch schema validation
  -> policy validation
  -> dry-run materialization
  -> semantic validation of resulting graph/capsule
  -> semantic diff report
  -> optional apply only with human approval
```

## 3. Commands

```bash
acc graphops validate-patch <patch.json> --semantic
acc graphops apply-patch <patch.json> --dry-run --semantic
```

Optional real apply:

```bash
acc graphops apply-patch <patch.json> --apply --human-approved
```

## 4. Policy rules

GraphOps must flag or reject by default:

- enabling `danger-full-access`;
- enabling `network: true`;
- enabling `write_files: true`;
- deleting human gates;
- deleting required output schemas;
- deleting required artifact manifest entries;
- replacing a capsule runtime with a more dangerous runtime;
- adding data edges to non-upstream nodes;
- adding cycles;
- path traversal in file operations.

## 5. Semantic diff

The dry-run output should summarize:

```json
{
  "status": "valid|invalid|warning",
  "added_nodes": [],
  "removed_nodes": [],
  "changed_nodes": [],
  "added_edges": [],
  "removed_edges": [],
  "policy_warnings": [],
  "semantic_errors": []
}
```

## 6. Test requirements

- valid patch passes;
- patch adding invalid edge fails;
- patch introducing cycle fails;
- patch enabling dangerous permission fails or requires explicit approval;
- dry-run does not mutate repo files;
- apply requires `--human-approved`.
