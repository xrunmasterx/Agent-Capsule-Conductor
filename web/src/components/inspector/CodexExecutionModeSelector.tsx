import type { CodexExecutionMode } from '../../types/workbench';
import { normalizedCodexExecutionMode } from '../../workbench/model/taskModel';

type CodexExecutionModeSelectorProps = {
  value: CodexExecutionMode;
  onChange: (value: CodexExecutionMode) => void;
};

export function CodexExecutionModeSelector({ value, onChange }: CodexExecutionModeSelectorProps) {
  return (
    <div className="node-settings-field codex-mode-field">
      <span>Codex 执行模式</span>
      <select
        value={value}
        onChange={(event) => onChange(normalizedCodexExecutionMode(event.currentTarget.value))}
        aria-label="Codex 执行模式"
      >
        <option value="default">默认本地全权限（推荐）</option>
        <option value="local_readonly_no_sandbox">只读无沙箱（仅代码阅读场景）</option>
        <option value="danger_full_access">显式危险全权限（调试/特殊任务）</option>
      </select>
      {value === 'local_readonly_no_sandbox' ? (
        <p className="notice compact-notice">
          底层会使用 Codex dangerous bypass；只读约束来自提示词，不是 OS 级沙箱。
        </p>
      ) : null}
      {value === 'danger_full_access' ? (
        <p className="notice compact-notice">
          底层会使用 Codex dangerous bypass，并且不会注入禁止修改文件的提示词约束。
        </p>
      ) : null}
    </div>
  );
}
