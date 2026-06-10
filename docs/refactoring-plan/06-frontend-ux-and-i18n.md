# 前端 UX 修复、i18n 系统化与 CSS 模块化

## 现状分析

### 涉及文件及行数

| 文件 | 行数 | 问题类型 |
|------|------|---------|
| `web/src/components/InteractionPanel.tsx` | 117 | ask/suggest 类型无文本输入框 |
| `web/src/components/ArtifactViewer.tsx` | 359 | 硬编码取首节点，dead code（briefValue 中重复判断） |
| `web/src/components/CallableBrowser.tsx` | 701 | deleteDraft 无确认对话框 |
| `web/src/components/DecisionInboxPanel.tsx` | 205 | 暴露原始 UUID / node_id |
| `web/src/components/ControlPlanePanel.tsx` | 151 | 开发者工具在生产 UI 中始终可见 |
| `web/src/components/RunInspector.tsx` | 271 | 暴露原始文件路径，size_bytes 未格式化 |
| `web/src/components/workflow-viewer/WorkflowEvidenceDock.tsx` | 191 | open 时显示 ChevronDown（应为 ChevronUp），逻辑反转 |
| `web/src/format.ts` | 30 | 缺少 formatTimestamp、formatBytes、formatDuration（已有但需扩展）|
| `web/src/i18n/zh-CN.ts` | 62 | 覆盖率低，大量组件仍有硬编码中文字符串 |
| `web/src/styles.css` | 6574 | 单体全局样式文件，无 CSS Modules 隔离 |

### 当前问题

1. **InteractionPanel**：`kind === 'ask'` 和 `kind === 'suggest'` 渲染无输入控件，用户无法提交文本回答，交互卡住。
2. **ArtifactViewer**：`firstNode = run?.nodes[0]` 硬编码取首节点，多节点运行无法切换；`briefValue` 函数中对 `null/undefined` 和 `Array` 的判断重复出现（dead code，lines 333-346 与 318-322 逻辑重复）。
3. **CallableBrowser**：`deleteDraft()` 直接调用 `api.deleteAgentCallable`，无二次确认；智能体删除为不可逆操作。
4. **DecisionInboxPanel**：详情区直接渲染 `item.run?.run_id`、`item.node?.node_id`、`graphopsId`（UUID 格式），对技术用户以外的人不友好；severity 标签直接用英文 `high/medium/low`。
5. **ControlPlanePanel**：包含"运行示例工作流"、"检查当前运行"、dry-run patch 等开发者工具，始终在导航栏可见，缺少 `?dev=true` 开关。
6. **RunInspector**：`NodeDetail` 的 path-grid 按钮展示 `shortPath(item.path)`（仍含 `runs/` 相对路径），产物列表显示 `{artifact.size_bytes} bytes`（原始数字），均不友好。
7. **WorkflowEvidenceDock**：底栏折叠图标逻辑反转——`state.open` 为 `true` 时渲染 `<ChevronDown>`，应渲染 `<ChevronUp>`（展开时显示"收起"箭头）。
8. **format.ts**：缺少 `formatTimestamp(iso: string): string` 和 `formatBytes(bytes: number): string`；`formatDuration` 已存在但无毫秒/分钟/小时分级。
9. **i18n**：`zh-CN.ts` 仅有 62 行 / 约 40 个 key，大量文案在组件内硬编码（见下方逐组件枚举）。
10. **CSS**：`styles.css` 达 6574 行，所有选择器全局共享，无模块隔离，重构时极易引入意外样式覆盖。

---

## 重构目标

### 目标架构

