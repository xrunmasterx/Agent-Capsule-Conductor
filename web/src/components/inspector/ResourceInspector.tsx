export type ResourceTemplate =
  | { kind: 'workflow_class'; workflowId: string; path: string; name: string }
  | { kind: 'agent_class'; callableId: string; name: string }
  | { kind: 'tool_class'; callableId: string; name: string };

export function ResourceInspector({ resource }: { resource: ResourceTemplate }) {
  return (
    <aside className="right-inspector" aria-label="资源详情面板">
      <header className="inspector-title-row">
        <h3>{resource.name}</h3>
      </header>
      <dl className="definition-grid compact">
        <dt>类型</dt>
        <dd>
          {resource.kind === 'workflow_class'
            ? 'Workflow Class'
            : resource.kind === 'agent_class'
              ? 'Agent Class'
              : 'Tool Class'}
        </dd>
        <dt>ID</dt>
        <dd>{resource.kind === 'workflow_class' ? resource.workflowId : resource.callableId}</dd>
        {resource.kind === 'workflow_class' ? (
          <>
            <dt>路径</dt>
            <dd>{resource.path}</dd>
          </>
        ) : null}
      </dl>
      <p className="muted">Resources are reusable classes; dragging one onto the task canvas creates an invocation instance.</p>
    </aside>
  );
}
