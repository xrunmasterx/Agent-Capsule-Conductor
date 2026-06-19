import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';

import type {
  CanvasSelection,
  ConnectionMode,
  DataConnectionDraft,
  WorkbenchChromeState,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { findDataConnectNode } from '../../workbench/model/canvasEdgeOps';
import { normalizeWorkbenchSelection } from '../../workbench/model/selectionModel';
import { selectionKey } from '../../workbench/model/workflowViewerShell';

export type WorkflowViewerCanvasGuardsOptions = {
  displayCanvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  focusedWorkflowId: string | null;
  connectionMode: ConnectionMode;
  dataConnectionDraft: DataConnectionDraft;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setChrome: Dispatch<SetStateAction<WorkbenchChromeState>>;
  setNodeDetailOpen: (open: boolean) => void;
  setDataConnectionDraft: Dispatch<SetStateAction<DataConnectionDraft>>;
};

export function useWorkflowViewerCanvasGuards({
  displayCanvas,
  selection,
  focusedWorkflowId,
  connectionMode,
  dataConnectionDraft,
  setSelection,
  setChrome,
  setNodeDetailOpen,
  setDataConnectionDraft,
}: WorkflowViewerCanvasGuardsOptions): void {
  const normalizedSelection = useMemo(
    () => normalizeWorkbenchSelection(displayCanvas, selection, focusedWorkflowId),
    [displayCanvas, focusedWorkflowId, selection],
  );

  useEffect(() => {
    if (selectionKey(normalizedSelection) !== selectionKey(selection)) {
      setSelection(normalizedSelection);
      if (normalizedSelection.type === 'task_canvas') {
        setChrome((current) => ({ ...current, rightPanel: 'none' }));
        setNodeDetailOpen(false);
      }
    }
  }, [normalizedSelection, selection, setChrome, setNodeDetailOpen, setSelection]);

  useEffect(() => {
    if (connectionMode !== 'data') {
      setDataConnectionDraft(null);
    }
  }, [connectionMode, setDataConnectionDraft]);

  useEffect(() => {
    if (!dataConnectionDraft) {
      return;
    }
    const sourceNode = findDataConnectNode(
      displayCanvas,
      dataConnectionDraft.scopeWorkflowId,
      dataConnectionDraft.sourceNodeId,
    );
    const hasSourcePort = sourceNode?.outputPorts.some(
      (portValue) => portValue.id === dataConnectionDraft.sourcePortId,
    );
    if (!sourceNode || !hasSourcePort) {
      setDataConnectionDraft(null);
    }
  }, [dataConnectionDraft, displayCanvas, setDataConnectionDraft]);
}
