import { useEffect, useState } from 'react';

import type { WorkflowBindingView, WorkflowDirectorySelection } from '../../types';
import { workspaceRootOf } from '../../workbench/model/selectedNodeModel';

type WorkflowBindingDialogProps = {
  workflowId: string;
  binding?: WorkflowBindingView;
  onClose: () => void;
  onValidate: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onSave: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onOpenFolder: (workflowId: string) => Promise<void>;
  onSelectDirectory: (workflowId: string, initialDir: string) => Promise<WorkflowDirectorySelection>;
};

export function WorkflowBindingDialog({
  workflowId,
  binding,
  onClose,
  onValidate,
  onSave,
  onOpenFolder,
  onSelectDirectory,
}: WorkflowBindingDialogProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState(workspaceRootOf(binding) || '');
  const [message, setMessage] = useState(binding?.status || 'unbound');
  const [selectingDirectory, setSelectingDirectory] = useState(false);

  useEffect(() => {
    setWorkspaceRoot(workspaceRootOf(binding) || '');
    setMessage(binding?.status || 'unbound');
    setSelectingDirectory(false);
  }, [workflowId, binding]);

  async function validate() {
    const result = await onValidate(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  async function save() {
    const result = await onSave(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  async function selectDirectory() {
    setSelectingDirectory(true);
    try {
      const result = await onSelectDirectory(workflowId, workspaceRoot);
      if (result.status === 'selected' && result.valid) {
        const selectedPath = result.workspace_root || result.workspaceRoot || '';
        setWorkspaceRoot(selectedPath);
        setMessage('selected');
        return;
      }
      if (result.status === 'cancelled') {
        setMessage('cancelled');
        return;
      }
      setMessage(result.error || result.status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'directory picker failed');
    } finally {
      setSelectingDirectory(false);
    }
  }

  return (
    <div className="binding-dialog" role="dialog" aria-label="配置工作目录">
      <div className="binding-dialog-panel">
        <header>
          <div>
            <span className="topbar-kicker">Workspace Binding</span>
            <h3>{workflowId}</h3>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <label>
          workspace_root
          <input
            aria-label="workspace_root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            placeholder="F:\\Agent-Callable-Conductor\\WorkFlowTest\\paper1"
          />
        </label>
        <dl className="definition-grid compact">
          <dt>状态</dt>
          <dd>{message}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOf(binding) || `bindings/${workflowId}.binding.local.json`}</dd>
        </dl>
        <div className="toolbar-actions">
          <button type="button" onClick={selectDirectory} disabled={selectingDirectory}>
            {selectingDirectory ? '选择中...' : '选择文件夹'}
          </button>
          <button type="button" onClick={validate}>
            校验目录
          </button>
          <button type="button" className="primary-action" onClick={save}>
            保存绑定
          </button>
          <button type="button" onClick={() => void onOpenFolder(workflowId)}>
            打开 bindings 目录
          </button>
        </div>
      </div>
    </div>
  );
}

function bindingPathOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.bindingPath || binding?.binding_path || '';
}
