import { useEffect, useState } from 'react';

import type { SelectedEntityDetailsModel } from '../../types/workbench';
import { hasProjectedOutputPorts, schemaDerivedOutputFields } from '../../workbench/model/schemaPorts';
import { combinedLogText, statusLabel } from '../../workbench/model/selectedNodeModel';
import {
  SchemaFieldCards,
  dedupeSchemaFields,
  schemaFieldsFromJsonSchema,
  schemaFieldsFromPorts,
} from './SchemaFieldCards';

type SelectedNodeRuntimePaneProps = {
  model: SelectedEntityDetailsModel;
  agentEventText?: string;
  failedEventText?: string;
};

export function SelectedNodeRuntimePane({
  model,
  agentEventText = '',
  failedEventText = '',
}: SelectedNodeRuntimePaneProps) {
  const [tab, setTab] = useState<'live' | 'schema' | 'error'>('live');

  useEffect(() => {
    setTab('live');
  }, [model.key]);

  if (!isRuntimeDetailModel(model)) {
    return (
      <section className="selected-node-runtime-pane" aria-label="选中节点输出">
        <header>
          <span>选中节点输出</span>
          <strong>未选择节点</strong>
        </header>
        <p className="empty-state">选择一个 Agent/Tool/Workflow 节点查看输出。</p>
      </section>
    );
  }

  return (
    <section className="selected-node-runtime-pane" aria-label="选中节点输出">
      <header>
        <div>
          <span>选中节点输出</span>
          <strong>{model.title}</strong>
        </div>
        <small className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </small>
      </header>
      <div className="selected-node-runtime-tabs" role="tablist" aria-label="选中节点输出视图">
        <button type="button" className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          实时输出
        </button>
        <button type="button" className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')}>
          output schema
        </button>
        <button type="button" className={tab === 'error' ? 'active' : ''} onClick={() => setTab('error')}>
          error
        </button>
      </div>
      {tab === 'live' ? <SelectionLiveOutput model={model} agentEventText={agentEventText} /> : null}
      {tab === 'schema' ? <NodeOutputSchemaPane model={model} /> : null}
      {tab === 'error' ? <NodeErrorPane model={model} failedEventText={failedEventText} /> : null}
    </section>
  );
}

function SelectionLiveOutput({
  model,
  agentEventText,
}: {
  model: SelectedEntityDetailsModel;
  agentEventText: string;
}) {
  const combinedLog = combinedLogText(model.log);
  const visibleLog = [combinedLog || model.log.excerpt, agentEventText].filter(Boolean).join('\n\n');
  return (
    <div className="selection-log-output selection-live-output assistant-runtime-content" role="log" aria-live="polite">
      {visibleLog.trim() ? <pre>{visibleLog}</pre> : <p className="empty-state">当前节点还没有实时输出。</p>}
    </div>
  );
}

function NodeOutputSchemaPane({ model }: { model: SelectedEntityDetailsModel }) {
  const nodeSettings = model.nodeSettings;
  const fields =
    nodeSettings?.outputSchema && hasProjectedOutputPorts(nodeSettings.outputSchema)
      ? schemaDerivedOutputFields(nodeSettings.outputSchema)
      : dedupeSchemaFields([
          ...(nodeSettings?.outputSchema ? schemaFieldsFromJsonSchema(nodeSettings.outputSchema) : []),
          ...schemaFieldsFromPorts(undefined, nodeSettings?.outputPorts || []),
        ]);
  return (
    <div className="assistant-runtime-content output-schema-content">
      <SchemaFieldCards title="output schema" fields={fields} emptyText="当前节点没有声明 output schema。" />
    </div>
  );
}

function NodeErrorPane({ model, failedEventText }: { model: SelectedEntityDetailsModel; failedEventText: string }) {
  const errorText = [model.log.stderr, failedEventText].filter(Boolean).join('\n\n');
  return (
    <div className="selection-log-output assistant-runtime-content error-output" role="log" aria-live="polite">
      {errorText.trim() ? <pre>{errorText}</pre> : <p className="empty-state">当前节点没有错误输出。</p>}
    </div>
  );
}

function isRuntimeDetailModel(model: SelectedEntityDetailsModel): boolean {
  return model.kind === 'node' || model.kind === 'internal-node' || model.kind === 'workflow';
}
