# Goal 10: GraphOps Governance Option A

## 一句话目标

落实 GraphOps Option A: 明确 proposal/dry-run only, runtime supervisor/handoff 不走 GraphOps apply。
不实现 human-approved apply。

## 第一性原理

GraphOps 是持久 template/resource mutation control plane, 不是 runtime dispatch 机制。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/concepts/GRAPHOPS_CONTROL_PLANE.md`
- `docs/Design/08_GRAPHOPS_GOVERNANCE.md`
- 本文件

## 前置条件

Goal 06+ completed if supervisor proposals are involved。

## 允许修改

- GraphOps API/CLI messaging for dry-run only
- DecisionInbox/projection wording
- supervisor proposal dry-run wiring if needed
- focused GraphOps tests

## 禁止修改

- 不实现 real apply。
- 不允许 supervisor 自动 apply。
- 不让 runtime dispatch 通过 GraphOps add_node/apply/run。
- GraphOps library 不直接写 run evidence。
- 不改 workflow template unless explicit human-approved apply goal exists later。

## 任务

1. Make proposal/dry-run only explicit in CLI/API/Workbench projection。
2. Ensure GraphOps dry-run does not mutate `.accflow.json`。
3. Ensure apply without approval fails。
4. If apply not implemented, error message must be explicit。
5. If supervisor creates GraphOps proposal during a run:
   - app/runtime coordination may write run-scoped `DecisionRecord(kind="graphops_proposal")`。
   - GraphOps library itself does not write `decisions.jsonl`。
6. Independent authoring proposal writes proposal manifest/inbox, not run-scoped decisions。

## 验收标准

- Runtime supervisor/handoff never calls GraphOps apply。
- dry-run no mutation。
- dangerous operations still reject。
- apply unavailable/without approval fails explicitly。
- DecisionInbox/Workbench does not present apply as available if not implemented。

## 建议测试

```bash
uv run pytest -q tests/unit tests/server
uv run ruff check .
```

If web projection changes:

```bash
cd web
npm run test -- --run
npm run build
```

## 完成后

全部 10 个 goals 完成后运行 full regression:

```bash
uv run pytest -q
uv run ruff check .
cd web
npm run test -- --run
npm run build
```