```
web/src/
├── format.ts                        # formatTimestamp / formatBytes / formatDuration 补全
├── i18n/
│   └── zh-CN.ts                     # 完整 key 结构，覆盖所有组件
├── components/
│   ├── InteractionPanel.module.css  # CSS Modules 示范
│   ├── InteractionPanel.tsx         # ask/suggest 文本输入
│   ├── ArtifactViewer.tsx           # 节点选择器 + dead code 清除
│   ├── CallableBrowser.tsx          # 删除确认对话框
│   ├── DecisionInboxPanel.tsx       # 友好标签替换 UUID
│   ├── ControlPlanePanel.tsx        # ?dev=true 开关
│   ├── RunInspector.tsx             # 隐藏路径 + formatBytes
│   └── workflow-viewer/
│       └── WorkflowEvidenceDock.tsx # chevron 修正
└── styles.css                       # 逐步迁移，保留全局 reset/token
```

### 关键设计决策

- **i18n key 命名规范**：采用 `组件名.子区域.描述` 三段式，如 `interactionPanel.submit`、`callableBrowser.deleteConfirm.title`。
- **CSS Modules 迁移策略**：渐进式——先为本次涉及的 8 个组件各建 `.module.css`，提取组件私有选择器；`styles.css` 保留全局 token（CSS 变量）和 reset，不一次性全量迁移。
- **ControlPlanePanel 开关**：读取 `window.location.search` 中的 `dev=true`，无 React Context 依赖，不影响其他路由。
- **删除确认**：内联实现轻量 `ConfirmDialog` 组件（不引入新依赖），复用现有 CSS 变量。
- **ArtifactViewer 节点选择器**：新增 `selectedNodeId` state，渲染节点 tab strip；首次加载默认选首节点，保持向后兼容。
- **路径展示**：RunInspector 的 path-button 仅渲染文件名（`path.split('/').at(-1)`），完整路径放 `title` attribute 供 hover 查看（已有此逻辑但 shortPath 仍返回 `runs/…`）。

---

## 详细实施步骤

### 步骤 1：修复 format.ts — 补全 formatters

**具体操作：**
- 新增 `formatTimestamp(iso: string): string`：使用 `Intl.DateTimeFormat` 输出本地化时间，格式 `YYYY-MM-DD HH:mm:ss`
- 新增 `formatBytes(bytes: number): string`：分级显示 B / KB / MB / GB，保留 1 位小数
- 扩展 `formatDuration`：补充分钟、小时分级（当前仅到秒）

**涉及文件：**
- 修改：`web/src/format.ts`

**预期结果：**
- `formatBytes(1536)` → `"1.5 KB"`
- `formatTimestamp("2026-06-11T08:30:00Z")` → `"2026-06-11 08:30:00"`
- `formatDuration(65000)` → `"1 m 5 s"`

---

### 步骤 2：修复 WorkflowEvidenceDock 的倒置 chevron

**具体操作：**
- 将 `WorkflowEvidenceDock.tsx` 第 54 行条件表达式从
  `{state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}`
  改为
  `{state.open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}`

**涉及文件：**
- 修改：`web/src/components/workflow-viewer/WorkflowEvidenceDock.tsx`

**预期结果：**
- dock 折叠时显示向下箭头（提示"可展开"），展开时显示向上箭头（提示"可收起"），符合通用 UX 惯例。

---

### 步骤 3：修复 InteractionPanel — ask/suggest 文本输入

**具体操作：**
- 在组件内新增 `answers` state：`Record<string, string>`，key 为 `interaction_id`
- 为 `kind === 'ask'` 和 `kind === 'suggest'` 渲染 `<textarea>` + 提交按钮
  - `ask`：提交 `{ answer: text }`
  - `suggest`：提交 `{ suggestion: text }`
- ARIA：`<textarea>` 需绑定 `aria-label`，提交按钮 `aria-describedby` 指向问题文本

**涉及文件：**
- 修改：`web/src/components/InteractionPanel.tsx`
- 新建：`web/src/components/InteractionPanel.module.css`（提取 `.interaction-panel`、`.interaction-card`、`.interaction-actions` 选择器）

**预期结果：**
- 用户对 `ask` / `suggest` 类型的交互请求可输入文本并提交
- 不影响 `approval` / `confirm` 的现有按钮逻辑

