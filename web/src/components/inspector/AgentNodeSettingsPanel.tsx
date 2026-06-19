import type { CallableDetail, RuntimeConfig } from '../../types';
import type { CallableDetailLoadState } from '../../hooks/useCallableDetail';
import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import { normalizedCodexExecutionMode } from '../../workbench/model/taskModel';
import { statusLabel } from '../../workbench/model/selectedNodeModel';
import { hasProjectedOutputPorts, schemaDerivedOutputFields } from '../../workbench/model/schemaPorts';
import type {
  AgentNodeConnectionEditor,
  AgentNodeSettingsModel,
  CodexExecutionMode,
  EmptyInputPolicy,
  SelectedEntityDetailsModel,
} from '../../types/workbench';
import { AgentSessionPanel } from './AgentSessionPanel';
import { CodexExecutionModeSelector } from './CodexExecutionModeSelector';
import { DataConnectionsPanel } from './DataConnectionsPanel';
import { NodePromptEditor } from './NodePromptEditor';
import { PropertyGroups } from './PropertyGroups';
import { RunEvidenceCard } from './RunEvidenceCard';
import {
  SchemaFieldCards,
  dedupeSchemaFields,
  schemaFieldsFromArtifactContract,
  schemaFieldsFromPorts,
} from './SchemaFieldCards';
import { TechnicalDetailsDisclosure } from './TechnicalDetailsDisclosure';
import { WorkflowMainInputBindingNotice } from './WorkflowMainInputBindingNotice';

type NodeMutationCallbacks = {
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
};

type AgentNodeSettingsPanelProps = NodeMutationCallbacks & {
  node: AgentNodeSettingsModel;
  connectionEditor?: AgentNodeConnectionEditor;
  runtimeConfig: RuntimeConfig | null;
  callableState: CallableDetailLoadState;
};

type SelectionPropertiesPaneProps = NodeMutationCallbacks & {
  model: SelectedEntityDetailsModel;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
};

export function AgentNodeSettingsPanel({
  node,
  connectionEditor,
  runtimeConfig,
  callableState,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onReadEvidence,
  onOpenCallableResource,
}: AgentNodeSettingsPanelProps) {
  const detail = callableState.detail;
  const inputFields = schemaFieldsFromPorts(detail?.input_ports, node.inputPorts);
  const outputFields = hasProjectedOutputPorts(node.outputSchema)
    ? schemaDerivedOutputFields(node.outputSchema)
    : [
        ...schemaFieldsFromPorts(detail?.output_ports, node.outputPorts),
        ...schemaFieldsFromArtifactContract(detail?.artifact_contract),
      ];

  return (
    <div className="node-settings-content">
      <NodeBasicsCard
        node={node}
        detail={detail}
        onUpdateLabel={onUpdateLabel}
        onUpdateForwardMainOutput={onUpdateForwardMainOutput}
        onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
        onUpdateCodexExecutionMode={onUpdateCodexExecutionMode}
      />

      <NodePromptEditor
        nodeKey={node.nodeId}
        input={node.input}
        systemPrompt={detail?.default_prompt || ''}
        onChange={onUpdateInput}
      />

      <TemplateSummaryCard
        node={node}
        callableState={callableState}
        allowTemplateEdit={Boolean(node.callableId)}
        onOpenCallableResource={onOpenCallableResource}
      />

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">输入 / 输出</span>
            <h4>节点输入输出契约</h4>
          </div>
        </div>
        <SchemaFieldCards title="输入" fields={inputFields} emptyText="未声明输入字段。" />
        <SchemaFieldCards title="输出" fields={dedupeSchemaFields(outputFields)} emptyText="未声明输出字段。" />
      </section>

      {connectionEditor ? <DataConnectionsCard connectionEditor={connectionEditor} /> : null}

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">本次运行</span>
            <h4>{node.run ? '运行证据' : '尚未运行'}</h4>
          </div>
        </div>
        <WorkflowMainInputBindingNotice binding={node.workflowMainInputBinding} nodeRun={node.run} />
        <RunEvidenceCard
          nodeRun={node.run}
          liveLogs={node.logs}
          runtimeConfig={runtimeConfig}
          onReadEvidence={onReadEvidence}
        />
      </section>

      <TechnicalDetailsDisclosure node={node} runtimeConfig={runtimeConfig} callableDetail={detail} />
    </div>
  );
}

