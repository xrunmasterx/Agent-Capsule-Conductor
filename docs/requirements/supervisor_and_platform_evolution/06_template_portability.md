# 06 — 模板可移植与技能附件（B5）

**里程碑目标**：ClassTemplate / WorkflowFunctionTemplate 可 **导出/导入/版本化**，强制「导结构不导状态」，可选无状态 Skill 附件。  
**借鉴来源**：Paperclip ClipHub + Multica Templates/Skills（[04_synthesis B5](../../research/agent_orchestration_comparison/04_synthesis_vs_acc.md)）。  
**依赖**：REQ-PRIN-001、近期 B4 校验（导入时触发）。

---

### REQ-B5-001: 模板导出包（ACC Template Bundle）

| 属性 | 值 |
|------|-----|
| 来源 | B5 |
| 阶段 | template |
| 优先级 | P2 |
| 依赖 | REQ-B4-002 |

**问题陈述**  
复用 agent/workflow 定义应可分享，降低从零写 capsule 门槛。

**当前 ACC 现状**  
- Conductor YAML **export-only**：`acc/conductor_export.py`, `acc/cli.py` conductor export  
- **缺口**：无 ACC 原生 `.accbundle`（名称待定）格式

**目标行为**  
CLI：`acc template export --class <id> | --workflow <id> -o bundle.zip`  
包内容：

```text
manifest.json          # bundle_id, version, lineage, exported_at
classes/<id>/          # capsule dir snapshot (yaml, schemas, prompts)
workflows/<id>.accflow.json
skills/                # optional, REQ-B5-003
```

**禁止** 包含：`runs/`, `session_*`, 绝对路径, `.env`

**架构约束**  
`acc.app` + `acc.store` 读 template；zip 写入由 app 协调。

**验收标准**  
- Given 合法 class When export Then zip 无 runs 路径  
- manifest 含 semver

**风险与缓解**  
秘密泄露 → 导出前 secret scan（复用 `control_plane` SECRET 规则思路）。

---

### REQ-B5-002: 导入与纯净性校验

| 属性 | 值 |
|------|-----|
| 来源 | B5 / REQ-PRIN-001 |
| 阶段 | template |
| 优先级 | P2 |
| 依赖 | REQ-B5-001, REQ-B4-001 |

**问题陈述**  
导入恶意或含运行态的包不应污染 registry。

**当前 ACC 现状**  
- `reject_absolute_workspace_paths`：`acc/engine` validate clean template  
- **缺口**：无 import 命令

**目标行为**  
`acc template import bundle.zip [--dry-run]`  
步骤：解压到 staging → `validate_*` + 纯净性规则 → 复制到 `capsules/` / `workflows/`  
冲突策略：`--fork-id` 或 `--replace`（需 `--human-approved`）。

**纯净性规则**（必须全部通过）  
- 无 `runs/`, `node_runs/`, `session_manifest.json`  
- yaml/json 无绝对路径（Windows/Unix）  
- 无 `session_id`, `run_dir`, `last_output` 字段名（denylist）

**验收标准**  
- Given 含 runs/ 的 zip When import Then 拒绝  
- Given --dry-run Then 无文件写入

**风险与缓解**  
路径遍历 → 解压时校验 zip 条目相对路径。

---

### REQ-B5-003: 可选 Skill 附件（无状态）

| 属性 | 值 |
|------|-----|
| 来源 | B5 / Multica |
| 阶段 | template |
| 优先级 | P2 |
| 依赖 | REQ-B5-001, REQ-NONGOAL-002 |

**问题陈述**  
技能说明可作为附件增强 agent，但不得引入有状态 agent 实体。

**当前 ACC 现状**  
- `AgentClassTemplate.default_skills: tuple[str, ...]`：`acc/domain.py:197`  
- **缺口**：skills 仅为 id 引用，无打包格式

**目标行为**  
bundle 内 `skills/<name>/SKILL.md` + 可选 `metadata.json`  
导入后复制到项目约定目录（如 `.acc/skills/` 或 `capsules/<id>/skills/`），registry 解析为 **只读路径引用**。

**禁止**  
- Skill 内嵌 session、API key、run 证据

**验收标准**  
- Given bundle 含 skill When import Then default_skills 可解析  
- Skill 不含 denylist 字段

**风险与缓解**  
与 Cursor skills 混淆 → 文档说明 ACC skill 为导出附件，非 IDE 自动加载。

---

### REQ-B5-004: 版本与血缘（lineage）元数据

| 属性 | 值 |
|------|-----|
| 来源 | B5 / ClipHub |
| 阶段 | template |
| 优先级 | P2 |
| 依赖 | REQ-B5-001 |

**问题陈述**  
 fork 与升级需要知道来源版本，避免静默覆盖。

**当前 ACC 现状**  
- `AgentClassTemplate.version` / `WorkflowFunctionTemplate.version` 存在  
- **缺口**：无 lineage 字段

**目标行为**  
`manifest.json`：

```json
{
  "bundle_version": "1.0.0",
  "lineage": {
    "parent_bundle_id": "optional",
    "parent_version": "1.0.0",
    "forked_at": "ISO8601"
  }
}
```

导入时写入 target template `metadata.acc_lineage`。

**验收标准**  
- Given fork import When show class Then metadata 含 lineage  
- 不自动覆盖已有 id 除非 `--replace`

**风险与缓解**  
semver 冲突 → 仅警告，不阻塞 import（P2）。

---

## 模板阶段 Done 定义

- [ ] export/import dry-run 可用  
- [ ] 纯净性校验拒绝含 run 状态包  
- [ ] 与 Conductor export 文档区分（export-only YAML 保留）