---

### 步骤 4：修复 ArtifactViewer — 节点选择器 + dead code

**具体操作：**

**4a 节点选择器：**
- 将 `firstNode` 改为受控 state `selectedNodeId`
- 渲染节点 tab strip（仅当 `run.nodes.length > 1` 时显示）：
  ```
  [节点 1] [节点 2] ... [节点 N]
  ```
- 切换节点时清空 `content` 并重新加载 artifacts

**4b dead code 清除：**
- `briefValue` 函数中 lines 333-346 是对 `null/undefined`、`Array`、`object` 的重复判断，已在 lines 318-327 处理过——删除重复分支，保留首次处理路径

**涉及文件：**
- 修改：`web/src/components/ArtifactViewer.tsx`

**预期结果：**
- 多节点运行时可切换节点查看各节点产物
- briefValue 函数去除死代码，无功能变化

---

### 步骤 5：CallableBrowser — 删除确认对话框

**具体操作：**
- 新建内联组件 `ConfirmDialog`（props: `message`, `onConfirm`, `onCancel`）
- 在 `AgentClassEditor` 内新增 `pendingDelete` boolean state
- 点击"删除"按钮时：将 `pendingDelete` 置 true，渲染 `ConfirmDialog`
- ConfirmDialog 样式复用 `agent-editor-backdrop` / `agent-editor-dialog` CSS 类
- 确认后调用 `onDelete()`，取消则关闭

**ARIA 要求：**
- `ConfirmDialog` 根元素添加 `role="alertdialog"` + `aria-modal="true"` + `aria-labelledby`
- 对话框打开时 focus 移至确认按钮（`useEffect` + `ref.focus()`）
- ESC 键关闭（`onKeyDown`）

**涉及文件：**
- 修改：`web/src/components/CallableBrowser.tsx`
- 新建：`web/src/components/ConfirmDialog.tsx`（可跨组件复用）
- 新建：`web/src/components/ConfirmDialog.module.css`

**预期结果：**
- 点击"删除"时弹出确认对话框，显示被删除的智能体名称
- 确认后执行删除；取消则对话框关闭，无任何副作用

---

### 步骤 6：DecisionInboxPanel — 友好化标签

**具体操作：**
- `item.run?.run_id`：截取后 8 位 + 前缀"运行 #"（例：`运行 #a3f2c1d8`）
- `item.node?.node_id`：直接显示（node_id 通常是语义化名称如 `research_agent`，非 UUID）；若为 UUID 格式则截取后 8 位
- `graphopsId`（`proposal_id` / `patch_id`）：前缀"提案 #" + 后 8 位
- severity 英文标签映射为中文：`high` → `高`, `medium` → `中`, `low` → `低`
- 计数区的英文 key（`Open`, `Failed`, `GraphOps`）替换为 i18n 翻译

**涉及文件：**
- 修改：`web/src/components/DecisionInboxPanel.tsx`
- 修改：`web/src/i18n/zh-CN.ts`（新增 `decisionInbox.*` keys）

**预期结果：**
- 详情区所有 UUID 均以缩短友好格式呈现
- 严重等级显示中文

---

### 步骤 7：ControlPlanePanel — 移至 ?dev=true

**具体操作：**
- 在 `ControlPlanePanel` 内顶部添加：
  ```typescript
  const isDev = new URLSearchParams(window.location.search).has('dev');
  if (!isDev) return null;
  ```
- 导航栏（`App.tsx` 或父组件）中"控制平面"选项卡同样需要 `isDev` 判断以隐藏入口
- 在 `README` 或开发文档中注明访问方式：`?dev=true`

**涉及文件：**
- 修改：`web/src/components/ControlPlanePanel.tsx`
- 修改：`web/src/App.tsx`（或导航组件，待确认确切文件）

**预期结果：**
- 普通访问不显示控制平面选项卡
- `localhost:PORT?dev=true` 时恢复可见，功能不变

