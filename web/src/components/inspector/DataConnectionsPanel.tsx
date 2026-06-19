import { useMemo, useState, type ReactNode } from 'react';

import type {
  DataConnectionDraft,
  PortDirection,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  buildDataConnectionsModel,
  type DataConnectionPortModel,
} from '../../workbench/model/inspectorActions';

type DataConnectionsPanelProps = {
  canvasNodeKind: 'workflow' | 'internal';
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  nodeId: string;
  nodeLabel: string;
  callableId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  outputPortsReadonly?: boolean;
  dataConnectionDraft: DataConnectionDraft;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenamePort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeletePort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
};

type RenameState = {
  direction: PortDirection;
  portId: string;
  value: string;
} | null;

export function DataConnectionsPanel({
  canvas,
  scopeWorkflowId,
  nodeId,
  nodeLabel,
  callableId,
  inputPorts,
  outputPorts,
  outputPortsReadonly = false,
  dataConnectionDraft,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddPort,
  onRenamePort,
  onDeletePort,
}: DataConnectionsPanelProps) {
  const [newInputPortId, setNewInputPortId] = useState('');
  const [newOutputPortId, setNewOutputPortId] = useState('');
  const [renameState, setRenameState] = useState<RenameState>(null);
  const model = useMemo(
    () =>
      buildDataConnectionsModel({
        canvas,
        scopeWorkflowId,
        nodeId,
        inputPorts,
        outputPorts,
        outputPortsReadonly,
        dataConnectionDraft,
      }),
    [canvas, dataConnectionDraft, inputPorts, nodeId, outputPorts, outputPortsReadonly, scopeWorkflowId],
  );

  function addPort(direction: PortDirection) {
    const requestedPortId = direction === 'input' ? newInputPortId : newOutputPortId;
    onAddPort(scopeWorkflowId, nodeId, direction, requestedPortId);
    if (direction === 'input') {
      setNewInputPortId('');
    } else {
      setNewOutputPortId('');
    }
  }

  function submitRename(direction: PortDirection, currentPortId: string, requestedPortId: string) {
    onRenamePort(scopeWorkflowId, nodeId, direction, currentPortId, requestedPortId);
    setRenameState(null);
  }

  return (
    <section className="inspector-stack data-connections-panel">
      <div className="connection-identity-card">
        <strong>{nodeLabel}</strong>
        <small>{nodeId}</small>
        {callableId ? <small>{callableId}</small> : null}
      </div>

      {dataConnectionDraft ? (
        <div className="data-connect-draft">
          <strong>
            正在连接: {dataConnectionDraft.sourceNodeLabel}.{dataConnectionDraft.sourcePortId}
          </strong>
          <label>
            materialization
            <select
              value={dataConnectionDraft.materialization}
              onChange={(event) =>
                onUpdateDataConnectionMaterialization(
                  event.target.value === 'reference' ? 'reference' : 'copy',
                )
              }
            >
              <option value="copy">copy</option>
              <option value="reference">reference</option>
            </select>
          </label>
          <button type="button" onClick={onCancelDataConnection}>
            取消连接
          </button>
        </div>
      ) : (
        <p className="muted">先从某个 output port 发起连接，再选择目标 input port。</p>
      )}

      <section className="inspector-stack">
        <h4>输出端口</h4>
        {outputPortsReadonly ? (
          <p className="muted">
            输出端口来自 output_schema.properties.outputs.properties，只读展示；需要修改命名输出时请编辑 output schema。
          </p>
        ) : null}
        {model.outputPorts.map((portModel) => (
          <PortConnectionRow
            key={portModel.port.id}
            model={portModel}
            renameState={renameState}
            setRenameState={setRenameState}
            onSubmitRename={submitRename}
            onDeletePort={(direction, portId) => onDeletePort(scopeWorkflowId, nodeId, direction, portId)}
            renderRelated={(related) =>
              related.length > 0
                ? `输出到 ${related.map((edge) => `${edge.target.workflowId}.${edge.target.portId}`).join(', ')}`
                : '暂无下游 data edge'
            }
            extraAction={
              <button
                type="button"
                className="secondary-action-button"
                onClick={() =>
                  onBeginDataConnection({
                    scopeWorkflowId,
                    sourceNodeId: nodeId,
                    sourceNodeLabel: nodeLabel,
                    sourcePortId: portModel.port.id,
                    materialization: 'copy',
                  })
                }
              >
                从此输出连接...
              </button>
            }
          />
        ))}
        {!outputPortsReadonly ? (
          <div className="inline-port-form">
            <input
              value={newOutputPortId}
              onChange={(event) => setNewOutputPortId(event.target.value)}
              placeholder="new_output_port"
              aria-label="new output port id"
            />
            <button type="button" onClick={() => addPort('output')}>
              添加输出端口
            </button>
          </div>
        ) : null}
      </section>

      <section className="inspector-stack">
        <h4>输入端口</h4>
        {model.inputPorts.map((portModel) => (
          <PortConnectionRow
            key={portModel.port.id}
            model={portModel}
            renameState={renameState}
            setRenameState={setRenameState}
            onSubmitRename={submitRename}
            onDeletePort={(direction, portId) => onDeletePort(scopeWorkflowId, nodeId, direction, portId)}
            renderRelated={(related) =>
              related.length > 0
                ? `来自 ${related.map((edge) => `${edge.source.workflowId}.${edge.source.portId}`).join(', ')}`
                : '暂无上游 data edge'
            }
          />
        ))}
        <div className="inline-port-form">
          <input
            value={newInputPortId}
            onChange={(event) => setNewInputPortId(event.target.value)}
            placeholder="new_input_port"
            aria-label="new input port id"
          />
          <button type="button" onClick={() => addPort('input')}>
            添加输入端口
          </button>
        </div>
      </section>

      {dataConnectionDraft && model.sourceScopeMatches ? (
        <section className="inspector-stack">
          <h4>可连接目标</h4>
          {model.targets.map((target) => (
            <article key={target.nodeId} className="connection-target-card">
              <strong>{target.label}</strong>
              <small>{target.nodeId}</small>
              {target.inputPorts.map((targetPort) => (
                <div key={targetPort.port.id} className="connection-target-port">
                  <span>
                    {targetPort.port.id}
                    {targetPort.hasOneCardinalityConflict ? '（已有输入）' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onCompleteDataConnection(target.nodeId, targetPort.port.id, {
                        replaceExisting: targetPort.hasOneCardinalityConflict,
                      })
                    }
                  >
                    {targetPort.hasOneCardinalityConflict ? '替换连接' : '连接到此输入'}
                  </button>
                  {targetPort.hasOneCardinalityConflict ? (
                    <button
                      type="button"
                      onClick={() =>
                        onCompleteDataConnectionWithNewInputPort(
                          target.nodeId,
                          targetPort.requestedPortId,
                        )
                      }
                    >
                      创建新输入端口并连接
                    </button>
                  ) : null}
                </div>
              ))}
            </article>
          ))}
          {model.targets.length === 0 ? <p className="muted">当前 scope 没有可连接目标。</p> : null}
        </section>
      ) : null}
      {dataConnectionDraft && !model.sourceScopeMatches ? (
        <p className="muted">当前连接来源不在这个 scope 内，请回到来源所在的画布层级。</p>
      ) : null}
    </section>
  );
}

