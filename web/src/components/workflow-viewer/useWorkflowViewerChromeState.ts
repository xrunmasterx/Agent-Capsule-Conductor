import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import type {
  BottomDockMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
} from '../../types/workbench';
import {
  workbenchViewProjection,
  type WorkbenchViewProjection,
} from '../../workbench/model/workbenchViewProjection';
import type { EvidenceDockState } from '../../hooks/useEvidenceDockActions';

export type WorkflowViewerChromeState = {
  viewProjection: WorkbenchViewProjection;
  blueprintViewActive: boolean;
  resourceDetailOpen: boolean;
  inspectorOpen: boolean;
  assistantOpen: boolean;
  inspectorWidth: number;
  toggleAssistantDock: () => void;
  toggleDetailsDock: () => void;
};

export type WorkflowViewerChromeStateOptions = {
  taskWorkspaceView: TaskWorkspaceView;
  setTaskWorkspaceView: (view: TaskWorkspaceView) => void;
  chrome: WorkbenchChromeState;
  bottomDockMode: BottomDockMode;
  setBottomDockMode: (mode: BottomDockMode) => void;
  evidenceDock: EvidenceDockState;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
};

export function useWorkflowViewerChromeState({
  taskWorkspaceView,
  setTaskWorkspaceView,
  chrome,
  bottomDockMode,
  setBottomDockMode,
  evidenceDock,
  setEvidenceDock,
}: WorkflowViewerChromeStateOptions): WorkflowViewerChromeState {
  const viewProjection = useMemo(
    () =>
      workbenchViewProjection({
        taskWorkspaceView,
        chrome,
        bottomDockMode,
        evidenceDockOpen: evidenceDock.open,
      }),
    [bottomDockMode, chrome, evidenceDock.open, taskWorkspaceView],
  );

  const openDockMode = useCallback(
    (mode: BottomDockMode) => {
      if (!viewProjection.blueprintActive) {
        setTaskWorkspaceView('blueprint');
        setBottomDockMode(mode);
        setEvidenceDock((current) => ({ ...current, open: true }));
        return;
      }
      const nextOpen = !(bottomDockMode === mode && evidenceDock.open);
      setBottomDockMode(mode);
      setEvidenceDock((current) => ({ ...current, open: nextOpen }));
    },
    [
      bottomDockMode,
      evidenceDock.open,
      setBottomDockMode,
      setEvidenceDock,
      setTaskWorkspaceView,
      viewProjection.blueprintActive,
    ],
  );

  return {
    viewProjection,
    blueprintViewActive: viewProjection.blueprintActive,
    resourceDetailOpen: viewProjection.resourceDetailOpen,
    inspectorOpen: viewProjection.inspectorOpen,
    assistantOpen: viewProjection.assistantOpen,
    inspectorWidth: chrome.inspectorWidth,
    toggleAssistantDock: () => openDockMode('assistant'),
    toggleDetailsDock: () => openDockMode('evidence'),
  };
}