---

### 步骤 8：RunInspector — 隐藏路径 + 格式化字节数

**具体操作：**
- `path-button` 的 `<small>` 区：将 `shortPath(item.path)` 替换为仅显示文件名
  ```typescript
  item.path?.split('/').at(-1) ?? 'n/a'
  ```
  完整路径保留在 `title` attribute（已有）供 hover 查看
- 产物列表的字节数：将 `{artifact.size_bytes} bytes` 替换为 `{formatBytes(artifact.size_bytes)}`
- 导入 `formatBytes` 自 `../format`

**涉及文件：**
- 修改：`web/src/components/RunInspector.tsx`

**预期结果：**
- path-button 显示 `output.json`（而非 `runs/ui_run_xxx/nodes/agent/output.json`）
- 产物大小显示 `12.3 KB`（而非 `12594 bytes`）

---

### 步骤 9：i18n 系统化 — 完整 zh-CN key 结构

**具体操作：**

将 `zh-CN.ts` 扩展为分区结构（保持向后兼容，仅追加 key）：

```typescript
// 新增 key 区域（按组件分组）
export const zhCN = {
  // ——— 已有 key（保留不变） ———
  appTitle: ..., // ...existing keys

  // ——— 新增：InteractionPanel ———
  interactionPanel: {
    pending: '待处理',
    pendingCount: (n: number) => `${n} 项待回复`,
    noPending: '暂无待处理交互',
    runLevel: '运行级',
    submitAnswer: '提交',
    answerPlaceholder: '输入回答...',
    suggestionPlaceholder: '输入建议...',
    kinds: {
      approval: '审批',
      ask: '追问',
      confirm: '确认',
      suggest: '建议',
    },
    actions: {
      approve: '通过',
      reject: '拒绝',
      confirm: '确认',
      cancel: '取消',
    },
  },

  // ——— 新增：ArtifactViewer ———
  artifactViewer: {
    title: '产物查看器',
    noRun: '未选择运行',
    noNode: '无节点',
    noArtifacts: '暂无可用产物',
    selectArtifact: '选择一个产物查看 Markdown、JSON、文本、日志或 Patch',
    nodeSelector: '选择节点',
    tabs: {
      readable: '可读视图',
      raw: '原始数据',
    },
    jsonSummary: {
      title: '摘要',
      conclusion: '结论',
      status: '状态',
      confidence: '置信度',
      findings: '发现',
      nextActions: '下一步',
      namedOutputs: '命名输出',
      moreFields: (n: number) => `还有 ${n} 个字段在原始数据中`,
    },
    log: {
      title: '日志预览',
      truncated: (n: number) => `日志较长，仅展示最后 ${n} 行`,
    },
    patch: {
      additions: '新增行',
      deletions: '删除行',
      total: '总行数',
    },
    types: {
      markdown: 'Markdown',
      json: 'JSON',
      log: '日志',
      patch: 'Patch',
      text: '文本',
    },
  },

  // ——— 新增：CallableBrowser ———
  callableBrowser: {
    title: '智能体工具资源库',
    subtitle: (n: number) => `${n} 个可复用智能体与工具`,
    localResources: '本地资源',
    createAgent: '新建智能体',
    loadFailed: '资源加载失败',
    selectResource: '选择一个资源',
    selectResourceHint: '查看智能体的默认提示词、模型偏好和固定 skills',
    noResources: '还没有智能体资源',
    noResourcesHint: '创建一个智能体后，它会出现在这里',
    kinds: {
      agent_class: '智能体',
      tool_class: '工具',
      default: '资源',
    },
    detail: {
      agent: '使用的 Agent',
      model: '模型',
      thinkingLevel: '思考强度',
      systemPrompt: '系统提示词',
      noPrompt: '未填写系统提示词',
      pinnedSkills: '固定 Skills',
      noSkills: '未固定 skills',
      noDescription: '未填写描述',
      editAgent: '编辑智能体',
    },
    editor: {
      createTitle: '创建智能体',
      editTitle: '编辑智能体',
      subtitle: '为工作区创建一个新的 AI 智能体',
      close: '关闭',
      namePlaceholder: '例如：深度研究智能体',
      descriptionPlaceholder: '这个智能体做什么？',
      promptPlaceholder: '写下这个智能体默认遵守的方法、边界和输出风格',
      skillInputPlaceholder: '输入 skill 名称',
      addSkill: '添加',
      save: '保存',
      create: '创建',
      cancel: '取消',
      delete: '删除',
    },
    deleteConfirm: {
      title: '确认删除',
      message: (name: string) => `确定要删除智能体「${name}」吗？此操作不可撤销。`,
      confirm: '确认删除',
      cancel: '取消',
    },
  },

  // ——— 新增：DecisionInboxPanel ———
  decisionInbox: {
    title: '决策收件箱',
    subtitle: '聚合运行失败、人工确认和 GraphOps 提案',
    loadError: 'Decision Inbox 错误',
    loading: '正在加载决策事项...',
    empty: '暂无需要处理的决策事项',
    counts: {
      open: '待处理',
      failed: '失败',
      graphops: 'GraphOps',
    },
    detail: {
      status: '状态',
      run: '运行',
      node: '节点',
      graphops: 'GraphOps',
      evidence: '证据',
    },
    severity: {
      high: '高',
      medium: '中',
      low: '低',
    },
    runPrefix: '运行 #',
    proposalPrefix: '提案 #',
  },

  // ——— 新增：RunInspector ———
  runInspector: {
    title: '运行检查器',
    noRun: '未选择运行',
    selectRun: '选择一个运行来检查它的 Session 和 Artifact Bundle',
    runError: '运行错误',
    nodeList: '运行节点列表',
    session: 'Session',
    duration: '耗时',
    summary: '摘要',
    artifacts: '产物',
    noArtifacts: '暂无可见产物',
    selectPath: '选择输入、输出、日志、事件或产物',
    paths: {
      input: '输入',
      prompt: 'Prompt',
      output: '输出',
      events: 'Events',
      stdout: 'Stdout',
      stderr: 'Stderr',
    },
    debugger: {
      title: '调试',
      replay: '事件回放',
    },
  },

  // ——— 新增：ControlPlanePanel ———
  controlPlane: {
    title: '控制平面',
    subtitle: '开发者工具：工作流、运行、产物与 GraphOps 操作',
    workflowSection: '工作流与运行',
    runSampleWorkflow: '运行示例工作流',
    inspectCurrentRun: '检查当前运行',
    readCurrentArtifact: '读取当前产物',
    samplePatch: '示例 patch',
    validatePatch: '校验 patch',
    dryRunPatch: 'dry-run patch',
  },

  // ——— 新增：EvidenceDock ———
  evidenceDock: {
    notRun: '未运行',
    currentEvidence: '当前证据',
    noEvidence: '暂无打开的证据',
    recentEvents: '最近事件',
    noEvents: '暂无事件',
    failureNode: '失败节点',
    failureReason: '原因',
    failureEvidence: '证据',
    statuses: {
      success: '成功',
      failed: '失败',
      timeout: '超时',
      schema_error: 'Schema 错误',
      artifact_error: '产物错误',
      running: '运行中',
      scheduled: '已调度',
      manual_review: '等待人工确认',
      not_run: '未运行',
    },
  },
};
```

