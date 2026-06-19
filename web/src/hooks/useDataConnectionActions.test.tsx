import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState, type SetStateAction } from 'react';

import type {
  CanvasSelection,
  ConnectionMode,
  DataConnectionDraft,
  WorkbenchChromeState,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  useDataConnectionActions,
  type UseDataConnectionActionsResult,
} from './useDataConnectionActions';

type HarnessState = {
  canvas: WorkspaceCanvasModel;
  dataConnectionDraft: DataConnectionDraft;
  connectionMode: ConnectionMode;
  chrome: WorkbenchChromeState;
  message: string;
  selection: CanvasSelection;
};

let latestActions: UseDataConnectionActionsResult | null = null;
let latestState: HarnessState | null = null;

function applySetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    required: false,
    cardinality: 'one',
    artifactTypes: ['artifact'],
  };
}

function node(
  id: string,
  inputPorts: WorkflowPortView[],
  outputPorts: WorkflowPortView[],
): WorkflowContainerModel {
  return {
    id,
    title: id,
    sourceKind: 'agent_session',
    callableId: `${id}.codex`,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts,
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 276, height: 132 },
    warnings: [],
  };
}

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_canvas',
    name: '任务',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task_canvas',
    workflows: [
      node('source_agent', [], [port('main', 'output')]),
      node('target_agent', [port('main', 'input'), port('payload', 'input')], []),
    ],
    edges: [],
  };
}

function sourceDraft(): Exclude<DataConnectionDraft, null> {
  return {
    scopeWorkflowId: null,
    sourceNodeId: 'source_agent',
    sourceNodeLabel: 'Source Agent',
    sourcePortId: 'main',
    materialization: 'copy',
  };
}

function Harness({ initialCanvas = canvas() }: { initialCanvas?: WorkspaceCanvasModel }) {
  const [currentCanvas, setCurrentCanvas] = useState(initialCanvas);
  const [dataConnectionDraft, setDataConnectionDraft] = useState<DataConnectionDraft>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('control');
  const [chrome, setChrome] = useState<WorkbenchChromeState>({
    leftPanel: 'resources',
    rightPanel: 'none',
    inspectorWidth: 390,
  });
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: initialCanvas.id,
  });

  latestActions = useDataConnectionActions({
    canvas: currentCanvas,
    dataConnectionDraft,
    setConnectionMode,
    setDataConnectionDraft,
    setChrome,
    setMessage,
    setSelection,
    updateCanvasAndGraph: (next) => {
      setCurrentCanvas((current) => applySetState(current, next));
    },
  });
  latestState = {
    canvas: currentCanvas,
    dataConnectionDraft,
    connectionMode,
    chrome,
    message,
    selection,
  };

  return <output>{message}</output>;
}

function dataEdges(edges: WorkflowCanvasEdge[]): Extract<WorkflowCanvasEdge, { kind: 'data' }>[] {
  return edges.filter((edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => edge.kind === 'data');
}

describe('useDataConnectionActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'));
  });

  afterEach(() => {
    latestActions = null;
    latestState = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('starts and cancels a data connection draft', () => {
    render(<Harness />);

    act(() => {
      latestActions?.beginDataConnection(sourceDraft());
    });

    expect(latestState?.connectionMode).toBe('data');
    expect(latestState?.dataConnectionDraft?.sourceNodeId).toBe('source_agent');
    expect(latestState?.chrome.rightPanel).toBe('inspector');
    expect(latestState?.message).toBe('正在连接: Source Agent.main -> 请选择目标输入');

    act(() => {
      latestActions?.cancelDataConnection();
    });

    expect(latestState?.dataConnectionDraft).toBeNull();
    expect(latestState?.message).toBe('已取消 Data Edge 连接');
  });

  test('reports a clear error when completing without a source draft', () => {
    render(<Harness />);

    act(() => {
      latestActions?.completeDataConnection('target_agent', 'main');
    });

    expect(latestState?.message).toBe('请先选择一个 output port 作为 Data Edge 来源');
    expect(latestState?.canvas.edges).toHaveLength(0);
  });

  test('creates a data edge from the selected source draft to a target input port', () => {
    render(<Harness />);

    act(() => {
      latestActions?.beginDataConnection(sourceDraft());
    });
    act(() => {
      latestActions?.completeDataConnection('target_agent', 'payload');
    });

    const edge = dataEdges(latestState?.canvas.edges || [])[0];
    expect(edge).toMatchObject({
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_agent', portId: 'payload' },
      materialization: 'copy',
    });
    expect(latestState?.dataConnectionDraft).toBeNull();
    expect(latestState?.selection.type).toBe('edge');
    expect(latestState?.message).toContain('已创建 Data Edge: Source Agent.main -> target_agent.payload');
  });

  test('creates a new input port before connecting a data edge', () => {
    render(<Harness />);

    act(() => {
      latestActions?.beginDataConnection(sourceDraft());
    });
    act(() => {
      latestActions?.completeDataConnectionWithNewInputPort('target_agent', 'Evidence Pack');
    });

    const target = latestState?.canvas.workflows.find((item) => item.id === 'target_agent');
    const edge = dataEdges(latestState?.canvas.edges || [])[0];
    expect(target?.inputPorts.map((item) => item.id)).toContain('Evidence_Pack');
    expect(edge?.target.portId).toBe('Evidence_Pack');
    expect(latestState?.message).toContain('已创建输入端口 target_agent.Evidence_Pack 并连接 Data Edge');
  });

  test('adds, renames, and deletes data connect ports', () => {
    render(<Harness />);

    act(() => {
      latestActions?.addDataConnectPort(null, 'target_agent', 'input', 'review notes');
    });
    expect(
      latestState?.canvas.workflows.find((item) => item.id === 'target_agent')?.inputPorts.map((item) => item.id),
    ).toContain('review_notes');
    expect(latestState?.message).toBe('已添加 input port: target_agent.review_notes');

    act(() => {
      latestActions?.renameDataConnectPort(null, 'target_agent', 'input', 'review_notes', 'reviewed notes');
    });
    expect(
      latestState?.canvas.workflows.find((item) => item.id === 'target_agent')?.inputPorts.map((item) => item.id),
    ).toContain('reviewed_notes');
    expect(latestState?.message).toBe('已重命名 input port: target_agent.review_notes -> reviewed_notes');

    act(() => {
      latestActions?.deleteDataConnectPort(null, 'target_agent', 'input', 'reviewed_notes');
    });
    expect(
      latestState?.canvas.workflows.find((item) => item.id === 'target_agent')?.inputPorts.map((item) => item.id),
    ).not.toContain('reviewed_notes');
    expect(latestState?.message).toBe('已删除 input port: target_agent.reviewed_notes');
  });
});
