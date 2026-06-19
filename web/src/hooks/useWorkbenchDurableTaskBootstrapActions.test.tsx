import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type { CallableSummary, RuntimeConfig, WorkflowGraph, WorkflowSummary } from '../types';
import type { CanvasSelection, WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import type { UseWorkbenchBootstrapOptions } from './useWorkbenchBootstrap';
import { useWorkbenchDurableTaskBootstrapActions } from './useWorkbenchDurableTaskBootstrapActions';

const bootstrapState = vi.hoisted(() => ({
  latestOptions: null as UseWorkbenchBootstrapOptions | null,
  loadRuntimeConfig: vi.fn(),
  loadWorkbenchTaskRecords: vi.fn(),
}));

vi.mock('./useWorkbenchBootstrap', () => ({
  useWorkbenchBootstrapLoaders: () => ({
    loadRuntimeConfig: bootstrapState.loadRuntimeConfig,
    loadWorkbenchTaskRecords: bootstrapState.loadWorkbenchTaskRecords,
  }),
  useWorkbenchBootstrap: (options: UseWorkbenchBootstrapOptions) => {
    bootstrapState.latestOptions = options;
  },
}));

let latestTasks: WorkbenchTask[] = [];
let latestActiveTaskId = '';
let latestCanvas: WorkspaceCanvasModel | null = null;
let latestSourceGraph: WorkflowGraph | null = null;
let latestSelection: CanvasSelection | null = null;
let latestMessage = '';
let latestRuntimeConfig: RuntimeConfig | null = null;
let latestDurableTasksReady = false;
let latestGraphRef: { current: WorkflowGraph } | null = null;

const saveWorkbenchTaskCanvas = vi.fn();
const loadWorkbenchTaskCanvas = vi.fn();

function canvas(partial: Partial<WorkspaceCanvasModel> = {}): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'task_1',
    workflows: [],
    edges: [],
    ...partial,
  };
}

function graph(id = 'task_1'): WorkflowGraph {
  return {
    id,
    name: id,
    version: '1.0.0',
    nodes: [],
    edges: [],
    control_edges: [],
    data_edges: [],
  };
}

function task(partial: Partial<WorkbenchTask> = {}): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: canvas(),
    status: 'not_run',
    ...partial,
  };
}

function callable(): CallableSummary {
  return {
    id: 'callable_1',
    name: 'Callable 1',
    kind: 'agent_class',
  } as CallableSummary;
}

function workflowSummary(): WorkflowSummary {
  return {
    workflow_id: 'workflow_1',
    file_id: 'workflow_1',
    name: 'Workflow 1',
    path: 'workflows/workflow_1.accflow.json',
    task_count: 0,
  };
}

function runtimeConfig(): RuntimeConfig {
  return {
    run_mode: 'hermetic',
    external_agent_execution_enabled: false,
    real_external_agents_enabled: false,
  };
}