**涉及文件：**
- 修改：`web/src/i18n/zh-CN.ts`（完整替换为上述结构）

**预期结果：**
- 所有组件的硬编码中文字符串统一通过 i18n key 引用
- `ZhKey` 类型自动更新覆盖新 key

---

### 步骤 10：CSS Modules 迁移（渐进式）

**具体操作：**

**10a 建立迁移规范：**
- 全局 `styles.css` 保留：CSS 变量（`--color-*`, `--radius-*`）、reset、`.panel`/`.pill`/`.notice` 等全局 utility
- 各组件私有选择器迁移至同名 `.module.css`

**10b 本次迁移范围（仅本次涉及的组件）：**

| 新建 CSS Module 文件 | 从 styles.css 迁移的选择器前缀 |
|---------------------|-------------------------------|
| `InteractionPanel.module.css` | `.interaction-panel`, `.interaction-card`, `.interaction-card-head`, `.interaction-actions` |
| `ArtifactViewer.module.css` | `.artifact-viewer`, `.artifact-layout`, `.artifact-list`, `.readable-artifact`, `.artifact-row`, `.json-summary`, `.log-preview`, `.patch-preview`, `.readable-document` |
| `CallableBrowser.module.css` | `.callable-browser`, `.callable-hero`, `.resource-library-layout`, `.resource-list-panel`, `.resource-list-item`, `.resource-detail-panel`, `.resource-detail-*`, `.agent-editor-*` |
| `DecisionInboxPanel.module.css` | `.decision-inbox`, `.decision-layout`, `.decision-list`, `.decision-item`, `.decision-detail`, `.decision-actions` |
| `RunInspector.module.css` | `.inspector`, `.inspector-grid`, `.dag-list`, `.node`, `.node-detail`, `.node-index`, `.path-grid`, `.path-button`, `.debugger-panel`, `.debugger-actions` |
| `ConfirmDialog.module.css` | 新增（不迁移，全新编写） |
| `WorkflowEvidenceDock.module.css` | `.evidence-dock`, `.evidence-dock-toggle`, `.evidence-dock-body`, `.evidence-dock-status`, `.evidence-dock-message`, `.evidence-artifact-pane`, `.failure-summary-card`, `.event-timeline`, `.event-row` |

