import { useMemo } from 'react';

import type { WorkflowCanvasEdge, WorkspaceCanvasModel } from '../../types/workbench';
import { useBoundaryTransferPreview } from '../../hooks/useBoundaryTransferPreview';
import {
  boundaryInputMainConflictMessage,
  boundaryMainBindingLabel,
  controlEdgeMainTransferMode,
} from '../../workbench/model/selectedNodeModel';
import {
  dataConnectNodes,
  edgeDiagnosticsForCanvasEdge,
  workflowIdForBoundaryMainBinding,
} from '../../workbench/model/canvasEdgeOps';
import { edgeCanonicalPreview } from '../../workbench/model/workflowGraphProjection';
import {
  boundaryTransferPreviewHasErrors,
  unavailableBoundaryTransferPreview,
} from '../../workbench/model/boundaryTransferProjection';

export function EdgeInspector({
  edge,
  tab,
  canvas,
  scopeWorkflowId,
  boundaryPreviewSnapshotForCanvas,
  onCreateTargetInputPort,
}: {
  edge: WorkflowCanvasEdge;
  tab: string;
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  boundaryPreviewSnapshotForCanvas: (canvas: WorkspaceCanvasModel) => Record<string, unknown>;
  onCreateTargetInputPort: (targetNodeId: string, targetPortId: string) => void;
}) {
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.source.workflowId);
  const targetWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.target.workflowId);
  const boundaryWorkflowId = workflowIdForBoundaryMainBinding(edge);
  const isBoundaryControlEdge = edge.kind === 'control' && Boolean(boundaryWorkflowId);
  const boundaryPreviewSnapshot = useMemo(
    () => (isBoundaryControlEdge ? boundaryPreviewSnapshotForCanvas(canvas) : null),
    [boundaryPreviewSnapshotForCanvas, canvas, isBoundaryControlEdge],
  );
  const boundaryPreview = useBoundaryTransferPreview({
    enabled: isBoundaryControlEdge,
    canvasSnapshot: boundaryPreviewSnapshot,
    edgeId: edge.id,
  });
  const diagnostics = edgeDiagnosticsForCanvasEdge(canvas, scopeWorkflowId, edge);
  const targetNodeExists =
    edge.kind === 'data' &&
    dataConnectNodes(canvas, scopeWorkflowId).some((node) => node.nodeId === edge.target.workflowId);
  const targetPortDiagnostic = targetNodeExists
    ? diagnostics.find((diagnostic) => diagnostic.code === 'dangling_data_edge_target')
    : undefined;
  const transferMode = controlEdgeMainTransferMode(canvas, scopeWorkflowId, edge);
  const boundaryLabel = boundaryMainBindingLabel(edge);
  const conflictMessage = boundaryInputMainConflictMessage(canvas, scopeWorkflowId, edge);

  if (tab === 'raw') {
    return <CodeBlock title="edge.json" content={JSON.stringify(edge, null, 2)} variant="json" />;
  }
  if (tab === 'mapping') {
    const preview = isBoundaryControlEdge
      ? boundaryPreview || unavailableBoundaryTransferPreview()
      : edgeCanonicalPreview(edge, canvas);
    return (
      <CodeBlock
        title="core-v2-edge-preview.json"
        content={JSON.stringify(preview, null, 2)}
        variant="json"
      />
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>类型</dt>
      <dd>{boundaryLabel || (edge.kind === 'data' ? 'Data Edge' : 'Control Edge')}</dd>
      <dt>上游</dt>
      <dd>
        {sourceWorkflow?.title || edge.source.workflowId}
        {'portId' in edge.source ? `.${edge.source.portId}` : ''}
      </dd>
      <dt>下游</dt>
      <dd>
        {targetWorkflow?.title || edge.target.workflowId}
        {'portId' in edge.target ? `.${edge.target.portId}` : ''}
      </dd>
      <dt>样式</dt>
      <dd>{edge.kind === 'data' ? '浅灰虚线' : '控制线'}</dd>
      {edge.kind === 'control' ? (
        <>
          <dt>数据传递</dt>
          <dd>{transferMode.label}</dd>
          <dt>传递规则</dt>
          <dd>{transferMode.reason}</dd>
        </>
      ) : null}
      {conflictMessage ? (
        <>
          <dt>输入覆盖</dt>
          <dd>{conflictMessage}</dd>
        </>
      ) : null}
      {boundaryPreview?.diagnostics.length ? (
        <>
          <dt>边界传输</dt>
          <dd>{boundaryTransferPreviewHasErrors(boundaryPreview) ? '配置错误' : '可预览'}</dd>
          <dt>边界诊断</dt>
          <dd>{boundaryPreview.diagnostics.map((diagnostic) => diagnostic.message).join('；')}</dd>
        </>
      ) : null}
      {diagnostics.length > 0 ? (
        <>
          <dt>诊断</dt>
          <dd>{diagnostics.map((diagnostic) => diagnostic.message).join('；')}</dd>
          <dt>修复建议</dt>
          <dd>
            {diagnostics.some((diagnostic) => diagnostic.code === 'dangling_data_edge_source')
              ? '更新上游 output_schema，或把这条 data edge 迁移到仍存在的输出端口。'
              : '在下游节点创建对应 input port，或把这条 data edge 迁移到已有输入端口。'}
          </dd>
        </>
      ) : null}
      {targetPortDiagnostic && edge.kind === 'data' ? (
        <>
          <dt>快速修复</dt>
          <dd>
            <button
              type="button"
              className="secondary-action-button"
              onClick={() => onCreateTargetInputPort(edge.target.workflowId, edge.target.portId)}
            >
              创建 target input port
            </button>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function CodeBlock({
  title,
  content,
  variant = 'json',
}: {
  title: string;
  content: string;
  variant?: 'json' | 'log' | 'text';
}) {
  return (
    <div className={`code-block code-block-${variant}`}>
      <div className="code-block-title">{title}</div>
      <pre>{content}</pre>
    </div>
  );
}
