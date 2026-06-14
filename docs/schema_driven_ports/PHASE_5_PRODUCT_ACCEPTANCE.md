# Phase 5 - Product Acceptance And Release Hardening

## 目标

Phase 5 证明 schema-driven ports 在真实 Workbench 中可产品化使用，而不只是 backend validate 或组件测试通过。

边界：

- Phase 4 证明语义、迁移和单元测试正确。
- Phase 5 证明真实用户路径可用、可诊断、可回滚。
- Phase 5 不新增核心 runtime/schema 语义；如果验收发现 blocker，回到对应 Phase 修复。

## 约束

- 使用真实 ACC server + Vite + Browser。
- 验收必须覆盖拖拽、保存、重开、运行、查看 evidence、修复 broken edge。
- 验收产物应包含截图、console/network log 或 JSON report，方便定位失败。
- 不以“端口能显示”为完成定义，必须证明数据实际进入下游 payload。

## Browser Journey

### 1. 启动和加载

步骤：

1. 启动 ACC backend。
2. 启动 Vite frontend。
3. 打开 Workbench。
4. 加载 stock research / NVIDIA 示例或专门的 schema-driven test workflow。

期望：

- 页面无 console error。
- schema-derived output ports 正确显示。
- control/data 两类连接视觉上可区分。

### 2. Manual Connection

步骤：

1. 找到有 `output_schema.properties.outputs.properties` 的 agent。
2. 从一个 schema-derived output port 拖到下游 agent node body。
3. 松开鼠标。

期望：

- 目标节点出现 drop highlight。
- 自动创建同名 input port。
- 自动创建 data edge。
- 自动补 control dependency。
- toast 或状态提示说明创建结果。

### 3. Save / Reopen

步骤：

1. 保存 workflow。
2. 刷新页面或重新打开保存后的 `.accflow.json`。

期望：

- `output_schema` 仍是 source of truth。
- generated `output_ports` snapshot 未漂移。
- data edge 仍指向 schema-declared source port。
- target input port 仍存在。
- workflow output bindings 未被意外改写。

### 4. Run / Inspect

步骤：

1. 关闭上游 source node 的 full-output forwarding。
2. 保留显式 data edge。
3. 运行 workflow。
4. 打开下游节点实时输出 / 最终结果 / input evidence 面板。

期望：

- 下游 payload 只包含显式 data edge 传入的字段。
- 不应偷偷收到上游完整 `main` output。
- binding/evidence 中能看到 data edge 来源。
- 如果 control-only full forwarding 开启，则 evidence 中能看到 `control_main_default`。

### 5. Broken Edge Repair

步骤：

1. 将 source agent schema 字段改名，例如 `valuation_conclusion -> valuation_view`。
2. 保留旧 edge。
3. validate workflow。
4. 在 UI 中修复 edge。

期望：

- edge 不被自动删除。
- validate 返回 `dangling_data_edge_source`。
- UI edge 显示 broken。
- Inspector 显示 missing source port 和建议修复路径。
- 用户重新连接到新 port 后 validate 通过。

## 产品验收标准

### 可发现性

- 用户能从节点上直接看到可连接的 schema-derived output ports。
- Hover port 时能看到字段说明、类型、required、json path。
- Full-output forwarding 开关说明清楚，不误导用户。

### 可逆性

- 用户可以删除 data edge。
- 删除 data edge 后 target input port 是否保留要有明确规则：
  - P0 建议保留 input port，避免误删用户自定义输入别名。
  - 可提供手动删除入口。

### 错误反馈

- invalid drop 必须显示原因。
- schema field missing 必须显示 broken edge。
- port 冲突必须说明是复用、替换还是生成唯一端口名。

### 大画布可用性

- 端口超过 6 个时视觉仍可读。
- 端口超过 10 个时应考虑折叠、滚动或分组。
- 长字段名和中文 description 不应溢出。
- 50% / 125% zoom 下 handle 可点击。

## Observability

Browser acceptance 失败时报告至少包含：

```text
workflow id
node id
edge id
source port
target port
validation code
console errors
network failures
screenshots or trace path
```

## Documentation / User Guide

完成 Phase 5 前，应补用户向导：

- 如何在 `output_schema.properties.outputs.properties` 定义业务输出端口。
- 如何从 output port 拖数据线到下游节点。
- 如何关闭“控制线传递完整输出”。
- 如何判断下游收到的是完整 output 还是精确字段。
- 如何修复 broken data edge。
- 为什么 workflow output 需要通过 boundary 显式暴露。

交付文档：

- `docs/schema_driven_ports/USER_GUIDE.md`

## 最小回滚策略

如果 Phase 5 发现产品路径不可用：

1. 不回滚 runtime evidence。
2. 不删除用户 workflow 中的 data edges。
3. 可临时关闭 UI 的 schema-driven projection 主路径，回到 legacy `output_ports` 展示。
4. 保留 backend validation 对 schema-derived ports 的支持。
5. 回到对应 Phase 修复具体 blocker。

## 完成标准

- 真实 Browser 中能完成：加载、拖拽、保存、重开、运行、查看 evidence。
- 关闭 full-output forwarding 后，数据只通过显式 data edge 进入下游。
- Broken edge 可见、可解释、可修复。
- 验收产物足以定位失败到 workflow/node/edge/port。

自动化验收入口：

```bash
cd web
npm run test:e2e
```

该命令会启动真实 ACC server + Vite，并在 `runs/browser_e2e/<timestamp>/` 写出：

- `browser_e2e_report.json`
- `console.log`
- `network.log`
- `screenshots/`
