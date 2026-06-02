# 死代码与孤儿模块

> 本文档记录 ACC 当前架构中属于 "死代码与孤儿模块" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 在 Core v2 迁移与 Phase 2/3 规划过程中遗留了大量"墓碑"模块：要么是无任何 import、无生产调用方的孤儿文件（`binding/resolver.py`、`prompting.py`、`migration/capsule_compat.py`），要么是仅作 `raise AccError` 拒绝路径但仍暴露在 CLI / REST 表面的拒绝桩（`batch.py`、`debugger.py`、`app/binding_runtime.py`）。其中 `binding/resolver.py` 与 `migration/capsule_compat.py` 不仅未被引用，其代码本身也已与当前 schema 漂移脱节，一旦执行即会立即抛出 `AttributeError` / `TypeError` 或被 domain validator 直接拒绝——它们伪装成 "Phase 3 已实现的绑定逻辑" 或 "legacy capsule 迁移入口"，对阅读者构成真实的误导。这类问题虽然不影响正常运行路径，但持续放大代码噪声、削弱模块边界的可信度，并让 CLI/REST surface 暴露明知会失败的命令。

## 详细问题清单

### 1. [CRITICAL] acc/batch.py 是仅会抛异常的死模块，但仍以 CLI 命令对外暴露

**证据**:
- `acc/batch.py` (9-25) — `run_batch()` 在两处 guard 检查后无条件 `raise AccError('Legacy batch-run specs are no longer executable')`，参数全部用 `_ = run_dir, service` (L21) 静默。
- `acc/cli.py` (289-309) — `batch_run_command` 同样以 `_ = spec, run_dir, max_concurrency` (L300) 静默全部参数并立即 raise；`finally` 中以 `_ = emit_conductor_json` (L309) 吞掉副作用。
- `acc/cli.py` (1) — `grep -rn 'from acc.batch' acc/` 无任何结果，`acc.batch` 仅通过 `acc/cli.py` 触达，而后者本身就是直接抛错的死路径。

**为什么是问题**: 死代码以 "可用 CLI 命令" 的形象暴露给用户。任何执行 `acc batch-run` 的调用者都会得到立即错误。模块在包内的存在让人误以为 Core v2 迁移仍未完成清理。

**建议**: 删除 `acc/batch.py`，并从 `acc/cli.py` 移除 `batch_run_command`；或将两者迁入 `legacy/` / `archive/` 目录并辅以弃用说明文档。实施前需要核对 `test_core_v2_capsule_cli_rejection.py` 是否专门覆盖了 `batch-run` 拒绝路径，并相应更新或移除该测试。

**可行性 / 风险**: 安全可删——无任何生产 import；当前既有的"严重度 critical"措辞略偏激进，因为这是 ACCEPTANCE.md 明确登记的迁移边界（intentional rejection），实际并非意外故障，但形态仍属于应删除的拒绝桩。

来源: dead-code-and-orphans / dead-code-and-orphans#0

---

### 2. [CRITICAL] acc/binding/resolver.py 是与当前 schema 漂移的孤儿模块，含两处运行期类型错误

**证据**:
- `acc/binding/resolver.py` (61-62) — 访问 `binding.selector.node_id` 与 `binding.selector.port_id`，但 `OutboxSelector` (selector.py L24-27) 只有 `path: str` 一个字段，运行时立即 `AttributeError`。
- `acc/binding/resolver.py` (88-93) — 以 `kind='aggregate', source_id=..., run_id=..., materialization_mode='inline', inline_value_sha256=...` 构造 `ProvenanceObject`；但 `ProvenanceObject` 的实际字段是 `producer_session_id, bundle_id, binding_applied, call_depth, materialization_mode_resolved, parent_frame_id, invoking_workflow_call_id, inline_value_sha256, source_artifact_sha256`——所有 kwarg 名称错配，且必填字段全部缺失，运行时立即 `TypeError` 并被 `__post_init__` 进一步拒绝。
- `acc/binding/__init__.py` (24-33) — `BindingResolver` 未列入 `__all__`，`resolver.py` 未被任何生产模块 import。
- `acc/binding/resolver.py` (1) — `grep -rn 'from acc.binding.resolver\|BindingResolver' acc/` 仅命中自身定义与 `domain.py` 中的注释，未发现真实调用方。

