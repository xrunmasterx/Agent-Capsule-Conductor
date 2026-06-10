/**
 * SaveWorkflowDialog - modal for saving a task as a persistent workflow.
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
        aria-label="Save Workflow"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="modal-title-row">
          <h3>保存任务为 Workflow</h3>
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
        {state.error ? <p className="form-error">{state.error}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={state.saving}>
            取消
          </button>
          <button type="submit" className="primary-action" disabled={state.saving}>
            {state.saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
