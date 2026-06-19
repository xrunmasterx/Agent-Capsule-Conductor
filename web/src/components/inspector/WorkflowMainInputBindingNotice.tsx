import type { NodeRunSummary } from '../../types';
import type { WorkflowMainInputBindingState } from '../../types/workbench';
import { nodeRunHasWorkflowInputBinding } from '../../workbench/model/selectedNodeModel';

export function WorkflowMainInputBindingNotice({
  binding,
  nodeRun,
}: {
  binding?: WorkflowMainInputBindingState;
  nodeRun?: NodeRunSummary;
}) {
  if (!binding) {
    return null;
  }
  if (binding.status === 'unbound') {
    return <p className="muted workflow-binding-notice">当前节点没有 Workflow main 输入绑定。</p>;
  }
  const bindingLabel = `${binding.workflowId}.main -> ${binding.nodeId}.${binding.targetPort}`;
  const runHasWorkflowInput = nodeRunHasWorkflowInputBinding(nodeRun);
  if (!nodeRun) {
    return (
      <p className="muted workflow-binding-notice">
        当前画布绑定：{bindingLabel}。尚未运行，运行后会在 binding_manifest.json 中记录 workflow_input。
      </p>
    );
  }
  if (runHasWorkflowInput) {
    return (
      <p className="muted workflow-binding-notice">
        当前画布绑定：{bindingLabel}；本次运行证据已记录 workflow_input。
      </p>
    );
  }
  return (
    <p className="notice compact-notice workflow-binding-notice">
      当前画布已连接 Workflow main 输入，但本次运行没有对应 workflow_input 证据，可能发生在连接保存/发布前。请重新运行以生成新的运行证据。
    </p>
  );
}