**为什么是问题**: `resolver.py` 是基于旧 schema 撰写、且未随 `OutboxSelector` 与 `ProvenanceObject` 演进同步更新的代码。两处运行期错误意味着该文件**从未被执行过**；它伪装成 "Phase 3 binding resolution 已实现" 的入口，对搜索绑定解析逻辑的开发者构成强误导。

**建议**: 直接删除 `acc/binding/resolver.py`。若 Phase 3 binding resolution 列入计划，应以当前 `OutboxSelector` (path-only) 与当前 `ProvenanceObject` schema 为基础重写。同时更新 `domain.py:613` 的注释，明确 Phase 3 binding resolver 尚未实现，不应将该注释默认理解为对现有 `BindingResolver` 的引用。

**可行性 / 风险**: 零爆炸半径——无任何 importer，未导出，运行期错误证明从未被执行。

来源: dead-code-and-orphans / dead-code-and-orphans#4

---

### 3. [MAJOR] binding/resolver.py 同时存在 selector schema 与 ProvenanceObject schema 双重漂移

**证据**:
- `acc/binding/resolver.py` (59-62) —
  ```python
  result = self._result_store.get(
      run_id,
      NodeId(binding.selector.node_id),   # AttributeError: OutboxSelector 无 .node_id
      PortId(binding.selector.port_id),   # AttributeError: OutboxSelector 无 .port_id
  )
  ```
- `acc/binding/resolver.py` (88-93) —
  ```python
  provenance = ProvenanceObject(
      kind='aggregate',                       # 非 ProvenanceObject 字段
      source_id=str(node_id),                 # 非 ProvenanceObject 字段
      run_id=str(run_id),                     # 非 ProvenanceObject 字段
      materialization_mode='inline',          # 字段名应为 materialization_mode_resolved
      inline_value_sha256=_hash_json(agent_payload),
  )
  # ProvenanceObject 是 frozen dataclass，必填字段
  # producer_session_id / bundle_id / binding_applied / call_depth / materialization_mode_resolved 全部缺失。
  ```
- `acc/binding/selector.py` (23-27) —
  ```python
  @dataclass(frozen=True)
  class OutboxSelector:
      path: str   # 唯一字段，无 node_id / port_id
  ```

**为什么是问题**: 文件未通过 `acc/binding/__init__.py` 暴露，也无生产 importer。两处运行期访问 (`binding.selector.node_id` 与 `ProvenanceObject` 构造) 都会即时抛错——这意味着代码停留在更早的 schema 版本上，从未被随同迁移。它对外形态像 "已实现的 Phase 3 binding 逻辑"，实则是重复证据点上的同一份死文件。

**建议**: 删除 `acc/binding/resolver.py`。若未来需重启 Phase 3 binding resolution，应基于当前 `OutboxSelector` (仅 `path: str`) 与当前 `ProvenanceObject` schema 从零重写。

**可行性 / 风险**: 零爆炸半径，文件无 importer，立即可删。

来源: redundancy-and-duplication / redundancy-and-duplication#11

---

### 4. [MAJOR] acc/debugger.py 暴露三个永远报错的 CLI 命令（rerun-node / rerun-from / fork）

**证据**:
- `acc/debugger.py` (43-67) — `rerun_single_node` (L43)、`rerun_from_node` (L50)、`fork_run` (L58) 均以 `_ = ...` 静默全部参数后立即 `raise AccError('disabled until it is rebuilt on RunRecord, EventLog, and ResultStore')`。
- `acc/cli.py` (599-658) — 三个 CLI 命令直接挂到这些 raise-only 函数上：`workflow_rerun_node` (L600)、`workflow_rerun_from` (L620)、`workflow_fork` (L640)。

**为什么是问题**: 三个 CLI 命令暴露在用户表面但永远抛错。它们是 Phase 2/3 规划留下的占位实现，长期未清理，污染 CLI surface。

**建议（务必校对覆盖面）**: 移除 `acc/debugger.py` 中的三个 stub 与 `acc/cli.py` 对应的三条命令，但**必须同步处理 `acc/server/routes/debugger.py`**——它直接 `import rerun_single_node, rerun_from_node, fork_run` 并将其挂到三个 POST 路由上。仅删 `debugger.py` + `cli.py` 而不更新 server routes 会导致整个 debugger API router 在启动时 `ImportError` 崩溃。`replay_workflow_events()` 与 `diff_runs()` 是已实现的能力，应保留。

