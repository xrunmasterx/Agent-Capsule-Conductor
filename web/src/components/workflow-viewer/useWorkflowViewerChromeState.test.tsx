import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  BottomDockMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
} from '../../types/workbench';
import type { EvidenceDockState } from '../../hooks/useEvidenceDockActions';
import { useWorkflowViewerChromeState } from './useWorkflowViewerChromeState';

function chrome(rightPanel: WorkbenchChromeState['rightPanel'] = 'inspector'): WorkbenchChromeState {
  return {
    rightPanel,
    inspectorWidth: 360,
    leftPanel: 'resources',
  };
}

function evidenceDock(open = false): EvidenceDockState {
  return {
    open,
    title: 'Evidence',
    content: null,
  };
}

function applyEvidenceUpdate(
  update: EvidenceDockState | ((current: EvidenceDockState) => EvidenceDockState),
  current = evidenceDock(false),
): EvidenceDockState {
  return typeof update === 'function' ? update(current) : update;
}

describe('useWorkflowViewerChromeState', () => {
  test('projects right panel and dock visibility from workbench chrome state', () => {
    const { result } = renderHook(() =>
      useWorkflowViewerChromeState({
        taskWorkspaceView: 'blueprint',
        setTaskWorkspaceView: vi.fn(),
        chrome: chrome('resourceDetail'),
        bottomDockMode: 'assistant',
        setBottomDockMode: vi.fn(),
        evidenceDock: evidenceDock(true),
        setEvidenceDock: vi.fn(),
      }),
    );

    expect(result.current.blueprintViewActive).toBe(true);
    expect(result.current.resourceDetailOpen).toBe(true);
    expect(result.current.inspectorOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(true);
    expect(result.current.inspectorWidth).toBe(360);
  });

  test('assistant toggle returns overview users to blueprint and opens the assistant dock', () => {
    const setTaskWorkspaceView = vi.fn();
    const setBottomDockMode = vi.fn();
    const setEvidenceDock = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowViewerChromeState({
        taskWorkspaceView: 'overview',
        setTaskWorkspaceView,
        chrome: chrome('inspector'),
        bottomDockMode: 'evidence',
        setBottomDockMode,
        evidenceDock: evidenceDock(false),
        setEvidenceDock,
      }),
    );

    act(() => {
      result.current.toggleAssistantDock();
    });

    expect(setTaskWorkspaceView).toHaveBeenCalledWith('blueprint');
    expect(setBottomDockMode).toHaveBeenCalledWith('assistant');
    expect(applyEvidenceUpdate(setEvidenceDock.mock.calls[0][0]).open).toBe(true);
  });

  test('details toggle closes an already open evidence dock in blueprint view', () => {
    const setEvidenceDock = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowViewerChromeState({
        taskWorkspaceView: 'blueprint',
        setTaskWorkspaceView: vi.fn(),
        chrome: chrome('inspector'),
        bottomDockMode: 'evidence',
        setBottomDockMode: vi.fn(),
        evidenceDock: evidenceDock(true),
        setEvidenceDock,
      }),
    );

    act(() => {
      result.current.toggleDetailsDock();
    });

    expect(applyEvidenceUpdate(setEvidenceDock.mock.calls[0][0], evidenceDock(true)).open).toBe(false);
  });
});
