# Behavior Pack Spec

## 1. Purpose

An AgentSessionNode should feel like manually opening an agent CLI in the workflow workspace.

Therefore it must support workspace-native configuration and optional template-defined overlays.

## 2. Modes

### workspace_native

Use whatever exists in the bound workspace.

Examples:

```text
AGENTS.md
CLAUDE.md
.claude/skills/
hooks/
```

### template_overlay

Use files packaged with the workflow template.

Examples:

```text
behavior_pack/AGENTS.md
behavior_pack/skills/rendering-review/SKILL.md
behavior_pack/hooks/preflight.py
```

### hybrid

Use both workspace-native and template overlay.

Must define precedence:

```text
template_over_workspace
workspace_over_template
```

## 3. Snapshot

Every session must snapshot effective behavior files:

```text
session_snapshot/behavior_pack_effective/
```

## 4. Conflict handling

If template and workspace both define the same behavior file, behavior depends on precedence.

Conflicts must be recorded in:

```text
behavior_conflicts.json
```

## 5. UI

Workbench should show:

```text
当前使用：workspace_native / template_overlay / hybrid
有效 AGENTS.md 来源
有效 CLAUDE.md 来源
有效 skills 来源
冲突列表
```