**可行性 / 风险**: 严格而言，原始建议中 "no callers outside these CLI commands" 不准确——server routes 也是消费方。考虑将该问题降为 minor / informational，或重新表述为 "未实现前应从 public CLI/API surface 隐藏的预留 stub"。MIGRATION_NOTES.md 也确认 Phase 10 仅部分完成了这条迁移路径。

来源: dead-code-and-orphans / dead-code-and-orphans#1

---

### 5. [MAJOR] acc/prompting.py 是已实现但完全未接入的 Jinja2 prompt 渲染器

**证据**:
- `acc/prompting.py` (13-56) — `render_prompt()` 与 `render_prompt_text()` 提供 agent prompt 的 Jinja2 模板渲染。
- `acc/prompting.py` (1) — `grep -rn 'from acc.prompting\|import prompting' acc/ --include='*.py'` 无任何结果。

**为什么是问题**: 模块功能完整但无任何生产 / 测试 / examples 调用方。它是脚手架或被搁置的特性，留在仓库里持续承担维护成本却产生零价值。

**建议**: 删除 `acc/prompting.py`。若未来 prompt templating 真有具体使用方，可在那时按当时需求重新引入。同时注意 `domain.py` 中的 `PromptAppendixPolicy` 在删除该文件后亦将变为死代码，可一并审视是否清理。

**可行性 / 风险**: 安全可删——`acc/`、`tests/`、`examples/` 中均无 import，从未进入公开 API surface，无需弃用周期。

来源: dead-code-and-orphans / dead-code-and-orphans#2

---

### 6. [MAJOR] acc/app/binding_runtime.py 含三个仅 raise 的墓碑函数

**证据**:
- `acc/app/binding_runtime.py` (16-33) — `record_node_result_in_store`、`record_workflow_outputs_in_store`、`build_node_input_payload_with_bindings` 三个函数全部无条件 `raise AccError`，宣告 ownership 已迁移至 Core v2 ResultStore / ScopeFrame。

**为什么是问题**: 三个函数是 refactor 后未清理的 sentinel stub。任何调用方都会立即拿到错误。它们是死代码，且对模块边界的当前归属构成误导。

**建议**: 删除三个 stub 函数。若文件中其余符号（实际为 `resolve_core_v2_mode` 与 `resolve_prompt_appendix_policy`，并非原描述中提及的 `allow_network_for_node` / `is_sandbox_policy_compatible`——那两个函数在该文件中并不存在）也无外部调用方，则可整体删除文件。

**可行性 / 风险**: 低风险——`grep` 显示模块外无调用方。删除后 API surface 更清爽。注意：原始建议中提到的两个 "应保留" 的策略函数名称错误，实施时应以文件实际内容为准。

来源: dead-code-and-orphans / dead-code-and-orphans#5

---

### 7. [MINOR] app/binding_runtime.py 是含两个常量的墓碑文件

**证据**:
- `acc/app/binding_runtime.py` (16-29) —
  ```python
  def record_node_result_in_store(*args, **kwargs) -> None:
      raise AccError('Node result recording is owned by Core v2 ResultStore.')
  def record_workflow_outputs_in_store(*args, **kwargs) -> None:
      raise AccError('Workflow output recording is owned by Core v2 ResultStore.')
  def build_node_input_payload_with_bindings(*args, **kwargs) -> dict:
      raise AccError('Node input materialization is owned by Core v2 ScopeFrame.')
  ```
- `acc/app/binding_runtime.py` (7) — `DEFAULT_RESULT_STORE_PORT_ID = 'main'`、`TERMINAL_WORKFLOW_NODE_ID = '__workflow__'`，仅这两项是"活的"。
- 文件还含 `resolve_core_v2_mode`（恒返回 `"core_v2"`）与 `resolve_prompt_appendix_policy`（恒返回 `"task_only"`），两者亦无外部调用方。整文件零 Python importer。

**为什么是问题**: 任何调用方触达三个 stub 都会立即拿到 `AccError`，没有非错误路径。文件仅有的两个常量也已在 `server/run_projection.py` 中复制了一份且取值不同（见 redundancy 类问题）。stub 的存在制造了 "binding_runtime.py 是活模块" 的错误印象。

**建议**: 删除三个 stub 函数。两个常量可考虑迁入 `acc/result_store/types.py` 或 `acc/domain.py` 作为单一规范源；但需注意 `server/run_projection.py` 出于架构边界刻意避开 `acc.app`，其本地副本可能仍需保留。最直接的修复是整文件删除。`_preferred_port_id()` 已通过 `"default"` / `"main"` 双 fallback 在一定程度上缓解了取值差异。

