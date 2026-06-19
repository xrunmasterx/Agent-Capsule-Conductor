import type { WorkflowCanvasEdge, WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';

export function PortInspector({
  workflow,
  port,
  tab,
  canvas,
}: {
  workflow: WorkflowContainerModel;
  port: WorkflowPortView;
  tab: string;
  canvas: WorkspaceCanvasModel;
}) {
  const relatedEdges = canvas.edges.filter(
    (edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => {
      if (edge.kind !== 'data') {
        return false;
      }
      return (
        (edge.source.workflowId === workflow.id && edge.source.portId === port.id) ||
        (edge.target.workflowId === workflow.id && edge.target.portId === port.id)
      );
    },
  );
  if (tab === 'connections') {
    return (
      <section className="inspector-stack">
        {relatedEdges.map((edge) => (
          <article
            key={`${edge.kind}:${edge.id}:${edge.source.workflowId}:${edge.source.portId}:${edge.target.workflowId}:${edge.target.portId}`}
            className="edge-summary-row"
          >
            {edge.source.workflowId}.{edge.source.portId} {'->'} {edge.target.workflowId}.
            {edge.target.portId}
          </article>
        ))}
        {relatedEdges.length === 0 ? <p className="muted">暂无连接</p> : null}
      </section>
    );
  }
  if (tab === 'contract' || tab === 'overview') {
    return (
      <dl className="definition-grid compact">
        <dt>workflow</dt>
        <dd>{workflow.title}</dd>
        <dt>port</dt>
        <dd>{port.id}</dd>
        <dt>方向</dt>
        <dd>{port.direction}</dd>
        <dt>说明</dt>
        <dd>{port.label}</dd>
        <dt>required</dt>
        <dd>{String(Boolean(port.required))}</dd>
        <dt>cardinality</dt>
        <dd>{port.cardinality || 'one'}</dd>
      </dl>
    );
  }
  return <p className="muted">运行证据会在 workflow run 后按 inbox/outbox manifest 展示。</p>;
}