function Harness() {
  const callablesRef = useRef<CallableSummary[]>([callable()]);
  const workflowsRef = useRef<WorkflowSummary[]>([workflowSummary()]);
  const graphRef = useRef<WorkflowGraph>(graph('initial'));
  const [tasks, setTasks] = useState<WorkbenchTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState('');
  const [currentCanvas, setCanvas] = useState<WorkspaceCanvasModel>(canvas({ id: 'initial' }));
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(graph('source'));
  const [selection, setSelection] = useState<CanvasSelection>({ type: 'task_canvas', taskId: 'initial' });
  const [message, setMessage] = useState('');
  const [config, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [durableTasksReady, setDurableTasksReady] = useState(false);

  useWorkbenchDurableTaskBootstrapActions({
    initialTaskStore: { version: 1, activeTaskId: 'task_1', tasks: [task()] },
    callablesRef,
    workflowsRef,
    graphRef,
    loadWorkbenchTaskCanvas,
    saveWorkbenchTaskCanvas,
    setRuntimeConfig,
    setTasks,
    setActiveTaskId,
    setCanvas,
    setSourceGraph,
    setSelection,
    setMessage,
    setDurableTasksReady,
  });

  latestTasks = tasks;
  latestActiveTaskId = activeTaskId;
  latestCanvas = currentCanvas;
  latestSourceGraph = sourceGraph;
  latestSelection = selection;
  latestMessage = message;
  latestRuntimeConfig = config;
  latestDurableTasksReady = durableTasksReady;
  latestGraphRef = graphRef;

  return <output>{message}</output>;
}

describe('useWorkbenchDurableTaskBootstrapActions', () => {
  beforeEach(() => {
    bootstrapState.latestOptions = null;
    bootstrapState.loadRuntimeConfig.mockResolvedValue(runtimeConfig());
    bootstrapState.loadWorkbenchTaskRecords.mockResolvedValue({ tasks: [] });
    saveWorkbenchTaskCanvas.mockResolvedValue({});
    loadWorkbenchTaskCanvas.mockResolvedValue({
      canvas_snapshot: canvas(),
      temporary_resources: {},
    });
    latestTasks = [];
    latestActiveTaskId = '';
    latestCanvas = null;
    latestSourceGraph = null;
    latestSelection = null;
    latestMessage = '';
    latestRuntimeConfig = null;
    latestDurableTasksReady = false;
    latestGraphRef = null;
  });

  test('wires loaders and runtime config callback into bootstrap', () => {
    render(<Harness />);

    expect(bootstrapState.latestOptions?.loadRuntimeConfig).toBe(bootstrapState.loadRuntimeConfig);
    expect(bootstrapState.latestOptions?.loadWorkbenchTaskRecords).toBe(bootstrapState.loadWorkbenchTaskRecords);

    act(() => {
      bootstrapState.latestOptions?.onRuntimeConfig(runtimeConfig());
      bootstrapState.latestOptions?.setDurableTasksReady(true);
    });

    expect(latestRuntimeConfig).toEqual(runtimeConfig());
    expect(latestDurableTasksReady).toBe(true);
  });

  test('loads backend task records through the canvas snapshot loader', async () => {
    render(<Harness />);

    await expect(bootstrapState.latestOptions?.loadWorkbenchTask({ task_id: 'task_1', title: 'Loaded' })).resolves
      .toMatchObject({
        taskId: 'task_1',
        title: 'Loaded',
        canvas: { id: 'task_1' },
      });

    expect(loadWorkbenchTaskCanvas).toHaveBeenCalledWith('task_1');
  });

  test('persists initial tasks through backend canvas snapshots', async () => {
    render(<Harness />);

    await bootstrapState.latestOptions?.persistInitialTask(task());

    expect(saveWorkbenchTaskCanvas).toHaveBeenCalledWith(
      'task_1',
      expect.objectContaining({
        canvas_snapshot: expect.objectContaining({ id: 'task_1' }),
        temporary_resources: {},
      }),
    );
  });

  test('hydrates loaded tasks into active canvas, graph, selection, and message', () => {
    render(<Harness />);
    const loadedTask = task({ title: 'Loaded Task', canvas: canvas({ name: 'Loaded Canvas' }) });

    act(() => {
      bootstrapState.latestOptions?.onLoadedTasks([loadedTask], loadedTask);
    });

    expect(latestTasks).toEqual([loadedTask]);
    expect(latestActiveTaskId).toBe('task_1');
    expect(latestCanvas?.name).toBe('Loaded Canvas');
    expect(latestSourceGraph?.name).toBe('Loaded Canvas');
    expect(latestGraphRef?.current).toBe(latestSourceGraph);
    expect(latestSelection).toEqual({ type: 'task_canvas', taskId: 'task_1' });
    expect(latestMessage).toBe('已从本地 runner 加载持久化任务');
  });

  test('reports migration and bootstrap errors as user messages', () => {
    render(<Harness />);

    act(() => {
      bootstrapState.latestOptions?.onMigratedInitialTasks();
    });
    expect(latestMessage).toBe('已迁移浏览器任务缓存到本地 runner');

    act(() => {
      bootstrapState.latestOptions?.onBootstrapError(new Error('failed bootstrap'));
    });
    expect(latestMessage).toBe('failed bootstrap');
  });
});
