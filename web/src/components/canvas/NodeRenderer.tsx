import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Bot, FolderCog, LayoutDashboard, TestTube } from 'lucide-react';
import { Fragment, createContext, memo, useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { AGENT_CONTROL_HANDLE_TOP, AGENT_MAX_DATA_PORTS, AGENT_TOOL_NODE_SIZE, agentDataPortTop } from '../../workbench/constants';
import type { WorkflowBindingView } from '../../types';
import type { CanvasSelection, ConnectionMode, EdgeViewMode, WorkflowContainerModel, WorkflowPortView, WorkflowStatus } from '../../types/workbench';
import { bindingDirectory, statusLabel } from '../../workbench/model/selectedNodeModel';
import { workflowInvocationLabel } from '../../workbench/model/selectionModel';
import { outputPortTooltip } from '../../workbench/model/schemaPorts';
import { controlSourceTokenId, controlTargetTokenId, parsePortToken, portTokenId, workflowInputInnerSourceTokenId, workflowInputOuterTargetTokenId, workflowOutputInnerTargetTokenId, workflowOutputOuterSourceTokenId, type EndpointSide } from '../../workbench/model/canvasEdgeOps';
import type { EdgeAddress } from '../workflow-viewer/workflowConnectionState';


function visibleAgentDataPorts(ports: WorkflowPortView[]): WorkflowPortView[] {
  return ports.slice(0, AGENT_MAX_DATA_PORTS);
}

function connectionHandleSelector(mode?: ConnectionMode): string {
  if (mode === 'control') {
    return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle';
  }
  if (mode === 'data') {
    return '.workflow-port-handle';
  }
  return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle, .workflow-port-handle, .react-flow__handle';
}

function closestConnectionHandle(element: Element | null): HTMLElement | null {
  const handle = element?.closest?.(connectionHandleSelector());
  return handle instanceof HTMLElement ? handle : null;
}

function isConnectionHandleForMode(handle: HTMLElement, mode: ConnectionMode): boolean {
  if (mode === 'control') {
    return (
      handle.classList.contains('acc-connect-hitbox') ||
      handle.classList.contains('workflow-control-handle') ||
      handle.classList.contains('agent-control-handle')
    );
  }
  return handle.classList.contains('workflow-port-handle');
}

function connectionSideFromHandleElement(handle: HTMLElement): EndpointSide | null {
  const handleId = handle.getAttribute('data-handleid') || '';
  if (handleId.endsWith(':control:source') || handleId.includes('workflow-input-inner-source') || handleId.includes('workflow-output-outer-source')) {
    return 'source';
  }
  if (handleId.endsWith(':control:target') || handleId.includes('workflow-input-outer-target') || handleId.includes('workflow-output-inner-target')) {
    return 'target';
  }
  if (handle.classList.contains('source')) {
    return 'source';
  }
  if (handle.classList.contains('target')) {
    return 'target';
  }
  return null;
}

function queueControlHandleConnectionStart(
  target: EventTarget | null,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  mode: ConnectionMode = 'control',
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const handle = closestConnectionHandle(target);
  if (!(handle instanceof HTMLElement)) {
    return false;
  }
  if (!isConnectionHandleForMode(handle, mode)) {
    return false;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  const handleId = handle.getAttribute('data-handleid');
  const side = connectionSideFromHandleElement(handle);
  if (!nodeId || !handleId || !side) {
    return false;
  }
  onControlHandleMouseDown(nodeId, handleId, side, mode);
  return true;
}

export type WorkflowNodeData = {
  workflow: WorkflowContainerModel;
  binding?: WorkflowBindingView;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  selected: boolean;
  dataDropHint?: string;
  showDataPorts: boolean;
  showDataPortLabels?: boolean;
  onSelectEdge: (address: EdgeAddress, altKey?: boolean) => void;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onSelectInternal: (workflowId: string, nodeId: string) => void;
  onOpenNodeDetails: (selection: CanvasSelection) => void;
  onOpenFocus: (workflowId: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
  onResize: (workflowId: string, size: { width: number; height: number }) => void;
  onMoveInternal: (
    workflowId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

export type AgentToolNodeData = {
  id: string;
  title: string;
  subtitle?: string;
  scopeLabel?: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId?: string;
  temporaryResourceId?: string;
  workflowId?: string;
  internalNodeId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  size: { width: number; height: number };
  selected: boolean;
  dataDropHint?: string;
  showDataPorts: boolean;
  showDataPortLabels?: boolean;
  onSelect: () => void;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

export type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowContainer'>;
export type AgentToolFlowNode = Node<AgentToolNodeData, 'agentToolNode'>;
export type CanvasFlowNode = WorkflowFlowNode | AgentToolFlowNode;
export const FlowNodeLayoutContext = createContext<CanvasFlowNode[]>([]);

export const nodeTypes = { workflowContainer: memo(WorkflowContainer), agentToolNode: memo(AgentToolNode) };


export function WorkflowContainer({
  id,
  data,
}: NodeProps<WorkflowFlowNode>) {
  const workflow = data.workflow;
  const showPortLabels = data.showDataPorts && (data.showDataPortLabels || data.selected);
  return (
    <article
      className={[
        'workflow-container',
        workflow.boundaryKind ? 'workflow-boundary-container' : '',
        `status-${workflow.status}`,
        data.selected ? 'selected' : '',
        data.dataDropHint ? 'data-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`workflow-container-${id}`}
      data-workflow-id={workflow.id}
      style={{ width: workflow.size.width, height: workflow.size.height }}
      onPointerDownCapture={(event) => {
        queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
      }}
      onMouseDownCapture={(event) => {
        queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
      }}
    >
      <NodeResizer
        color="#1d78d6"
        isVisible={data.selected}
        minWidth={260}
        minHeight={190}
        onResize={(_, params) =>
          data.onResize(workflow.id, {
            width: Math.round(params.width),
            height: Math.round(params.height),
          })
        }
      />
      <Handle
        type="target"
        position={Position.Left}
        id={workflowInputOuterTargetTokenId(workflow.id)}
        className="workflow-control-handle input workflow-shell-outer-input"
        data-nodeid={workflow.id}
        data-handleid={workflowInputOuterTargetTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetTokenId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetTokenId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputOuterTargetTokenId(workflow.id)}
        side="target"
        className="input workflow-shell-outer-input"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowInputInnerSourceTokenId(workflow.id)}
        className="workflow-control-handle input workflow-shell-inner-input workflow-boundary-source"
        data-nodeid={workflow.id}
        data-handleid={workflowInputInnerSourceTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceTokenId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceTokenId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputInnerSourceTokenId(workflow.id)}
        side="source"
        className="input workflow-shell-inner-input workflow-boundary-source"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowOutputOuterSourceTokenId(workflow.id)}
        className="workflow-control-handle output workflow-shell-outer-output"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputOuterSourceTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceTokenId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceTokenId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputOuterSourceTokenId(workflow.id)}
        side="source"
        className="output workflow-shell-outer-output"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={workflowOutputInnerTargetTokenId(workflow.id)}
        className="workflow-control-handle output workflow-shell-inner-output workflow-boundary-target"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputInnerTargetTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetTokenId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetTokenId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputInnerTargetTokenId(workflow.id)}
        side="target"
        className="output workflow-shell-inner-output workflow-boundary-target"
        onStart={data.onControlHandleMouseDown}
      />
      <WorkflowHeader
        workflow={workflow}
        directory={bindingDirectory(workflow, data.binding)}
        status={data.binding?.status || 'unbound'}
        onOpenFocus={() => data.onOpenFocus(workflow.id)}
        onConfigure={() => data.onConfigureWorkflow(workflow.id)}
      />
      {data.dataDropHint ? <div className="data-drop-hint">{data.dataDropHint}</div> : null}
      <WorkflowBoundaryPortHandles
        workflow={workflow}
        showDataPorts={data.showDataPorts}
        showDataPortLabels={showPortLabels}
        onSelectPort={data.onSelectPort}
      />
      <div
        className="workflow-nested-canvas"
        data-drop-scope="workflow-internal"
        data-workflow-id={workflow.id}
      >
        <div className="internal-node-grid" aria-label={`${workflow.title} internal nodes`} />
      </div>
    </article>
  );
}

function WorkflowBoundaryPortHandles({
  workflow,
  showDataPorts,
  showDataPortLabels,
  onSelectPort,
}: {
  workflow: WorkflowContainerModel;
  showDataPorts: boolean;
  showDataPortLabels: boolean;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
}) {
  const visibleInputPorts = visibleAgentDataPorts(workflow.inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(workflow.outputPorts);
  return (
    <div
      className="workflow-hidden-port-handles"
      data-drop-scope="workflow-internal"
      data-workflow-id={workflow.id}
    >
      {visibleInputPorts.map((port, index) => {
        const top = agentDataPortTop(index, visibleInputPorts.length, workflow.size.height);
        const handleId = portTokenId(workflow.id, 'input', port.id);
        return (
          <Fragment key={`input-${port.id}`}>
            <Handle
              type="target"
              position={Position.Left}
              id={handleId}
              className={['workflow-port-handle', showDataPorts ? '' : 'hidden', 'input'].filter(Boolean).join(' ')}
              data-nodeid={workflow.id}
              data-handleid={handleId}
              data-acc-connection-mode="data"
              data-acc-connection-side="target"
              style={{ top }}
              title={`数据输入端口: ${port.id}`}
            />
            {showDataPorts ? (
              <button
                type="button"
                className="workflow-port-click-target input nodrag nopan"
                style={{ top }}
                title={`数据输入端口: ${port.id}`}
                aria-label={`选择数据输入端口 ${port.id}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
              />
            ) : null}
            {showDataPortLabels ? (
              <span
                className="workflow-port-label input workflow-boundary-port-label"
                style={{ top }}
                title={`数据输入端口: ${port.id}`}
              >
                {port.id}
              </span>
            ) : null}
          </Fragment>
        );
      })}
      {visibleOutputPorts.map((port, index) => {
        const top = agentDataPortTop(index, visibleOutputPorts.length, workflow.size.height);
        const handleId = portTokenId(workflow.id, 'output', port.id);
        const tooltip = outputPortTooltip(port);
        return (
          <Fragment key={`output-${port.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={handleId}
              className={['workflow-port-handle', showDataPorts ? '' : 'hidden', 'output'].filter(Boolean).join(' ')}
              data-nodeid={workflow.id}
              data-handleid={handleId}
              data-acc-connection-mode="data"
              data-acc-connection-side="source"
              style={{ top }}
              title={tooltip || `数据输出端口: ${port.id}`}
            />
            {showDataPorts ? (
              <button
                type="button"
                className="workflow-port-click-target output nodrag nopan"
                style={{ top }}
                title={tooltip || `数据输出端口: ${port.id}`}
                aria-label={`选择数据输出端口 ${port.id}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
              />
            ) : null}
            {showDataPortLabels ? (
              <span
                className="workflow-port-label output workflow-boundary-port-label"
                style={{ top }}
                title={tooltip || `数据输出端口: ${port.id}`}
              >
                {port.id}
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function ControlConnectHitbox({
  nodeId,
  handleId,
  side,
  className,
  style,
  onStart,
}: {
  nodeId: string;
  handleId: string;
  side: EndpointSide;
  className?: string;
  style?: CSSProperties;
  onStart: (nodeId: string, handleId: string, side: EndpointSide, mode?: ConnectionMode) => void;
}) {
  const startConnection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
      if ('button' in event && typeof event.button === 'number' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onStart(nodeId, handleId, side, 'control');
    },
    [handleId, nodeId, onStart, side],
  );

  return (
    <div
      aria-hidden="true"
      className={['acc-connect-hitbox', side, className].filter(Boolean).join(' ')}
      data-nodeid={nodeId}
      data-handleid={handleId}
      data-acc-connection-mode="control"
      data-acc-connection-side={side}
      style={style}
      onPointerDown={startConnection}
      onMouseDown={startConnection}
      onTouchStart={startConnection}
    />
  );
}


function HiddenAgentPortHandles({
  nodeId,
  inputPorts,
  outputPorts,
  nodeHeight,
}: {
  nodeId: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  nodeHeight: number;
}) {
  const visibleInputPorts = visibleAgentDataPorts(inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(outputPorts);
  return (
    <div className="workflow-hidden-port-handles" aria-hidden="true">
      {visibleInputPorts.map((portValue, index) => (
        <Handle
          key={`input-${portValue.id}`}
          id={portTokenId(nodeId, 'input', portValue.id)}
          type="target"
          position={Position.Left}
          className="workflow-port-handle hidden input"
          data-nodeid={nodeId}
          data-handleid={portTokenId(nodeId, 'input', portValue.id)}
          data-acc-connection-mode="data"
          data-acc-connection-side="target"
          style={{ top: agentDataPortTop(index, visibleInputPorts.length, nodeHeight) }}
        />
      ))}
      {visibleOutputPorts.map((portValue, index) => (
        <Handle
          key={`output-${portValue.id}`}
          id={portTokenId(nodeId, 'output', portValue.id)}
          type="source"
          position={Position.Right}
          className="workflow-port-handle hidden output"
          data-nodeid={nodeId}
          data-handleid={portTokenId(nodeId, 'output', portValue.id)}
          data-acc-connection-mode="data"
          data-acc-connection-side="source"
          style={{ top: agentDataPortTop(index, visibleOutputPorts.length, nodeHeight) }}
        />
      ))}
    </div>
  );
}


export function AgentToolNode({
  data,
}: NodeProps<AgentToolFlowNode>) {
  const nodeSize = data.size || AGENT_TOOL_NODE_SIZE;
  const visibleInputPorts = visibleAgentDataPorts(data.inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(data.outputPorts);
  const showPortLabels = data.showDataPorts && (data.showDataPortLabels || data.selected);

  function queuePortSelection(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    const portHandle = target.closest('.workflow-port-handle');
    const parsed = parsePortToken(portHandle?.getAttribute('data-handleid'));
    if (!data.showDataPorts || !parsed || parsed.workflowId !== data.id) {
      return false;
    }
    const ports = parsed.direction === 'input' ? data.inputPorts : data.outputPorts;
    const portValue = ports.find((port) => port.id === parsed.portId);
    if (!portValue) {
      return false;
    }
    window.setTimeout(() => data.onSelectPort(data.id, portValue), 0);
    return true;
  }

  return (
    <div
      role="group"
      tabIndex={0}
      className={[
        'agent-tool-node',
        'nopan',
        data.showDataPorts ? 'data-ports-visible' : '',
        data.kind === 'Tool' ? 'tool' : 'agent',
        `status-${data.status}`,
        data.selected ? 'selected' : '',
        data.dataDropHint ? 'data-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`agent-tool-node-${data.id}`}
      style={{ width: nodeSize.width, minHeight: nodeSize.height }}
      onPointerDownCapture={(event) => {
        if (queuePortSelection(event.target)) {
          return;
        }
        if (!(event.target instanceof Element)) {
          data.onSelect();
          return;
        }
        if (closestConnectionHandle(event.target)) {
          queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
          return;
        }
        data.onSelect();
      }}
      onMouseDownCapture={(event) => {
        if (queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown)) {
          return;
        }
        queuePortSelection(event.target);
      }}
      onPointerUpCapture={(event) => {
        if (!(event.target instanceof Element) || !data.showDataPorts) {
          return;
        }
        const handle = event.target.closest('.workflow-port-handle');
        const parsed = parsePortToken(handle?.getAttribute('data-handleid'));
        if (!parsed || parsed.workflowId !== data.id) {
          return;
        }
        const ports = parsed.direction === 'input' ? data.inputPorts : data.outputPorts;
        const portValue = ports.find((port) => port.id === parsed.portId);
        if (portValue) {
          data.onSelectPort(data.id, portValue);
        }
      }}
      onFocus={data.onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        data.onSelect();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (queuePortSelection(event.target)) {
          return;
        }
        data.onSelect();
      }}
    >
      <Handle
        id={controlTargetTokenId(data.id)}
        type="target"
        position={Position.Left}
        className="workflow-control-handle input agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlTargetTokenId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlTargetTokenId(data.id), 'target', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlTargetTokenId(data.id), 'target', 'control')}
        title="控制输入：接收运行顺序；是否收到完整输出取决于上游节点的“控制线传递完整输出”开关"
        aria-label="控制输入端口，接收运行顺序和可能的完整输出"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlTargetTokenId(data.id)}
        side="target"
        className="input agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        id={controlSourceTokenId(data.id)}
        type="source"
        position={Position.Right}
        className="workflow-control-handle output agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlSourceTokenId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlSourceTokenId(data.id), 'source', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlSourceTokenId(data.id), 'source', 'control')}
        title="控制输出：开启“控制线传递完整输出”时，下游 main input 会收到该节点完整输出"
        aria-label="控制输出端口，连接运行顺序和可能的完整输出"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlSourceTokenId(data.id)}
        side="source"
        className="output agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      {!data.showDataPorts ? (
        <HiddenAgentPortHandles
          nodeId={data.id}
          inputPorts={visibleInputPorts}
          outputPorts={visibleOutputPorts}
          nodeHeight={nodeSize.height}
        />
      ) : null}
      {data.showDataPorts
        ? visibleInputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index, visibleInputPorts.length, nodeSize.height);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portTokenId(data.id, 'input', portValue.id)}
                  type="target"
                  position={Position.Left}
                  className="workflow-port-handle input"
                  data-nodeid={data.id}
                  data-handleid={portTokenId(data.id, 'input', portValue.id)}
                  data-acc-connection-mode="data"
                  data-acc-connection-side="target"
                  style={{ top: portTop }}
                  title={`数据输入端口: ${portValue.id}`}
                  aria-label={`数据输入端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target input nodrag nopan"
                  style={{ top: portTop }}
                  title={`数据输入端口: ${portValue.id}`}
                  aria-label={`选择数据输入端口 ${portValue.id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                />
                {showPortLabels ? (
                  <span
                    className="workflow-port-label input"
                    style={{ top: portTop }}
                    title={`数据输入端口: ${portValue.id}`}
                  >
                    {portValue.id}
                  </span>
                ) : null}
              </Fragment>
            );
          })
        : null}
      {data.showDataPorts
        ? visibleOutputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index, visibleOutputPorts.length, nodeSize.height);
            const tooltip = outputPortTooltip(portValue);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portTokenId(data.id, 'output', portValue.id)}
                  type="source"
                  position={Position.Right}
                  className="workflow-port-handle output"
                  data-nodeid={data.id}
                  data-handleid={portTokenId(data.id, 'output', portValue.id)}
                  data-acc-connection-mode="data"
                  data-acc-connection-side="source"
                  style={{ top: portTop }}
                  title={tooltip || `数据输出端口: ${portValue.id}`}
                  aria-label={`数据输出端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target output nodrag nopan"
                  style={{ top: portTop }}
                  title={tooltip || `数据输出端口: ${portValue.id}`}
                  aria-label={`选择数据输出端口 ${portValue.id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                />
                {showPortLabels ? (
                  <span
                    className="workflow-port-label output"
                    style={{ top: portTop }}
                    title={tooltip || `数据输出端口: ${portValue.id}`}
                  >
                    {portValue.id}
                  </span>
                ) : null}
              </Fragment>
            );
          })
        : null}
      <div className="agent-node-topline">
        <span className={`agent-node-icon ${data.kind === 'Tool' ? 'tool' : 'agent'}`}>
          {data.kind === 'Tool' ? <TestTube aria-hidden="true" size={14} /> : <Bot aria-hidden="true" size={14} />}
        </span>
        {data.temporaryResourceId ? <span className="node-badge temporary">临时</span> : null}
        <span className={`node-status-chip ${data.status}`}>{statusLabel(data.status)}</span>
      </div>
      <div className="agent-node-main">
        <strong title={data.title}>{data.title}</strong>
        {data.subtitle || !data.callableId ? (
          <p title={data.subtitle || ''}>{data.subtitle || '未绑定模板'}</p>
        ) : null}
        {data.scopeLabel ? <span className="node-scope-badge">{data.scopeLabel}</span> : null}
      </div>
      {data.dataDropHint ? <div className="data-drop-hint">{data.dataDropHint}</div> : null}
        <div className="agent-node-footer">
          <span className={data.kind === 'Tool' ? 'node-badge tool' : 'node-badge agent'}>
            {data.kind === 'Tool' ? 'Tool' : 'Agent'}
          </span>
          {!data.callableId ? <small>模板缺失</small> : null}
        </div>
    </div>
  );
}


function WorkflowHeader({
  workflow,
  directory,
  status,
  onOpenFocus,
  onConfigure,
}: {
  workflow: WorkflowContainerModel;
  directory: string;
  status: string;
  onOpenFocus: () => void;
  onConfigure: () => void;
}) {
  const inputCount = visibleAgentDataPorts(workflow.inputPorts).length;
  const outputCount = visibleAgentDataPorts(workflow.outputPorts).length;
  const nodeCount = workflow.internalNodes.length;
  return (
    <header className="workflow-container-header">
      <span className={`workflow-status-marker ${workflow.status}`} aria-label={statusLabel(workflow.status)} />
      <h3>{workflowInvocationLabel(workflow)}</h3>
      <div
        className="workflow-stage-meta"
        title={`阶段包含 ${nodeCount} 个节点，${inputCount} 个输入端口，${outputCount} 个输出端口`}
      >
        <span>{nodeCount} 节点</span>
        <span>{inputCount} 输入</span>
        <span>{outputCount} 输出</span>
      </div>
      <div className={`workflow-directory-line ${status}`}>
        <span>{directory}</span>
        {!workflow.boundaryKind ? (
          <button
            type="button"
            aria-label="聚焦此 Workflow"
            title="聚焦此 Workflow"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFocus();
            }}
          >
            <LayoutDashboard size={13} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="配置工作目录"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure();
          }}
        >
          <FolderCog size={13} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
