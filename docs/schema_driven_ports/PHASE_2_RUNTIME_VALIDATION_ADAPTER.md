# Phase 2 - Runtime, Validation, And Workbench Adapter

## 目标

让 backend 真正使用 schema-derived effective output ports。完成后，即使 agent node 没有手写 `output_ports`，只要 `output_schema.properties.outputs.properties` 声明了字段，data edge 和 workflow output binding 就可以引用这些字段。

## 约束

- 不改 `DataEdge` model。
- 不新增 `json_path` 到 `DataEdge`。
- 不新增 runtime 状态机。
- 显式 data edge 默认 required：source port 存在但 runtime output 缺值，应导致 node failure，而不是静默传 `null`。
- Broken/stale edge 是 validation/projection result，不是 runtime durable state。

## 修改范围

重点文件：

```text
acc/runtime/node_payload.py
acc/engine/workflow_validation.py
acc/app/workbench_adapter.py
acc/app/workflow_normalization.py
tests/unit/test_core_v2_output_schema_and_ports.py
tests/unit/test_workbench_adapter.py
tests/unit/test_workflow_normalization.py
```

## 方案

### 1. Runtime 使用 effective output ports

`acc/runtime/node_payload.py` 中的 `output_port_ids()` 应使用 Phase 1 helper。

推荐优先级：

```text
workflow_call_output_bindings 特例处理 workflow node outputs
output_bindings 如果是明确 exposure contract，则优先
agent/tool effective outputs:
  main + schema-derived outputs if output_schema.outputs.properties exists
  else legacy node.output_ports
  else main
```

注意：

- `output_bindings` 不应无意屏蔽 schema-derived ports，除非它本身就是明确的 output exposure contract。
- `output_value_for_port()` 可保持现有规则：
  - `main` / `default` 返回完整 output。
  - 非 `main` 优先取 `output["outputs"][port]`。
  - fallback legacy top-level `output[port]`。

### 2. Validation 使用 effective output ports

`acc/engine/workflow_validation.py` 中必须替换直接读 `node.output_ports` 的关键路径：

- data edge source port 校验。
- workflow output binding source port 校验。
- `_collect_output_schema_port_issues()`。
- `_resolve_output_port_type()`。
- required input / unbound input 判断中涉及 control-main default forwarding 的部分。

失败策略：

| 场景 | 结果 |
| --- | --- |
| data edge source port 不在 effective output ports | `dangling_data_edge_source` |
| data edge target port 不在 target input ports | `dangling_data_edge_target` |
| required input 没有 static/workflow/data/control-main 来源 | `unbound_input_port` |
| runtime output 缺少显式 data edge source value | node failed + FailureRecord |
| output.json 不符合 output_schema | node failed + schema validation error |

### 3. Workbench adapter canonicalization

`acc/app/workbench_adapter.py` 保存或运行 Workbench draft 时：

- agent node 有可投影 `output_schema`：
  - 重新生成 `ports.outputs` snapshot。
  - 保留 `main`。
  - 不让旧 `output_ports` 覆盖 schema projection。
- agent node 没有可投影 schema：
  - fallback legacy `output_ports`。
- input ports 不从 schema 生成，继续保存用户连接生成的 input ports。
- workflow container output ports 不从内部 agent schema 泄漏。

### 4. Workflow normalization

`acc/app/workflow_normalization.py` snapshot callable registry 时：

- agent template 有 output schema：优先从 schema 投影 `ports.outputs`。
- agent template 没有 output schema 但有 legacy ports：继续 snapshot legacy ports。
- schema 和 legacy ports 冲突时：schema 胜出，diagnostic/warning 可由 validation 层报告。

## 关键数据流 / 调用链

```text
NodeInvocationSpec.output_schema
  -> effective_output_ports(node)
  -> validation accepts DataEdge source port
  -> runtime materializes source port value
  -> resolve_node_payload() writes target input key
```

## 必测用例

1. `Node A` 只有 `output_schema.outputs.valuation_conclusion`，没有 `output_ports`。
   - `DataEdge A.valuation_conclusion -> B.valuation_conclusion` validate 通过。
   - runtime 能把 `output.outputs.valuation_conclusion` 写进 B payload。

2. schema 将 `valuation_conclusion` 改名为 `valuation_view`。
   - 旧 edge 保留在文件中。
   - validate 返回 `dangling_data_edge_source`。

3. workflow output binding 引用 schema-derived port。
   - validate 通过。
   - workflow output 正确生成。

4. source node `forward_main_output_on_control=false`。
   - control-only 不满足下游 required `main` input。
   - 有显式 data edge 时可满足对应 target input。

5. control-only 默认 full forwarding。
   - 下游 required `main` input 可由 `control_main_default` 满足。

推荐命令：

```bash
uv run pytest -q tests/unit/test_schema_driven_ports.py
uv run pytest -q tests/unit/test_core_v2_output_schema_and_ports.py
uv run pytest -q tests/unit/test_workbench_adapter.py
uv run pytest -q tests/unit/test_workflow_normalization.py
```

## 完成标准

- Runtime、validation、adapter、normalization 都通过同一 effective ports 语义工作。
- 不需要前端手写 `output_ports`，schema-derived ports 也能保存、validate、运行。
- schema 删除字段后不静默删除 edge，而是明确报错。
- 旧无 schema workflow 仍兼容。
