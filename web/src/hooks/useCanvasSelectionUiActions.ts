import {
  useCallback,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';

import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from '../workbench/constants';
import type {
  CanvasSelection,
  WorkbenchChromeState,
  WorkspaceCanvasModel,
} from '../types/workbench';
import type { ResourceTemplate } from '../components/inspector/ResourceInspector';
import { clamp } from '../workbench/model/canvasLayout';
import {
  isInspectableNodeSelection,
} from '../workbench/model/authoringProposal';
import {
  deleteSelectionFromCanvas,
  selectionCanBeDeleted,
} from '../workbench/model/selectionModel';

export type UseCanvasSelectionUiActionsOptions = {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  inspectorWidth: number;
  isRunning: boolean;
  setChrome: Dispatch<SetStateAction<WorkbenchChromeState>>;
  setNodeDetailOpen: (open: boolean) => void;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  updateCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setSelectedResource: Dispatch<SetStateAction<ResourceTemplate | null>>;
};

export type UseCanvasSelectionUiActionsResult = {
  startInspectorResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleCanvasLayoutPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleCanvasLayoutClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  selectCanvasObject: (nextSelection: CanvasSelection) => void;
  openNodeDetails: (nextSelection: CanvasSelection) => void;
  deleteSelectedCanvasObject: (targetSelection?: CanvasSelection) => void;
  openCallableResourceFromNode: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
};

export function useCanvasSelectionUiActions({
  canvas,
  selection,
  inspectorWidth,
  isRunning,
  setChrome,
  setNodeDetailOpen,
  setSelection,
  updateCanvas,
  setMessage,
  setSelectedResource,
}: UseCanvasSelectionUiActionsOptions): UseCanvasSelectionUiActionsResult {
  const startInspectorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = inspectorWidth;
      const move = (nextEvent: PointerEvent) => {
        const nextWidth = clamp(startWidth + startX - nextEvent.clientX, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH);
        setChrome((current) => ({ ...current, inspectorWidth: nextWidth }));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    },
    [inspectorWidth, setChrome],
  );

  const handleCanvasLayoutPointerDown = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {},
    [],
  );

  const handleCanvasLayoutClick = useCallback(
    (_event: ReactMouseEvent<HTMLDivElement>) => {},
    [],
  );

  const selectCanvasObject = useCallback(
    (nextSelection: CanvasSelection) => {
      setSelection(nextSelection);
      if (!isInspectableNodeSelection(nextSelection)) {
        setNodeDetailOpen(false);
        setChrome((current) => ({ ...current, rightPanel: 'none' }));
        return;
      }
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
    },
    [setChrome, setNodeDetailOpen, setSelection],
  );

  const openNodeDetails = useCallback(
    (nextSelection: CanvasSelection) => {
      setSelection(nextSelection);
      if (!isInspectableNodeSelection(nextSelection)) {
        setNodeDetailOpen(false);
        return;
      }
      setNodeDetailOpen(true);
      setChrome((current) => ({
        ...current,
        rightPanel: 'none',
      }));
    },
    [setChrome, setNodeDetailOpen, setSelection],
  );

  const deleteSelectedCanvasObject = useCallback(
    (targetSelection = selection) => {
      const eligibility = selectionCanBeDeleted(canvas, targetSelection, isRunning);
      if (!eligibility.ok) {
        if (eligibility.reason) {
          setMessage(eligibility.reason);
        }
        return;
      }
      updateCanvas((current) => deleteSelectionFromCanvas(current, targetSelection));
      setSelection({ type: 'task_canvas', taskId: canvas.id });
      setMessage('已删除选中的画布对象。');
    },
    [canvas, isRunning, selection, setMessage, setSelection, updateCanvas],
  );

  const openCallableResourceFromNode = useCallback(
    (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => {
      setSelectedResource({
        kind: kind === 'tool_class' ? 'tool_class' : 'agent_class',
        callableId,
        name: name || callableId,
      });
      setChrome((current) => ({ ...current, rightPanel: 'resourceDetail' }));
    },
    [setChrome, setSelectedResource],
  );

  return {
    startInspectorResize,
    handleCanvasLayoutPointerDown,
    handleCanvasLayoutClick,
    selectCanvasObject,
    openNodeDetails,
    deleteSelectedCanvasObject,
    openCallableResourceFromNode,
  };
}
