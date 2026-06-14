# Schema-Driven Ports 用户向导

## 目标

让用户在 Workbench 里通过 `output_schema` 定义 Agent 的命名输出端口，并用可视化拖拽把上游字段精确传给下游节点。

## 定义输出端口

业务输出端口只从这个位置生成：

```json
{
  "type": "object",
  "properties": {
    "outputs": {
      "type": "object",
      "properties": {
        "alpha_signal": {
          "type": "string",
          "description": "给下游使用的核心信号"
        }
      },
      "required": ["alpha_signal"],
      "additionalProperties": false
    }
  },
  "required": ["outputs"],
  "additionalProperties": false
}
```

规则：

- `outputs.properties` 下每个第一层字段会投影成一个 output data port。
- `description` 会进入端口 hover tooltip，用来告诉用户这个端口是什么。
- `main` 保留为完整输出，不作为业务字段端口使用。
- Workflow container 的对外输出必须通过 boundary / `workflow_output_bindings` 显式暴露，内部 Agent schema 不会自动泄漏到父图。

## 拖数据线

1. 切到画布工具栏的 `数据` 模式。
2. 从上游节点右侧的 schema output port 拖线。
3. 释放到下游节点 body。
4. Workbench 会自动创建同名 input port、创建 data edge，并补一条 control dependency。

如果释放到不合法位置，Workbench 会显示失败原因；如果目标 input port 已有单值 data edge，需要删除旧 edge 或换一个 input port。

## 控制线和数据线

- `control edge` 决定运行顺序。
- `data edge` 决定精确字段传递。
- 节点设置里的 `控制线传递完整输出` 开启时，只连控制线也会把上游完整 `main` output 传给下游 `main` input。
- 如果只想传某个字段，关闭上游节点的 `控制线传递完整输出`，再用 data edge 连接具体 output port。

运行后可在下游节点的 `输入` / `运行证据` 面板查看真实 `input.json`：

- 出现 `binding_kind: data_edge` 表示来自显式数据线。
- 出现 `binding_kind: control_main_default` 表示来自控制线默认完整输出传递。

## 修复 Broken Edge

当上游 `output_schema` 字段改名时，旧 data edge 不会被自动删除；它会显示为 broken edge。

推荐修复方式：

1. 切到 `数据` 模式。
2. 选中 broken edge 并删除。
3. 从新的 schema output port 重新拖到下游节点。
4. 重新保存 / 校验 / 运行。

这个设计避免 Workbench 静默删除用户已有连接，也能让 schema 迁移过程可见、可解释、可回滚。

## 验收标准

- output port tooltip 能看到 description、type、required、json path。
- 保存并刷新后，`output_schema`、data edge、target input port 都保留。
- 关闭 full-output forwarding 后，下游 `input.json` 只包含显式 data edge 传入字段。
- schema 字段改名后，旧 edge 显示 broken，用户可以删除并重新连接。
