import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type {
  CanvasSelection,
  ConnectionMode,
  DataConnectionDraft,
  PortDirection,
  WorkbenchChromeState,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  addPortToDataConnectNode,
  createDataEdgeCommand,
  deletePortFromDataConnectNode,
  renamePortOnDataConnectNode,
  uniqueInputPortIdForNode,
} from '../workbench/model/canvasEdgeOps';
import {
  edgeAddressForScope,
  selectionForEdgeAddress,
} from '../workbench/model/selectionModel';
import { slugId } from '../workbench/model/paletteCanvasOps';
import { addInputPortToDataConnectNode } from '../components/canvas/canvasDataDrop';

export type UseDataConnectionActionsOptions = {
  canvas: WorkspaceCanvasModel;
  dataConnectionDraft: DataConnectionDraft;
  setConnectionMode: (mode: ConnectionMode) => void;
  setDataConnectionDraft: Dispatch<SetStateAction<DataConnectionDraft>>;
  setChrome: Dispatch<SetStateAction<WorkbenchChromeState>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  updateCanvasAndGraph: (next: SetStateAction<WorkspaceCanvasModel>) => void;
};

export type UseDataConnectionActionsResult = {
  beginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  cancelDataConnection: () => void;
  updateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  completeDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  completeDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  addDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  renameDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  deleteDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
};

export function useDataConnectionActions({
  canvas,
  dataConnectionDraft,
  setConnectionMode,
  setDataConnectionDraft,
  setChrome,
  setMessage,
  setSelection,
  updateCanvasAndGraph,
}: UseDataConnectionActionsOptions): UseDataConnectionActionsResult {
  const openInspector = useCallback(() => {
    setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
  }, [setChrome]);

  const beginDataConnection = useCallback(
    (draft: Exclude<DataConnectionDraft, null>) => {
      setConnectionMode('data');
      setDataConnectionDraft(draft);
      openInspector();
      setMessage(`正在连接: ${draft.sourceNodeLabel}.${draft.sourcePortId} -> 请选择目标输入`);
    },
    [openInspector, setConnectionMode, setDataConnectionDraft, setMessage],
  );

  const cancelDataConnection = useCallback(() => {
    setDataConnectionDraft(null);
    setMessage('已取消 Data Edge 连接');
  }, [setDataConnectionDraft, setMessage]);

  const updateDataConnectionMaterialization = useCallback(
    (materialization: 'copy' | 'reference') => {
      setDataConnectionDraft((current) => (current ? { ...current, materialization } : current));
    },
    [setDataConnectionDraft],
  );

  const completeDataConnection = useCallback(
    (
      targetNodeId: string,
      targetPortId: string,
      options: { replaceExisting?: boolean } = {},
    ) => {
      if (!dataConnectionDraft) {
        setMessage('请先选择一个 output port 作为 Data Edge 来源');
        return;
      }
      try {
        const result = createDataEdgeCommand(canvas, {
          ...dataConnectionDraft,
          targetNodeId,
          targetPortId,
          replaceExisting: options.replaceExisting,
        });
        updateCanvasAndGraph(result.canvas);
        setDataConnectionDraft(null);
        setSelection(selectionForEdgeAddress(edgeAddressForScope(dataConnectionDraft.scopeWorkflowId, result.edge.id)));
        openInspector();
        setMessage(
          `已创建 Data Edge: ${dataConnectionDraft.sourceNodeLabel}.${dataConnectionDraft.sourcePortId} -> ${targetNodeId}.${targetPortId}` +
            (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
      }
    },
    [
      canvas,
      dataConnectionDraft,
      openInspector,
      setDataConnectionDraft,
      setMessage,
      setSelection,
      updateCanvasAndGraph,
    ],
  );

  const completeDataConnectionWithNewInputPort = useCallback(
    (targetNodeId: string, requestedPortId: string) => {
      if (!dataConnectionDraft) {
        setMessage('请先选择一个 output port 作为 Data Edge 来源');
        return;
      }
      try {
        const portId = uniqueInputPortIdForNode(
          canvas,
          dataConnectionDraft.scopeWorkflowId,
          targetNodeId,
          requestedPortId,
        );
        const currentWithPort = addInputPortToDataConnectNode(
          canvas,
          dataConnectionDraft.scopeWorkflowId,
          targetNodeId,
          portId,
        );
        const result = createDataEdgeCommand(currentWithPort, {
          ...dataConnectionDraft,
          targetNodeId,
          targetPortId: portId,
        });
        updateCanvasAndGraph(result.canvas);
        setDataConnectionDraft(null);
        setSelection(selectionForEdgeAddress(edgeAddressForScope(dataConnectionDraft.scopeWorkflowId, result.edge.id)));
        openInspector();
        setMessage(
          `已创建输入端口 ${targetNodeId}.${portId} 并连接 Data Edge` +
            (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
      }
    },
    [
      canvas,
      dataConnectionDraft,
      openInspector,
      setDataConnectionDraft,
      setMessage,
      setSelection,
      updateCanvasAndGraph,
    ],
  );

  const addDataConnectPort = useCallback(
    (
      scopeWorkflowId: string | null,
      nodeId: string,
      direction: PortDirection,
      requestedPortId: string,
    ) => {
      const normalizedPortId = slugId(requestedPortId || `${direction}_${Date.now()}`);
      if (!normalizedPortId) {
        setMessage('端口 id 不能为空');
        return;
      }
      try {
        updateCanvasAndGraph((current) =>
          addPortToDataConnectNode(current, scopeWorkflowId, nodeId, direction, normalizedPortId),
        );
        setMessage(`已添加 ${direction} port: ${nodeId}.${normalizedPortId}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '添加端口失败');
      }
    },
    [setMessage, updateCanvasAndGraph],
  );

  const renameDataConnectPort = useCallback(
    (
      scopeWorkflowId: string | null,
      nodeId: string,
      direction: PortDirection,
      portId: string,
      requestedPortId: string,
    ) => {
      const normalizedPortId = slugId(requestedPortId);
      if (!normalizedPortId) {
        setMessage('端口 id 不能为空');
        return;
      }
      try {
        updateCanvasAndGraph((current) =>
          renamePortOnDataConnectNode(current, scopeWorkflowId, nodeId, direction, portId, normalizedPortId),
        );
        setMessage(`已重命名 ${direction} port: ${nodeId}.${portId} -> ${normalizedPortId}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '重命名端口失败');
      }
    },
    [setMessage, updateCanvasAndGraph],
  );

  const deleteDataConnectPort = useCallback(
    (
      scopeWorkflowId: string | null,
      nodeId: string,
      direction: PortDirection,
      portId: string,
    ) => {
      try {
        updateCanvasAndGraph((current) =>
          deletePortFromDataConnectNode(current, scopeWorkflowId, nodeId, direction, portId),
        );
        setMessage(`已删除 ${direction} port: ${nodeId}.${portId}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '删除端口失败');
      }
    },
    [setMessage, updateCanvasAndGraph],
  );

  return {
    beginDataConnection,
    cancelDataConnection,
    updateDataConnectionMaterialization,
    completeDataConnection,
    completeDataConnectionWithNewInputPort,
    addDataConnectPort,
    renameDataConnectPort,
    deleteDataConnectPort,
  };
}