function PortConnectionRow({
  model,
  renameState,
  setRenameState,
  onSubmitRename,
  onDeletePort,
  renderRelated,
  extraAction,
}: {
  model: DataConnectionPortModel;
  renameState: RenameState;
  setRenameState: (state: RenameState) => void;
  onSubmitRename: (direction: PortDirection, currentPortId: string, requestedPortId: string) => void;
  onDeletePort: (direction: PortDirection, portId: string) => void;
  renderRelated: (related: DataConnectionPortModel['relatedEdges']) => string;
  extraAction?: ReactNode;
}) {
  const renameActive =
    renameState?.direction === model.direction && renameState.portId === model.port.id;
  return (
    <article className="port-contract-row">
      <strong>{model.port.id}</strong>
      <span>{model.port.label}</span>
      {model.port.jsonPath ? <small>{model.port.jsonPath}</small> : null}
      {model.port.diagnostic ? <small>{model.port.diagnostic}</small> : null}
      <small>{renderRelated(model.relatedEdges)}</small>
      {extraAction}
      {renameActive ? (
        <div className="inline-port-form">
          <input
            value={renameState.value}
            onChange={(event) =>
              setRenameState({ ...renameState, value: event.target.value })
            }
            aria-label={`rename ${model.direction} port ${model.port.id}`}
          />
          <button
            type="button"
            onClick={() => onSubmitRename(model.direction, model.port.id, renameState.value)}
          >
            保存
          </button>
          <button type="button" onClick={() => setRenameState(null)}>
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="secondary-action-button"
          disabled={model.readonly}
          title={model.readonlyReason}
          onClick={() =>
            setRenameState({ direction: model.direction, portId: model.port.id, value: model.port.id })
          }
        >
          重命名
        </button>
      )}
      <button
        type="button"
        className="secondary-action-button"
        disabled={model.readonly}
        title={model.readonlyReason}
        onClick={() => onDeletePort(model.direction, model.port.id)}
      >
        删除
      </button>
    </article>
  );
}
