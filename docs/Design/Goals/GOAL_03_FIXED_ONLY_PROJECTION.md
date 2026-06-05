# Goal 03: Fixed-Only Projection

## 一句话目标

为 fixed run 的 control ledger 提供 read-only API/app projection, 可选最小 Workbench 展示。
本 goal 只展示 fixed ledger, 不碰 human/supervisor/handoff。

## 第一性原理

UI/API 只能读取 runtime truth, 不能创造 truth。先让 fixed ledger 可观察, 再接动态控制。

## 必读文件

- `AGENTS.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/Design/07_API_WORKBENCH_PROJECTION.md`
- `docs/Design/Goals/GOAL_02_FIXED_RUNPLAN_DISPATCH.md`
- 本文件

## 前置条件

Goal 02 completed, fixed run 已写 ledger。

## 允许修改

- `acc/app/*` read-only projection service/helper
- `acc/server/routes/*` read-only route, 如确实需要
- `web/src/api.ts` 和最小 fixed-only UI 展示, 如选择做 Workbench 展示
- focused server/web tests

## 禁止修改

- 不修改 runtime execution。
- 不让 server route 写 `decisions.jsonl`。
- 不把 `/api/decisions` 改成 source of truth。
- 不把 Workbench localStorage 写入 `PlanStep` / `DecisionRecord` / `DispatchEnvelope` 正文。
- 不实现 human/supervisor/handoff UI。

## 任务

1. 提供 read-only projection:
   - run plan
   - plan steps
   - dispatches
   - decisions
   - optional aggregate control ledger
2. missing ledger files 返回 empty/warnings。
3. fixed-only endpoint 如:
   - `GET /api/runs/{run_id}/plan`
   - `GET /api/runs/{run_id}/steps`
   - `GET /api/runs/{run_id}/dispatches`
   - `GET /api/runs/{run_id}/decisions`
4. 如改 Workbench:
   - 只展示 fixed ledger。
   - submit 仍走 `/api/workflows/run-graph/submit`。
   - SSE 只作 notification, polling/read API 是 truth。
5. 添加 tests:
   - API read-only。
   - missing files warnings。
   - localStorage 不含 ledger 正文。

## 验收标准

- read-only API/app projection 能展示 fixed run ledger。
- server route 不直接写 ledger。
- Workbench 不保存 runtime truth。
- `/api/decisions` 仍是 inbox projection。
- fixed workflow 执行行为不变。

## 建议测试

```bash
uv run pytest -q tests/server tests/unit
uv run ruff check .
```

如果改了 `web/`:

```bash
cd web
npm run test -- --run
npm run build
```

## 完成后进入

`GOAL_04_RUN_WAIT_RESUME_LIFECYCLE.md`