**10c 迁移步骤（每个组件）：**
1. 新建 `ComponentName.module.css`，粘贴对应选择器并去掉全局前缀
2. 组件文件顶部添加 `import styles from './ComponentName.module.css'`
3. JSX 中将字符串 className 替换为 `styles.xxx`（或 `clsx(styles.xxx, condition && styles.yyy)`）
4. 从 `styles.css` 删除已迁移的选择器
5. 运行 `npm run build` 验证无编译错误

**涉及文件：**
- 新建：7 个 `.module.css` 文件（见上表）
- 修改：对应 7 个 `.tsx` 文件
- 修改：`web/src/styles.css`（删除已迁移的约 800–1200 行）

**预期结果：**
- 各组件样式作用域隔离，className 冲突风险消除
- `styles.css` 缩减至约 5200–5700 行（全局 token + utility + 未迁移组件）

---

### 步骤 11：无障碍（Accessibility）关键修复

**具体操作：**

**11a ConfirmDialog（步骤 5 的组件）：**
- `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby="confirm-dialog-title"`
- 打开时 focus trap：Tab 键仅在对话框内循环，ESC 关闭
- 使用 `useEffect` + `ref` 将初始 focus 移至取消按钮（默认安全操作）

**11b InteractionPanel：**
- 文本输入区：`<textarea aria-label={...}>`，其中 label 值为交互的 `prompt` 文本
- 卡片容器添加 `role="region"` + `aria-labelledby`

**11c 运行状态更新（aria-live）：**
- `RunInspector` 的错误区域：`<div aria-live="polite" aria-atomic="true">`
- `InteractionPanel` 的错误信息：`<p role="alert">`（已有但需确认语义正确性）

**11d 导航选项卡（若存在 tab strip）：**
- ArtifactViewer 节点选择器：`role="tablist"` + `role="tab"` + `aria-selected`
- 键盘导航：左右箭头切换节点

**涉及文件：**
- 修改：`web/src/components/ConfirmDialog.tsx`
- 修改：`web/src/components/InteractionPanel.tsx`
- 修改：`web/src/components/RunInspector.tsx`
- 修改：`web/src/components/ArtifactViewer.tsx`

