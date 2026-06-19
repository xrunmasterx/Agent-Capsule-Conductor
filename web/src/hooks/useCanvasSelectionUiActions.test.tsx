import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type {
  CanvasSelection,
  WorkbenchChromeState,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../types/workbench';
import type { ResourceTemplate } from '../components/inspector/ResourceInspector';
import { emptyWorkspaceCanvas } from '../workbench/model/taskModel';
import {
  useCanvasSelectionUiActions,
  type UseCanvasSelectionUiActionsResult,
} from './useCanvasSelectionUiActions';

let latestActions: UseCanvasSelectionUiActionsResult | null = null;
let latestCanvas: WorkspaceCanvasModel | null = null;
let latestChrome: WorkbenchChromeState | null = null;
let latestNodeDetailOpen = false;
let latestSelection: CanvasSelection | null = null;
let latestMessage = '';
let latestResource: ResourceTemplate | null = null;

function workflow(id = 'workflow_1'): WorkflowContainerModel {
  return {
    id,
    title: 'Workflow 1',
    sourceKind: 'workflow',
    directory: 'workflows/workflow_1',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 200 },
    warnings: [],
  };
}

function canvas(): WorkspaceCanvasModel {
  return {
    ...emptyWorkspaceCanvas('task_1', 'Task Canvas'),
    workflows: [workflow()],
  };
}

function Harness({
  initialCanvas = canvas(),
  initialSelection = { type: 'task_canvas', taskId: 'task_1' } as CanvasSelection,
  isRunning = false,
  inspectorWidth = 320,
}: {
  initialCanvas?: WorkspaceCanvasModel;
  initialSelection?: CanvasSelection;
  isRunning?: boolean;
  inspectorWidth?: number;
}) {
  const [currentCanvas, setCanvas] = useState(initialCanvas);
  const [chrome, setChrome] = useState<WorkbenchChromeState>({
    leftPanel: 'none',
    rightPanel: 'none',
    inspectorWidth,
  });
  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection>(initialSelection);
  const [message, setMessage] = useState('');
  const [resource, setResource] = useState<ResourceTemplate | null>(null);

  latestActions = useCanvasSelectionUiActions({
    canvas: currentCanvas,
    selection,
    inspectorWidth: chrome.inspectorWidth,
    isRunning,
    setChrome,
    setNodeDetailOpen,
    setSelection,
    updateCanvas: setCanvas,
    setMessage,
    setSelectedResource: setResource,
  });
  latestCanvas = currentCanvas;
  latestChrome = chrome;
  latestNodeDetailOpen = nodeDetailOpen;
  latestSelection = selection;
  latestMessage = message;
  latestResource = resource;

  return <output>{message}</output>;
}

describe('useCanvasSelectionUiActions', () => {
  afterEach(() => {
    latestActions = null;
    latestCanvas = null;
    latestChrome = null;
    latestNodeDetailOpen = false;
    latestSelection = null;
    latestMessage = '';
    latestResource = null;
  });

  test('selects inspectable objects into the inspector panel', () => {
    render(<Harness />);

    act(() => {
      latestActions?.selectCanvasObject({ type: 'workflow', id: 'workflow_1' });
    });

    expect(latestSelection).toEqual({ type: 'workflow', id: 'workflow_1' });
    expect(latestChrome?.rightPanel).toBe('inspector');
    expect(latestNodeDetailOpen).toBe(false);
  });

  test('selects non-inspectable task canvas and closes node details', () => {
    render(<Harness initialSelection={{ type: 'workflow', id: 'workflow_1' }} />);

    act(() => {
      latestActions?.openNodeDetails({ type: 'workflow', id: 'workflow_1' });
      latestActions?.selectCanvasObject({ type: 'task_canvas', taskId: 'task_1' });
    });

    expect(latestSelection).toEqual({ type: 'task_canvas', taskId: 'task_1' });
    expect(latestChrome?.rightPanel).toBe('none');
    expect(latestNodeDetailOpen).toBe(false);
  });

  test('opens node detail overlay for inspectable selections', () => {
    render(<Harness />);

    act(() => {
      latestActions?.openNodeDetails({ type: 'workflow', id: 'workflow_1' });
    });

    expect(latestSelection).toEqual({ type: 'workflow', id: 'workflow_1' });
    expect(latestNodeDetailOpen).toBe(true);
    expect(latestChrome?.rightPanel).toBe('none');
  });

  test('deletes selected canvas objects and resets selection to task canvas', () => {
    render(<Harness initialSelection={{ type: 'workflow', id: 'workflow_1' }} />);

    act(() => {
      latestActions?.deleteSelectedCanvasObject();
    });

    expect(latestCanvas?.workflows).toEqual([]);
    expect(latestSelection).toEqual({ type: 'task_canvas', taskId: 'task_1' });
    expect(latestMessage).toBe('已删除选中的画布对象。');
  });

  test('reports delete eligibility failures without mutating the canvas', () => {
    render(<Harness initialSelection={{ type: 'workflow', id: 'workflow_1' }} isRunning />);

    act(() => {
      latestActions?.deleteSelectedCanvasObject();
    });

    expect(latestCanvas?.workflows).toHaveLength(1);
    expect(latestSelection).toEqual({ type: 'workflow', id: 'workflow_1' });
    expect(latestMessage).toBeTruthy();
  });

  test('opens callable resources in the resource detail panel', () => {
    render(<Harness />);

    act(() => {
      latestActions?.openCallableResourceFromNode('tool_1', '', 'tool_class');
    });

    expect(latestResource).toEqual({
      kind: 'tool_class',
      callableId: 'tool_1',
      name: 'tool_1',
    });
    expect(latestChrome?.rightPanel).toBe('resourceDetail');
  });

  test('resizes the inspector from pointer movement and unregisters on pointer up', () => {
    const preventDefault = vi.fn();
    render(<Harness inspectorWidth={320} />);

    act(() => {
      latestActions?.startInspectorResize({ preventDefault, clientX: 100 } as never);
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(latestChrome?.inspectorWidth).toBe(370);
  });
});