export function SelectionPropertiesPane({
  model,
  callableState,
  runtimeConfig,
  agentSessionState,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onOpenCallableResource,
}: SelectionPropertiesPaneProps) {
  return (
    <section className="selection-properties-pane" aria-label="节点属性">
      <header className="selection-pane-header">
        <div>
          <span>节点属性</span>
          <h3>{model.scopeLabel || model.kind}</h3>
        </div>
      </header>
      {model.nodeSettings ? (
        <SelectionNodeProperties
          node={model.nodeSettings}
          callableState={callableState}
          runtimeConfig={runtimeConfig}
          agentSessionState={agentSessionState}
          onReadEvidence={onReadEvidence}
          onRefreshAgentSession={onRefreshAgentSession}
          onPublishAgentOutput={onPublishAgentOutput}
          onAnswerAgentInteraction={onAnswerAgentInteraction}
          onUpdateInput={onUpdateInput}
          onUpdateLabel={onUpdateLabel}
          onUpdateForwardMainOutput={onUpdateForwardMainOutput}
          onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
          onUpdateCodexExecutionMode={onUpdateCodexExecutionMode}
          onOpenCallableResource={onOpenCallableResource}
        />
      ) : (
        <PropertyGroups groups={model.properties} />
      )}
    </section>
  );
}

function SelectionNodeProperties({
  node,
  callableState,
  runtimeConfig,
  agentSessionState,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
  onOpenCallableResource,
}: NodeMutationCallbacks & {
  node: AgentNodeSettingsModel;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
}) {
  const detail = callableState.detail;
  return (
    <div className="selection-node-properties">
      <NodeBasicsCard
        node={node}
        detail={detail}
        onUpdateLabel={onUpdateLabel}
        onUpdateForwardMainOutput={onUpdateForwardMainOutput}
        onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
        onUpdateCodexExecutionMode={onUpdateCodexExecutionMode}
      />

      <NodePromptEditor
        nodeKey={node.nodeId}
        input={node.input}
        systemPrompt={detail?.default_prompt || ''}
        onChange={onUpdateInput}
      />

      {node.workflowMainInputBinding ? (
        <section className="node-settings-card">
          <div className="node-settings-section-header">
            <div>
              <span className="panel-kicker">Workflow 输入</span>
              <h4>当前画布绑定</h4>
            </div>
          </div>
          <WorkflowMainInputBindingNotice binding={node.workflowMainInputBinding} nodeRun={node.run} />
        </section>
      ) : null}

      <AgentSessionPanel
        node={node}
        state={agentSessionState}
        events={agentSessionState.events}
        onReadEvidence={onReadEvidence}
        onRefresh={onRefreshAgentSession}
        onPublish={onPublishAgentOutput}
        onAnswerInteraction={onAnswerAgentInteraction}
      />

      <TemplateSummaryCard
        node={node}
        callableState={callableState}
        allowTemplateEdit={Boolean(node.callableId && !node.temporaryResourceId)}
        onOpenCallableResource={onOpenCallableResource}
      />

      <TechnicalDetailsDisclosure node={node} runtimeConfig={runtimeConfig} callableDetail={detail} />
    </div>
  );
}

function NodeBasicsCard({
  node,
  detail,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
}: {
  node: AgentNodeSettingsModel;
  detail: CallableDetail | null;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
}) {
  const templateName = detail ? callableDisplayTitle(detail) : node.callableId || '未绑定模板';
  const showCodexMode = isCodexAgentNode(node, detail);
  return (
    <section className="node-settings-card current-node-card">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">当前节点</span>
          <h4>{node.label}</h4>
        </div>
        <span className={`node-settings-status status-${node.status}`}>{statusLabel(node.status)}</span>
      </div>
      <label className="node-settings-field">
        <span>节点名称</span>
        <input value={node.label} onChange={(event) => onUpdateLabel(event.target.value)} aria-label="节点名称" />
      </label>
      <dl className="node-settings-facts">
        <dt>节点类型</dt>
        <dd>{node.kind === 'Tool' ? '工具' : '智能体'}</dd>
        <dt>使用模板</dt>
        <dd>{templateName}</dd>
      </dl>
      <label className="node-settings-checkbox">
        <input
          type="checkbox"
          checked={node.forwardMainOutputOnControl !== false}
          onChange={(event) => onUpdateForwardMainOutput(event.currentTarget.checked)}
        />
        <span title="开启时，只有 control-only 下游会默认收到该节点完整 main 输出；如果同一上下游已有 Data Edge，控制线只决定运行顺序。关闭后，所有控制线都只决定运行顺序。">
          控制线传递完整输出
        </span>
      </label>
      <label className="node-settings-checkbox">
        <input
          type="checkbox"
          checked={node.emptyInputPolicy === 'block'}
          onChange={(event) => onUpdateEmptyInputPolicy(event.currentTarget.checked ? 'block' : 'allow')}
        />
        <span>空输入时阻止运行</span>
      </label>
      {showCodexMode ? (
        <CodexExecutionModeSelector
          value={normalizedCodexExecutionMode(node.codexExecutionMode)}
          onChange={onUpdateCodexExecutionMode}
        />
      ) : null}
    </section>
  );
}