---

## 文件变更清单

### 新建文件

| 文件路径 | 用途 |
|---------|------|
| `web/src/components/ConfirmDialog.tsx` | 通用删除确认对话框组件 |
| `web/src/components/ConfirmDialog.module.css` | 确认对话框样式 |
| `web/src/components/InteractionPanel.module.css` | InteractionPanel 私有样式 |
| `web/src/components/ArtifactViewer.module.css` | ArtifactViewer 私有样式 |
| `web/src/components/CallableBrowser.module.css` | CallableBrowser 私有样式 |
| `web/src/components/DecisionInboxPanel.module.css` | DecisionInboxPanel 私有样式 |
| `web/src/components/RunInspector.module.css` | RunInspector 私有样式 |
| `web/src/components/workflow-viewer/WorkflowEvidenceDock.module.css` | EvidenceDock 私有样式 |

### 修改文件

| 文件路径 | 变更内容 |
|---------|---------|
| `web/src/format.ts` | 新增 `formatTimestamp`、`formatBytes`；扩展 `formatDuration` |
| `web/src/i18n/zh-CN.ts` | 扩展为完整分区结构，新增约 150 个 key |
| `web/src/components/InteractionPanel.tsx` | ask/suggest 输入框、CSS Module 引入、ARIA |
| `web/src/components/ArtifactViewer.tsx` | 节点选择器、dead code 清除、CSS Module 引入 |
| `web/src/components/CallableBrowser.tsx` | 删除确认对话框集成、CSS Module 引入 |
| `web/src/components/DecisionInboxPanel.tsx` | UUID 友好化、severity 中文、CSS Module 引入 |
| `web/src/components/ControlPlanePanel.tsx` | `?dev=true` 开关 |
| `web/src/components/RunInspector.tsx` | 隐藏路径、formatBytes、CSS Module 引入 |
| `web/src/components/workflow-viewer/WorkflowEvidenceDock.tsx` | chevron 修正、CSS Module 引入 |
| `web/src/App.tsx`（或导航组件） | 隐藏控制平面选项卡（`?dev=true` 判断） |
| `web/src/styles.css` | 删除已迁移至 CSS Module 的约 800–1200 行选择器 |

### 删除文件

无（本次不删除现有文件，`styles.css` 为缩减而非删除）

---

## 测试计划

### 关键测试用例

