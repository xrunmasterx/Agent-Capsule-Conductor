# How to use this package with Codex /goal

## 1. Copy into repo

```bash
unzip agent_capsule_quality_audit_goal_package.zip
bash agent_capsule_quality_audit_goal_package/scripts/copy_into_repo.sh
```

## 2. Commit current state first

```bash
git status
git add .
git commit -m "chore: baseline before ACC quality audit"
```

## 3. Ask for a plan first

```text
/plan Read AGENTS.md, docs/codex_goal*/**/*.md if present, docs/codex_goal_quality_audit/*.md, and docs/human/ACC_QUALITY_REVIEW_PLAIN_LANGUAGE.md. Produce a concise quality-audit plan. Do not implement yet.
```

Reject the plan if it:

- adds unrelated features;
- rewrites the system broadly;
- ignores stdout contract;
- skips findings report;
- skips browser E2E if UI exists;
- makes default tests depend on real external agents.

## 4. Set goal

Copy:

```text
docs/codex_goal_quality_audit/GOAL_COMMAND.txt
```

Paste into Codex.

## 5. Steering messages

Useful corrections:

```text
Do not implement new features. Stay on quality audit and hardening.
```

```text
Preserve acc run stdout contract. Logs must not go to stdout under --emit-conductor-json.
```

```text
Fix critical/high findings first. Do not optimize before correctness and security issues are fixed.
```

```text
Browser E2E must produce screenshots and browser_e2e_report.json, not just npm build.
```

## 6. Final verification

Ask Codex:

```text
Run all required acceptance commands in docs/codex_goal_quality_audit/ACCEPTANCE.md. Report each command, exit code, and relevant output. Do not mark complete if any command fails.
```