function TemplateSummaryCard({
  node,
  callableState,
  allowTemplateEdit,
  onOpenCallableResource,
}: {
  node: AgentNodeSettingsModel;
  callableState: CallableDetailLoadState;
  allowTemplateEdit: boolean;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const detail = callableState.detail;
  const templateName = detail ? callableDisplayTitle(detail) : node.callableId || '未绑定模板';
  const templateDescription = detail ? callableDescription(detail) : '';
  const provider = detail ? providerLabelFromCallable(detail) : node.kind === 'Tool' ? '工具' : '智能体';
  const metadata = detail?.metadata || {};
  const skills = skillsFromMetadata(metadata);
  const templateKind = detail?.kind === 'tool_class' ? 'tool_class' : 'agent_class';
  return (
    <section className="node-settings-card">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">模板摘要</span>
          <h4>{templateName}</h4>
        </div>
        {allowTemplateEdit ? (
          <button
            type="button"
            className="secondary-action compact-action"
            onClick={() => onOpenCallableResource(node.callableId, templateName, templateKind)}
          >
            编辑模板
          </button>
        ) : null}
      </div>
      {callableState.status === 'loading' ? <p className="muted">正在加载模板信息...</p> : null}
      {callableState.status === 'error' ? (
        <p className="notice compact-notice">模板信息暂时不可用：{callableState.error}</p>
      ) : null}
      <p className="template-governance-hint">
        模板是 class-level 资源；修改会影响所有引用，持久化发布需要通过 GraphOps 或等效治理路径。
      </p>
      <div className="template-summary-grid">
        <div>
          <span>Agent</span>
          <strong>{provider}</strong>
        </div>
        <div>
          <span>模型</span>
          <strong>{String(metadata.model || '默认模型')}</strong>
        </div>
        <div>
          <span>思考程度</span>
          <strong>{thinkingLabel(String(metadata.reasoning_effort || 'medium'))}</strong>
        </div>
      </div>
      {templateDescription ? <p className="template-description">{templateDescription}</p> : null}
      <section className="template-readonly-block">
        <h5>Skills</h5>
        {skills.length > 0 ? (
          <div className="skill-chip-row readonly">
            {skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        ) : (
          <p>未配置固定 skills</p>
        )}
      </section>
    </section>
  );
}

function DataConnectionsCard({ connectionEditor }: { connectionEditor: AgentNodeConnectionEditor }) {
  return (
    <section className="node-settings-card">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">数据线</span>
          <h4>连接设置</h4>
        </div>
      </div>
      <DataConnectionsPanel
        canvasNodeKind={connectionEditor.canvasNodeKind}
        canvas={connectionEditor.canvas}
        scopeWorkflowId={connectionEditor.scopeWorkflowId}
        nodeId={connectionEditor.nodeId}
        nodeLabel={connectionEditor.nodeLabel}
        callableId={connectionEditor.callableId}
        inputPorts={connectionEditor.inputPorts}
        outputPorts={connectionEditor.outputPorts}
        outputPortsReadonly={connectionEditor.outputPortsReadonly}
        dataConnectionDraft={connectionEditor.dataConnectionDraft}
        onBeginDataConnection={connectionEditor.onBeginDataConnection}
        onCancelDataConnection={connectionEditor.onCancelDataConnection}
        onUpdateDataConnectionMaterialization={connectionEditor.onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={connectionEditor.onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={connectionEditor.onCompleteDataConnectionWithNewInputPort}
        onAddPort={connectionEditor.onAddPort}
        onRenamePort={connectionEditor.onRenamePort}
        onDeletePort={connectionEditor.onDeletePort}
      />
    </section>
  );
}

function isCodexAgentNode(node: AgentNodeSettingsModel, detail: CallableDetail | null): boolean {
  if (node.kind !== 'Agent') {
    return false;
  }
  if (detail?.runtime === 'codex_cli') {
    return true;
  }
  return node.callableId.toLowerCase().includes('codex');
}

function callableDisplayTitle(detail: Pick<CallableDetail, 'id' | 'name' | 'metadata'>): string {
  const metadataName = typeof detail.metadata?.display_name === 'string' ? detail.metadata.display_name : '';
  return detail.name || metadataName || detail.id;
}

function callableDescription(detail: Pick<CallableDetail, 'description' | 'metadata'>): string {
  return detail.description || (typeof detail.metadata?.summary === 'string' ? detail.metadata.summary : '');
}

function providerLabelFromCallable(detail: Pick<CallableDetail, 'runtime' | 'runner' | 'metadata'>): string {
  const metadataProvider = typeof detail.metadata?.provider === 'string' ? detail.metadata.provider : '';
  const raw = metadataProvider || detail.runtime || detail.runner || 'agent';
  return providerLabel(raw);
}

function providerLabel(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized.includes('codex')) {
    return 'Codex';
  }
  if (normalized.includes('claude')) {
    return 'Claude';
  }
  if (normalized.includes('cursor')) {
    return 'Cursor';
  }
  if (normalized.includes('gemini')) {
    return 'Gemini';
  }
  return provider || 'Agent';
}

function skillsFromMetadata(metadata?: Record<string, unknown>): string[] {
  const skills = metadata?.skills;
  if (Array.isArray(skills)) {
    return skills.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function thinkingLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'high') {
    return '高';
  }
  if (normalized === 'low') {
    return '低';
  }
  return '中';
}
