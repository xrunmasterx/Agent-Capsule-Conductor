# How to use this goal

## 1. Copy files

```bash
bash agent_capsule_environment_kernel_goal_package/scripts/copy_into_repo.sh
```

## 2. Ask Codex for a plan first

```text
/plan Read AGENTS.md, docs/codex_goal*/**/*.md if present, docs/codex_goal_environment_kernel/*.md, and docs/human/ACC_ENVIRONMENT_WORKFLOW_PLAIN_LANGUAGE.md. Produce a concise implementation plan for Environment Kernel Upgrade only. Do not implement yet.
```

Reject the plan if it proposes:

- rewriting `acc run`;
- changing stdout JSON contract;
- using ACC install directory as default mutable workspace;
- letting sender nodes write directly into receiver inbox;
- implementing a custom LLM agent loop;
- requiring real Codex/Claude credentials in default tests.

## 3. Set goal

Copy `docs/codex_goal_environment_kernel/GOAL_COMMAND.txt` into Codex.

## 4. Steering messages

Useful corrections:

```text
Preserve acc run stdout contract. Do not log to stdout under --emit-conductor-json.
```

```text
Do not use ACC install directory as default workspace. Use per-run ephemeral workspace.
```

```text
Sender nodes must write to outbox only. Scheduler materializes receiver inbox.
```

```text
Validate that saved workflow templates do not store absolute workspace paths.
```

## 5. Completion check

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_environment_kernel/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark complete if any command fails.
```