| 测试场景 | 操作 | 预期结果 |
|---------|------|---------|
| InteractionPanel ask | 打开包含 `kind=ask` 的交互请求 | 渲染文本输入框和提交按钮 |
| InteractionPanel ask 提交 | 输入文本并点击提交 | 调用 `answerInteraction(runId, id, { answer: text })`，卡片从列表消失 |
| InteractionPanel suggest 提交 | 输入文本并点击提交 | 调用 `answerInteraction(runId, id, { suggestion: text })` |
| ArtifactViewer 多节点 | 选择有 3 个节点的运行 | 显示节点 tab strip，默认选首节点 |
| ArtifactViewer 节点切换 | 点击第 2 个节点 | 产物列表更新为该节点的产物，content 清空 |
| CallableBrowser 删除 | 选择智能体，点击删除 | 弹出确认对话框，显示智能体名称 |
| CallableBrowser 删除取消 | 点击取消 | 对话框关闭，智能体未被删除 |
| CallableBrowser 删除确认 | 点击确认删除 | 调用 `deleteAgentCallable`，列表更新 |
| ConfirmDialog ESC 关闭 | 打开对话框后按 ESC | 对话框关闭 |
| ConfirmDialog focus trap | Tab 键循环 | focus 仅在对话框内循环 |
| ControlPlanePanel 隐藏 | 不带 `?dev=true` 访问 | 导航栏无"控制平面"选项卡，组件返回 null |
| ControlPlanePanel 显示 | 访问 `?dev=true` | 控制平面选项卡可见，功能正常 |
| RunInspector 路径显示 | 查看有完整路径的节点 | path-button 仅显示文件名，hover title 含完整路径 |
| RunInspector 字节格式化 | 产物大小为 12594 bytes | 显示 `12.3 KB` |
| EvidenceDock chevron | 折叠时 | 显示 ChevronDown（向下箭头） |
| EvidenceDock chevron | 展开时 | 显示 ChevronUp（向上箭头） |
| formatBytes | `formatBytes(0)` | `"0 B"` |
| formatBytes | `formatBytes(1536)` | `"1.5 KB"` |
| formatBytes | `formatBytes(1572864)` | `"1.5 MB"` |
| formatTimestamp | 有效 ISO 字符串 | 输出 `YYYY-MM-DD HH:mm:ss` |
| formatTimestamp | 空字符串 | 输出 `n/a` |
| i18n key 完整性 | TypeScript 编译 | 无 `ZhKey` 类型错误 |
| CSS Modules | `npm run build` | 无 className 冲突或编译错误 |
| CSS Modules | 视觉回归 | 各组件视觉表现与迁移前一致 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| CSS Modules 迁移引入视觉回归 | 中 | 中 | 每个组件迁移后立即在浏览器中对比截图；保留 `styles.css` 原始副本 |
| i18n key 结构变更破坏现有引用 | 低 | 中 | 新增 key 采用嵌套对象，不修改已有顶级 key；`ZhKey` 类型变化由 TypeScript 编译器捕获 |
| ControlPlanePanel `?dev=true` 被缓存 | 低 | 低 | 读取 `window.location.search` 而非 localStorage，刷新即可恢复 |
| ArtifactViewer 节点切换时 API 调用过快 | 低 | 低 | 使用 `ignore` flag 模式（已在代码库中采用），防止竞态条件 |
| ConfirmDialog focus trap 与现有 ESC 监听冲突 | 低 | 低 | 在组件内 `stopPropagation`，作用域明确 |
| formatTimestamp 时区问题 | 中 | 低 | 明确使用 `Intl.DateTimeFormat` 本地时区，单元测试覆盖边界值 |

---

## 依赖关系

```
步骤1 (format.ts)
  └── 步骤8 (RunInspector formatBytes)

步骤5 (ConfirmDialog 组件)
  └── 步骤5 (CallableBrowser 集成)

步骤9 (i18n 扩展)
  ├── 步骤3 (InteractionPanel i18n 引用)
  ├── 步骤4 (ArtifactViewer i18n 引用)
  ├── 步骤6 (DecisionInboxPanel i18n 引用)
  └── 步骤8 (RunInspector i18n 引用)

步骤10 (CSS Modules)
  └── 依赖各组件功能修复完成后再做迁移（避免合并冲突）
```

步骤 2（chevron 修正）和步骤 7（ControlPlanePanel 开关）为独立原子操作，可并行执行。

---

## 预估工作量

| 步骤 | 工作量 | 备注 |
|------|--------|------|
| 步骤 1：format.ts | 0.5 h | 纯函数，易测试 |
| 步骤 2：chevron 修正 | 0.1 h | 单行改动 |
| 步骤 3：InteractionPanel 输入 | 1.5 h | 含 ARIA |
| 步骤 4：ArtifactViewer 节点选择器 | 2 h | 状态逻辑 + tab |
| 步骤 5：ConfirmDialog + CallableBrowser | 2 h | 含 focus trap |
| 步骤 6：DecisionInboxPanel 友好化 | 1 h | |
| 步骤 7：ControlPlanePanel 开关 | 0.5 h | |
| 步骤 8：RunInspector 路径/字节 | 0.5 h | |
| 步骤 9：i18n 系统化 | 2 h | 追加 key，全量替换硬编码 |
| 步骤 10：CSS Modules 迁移（7 组件）| 4 h | 含视觉回归验证 |
| 步骤 11：Accessibility | 1.5 h | |
| **合计** | **~15.5 h** | |
