# How to use this package with Codex `/goal`

## 1. Copy into repo

From repository root:

```bash
unzip agent_capsule_workflow_kernel_goal_package.zip
bash agent_capsule_workflow_kernel_goal_package/scripts/copy_into_repo.sh
```

This adds:

```text
docs/codex_goal_workflow_kernel/
docs/human/ACC_WORKFLOW_KERNEL_PLAIN_LANGUAGE.md
schemas/*workflow-kernel*.json
examples/workflows/*
examples/capsules/*
examples/graphops/*
```

It does not replace older goal docs.

## 2. Commit current baseline first

Before asking Codex to implement this phase:

```bash
git status
git add .
git commit -m "chore: baseline before workflow kernel upgrade"
```

## 3. Ask for a plan first

In Codex:

```text
/plan Read AGENTS.md, docs/codex_goal*/**/*.md if present, docs/codex_goal_workflow_kernel/*.md, and docs/human/ACC_WORKFLOW_KERNEL_PLAIN_LANGUAGE.md. Produce a concise implementation plan for Workflow Kernel Upgrade only. Do not implement yet.
```

Reject the plan if it proposes:

- replacing ACC with Conductor YAML;
- copying Conductor full DSL;
- rewriting `acc run`;
- building a new LLM agent loop;
- making default tests call real Codex/Claude/Conductor;
- doing a large UI redesign first.

## 4. Start persistent goal

Copy and paste:

```text
docs/codex_goal_workflow_kernel/GOAL_COMMAND.txt
```

## 5. Steering during development

Useful steering messages:

```text
Stay on event emitters and workflow graph validation first. Do not implement Conductor export until Workflow Kernel tests pass.
```

```text
Preserve acc run stdout contract. Logs must not go to stdout when --emit-conductor-json is used.
```

```text
Default tests must be hermetic. Move real Conductor/Codex/Claude checks behind optional environment variables.
```

```text
Do not copy Conductor's full YAML DSL. WorkflowGraph remains ACC's authoring IR.
```

## 6. Completion check

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_workflow_kernel/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark the goal complete if any command fails.
```

## 7. If blocked

If external tools are missing, Codex must:

- keep default tests mocked/hermetic;
- record the missing tool in `docs/codex_goal_workflow_kernel/INTEGRATION_GAPS.md`;
- continue locally testable implementation.