**可行性 / 风险**: 低风险。整体为孤儿文件，删除前确认无外部调用即可。

来源: redundancy-and-duplication / redundancy-and-duplication#12

---

### 8. [MINOR] capsule_compat.py 双重死代码：无调用方，且产出会被 domain validator 立即拒绝

**证据**:
- `acc/migration/capsule_compat.py` (1-103) — 定义 `capsule_spec_to_callable_ref` 与 `capsule_spec_to_class_template`，对全 `acc/` 进行 grep 无任何外部 import。
- `acc/migration/capsule_compat.py` (43-44, 53-55, 65-69, 77-79) — 向 `AgentClassTemplate` / `WorkflowFunctionTemplate` 写入 `metadata={"legacy_capsule_kind": kind, "legacy_runtime": ...}` 等 `legacy_*` 前缀键。
- `acc/domain.py` (1108-1113) — `_reject_executable_metadata`：`if key.startswith('legacy_'): raise AccError(...)`，意味着 `capsule_compat` 一旦被调用，其产出会被 validator 直接拒绝。

**为什么是问题**: 模块属于双重死亡：既无调用方，又即便被调用，产出的模板因 `legacy_*` 元数据键会即时被 validator 拒绝。它不是单纯 "无人导入"，而是连结构上都无法工作的墓碑。保留它会让阅读者误以为 legacy capsule 格式仍是当前的迁移输入。

**建议**: 删除 `acc/migration/capsule_compat.py`。若未来需要恢复 CapsuleSpec 支持，可从 git history 重新引入。

**可行性 / 风险**: 零爆炸半径——零生产 import；docs 中的引用（ACCEPTANCE.md、需求与进度记录）属于历史上下文文档而非活代码，删除文件不会破坏运行时。

来源: compat-and-legacy-scars / compat-and-legacy-scars#7

---

## 整体建议

**清理优先级建议**：

1. **第一批（零爆炸半径，可立即删除）**：`acc/binding/resolver.py`（条目 2 + 3 同一文件）、`acc/migration/capsule_compat.py`（条目 8）、`acc/prompting.py`（条目 5）。三者均无任何生产 importer，运行期不会被触达，删除不需要联动改动。`prompting.py` 删除时可顺带清理 `domain.py` 中的 `PromptAppendixPolicy`。

2. **第二批（需联动 CLI / REST 表面）**：`acc/batch.py`（条目 1）、`acc/debugger.py` 中的三个 rerun/fork stub（条目 4）。这两类不仅要删模块本身，还要同步移除 `acc/cli.py` 的命令注册；尤其 `debugger.py` 必须同时更新 `acc/server/routes/debugger.py`，否则会触发启动期 `ImportError`。建议把这一批与现有 `test_core_v2_capsule_cli_rejection.py` 等拒绝路径测试一起审视，以决定是删除还是保留拒绝路径的回归测试。

3. **第三批（涉及常量归位的小重构）**：`acc/app/binding_runtime.py`（条目 6 + 7 同一文件）。最简方案是整体删除文件；若需保留 `DEFAULT_RESULT_STORE_PORT_ID` / `TERMINAL_WORKFLOW_NODE_ID`，应先在 `acc/result_store/types.py` 或 `acc/domain.py` 中确立单一规范源，再处理 `server/run_projection.py` 中的副本（注意其刻意避免依赖 `acc.app` 的架构边界约束）。

**可批量解决的共性**：所有"raise-only stub"模式（条目 1、4、6/7）共享同一形态——参数 `_ = ...` 静默 + 立即 `raise AccError(...)`。可以用一个简单的 grep 模板统一审计是否还有遗漏的 tombstone：`grep -rn "raise AccError" acc/` 配合 "_ = " 静默模式扫描。所有"schema 漂移孤儿"模式（条目 2、3、8）则共享 "文件存在 + 无 import + 与当前 schema 不一致" 的特征，通过 import graph 静态分析（找出零入度节点）即可一次性识别并安排批量删除。

清理本类问题不会影响任何运行路径，但能显著降低代码噪声、消除 CLI/REST surface 上的"假命令"，并消除阅读者因看到 `BindingResolver` / `capsule_spec_to_class_template` 等符号而对系统能力产生的错误预期。
