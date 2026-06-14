# Phase 1 - Backend Schema Port Projection

## 目标

新增一个纯 backend projection 层，把 agent `output_schema` 稳定投影成 output ports。Phase 1 只建立共同事实来源，不改 UI 交互，不改 runtime 状态机。

## 约束

- 新 helper 必须是纯函数层：无 IO、无 subprocess、无 server 依赖。
- `output_schema` 是 agent output ports 的 source of truth。
- `PortContract` 只服务 runtime / validation 的契约判断。
- UI 需要的 `description`、`json_path`、schema type、projection diagnostics 不应硬塞进 `PortContract` 后被序列化丢失。

## 修改范围

建议新增：

```text
acc/engine/schema_ports.py
tests/unit/test_schema_driven_ports.py
```

可少量修改：

```text
acc/engine/workflow_validation.py
acc/runtime/node_payload.py
```

Phase 1 的修改应尽量只接入 helper 或测试 helper，不全面替换 runtime/validation 行为；全面替换放在 Phase 2。

## Projection Contract

建议定义两层 API：

```python
@dataclass(frozen=True)
class OutputPortProjection:
    port_id: str
    required: bool
    type: str
    cardinality: str
    json_path: str
    description: str | None = None
    title: str | None = None
    schema_type: str | None = None
    projected: bool = True
    deprecated: bool = False
    diagnostic: str | None = None

def project_output_port_metadata(
    schema: dict[str, Any] | None,
    *,
    include_main: bool = True,
) -> dict[str, OutputPortProjection]:
    ...

def effective_output_ports(
    node: NodeInvocationSpec,
) -> dict[str, PortContract]:
    ...

def schema_declares_output_port(
    schema: dict[str, Any] | None,
    port_id: str,
) -> bool:
    ...
```

语义：

- `project_output_port_metadata()` 给 API/UI/diagnostics 使用。
- `effective_output_ports()` 给 validator/runtime 使用。
- `schema_declares_output_port()` 给 legacy compatibility 和 validation 使用。

## 投影规则

### Supported

- `main` 永远存在，`json_path = /`，表示完整 `output.json`。
- 只从 `output_schema.properties.outputs.properties.<field>` 生成非 `main` output ports。
- `required` 来自 `output_schema.properties.outputs.required`。
- `description`、`title`、`deprecated` 作为 projection metadata。
- nested object 作为一个一级 port，不递归展开。
- array 作为一个一级 port；`cardinality` 可粗略映射为 `many`，但不改变 runtime 聚合语义。

### Tolerated With Diagnostics

- `$ref` / `$defs`
- `anyOf` / `oneOf` / `allOf`
- `additionalProperties`

P0 不解析复杂 schema。遇到不可安全投影的结构时不应 crash；应返回 `main` 和 diagnostics，或者只投影 explicit `properties`。

### Not Projected By Default

- 动态 key。
- 深层 JSON path，例如 `/outputs/report/executive_summary`。
- legacy top-level `properties.<field>`。

legacy top-level 可以由 `schema_declares_output_port()` 识别以保持旧 workflow 通过，但新 UI 不默认把它们渲染成可拖拽业务端口。

## Effective Output Ports 规则

```text
if node has projectable output_schema.outputs.properties:
  main + schema-derived ports
elif node.output_ports exists:
  legacy node.output_ports, plus main if missing
else:
  main
```

注意：

- `default` 仅作为 legacy alias，不建议 UI 默认展示成新 port。
- `main` 不绑定 `/outputs/main`。
- schema projection 与 legacy `output_ports` 冲突时，schema 胜出。

## 状态机健壮性

这个阶段不能引入新状态。Broken/stale port 不是 runtime state，而是由当前 template + schema + edge 派生出来的 validation/projection result。

保存和运行路径后续必须遵守：

```text
output_schema = truth
output_ports = compatibility snapshot
data_edges = user intent, never silently deleted
```

## 测试

新增测试至少覆盖：

1. `outputs.properties` 生成 `main + fields`。
2. `required` 正确映射。
3. nested object / array 只生成一级 port。
4. `$ref` / composition / dynamic keys 不 crash。
5. legacy top-level 能被 `schema_declares_output_port()` 识别，但不默认投影成 UI ports。
6. stale manual `output_ports` 不覆盖 schema projection。
7. projection metadata 包含 `description`、`required`、`type`、`json_path`。

推荐命令：

```bash
uv run pytest -q tests/unit/test_schema_driven_ports.py
uv run pytest -q tests/unit/test_core_v2_output_schema_and_ports.py
```

## 完成标准

- 后端有唯一 schema projection helper。
- runtime/validation 后续可以统一依赖 `effective_output_ports()`。
- `PortContract` 和 UI projection metadata 的职责分离清楚。
- 无新增 IO、server、UI 或状态机依赖。
