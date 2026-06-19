/**
 * SaveWorkflowDialog - modal for publishing a task as a reusable workflow.
 */

export type SaveWorkflowDialogState = {
  name: string;
  saving: boolean;
  error: string | null;
};

export function SaveWorkflowDialog({
  state,
  onName,
  onCancel,
  onConfirm,
}: {
  state: SaveWorkflowDialogState;
  onName: (name: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-panel save-workflow-dialog"
        aria-label="发布 Workflow"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="modal-title-row">
          <h3>发布为可复用 Workflow</h3>
          <button type="button" onClick={onCancel} disabled={state.saving}>
            关闭
          </button>
        </div>
        <label className="form-field">
          <span>Workflow 名称</span>
          <input
            value={state.name}
            onChange={(event) => onName(event.target.value)}
            disabled={state.saving}
            autoFocus
          />
        </label>
        <p className="form-help">
          发布会写入 canonical <code>.accflow.json</code>，使当前任务蓝图成为可复用的
          WorkflowFunctionTemplate。
        </p>
        {state.error ? <p className="form-error">{state.error}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={state.saving}>
            取消
          </button>
          <button type="submit" className="primary-action" disabled={state.saving}>
            {state.saving ? '发布中...' : '发布到 canonical .accflow.json'}
          </button>
        </div>
      </form>
    </div>
  );
}
