import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap as ReactFlowMiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Database,
  FileText,
  FolderCog,
  GitBranch,
  LayoutDashboard,
  Link2,
  Play,
  Save,
  Search,
  TestTube,
} from 'lucide-react';
import dagre from 'dagre';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { api } from '../api';
import { shortPath, statusTone } from '../format';
import type {
  ArtifactContent,
  CapsuleSummary,
  RunEvent,
  WorkflowDataEdge,
  WorkflowBindingView,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowPort,
  WorkflowRunResult,
  WorkflowSummary,
} from '../types';
import { ReadableArtifact } from './ArtifactViewer';
import { CodeBlock } from './CodeBlock';
import { WorkflowEvidenceDock } from './workflow-viewer/WorkflowEvidenceDock';
import {
  isWorkflowBoundaryId,
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from './workflow-viewer/workflowViewerModel';
import {
  applyRunOverlayToCanvas,
  liveWorkflowRunFromEvents,
  runOverlayFromRun,
  stripRuntimeStateFromCanvas,
  stripRuntimeStateFromWorkflow,
  workflowRunFailureText,
  type RunOverlayState,
  type WorkflowStatus,
} from './workflow-viewer/runState';

type Props = {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

type PortDirection = 'input' | 'output';
type ConnectionMode = 'data' | 'control';

type WorkflowPortView = {
  id: string;
  label: string;
  direction: PortDirection;
  required?: boolean;
  cardinality?: string;
  artifactTypes?: string[];
};

type InternalNodeView = {
  id: string;
  name: string;
  task: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  capsuleId?: string;
  runtime?: string;
  input?: Record<string, unknown>;
  inputPorts?: WorkflowPortView[];
  outputPorts?: WorkflowPortView[];
  position?: { x: number; y: number };
};

type WorkflowContainerModel = {
  id: string;
  title: string;
  boundaryKind?: 'workflow_input' | 'workflow_output';
  sourceKind?: WorkflowGraphNode['kind'];
  capsuleId?: string;
  sourceInput?: Record<string, unknown>;
  sourceInputMapping?: Record<string, unknown>;
  workflowRef?: string;
  directory: string;
  bindingPath?: string;
  relativeCwd?: string;
  status: WorkflowStatus;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  internalNodes: InternalNodeView[];
  internalEdges: WorkflowCanvasEdge[];
  position: { x: number; y: number };
  size: { width: number; height: number };
  warnings: string[];
};

type WorkflowCanvasEdge =
  | {
      id: string;
      kind: 'data';
      source: { workflowId: string; portId: string };
      target: { workflowId: string; portId: string };
      materialization: 'copy' | 'reference' | 'symlink';
    }
  | {
      id: string;
      kind: 'control';
      source: { workflowId: string };
      target: { workflowId: string };
      condition?: string | null;
      context?: 'upstream_output' | 'none';
    };

type WorkspaceCanvasModel = {
  id: string;
  name: string;
  layout?: 'workspace-canvas' | 'workflow-focus';
  rootWorkflowId: string;
  workflows: WorkflowContainerModel[];
  edges: WorkflowCanvasEdge[];
};

type PaletteItem =
  | { kind: 'workflow'; workflowRef?: string; label: string }
  | { kind: 'agent'; capsuleId: string; label: string }
  | { kind: 'tool'; capsuleId: string; label: string }
  | { kind: 'file_source'; capsuleId: 'file-source.local'; label: string };

type PendingCanvasConnection = {
  nodeId: string;
  handleId: string | null;
  mode: ConnectionMode;
};

type NodeCreateMenuState = {
  x: number;
  y: number;
  position: { x: number; y: number };
  pendingConnection?: PendingCanvasConnection;
} | null;

type FlowEndpoint = {
  nodeId: string;
  workflowId: string | null;
  internal: boolean;
};

type CanvasSelection =
  | { type: 'task_canvas'; taskId: string }
  | { type: 'workflow'; id: string }
  | { type: 'port'; workflowId: string; portId: string; direction: PortDirection }
  | { type: 'edge'; id: string }
  | { type: 'internal'; workflowId: string; nodeId: string };

type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
};

type WorkbenchTask = {
  taskId: string;
  title: string;
  canvas: WorkspaceCanvasModel;
  savedWorkflowRef?: string;
  status: Extract<WorkflowStatus, 'not_run' | 'running' | 'success' | 'failed'>;
  activeRunId?: string;
};

type ResourceTemplate =
  | { kind: 'workflow_class'; workflowId: string; path: string; name: string }
  | { kind: 'agent_class'; capsuleId: string; name: string }
  | { kind: 'tool_class'; capsuleId: string; name: string };

type WorkbenchChromeState = {
  leftPanel: 'none' | 'tasks' | 'resources';
  rightPanel: 'none' | 'inspector' | 'resourceDetail' | 'runEvidence';
  inspectorWidth: number;
};

type EdgeViewMode = 'all' | 'control' | 'data';

type WorkflowNodeData = {
  workflow: WorkflowContainerModel;
  binding?: WorkflowBindingView;
  selected: boolean;
  showDataPorts: boolean;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onSelectInternal: (workflowId: string, nodeId: string) => void;
  onOpenFocus: (workflowId: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
  onResize: (workflowId: string, size: { width: number; height: number }) => void;
  onMoveInternal: (
    workflowId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
};

type AgentToolNodeData = {
  id: string;
  title: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  capsuleId?: string;
  workflowId?: string;
  internalNodeId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  selected: boolean;
  showDataPorts: boolean;
  onSelect: () => void;
};

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowContainer'>;
type AgentToolFlowNode = Node<AgentToolNodeData, 'agentToolNode'>;
type CanvasFlowNode = WorkflowFlowNode | AgentToolFlowNode;

const nodeTypes = { workflowContainer: memo(WorkflowContainer), agentToolNode: memo(AgentToolNode) };
const DEFAULT_CONTAINER_SIZE = { width: 430, height: 328 };
const BOUNDARY_NODE_SIZE = { width: 270, height: 240 };
const AGENT_TOOL_NODE_SIZE = { width: 260, height: 72 };
const WORKFLOW_CHILD_PADDING = 24;
const WORKFLOW_CHILD_START_PADDING = 8;
const INSPECTOR_DEFAULT_WIDTH = 390;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 640;
const ROOT_WORKSPACE = 'F:\\UE5_Project_A';
const MAX_LOG_PREVIEW_LINES = 180;

export function WorkflowViewer({
  workflows,
  capsules,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const initialCanvas = useMemo(() => workspaceDemoCanvas(), []);
  const [tasks, setTasks] = useState<WorkbenchTask[]>(() => [
    {
      taskId: initialCanvas.id,
      title: initialCanvas.name,
      canvas: initialCanvas,
      status: 'not_run',
    },
  ]);
  const [activeTaskId, setActiveTaskId] = useState(initialCanvas.id);
  const [canvas, setCanvas] = useState<WorkspaceCanvasModel>(() => initialCanvas);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() =>
    canvasToWorkflowGraph(initialCanvas),
  );
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: initialCanvas.id,
  });
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('control');
  const [message, setMessage] = useState('已加载 Workspace Canvas Demo');
  const [workflowRun, setWorkflowRun] = useState<WorkflowRunResult | null>(null);
  const [workflowEvents, setWorkflowEvents] = useState<RunEvent[]>([]);
  const [runOverlay, setRunOverlay] = useState<RunOverlayState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>(null);
  const [chrome, setChrome] = useState<WorkbenchChromeState>({
    leftPanel: 'none',
    rightPanel: 'none',
    inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  });
  const [edgeViewMode, setEdgeViewMode] = useState<EdgeViewMode>('all');
  const [selectedResource, setSelectedResource] = useState<ResourceTemplate | null>(null);
  const [workflowBindings, setWorkflowBindings] = useState<Record<string, WorkflowBindingView>>({});
  const [bindingEditorWorkflowId, setBindingEditorWorkflowId] = useState<string | null>(null);
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });
  const graphRef = useRef(sourceGraph);
  const paletteOpen = chrome.leftPanel === 'resources';
  const inspectorOpen = chrome.rightPanel === 'inspector';
  const resourceDetailOpen = chrome.rightPanel === 'resourceDetail';
  const inspectorWidth = chrome.inspectorWidth;
  const workflowBindingKey = useMemo(
    () => [canvas.id, ...canvas.workflows.map((item) => item.id)].sort().join('|'),
    [canvas.id, canvas.workflows],
  );

  function closeEvidenceDock() {
    setEvidenceDock({ open: false, title: '运行证据', content: null });
  }

  const updateCanvas = useCallback((next: SetStateAction<WorkspaceCanvasModel>) => {
    setCanvas((current) => {
      const nextCanvas = typeof next === 'function'
        ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
        : next;
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
            : task,
        ),
      );
      return nextCanvas;
    });
  }, [activeTaskId]);

  function resetCanvas(nextCanvas: WorkspaceCanvasModel) {
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
          : task,
      ),
    );
  }

  function updateCanvasAndGraph(next: SetStateAction<WorkspaceCanvasModel>) {
    setCanvas((current) => {
      const nextCanvas =
        typeof next === 'function'
          ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
          : next;
      const nextGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
            : task,
        ),
      );
      return nextCanvas;
    });
  }

  useEffect(() => {
    graphRef.current = sourceGraph;
  }, [sourceGraph]);

  useEffect(() => {
    let ignore = false;
    const workflowIds = Array.from(new Set([canvas.id, ...canvas.workflows.map((item) => item.id)]));
    Promise.all(
      workflowIds.map((workflowId) =>
        api
          .workflowBinding(workflowId)
          .then((binding) => [workflowId, normalizeBinding(binding, workflowId)] as const)
          .catch(
            () =>
              [
                workflowId,
                {
                  workflowId,
                  bindingPath: `bindings/${workflowId}.binding.local.json`,
                  workspaceRoot: null,
                  exists: false,
                  status: 'unbound',
                },
              ] as const,
          ),
      ),
    ).then((entries) => {
      if (ignore) {
        return;
      }
      setWorkflowBindings(Object.fromEntries(entries));
    });
    return () => {
      ignore = true;
    };
  }, [workflowBindingKey]);

  useEffect(() => {
    if (!openedExternalWorkflow || !selectedWorkflowId) {
      return;
    }
    let ignore = false;
    api.workflow(selectedWorkflowId).then((workflow) => {
      if (ignore) {
        return;
      }
      const nextGraph = normalizeWorkflowGraph(workflow.graph || graphFromLegacyWorkflow(workflow));
      const nextCanvas = graphToWorkspaceCanvas(nextGraph, workflowRun);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setCanvas(nextCanvas);
      setSelection(
        nextCanvas.workflows[0]
          ? { type: 'workflow', id: nextCanvas.workflows[0].id }
          : { type: 'workflow', id: nextCanvas.rootWorkflowId },
      );
      setMessage(`已打开 ${workflow.workflow_id}`);
      setWorkflowRun(null);
      setWorkflowEvents([]);
      closeEvidenceDock();
    });
    return () => {
      ignore = true;
    };
  }, [openedExternalWorkflow, selectedWorkflowId]);

  const displayCanvas = useMemo(() => applyRunOverlayToCanvas(canvas, runOverlay), [canvas, runOverlay]);
  const selectedWorkflow =
    selection.type === 'workflow'
      ? displayCanvas.workflows.find((workflow) => workflow.id === selection.id)
      : selection.type === 'port' || selection.type === 'internal'
        ? displayCanvas.workflows.find((workflow) => workflow.id === selection.workflowId)
        : undefined;
  const selectedEdge =
    selection.type === 'edge'
      ? displayCanvas.edges.find((edge) => edge.id === selection.id) ||
        displayCanvas.workflows.flatMap((workflow) => workflow.internalEdges).find((edge) => edge.id === selection.id)
      : undefined;
  const selectedPort =
    selection.type === 'port'
      ? selectedWorkflow?.[selection.direction === 'input' ? 'inputPorts' : 'outputPorts'].find(
          (port) => port.id === selection.portId,
        )
      : undefined;
  const selectedInternalNode =
    selection.type === 'internal'
      ? selectedWorkflow?.internalNodes.find((node) => node.id === selection.nodeId)
      : undefined;
  const canRunSelectedWorkflow = Boolean(selectedWorkflow && !isExecutableNodeWorkflow(selectedWorkflow));
  const canRunSelectedNode = Boolean(
    selectedInternalNode || (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)),
  );

  function createDemo() {
    const nextCanvas = workspaceDemoCanvas();
    resetCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setWorkflowRun(null);
    setWorkflowEvents([]);
    setOpenedExternalWorkflow(false);
    setMessage('已重置为 Workspace Canvas Demo');
  }

  function openWorkflow(workflowId: string) {
    setOpenedExternalWorkflow(true);
    onSelect(workflowId);
  }

  function switchTask(taskId: string) {
    const task = tasks.find((item) => item.taskId === taskId);
    if (!task) {
      return;
    }
    setActiveTaskId(task.taskId);
    const nextGraph = canvasToWorkflowGraph(task.canvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(task.canvas);
    setRunOverlay(null);
    setWorkflowRun(null);
    setWorkflowEvents([]);
    setSelection({ type: 'task_canvas', taskId: task.canvas.id });
  }

  function newTask() {
    const taskId = `task_canvas_${Date.now()}`;
    const nextCanvas = {
      ...workspaceDemoCanvas(),
      id: taskId,
      name: `任务 ${tasks.length + 1}`,
      workflows: [],
      edges: [],
      rootWorkflowId: taskId,
    };
    const task: WorkbenchTask = {
      taskId: nextCanvas.id,
      title: nextCanvas.name,
      canvas: nextCanvas,
      status: 'not_run',
    };
    setTasks((current) => [...current, task]);
    setActiveTaskId(task.taskId);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setRunOverlay(null);
    setWorkflowRun(null);
    setWorkflowEvents([]);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
  }

  function autoLayout() {
    updateCanvasAndGraph((current) => layoutCanvasForSelection(current, selection));
    setMessage(selection.type === 'workflow' || selection.type === 'internal' || selection.type === 'port'
      ? '已按连接关系重新布局选中 Workflow'
      : '已按连接关系重新布局整个任务');
  }

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
    [inspectorWidth],
  );

  const closeInspectorForBlankTarget = useCallback(
    (target: Element | null) => {
      if (!inspectorOpen) {
        return;
      }
      if (!target) {
        return;
      }
      if (
        target.closest(
          '.canvas-drawer, .toolbar-actions, .react-flow__node, .react-flow__edge, .react-flow__handle, .node-create-menu, .canvas-toolbar',
        )
      ) {
        return;
      }
      if (target.closest('.react-flow__pane, .react-flow, .workspace-canvas-surface')) {
        setChrome((current) => ({ ...current, rightPanel: 'none' }));
      }
    },
    [inspectorOpen],
  );
  const handleCanvasLayoutPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      closeInspectorForBlankTarget(event.target instanceof Element ? event.target : null);
    },
    [closeInspectorForBlankTarget],
  );
  const handleCanvasLayoutClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      closeInspectorForBlankTarget(event.target instanceof Element ? event.target : null);
    },
    [closeInspectorForBlankTarget],
  );
  const selectCanvasObject = useCallback((nextSelection: CanvasSelection) => {
    setSelection(nextSelection);
    if (nextSelection.type !== 'task_canvas') {
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
    }
  }, []);

  async function saveGraph(options: { selectSavedWorkflow?: boolean; refreshIndex?: boolean } = {}) {
    const { selectSavedWorkflow = true, refreshIndex = true } = options;
    const graph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    graphRef.current = graph;
    setSourceGraph(graph);
    const result = await api.saveWorkflow(graph, true);
    setMessage(`已保存 ${result.workflow_id}`);
    if (selectSavedWorkflow) {
      onSelect(result.workflow_id);
    }
    if (refreshIndex) {
      closeEvidenceDock();
      onChanged?.();
    }
  }

  async function validateGraph() {
    try {
      await saveGraph({ selectSavedWorkflow: false, refreshIndex: false });
      const result = await api.validateWorkflow(graphRef.current.id);
      setMessage(`校验通过: ${result.workflow_id}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`校验失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '校验错误',
        content: textArtifact('validation-error.log', text, 'log'),
      });
    }
  }

  async function runGraph() {
    await runWorkflowGraph(graphForCurrentView(stripRuntimeStateFromCanvas(canvas), null), 'task', canvas.id);
  }

  async function runSelectedWorkflow() {
    if (!selectedWorkflow || isExecutableNodeWorkflow(selectedWorkflow)) {
      return;
    }
    await runWorkflowGraph(internalWorkflowToGraph(stripRuntimeStateFromWorkflow(selectedWorkflow)), 'workflow', selectedWorkflow.id);
  }

  async function runSelectedNode() {
    const node =
      selectedInternalNode ||
      (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
        ? internalNodeFromExecutableWorkflow(selectedWorkflow, { x: 0, y: 0 })
        : null);
    if (!node) {
      return;
    }
    await runWorkflowGraph(singleNodeWorkflowGraph(node, selectedWorkflow?.id || canvas.id), 'node', node.id);
  }

  async function runWorkflowGraph(graph: WorkflowGraph, scope: RunOverlayState['scope'], targetId: string) {
    const runId = `ui_workflow_${graph.id}_${Date.now()}`;
    const runDir = `runs/${runId}`;
    const runnableGraph: WorkflowGraph = {
      ...graph,
      id: runId,
      name: graph.name ? `${graph.name} run` : `${graph.id} run`,
    };
    const binding = workflowBindings[graph.id];
    const bindingPath = binding?.exists ? bindingPathOf(binding) : '';
    let pollTimer: number | undefined;
    let pollingStopped = false;

    async function pollWorkflowEvents() {
      try {
        const result = await api.runEvents(runId);
        const liveRun = liveWorkflowRunFromEvents(runnableGraph, runDir, result.events);
        setWorkflowEvents(result.events);
        setWorkflowRun(liveRun);
        setRunOverlay(
          runOverlayFromRun(liveRun, {
            runId,
            scope,
            targetId,
          }),
        );
      } catch {
        const liveRun = liveWorkflowRunFromEvents(runnableGraph, runDir, []);
        setWorkflowRun(liveRun);
        setRunOverlay(
          runOverlayFromRun(liveRun, {
            runId,
            scope,
            targetId,
          }),
        );
      }
      if (!pollingStopped) {
        pollTimer = window.setTimeout(() => {
          void pollWorkflowEvents();
        }, 1000);
      }
    }

    try {
      if (scope === 'task') {
        graphRef.current = graph;
        setSourceGraph(graph);
      }
      setIsRunning(true);
      setWorkflowEvents([]);
      const initialRun = liveWorkflowRunFromEvents(runnableGraph, runDir, []);
      setWorkflowRun(initialRun);
      setRunOverlay(
        runOverlayFromRun(
          { ...initialRun, status: 'running' },
          {
            runId,
            scope,
            targetId,
          },
        ),
      );
      setTasks((current) =>
        current.map((task) =>
          task.taskId === activeTaskId ? { ...task, status: 'running', activeRunId: runId } : task,
        ),
      );
      setMessage(`运行 ${graph.id}: 已提交，等待节点事件...`);
      const runPromise = api.runGraph(
        runnableGraph,
        runDir,
        bindingPath ? { bindingPath } : undefined,
      );
      pollTimer = window.setTimeout(() => {
        void pollWorkflowEvents();
      }, 300);
      const result = await runPromise;
      pollingStopped = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
      setWorkflowRun(result);
      setRunOverlay(
        runOverlayFromRun(result, {
          runId,
          scope,
          targetId,
        }),
      );
      setTasks((current) =>
        current.map((task) =>
          task.taskId === activeTaskId
            ? {
                ...task,
                status: result.status === 'success' ? 'success' : 'failed',
                activeRunId: runId,
              }
            : task,
        ),
      );
      const events = await api.runEvents(runId).catch(() => null);
      setWorkflowEvents(events?.events || []);
      if (result.status === 'success') {
        closeEvidenceDock();
      } else {
        setEvidenceDock({
          open: true,
          title: '运行失败',
          content: textArtifact('run-error.log', workflowRunFailureText(result), 'log'),
        });
      }
      setMessage(`运行 ${result.workflow_id}: ${statusLabel(result.status)}`);
      onChanged?.();
    } catch (error) {
      pollingStopped = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`运行失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '运行错误',
        content: textArtifact('run-error.log', text, 'log'),
      });
      setRunOverlay((current) => (current ? { ...current, status: 'failed' } : current));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === activeTaskId ? { ...task, status: 'failed', activeRunId: runId } : task,
        ),
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function readEvidence(path: string | null | undefined, title = '运行证据') {
    if (!path) {
      return;
    }
    const content = await api.artifact(path);
    setEvidenceDock({ open: true, title, content: truncateLargeLog(content) });
  }

  async function saveBinding(workflowId: string, workspaceRoot: string) {
    const result = await api.saveWorkflowBinding(workflowId, workspaceRoot);
    const normalized = normalizeBinding(result, workflowId);
    setWorkflowBindings((current) => ({ ...current, [workflowId]: normalized }));
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, bindingPath: bindingPathOf(normalized), directory: workspaceRootOf(normalized) }
          : workflow,
      ),
    }));
    setMessage(`已保存 ${workflowId} workspace binding`);
    return normalized;
  }

  async function validateBinding(workflowId: string, workspaceRoot: string) {
    const result = await api.validateWorkflowBinding(workflowId, workspaceRoot);
    return normalizeBinding(result, workflowId);
  }

  async function openBindingsFolder(workflowId: string) {
    await api.openWorkflowBindingFolder(workflowId);
    setMessage(`已打开 ${workflowId} 的 bindings 目录`);
  }

  return (
    <WorkbenchShell>
      <TopBar
        title={canvas.name}
        subtitle="Workflow Template / EnvironmentFrame / Port / Artifact 统一视图"
        isRunning={isRunning}
        onNew={newTask}
        onSave={saveGraph}
        onValidate={validateGraph}
        onRun={runGraph}
        onAutoLayout={autoLayout}
        paletteOpen={paletteOpen}
        inspectorOpen={inspectorOpen}
        onTogglePalette={() =>
          setChrome((current) => ({
            ...current,
            leftPanel: current.leftPanel === 'resources' ? 'none' : 'resources',
          }))
        }
        onToggleInspector={() =>
          setChrome((current) => ({
            ...current,
            rightPanel: current.rightPanel === 'inspector' ? 'none' : 'inspector',
          }))
        }
      />
      <div
        className={[
          'workspace-canvas-layout',
          paletteOpen ? 'palette-open' : '',
          chrome.rightPanel !== 'none' ? 'inspector-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDownCapture={handleCanvasLayoutPointerDown}
        onClickCapture={handleCanvasLayoutClick}
      >
        <TaskRail tasks={tasks} activeTaskId={activeTaskId} onSelectTask={switchTask} onNewTask={newTask} />
        {paletteOpen ? (
          <div className="canvas-drawer canvas-drawer-left">
            <div className="drawer-title-row">
              <strong>资源</strong>
              <button
                type="button"
                onClick={() => setChrome((current) => ({ ...current, leftPanel: 'none' }))}
              >
                关闭
              </button>
            </div>
            <LeftNavigator
              workflows={workflows}
              capsules={capsules}
              selectedWorkflowId={selectedWorkflowId}
              onOpenWorkflow={(workflowId) => openWorkflow(workflowId)}
              onSelectResource={(resource) => {
                setSelectedResource(resource);
                setChrome((current) => ({ ...current, rightPanel: 'resourceDetail' }));
              }}
              focusedWorkflowId={focusedWorkflowId}
              onAddPaletteItem={(item) => {
                const selectedContainerId =
                  selection.type === 'workflow' &&
                  selectedWorkflow &&
                  !isExecutableNodeWorkflow(selectedWorkflow)
                    ? selectedWorkflow.id
                    : null;
                const requestedTargetWorkflowId = focusedWorkflowId || selectedContainerId;
                if (item.kind === 'workflow') {
                  updateCanvas((current) =>
                    addWorkflowFromPalette(current, item, {
                      x: 160 + current.workflows.length * 80,
                      y: 180 + current.workflows.length * 40,
                    }),
                  );
                  setMessage(`已加入 ${item.label}`);
                  return;
                }
                updateCanvas((current) => {
                  const targetWorkflowId = requestedTargetWorkflowId;
                  if (!targetWorkflowId) {
                    return addCapsuleNodeFromPalette(current, item, nextRootPalettePosition(current));
                  }
                  const workflow = current.workflows.find((candidate) => candidate.id === targetWorkflowId);
                  const nodeCount = workflow?.internalNodes.length || 0;
                  return addInternalNodeFromPalette(current, targetWorkflowId, item, {
                    x: 120 + (nodeCount % 4) * (AGENT_TOOL_NODE_SIZE.width + 80),
                    y: 130 + Math.floor(nodeCount / 4) * 170,
                  });
                });
                if (!requestedTargetWorkflowId) {
                  setMessage(`已加入 ${item.label}`);
                } else {
                  setMessage(`已加入 ${item.label} 到 ${requestedTargetWorkflowId}`);
                }
              }}
            />
          </div>
        ) : null}
        <WorkspaceCanvas
          canvas={displayCanvas}
          selection={selection}
          connectionMode={connectionMode}
          workflowRun={workflowRun}
          focusedWorkflowId={focusedWorkflowId}
          capsules={capsules}
          workflows={workflows}
          bindings={workflowBindings}
          onFocusedWorkflow={setFocusedWorkflowId}
          onCanvasChange={updateCanvas}
          onSelect={selectCanvasObject}
          edgeViewMode={edgeViewMode}
          onEdgeViewMode={setEdgeViewMode}
          onBlankCanvas={() => setChrome((current) => ({ ...current, rightPanel: 'none' }))}
          onConfigureWorkflow={(workflowId) => {
            setSelection({ type: 'workflow', id: workflowId });
            setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
            setBindingEditorWorkflowId(workflowId);
          }}
        />
        <ExecutionDock
          isRunning={isRunning}
          canRunWorkflow={canRunSelectedWorkflow}
          canRunNode={canRunSelectedNode}
          onRunTask={runGraph}
          onRunWorkflow={runSelectedWorkflow}
          onRunNode={runSelectedNode}
        />
        {inspectorOpen || resourceDetailOpen ? (
          <div
            className="canvas-drawer canvas-drawer-right"
            style={{ width: inspectorWidth }}
          >
            <div
              className="drawer-resize-handle"
              role="separator"
              aria-label="调整属性面板宽度"
              aria-orientation="vertical"
              onPointerDown={startInspectorResize}
            />
            <div className="drawer-title-row">
              <strong>属性</strong>
              <button
                type="button"
                onClick={() => setChrome((current) => ({ ...current, rightPanel: 'none' }))}
              >
                收起
              </button>
            </div>
            {resourceDetailOpen && selectedResource ? (
              <ResourceInspector resource={selectedResource} />
            ) : (
              <RightInspector
                canvas={displayCanvas}
                selection={selection}
                selectedWorkflow={selectedWorkflow}
                selectedPort={selectedPort}
                selectedEdge={selectedEdge}
                selectedInternalNode={selectedInternalNode}
                connectionMode={connectionMode}
                workflowRun={workflowRun}
                workflowEvents={workflowEvents}
                binding={selectedWorkflow ? workflowBindings[selectedWorkflow.id] : undefined}
                onConnectionMode={setConnectionMode}
                onReadEvidence={readEvidence}
                onConfigureBinding={(workflowId) => setBindingEditorWorkflowId(workflowId)}
              />
            )}
          </div>
        ) : null}
      </div>
      {bindingEditorWorkflowId ? (
        <WorkflowBindingDialog
          workflowId={bindingEditorWorkflowId}
          binding={workflowBindings[bindingEditorWorkflowId]}
          onClose={() => setBindingEditorWorkflowId(null)}
          onValidate={validateBinding}
          onSave={saveBinding}
          onOpenFolder={openBindingsFolder}
        />
      ) : null}
      <WorkflowEvidenceDock
        state={evidenceDock}
        message={message}
        workflowRun={workflowRun}
        workflowEvents={workflowEvents}
        onToggle={() => setEvidenceDock((current) => ({ ...current, open: !current.open }))}
      />
    </WorkbenchShell>
  );
}

function WorkbenchShell({ children }: { children: ReactNode }) {
  return (
    <section className="panel workflow-viewer graph-workbench-v2" aria-label="ACC Workbench">
      {children}
    </section>
  );
}

function ExecutionDock({
  isRunning,
  canRunWorkflow,
  canRunNode,
  onRunTask,
  onRunWorkflow,
  onRunNode,
}: {
  isRunning: boolean;
  canRunWorkflow: boolean;
  canRunNode: boolean;
  onRunTask: () => void;
  onRunWorkflow: () => void;
  onRunNode: () => void;
}) {
  return (
    <div className="execution-dock" aria-label="执行控制">
      <button type="button" className="primary-action run-task-action" onClick={onRunTask} disabled={isRunning}>
        <Play aria-hidden="true" size={18} />
        {isRunning ? '运行中' : '运行当前任务'}
      </button>
      {canRunWorkflow ? (
        <button type="button" onClick={onRunWorkflow} disabled={isRunning}>
          只运行此 Workflow
        </button>
      ) : null}
      {canRunNode ? (
        <button type="button" onClick={onRunNode} disabled={isRunning}>
          只运行此 Agent/Tool
        </button>
      ) : null}
    </div>
  );
}

function TaskRail({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
}: {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
}) {
  return (
    <aside className="task-rail" aria-label="任务列表">
      <button type="button" className="task-rail-new" onClick={onNewTask}>
        新建任务
      </button>
      {tasks.map((task) => (
        <button
          key={task.taskId}
          type="button"
          className={[
            'task-rail-item',
            task.taskId === activeTaskId ? 'active' : '',
            `status-${task.status}`,
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelectTask(task.taskId)}
        >
          <strong>{task.title}</strong>
          <small>{task.activeRunId || '未运行'}</small>
        </button>
      ))}
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  isRunning,
  onNew,
  onSave,
  onValidate,
  onRun,
  onAutoLayout,
  paletteOpen,
  inspectorOpen,
  onTogglePalette,
  onToggleInspector,
}: {
  title: string;
  subtitle: string;
  isRunning: boolean;
  onNew: () => void;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  onAutoLayout: () => void;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  onTogglePalette: () => void;
  onToggleInspector: () => void;
}) {
  return (
    <header className="workbench-topbar">
      <div className="topbar-title">
        <span className="topbar-kicker">Workspace Canvas</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="toolbar-actions" aria-label="工作流工具栏">
        <button
          type="button"
          className={paletteOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onTogglePalette}
        >
          <Boxes aria-hidden="true" size={16} />
          资源
        </button>
        <button
          type="button"
          className={inspectorOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onToggleInspector}
        >
          <Database aria-hidden="true" size={16} />
          属性
        </button>
        <button type="button" onClick={onNew}>
          <GitBranch aria-hidden="true" size={16} />
          新建
        </button>
        <button type="button" onClick={onSave} disabled={isRunning}>
          <Save aria-hidden="true" size={16} />
          保存任务为 Workflow
        </button>
        <button type="button" onClick={onValidate} disabled={isRunning}>
          <TestTube aria-hidden="true" size={16} />
          校验
        </button>
        <button type="button" className="primary-action topbar-run-action" onClick={onRun} disabled={isRunning}>
          <Play aria-hidden="true" size={16} />
          {isRunning ? '运行中' : '运行'}
        </button>
        <button type="button" onClick={onAutoLayout}>
          <LayoutDashboard aria-hidden="true" size={16} />
          自动布局
        </button>
      </div>
    </header>
  );
}

function LeftNavigator({
  workflows,
  capsules,
  selectedWorkflowId,
  onOpenWorkflow,
  onSelectResource,
  focusedWorkflowId,
  onAddPaletteItem,
}: {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onOpenWorkflow: (workflowId: string) => void;
  onSelectResource: (resource: ResourceTemplate) => void;
  focusedWorkflowId: string | null;
  onAddPaletteItem: (item: PaletteItem) => void;
}) {
  const paletteCapsules = capsules.filter((capsule) => capsule.id !== 'file-source.local').slice(0, 40);
  const workflowCapsuleCount = capsules.filter((capsule) =>
    /workflow|subworkflow|agent-workflow/u.test(capsule.id),
  );
  return (
    <aside className="left-navigator" aria-label="Workspace Navigator">
      <section className="navigator-section">
        <header>
          <h3>工作区</h3>
          <span>{workflows.length}</span>
        </header>
        <div className="search-box">
          <Search aria-hidden="true" size={15} />
          <span>Workflow Template</span>
        </div>
        <button
          type="button"
          className="palette-drag-item"
          draggable
          onClick={() => onAddPaletteItem({ kind: 'workflow', label: 'New Workflow' })}
          onDragStart={(event) =>
            setPaletteDragData(event, { kind: 'workflow', label: 'New Workflow' })
          }
        >
          <GitBranch aria-hidden="true" size={15} />
          <span>拖入 Workflow</span>
        </button>
        <div className="workflow-list">
          {workflows.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              className={
                selectedWorkflowId === workflow.workflow_id ? 'list-item selected' : 'list-item'
              }
              onClick={() =>
                onSelectResource({
                  kind: 'workflow_class',
                  workflowId: workflow.workflow_id,
                  path: workflow.path,
                  name: workflow.name || workflow.workflow_id,
                })
              }
              onDoubleClick={() => onOpenWorkflow(workflow.workflow_id)}
            >
              <strong>{workflow.name || workflow.workflow_id}</strong>
              <span>{workflow.path}</span>
              <small>{workflow.task_count} nodes</small>
            </button>
          ))}
        </div>
      </section>
      <section className="navigator-section">
        <header>
          <h3>Agent / Tool Capsule</h3>
          <span>{paletteCapsules.length}</span>
        </header>
        {paletteCapsules.map((capsule) => {
          const item: Exclude<PaletteItem, { kind: 'workflow' }> = {
            kind: capsule.runtime === 'generic_cli' ? 'tool' : 'agent',
            capsuleId: capsule.id,
            label: capsule.name || capsule.id,
          };
          return (
          <article
            key={capsule.id}
            className="capsule-palette-item"
            draggable
            title={focusedWorkflowId ? '双击加入当前 Workflow' : '拖到画布或 Workflow 容器'}
            onClick={() =>
              onSelectResource({
                kind: item.kind === 'tool' ? 'tool_class' : 'agent_class',
                capsuleId: capsule.id,
                name: capsule.name || capsule.id,
              })
            }
            onDoubleClick={() => onAddPaletteItem(item)}
            onDragStart={(event) => setPaletteDragData(event, item)}
          >
            <Boxes aria-hidden="true" size={16} />
            <div>
              <strong>{capsule.name || capsule.id}</strong>
              <small>{capsule.id}</small>
            </div>
            <button
              type="button"
              className="palette-add-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAddPaletteItem(item);
              }}
            >
              加入
            </button>
          </article>
          );
        })}
        {workflowCapsuleCount.length > 0 ? (
          <small className="navigator-hint">
            Workflow capsules: {workflowCapsuleCount.length}
          </small>
        ) : null}
        <article
          className="capsule-palette-item"
          draggable
          title={focusedWorkflowId ? '双击加入当前 Workflow' : '拖到画布或 Workflow 容器'}
          onClick={() =>
            onSelectResource({
              kind: 'tool_class',
              capsuleId: 'file-source.local',
              name: 'File Source',
            })
          }
          onDoubleClick={() =>
            onAddPaletteItem({
              kind: 'file_source',
              capsuleId: 'file-source.local',
              label: 'File Source',
            })
          }
          onDragStart={(event) =>
            setPaletteDragData(event, {
              kind: 'file_source',
              capsuleId: 'file-source.local',
              label: 'File Source',
            })
          }
        >
          <FileText aria-hidden="true" size={16} />
          <div>
            <strong>File Source</strong>
            <small>file-source.local</small>
          </div>
          <button
            type="button"
            className="palette-add-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddPaletteItem({
                kind: 'file_source',
                capsuleId: 'file-source.local',
                label: 'File Source',
              });
            }}
          >
            加入
          </button>
        </article>
      </section>
    </aside>
  );
}

function WorkspaceCanvas({
  canvas,
  selection,
  connectionMode,
  edgeViewMode,
  workflowRun,
  focusedWorkflowId,
  capsules,
  workflows,
  bindings,
  onFocusedWorkflow,
  onCanvasChange,
  onSelect,
  onEdgeViewMode,
  onBlankCanvas,
  onConfigureWorkflow,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  workflowRun: WorkflowRunResult | null;
  focusedWorkflowId: string | null;
  capsules: CapsuleSummary[];
  workflows: WorkflowSummary[];
  bindings: Record<string, WorkflowBindingView>;
  onFocusedWorkflow: (workflowId: string | null) => void;
  onCanvasChange: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  onSelect: (selection: CanvasSelection) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onBlankCanvas: () => void;
  onConfigureWorkflow: (workflowId: string) => void;
}) {
  const [flowInstance, setFlowInstance] = useState<{
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  } | null>(null);
  const [nodeCreateMenu, setNodeCreateMenu] = useState<NodeCreateMenuState>(null);
  const [connectStart, setConnectStart] = useState<PendingCanvasConnection | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const flowNodesRef = useRef<CanvasFlowNode[]>([]);
  const connectStartRef = useRef<PendingCanvasConnection | null>(null);
  const nodeDragStartPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeDragEligibleRef = useRef<Map<string, boolean>>(new Map());
  const draggingRef = useRef(false);
  const lastDragCommitRef = useRef<string | null>(null);
  const forceCommittedProjectionRef = useRef(false);
  const projectionKeysRef = useRef({ identity: '', layout: '' });
  const visibleCanvas = useMemo(
    () => focusCanvas(canvas, focusedWorkflowId),
    [canvas, focusedWorkflowId],
  );
  useEffect(() => {
    setNodeCreateMenu(null);
    connectStartRef.current = null;
    setConnectStart(null);
  }, [canvas.id]);
  const handleSelectPort = useCallback(
    (workflowId: string, portValue: WorkflowPortView) =>
      onSelect({
        type: 'port',
        workflowId,
        portId: portValue.id,
        direction: portValue.direction,
      }),
    [onSelect],
  );
  const handleSelectInternal = useCallback((workflowId: string, nodeId: string) => {
    if (isWorkflowBoundaryId(workflowId)) {
      onSelect({ type: 'workflow', id: workflowId });
      return;
    }
    if (
      focusedWorkflowId &&
      selection.type === 'internal' &&
      selection.workflowId !== workflowId
    ) {
      const edge =
        connectionMode === 'control'
          ? controlEdge(selection.workflowId, workflowId)
          : dataEdge(selection.workflowId, 'main', workflowId, 'main');
      onCanvasChange((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === focusedWorkflowId
            ? {
                ...workflow,
                internalEdges: [...workflow.internalEdges.filter((item) => item.id !== edge.id), edge],
              }
            : workflow,
        ),
      }));
      onSelect({ type: 'edge', id: edge.id });
      return;
    }
    onSelect({ type: 'internal', workflowId, nodeId });
  }, [connectionMode, focusedWorkflowId, onCanvasChange, onSelect, selection]);
  const handleResizeWorkflow = useCallback(
    (workflowId: string, size: { width: number; height: number }) =>
      onCanvasChange((current) => resizeWorkflowContainer(current, workflowId, size)),
    [onCanvasChange],
  );
  const handleMoveInternal = useCallback(
    (workflowId: string, nodeId: string, position: { x: number; y: number }) =>
      onCanvasChange((current) => moveInternalNode(current, workflowId, nodeId, position)),
    [onCanvasChange],
  );
  const projectedFlowNodes = useMemo(
    () =>
      toFlowNodes(
        visibleCanvas,
        selection,
        bindings,
        handleSelectPort,
        handleSelectInternal,
        onFocusedWorkflow,
        onConfigureWorkflow,
        connectionMode === 'data',
        handleResizeWorkflow,
        handleMoveInternal,
      ),
    [
      visibleCanvas,
      selection,
      bindings,
      handleSelectPort,
      handleSelectInternal,
      onFocusedWorkflow,
      onConfigureWorkflow,
      connectionMode,
      handleResizeWorkflow,
      handleMoveInternal,
    ],
  );
  const projectedIdentityKey = useMemo(
    () => flowNodeIdentityKey(projectedFlowNodes),
    [projectedFlowNodes],
  );
  const projectedLayoutKey = useMemo(
    () => flowNodeLayoutKey(projectedFlowNodes),
    [projectedFlowNodes],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(visibleCanvas, selection, connectionMode, edgeViewMode, connectionMode === 'data'),
    [visibleCanvas, selection, connectionMode, edgeViewMode],
  );

  useEffect(() => {
    setFlowNodes((current) => {
      const previousKeys = projectionKeysRef.current;
      const hasCurrentNodes = current.length > 0;
      const identityChanged = hasCurrentNodes && previousKeys.identity !== projectedIdentityKey;
      const layoutChanged = hasCurrentNodes && previousKeys.layout !== projectedLayoutKey;
      const shouldForceCommittedProjection = forceCommittedProjectionRef.current && layoutChanged;
      if (shouldForceCommittedProjection) {
        forceCommittedProjectionRef.current = false;
      }
      projectionKeysRef.current = {
        identity: projectedIdentityKey,
        layout: projectedLayoutKey,
      };
      const nextNodes =
        !hasCurrentNodes ||
        identityChanged ||
        shouldForceCommittedProjection ||
        (layoutChanged && !draggingRef.current)
          ? projectedFlowNodes
          : reconcileFlowNodes(current, projectedFlowNodes, { preservePositions: true });
      flowNodesRef.current = nextNodes;
      return nextNodes;
    });
  }, [projectedFlowNodes, projectedIdentityKey, projectedLayoutKey]);

  const commitDraggedFlowNode = useCallback((node: CanvasFlowNode) => {
    const commitKey = dragCommitKey(node);
    if (lastDragCommitRef.current === commitKey) {
      return;
    }
    lastDragCommitRef.current = commitKey;
    forceCommittedProjectionRef.current = true;
    const committedFlowNodes = flowNodesRef.current;
    const nextSelection = selectionForDraggedNodeCommit(
      visibleCanvas,
      committedFlowNodes,
      node,
      selection,
    );
    onCanvasChange((current) =>
      commitDraggedNodeToCanvas(current, committedFlowNodes, node),
    );
    if (nextSelection) {
      onSelect(nextSelection);
    }
  }, [onCanvasChange, onSelect, selection, visibleCanvas]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const hasRemoveChange = changes.some((change) => change.type === 'remove');
    const completedDragNodeIds = changes.flatMap((change) =>
      change.type === 'position' && change.dragging === false ? [change.id] : [],
    );
    const nextNodes = applyNodeChanges(
      changes,
      flowNodesRef.current.length ? flowNodesRef.current : projectedFlowNodes,
    ) as CanvasFlowNode[];
    flowNodesRef.current = nextNodes;
    setFlowNodes(nextNodes);
    if (completedDragNodeIds.length > 0) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      if (connectStartRef.current) {
        flowNodesRef.current = projectedFlowNodes;
        setFlowNodes(projectedFlowNodes);
        return;
      }
      const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));
      completedDragNodeIds.forEach((nodeId) => {
        const node = nextNodeById.get(nodeId);
        if (node) {
          commitDraggedFlowNode(node);
        }
      });
    }
    const positions = new Map(nextNodes.map((node) => [node.id, node.position]));
    const remainingIds = new Set(nextNodes.map((node) => node.id));
    if (hasRemoveChange) {
      onCanvasChange((current) => commitFlowNodePositions(current, visibleCanvas, positions, remainingIds));
    }
  }, [commitDraggedFlowNode, onCanvasChange, projectedFlowNodes, visibleCanvas]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const nextEdges = applyEdgeChanges(changes, flowEdges);
    if (!changes.some((change) => change.type === 'remove')) {
      return;
    }
    const remaining = new Set(nextEdges.map((edge) => edge.id));
    onCanvasChange((current) => ({
      ...current,
      edges: current.edges.filter((edge) => remaining.has(edge.id)),
      workflows: current.workflows.map((workflow) => ({
        ...workflow,
        internalEdges: workflow.internalEdges.filter((edge) => remaining.has(edge.id)),
      })),
    }));
  }, [flowEdges, onCanvasChange]);

  const handleConnect: OnConnect = useCallback((connection) => {
    const scopedEdge = scopedEdgeFromConnection(visibleCanvas, connection, connectionMode);
    if (!scopedEdge) {
      return;
    }
    const { edge, scopeWorkflowId } = scopedEdge;
    if (scopeWorkflowId) {
      onCanvasChange((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === scopeWorkflowId
            ? {
                ...workflow,
                internalEdges: [...workflow.internalEdges.filter((item) => item.id !== edge.id), edge],
              }
            : workflow,
        ),
      }));
      onSelect({ type: 'edge', id: edge.id });
      return;
    }
    onCanvasChange((current) => ({
      ...current,
      edges: [...current.edges.filter((item) => item.id !== edge.id), edge],
    }));
    onSelect({ type: 'edge', id: edge.id });
  }, [connectionMode, onCanvasChange, onSelect, visibleCanvas]);

  const handleNodeDragStart = useCallback((event?: unknown, node?: CanvasFlowNode) => {
    draggingRef.current = true;
    lastDragCommitRef.current = null;
    nodeDragStartPositionRef.current.clear();
    nodeDragEligibleRef.current.clear();
    const eventTarget = event && typeof event === 'object' && 'target' in event ? event.target : null;
    const hasBrowserEvent = eventTarget !== null;
    const startsFromHandle =
      eventTarget instanceof Element && Boolean(eventTarget.closest('.react-flow__handle'));
    if (node) {
      nodeDragStartPositionRef.current.set(node.id, { ...node.position });
      nodeDragEligibleRef.current.set(node.id, !startsFromHandle);
    } else {
      flowNodesRef.current.forEach((item) => {
        nodeDragStartPositionRef.current.set(item.id, { ...item.position });
        nodeDragEligibleRef.current.set(item.id, !hasBrowserEvent && !startsFromHandle);
      });
    }
    setIsDraggingNode(true);
  }, []);

  const handleNodeDragStop = useCallback((node: CanvasFlowNode) => {
    const latestNode = flowNodesRef.current.find((item) => item.id === node.id) || node;
    const startPosition = nodeDragStartPositionRef.current.get(node.id);
    const dragEligible = nodeDragEligibleRef.current.get(node.id) !== false;
    nodeDragStartPositionRef.current.delete(node.id);
    nodeDragEligibleRef.current.delete(node.id);
    draggingRef.current = false;
    setIsDraggingNode(false);
    if (
      connectStartRef.current ||
      !dragEligible ||
      !startPosition ||
      Math.abs(latestNode.position.x - startPosition.x) + Math.abs(latestNode.position.y - startPosition.y) < 2
    ) {
      return;
    }
    commitDraggedFlowNode(latestNode);
  }, [commitDraggedFlowNode]);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const item = parsePaletteItem(event.dataTransfer.getData('application/x-acc-palette'));
    if (!item) {
      return;
    }
    const position = flowPositionFromEvent(flowInstance, event);
    if (focusedWorkflowId) {
      if (item.kind === 'workflow') {
        return;
      }
      onCanvasChange((current) => addInternalNodeFromPalette(current, focusedWorkflowId, item, position));
      return;
    }
    onCanvasChange((current) => {
      if (item.kind === 'workflow') {
        return addWorkflowFromPalette(current, item, position);
      }
      const targetWorkflow = workflowFromDropTarget(current, event.target);
      const positionedWorkflow = targetWorkflow || workflowAtPosition(current, position);
      const internalPosition = positionedWorkflow
        ? finitePosition(
            {
              x: position.x - positionedWorkflow.position.x,
              y: position.y - positionedWorkflow.position.y,
            },
            defaultInternalNodePosition(positionedWorkflow.internalNodes.length),
          )
        : position;
      return positionedWorkflow
        ? addInternalNodeFromPalette(current, positionedWorkflow.id, item, internalPosition)
        : addCapsuleNodeFromPalette(current, item, position);
    });
  }, [flowInstance, focusedWorkflowId, onCanvasChange]);

  const openCreateMenu = useCallback((event: ReactMouseEvent<Element> | MouseEvent) => {
    event.preventDefault();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    setNodeCreateMenu({
      x: event.clientX,
      y: event.clientY,
      position: flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, target),
    });
  }, [flowInstance]);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const pendingConnection = connectStartRef.current || connectStart;
    if (!pendingConnection || target?.closest('.react-flow__handle, .react-flow__node')) {
      connectStartRef.current = null;
      setConnectStart(null);
      return;
    }
    const point = pointerPoint(event);
    setNodeCreateMenu({
      x: point.x,
      y: point.y,
      position: flowPositionFromPoint(flowInstance, point),
      pendingConnection,
    });
    connectStartRef.current = null;
    setConnectStart(null);
  }, [connectStart, flowInstance]);

  const createMenuItem = useCallback((item: PaletteItem) => {
    if (focusedWorkflowId && item.kind === 'workflow') {
      return;
    }
    const menu = nodeCreateMenu;
    if (!menu) {
      return;
    }
    if (focusedWorkflowId && item.kind !== 'workflow') {
      onCanvasChange((current) =>
        addInternalNodeFromPaletteWithConnection(
          current,
          focusedWorkflowId,
          item,
          menu.position,
          menu.pendingConnection,
        ),
      );
      setNodeCreateMenu(null);
      return;
    }
    if (item.kind === 'workflow') {
      onCanvasChange((current) => addWorkflowFromPalette(current, item, menu.position));
    } else {
      onCanvasChange((current) => addCapsuleNodeFromPalette(current, item, menu.position));
    }
    setNodeCreateMenu(null);
  }, [focusedWorkflowId, nodeCreateMenu, onCanvasChange]);

  const handleConnectStart = useCallback(
    (_: unknown, params: { nodeId?: string | null; handleId?: string | null }) => {
      const pending = {
        nodeId: String(params.nodeId || ''),
        handleId: params.handleId || null,
        mode: connectionMode,
      };
      connectStartRef.current = pending;
      setConnectStart(pending);
    },
    [connectionMode],
  );

  const handleInit = useCallback(
    (instance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } }) =>
      setFlowInstance(instance),
    [],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: CanvasFlowNode) => {
      setNodeCreateMenu(null);
      const internal = parseInternalFlowNodeId(node.id);
      if (internal) {
        handleSelectInternal(internal.workflowId, internal.nodeId);
        return;
      }
      onSelect({ type: 'workflow', id: node.id });
    },
    [handleSelectInternal, onSelect],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      setNodeCreateMenu(null);
      onSelect({ type: 'edge', id: edge.id });
    },
    [onSelect],
  );

  const handlePaneClick = useCallback(() => {
    setNodeCreateMenu(null);
    onSelect({ type: 'task_canvas', taskId: canvas.id });
    onBlankCanvas();
  }, [canvas.id, onBlankCanvas, onSelect]);

  const defaultEdgeOptions = useMemo(
    () => ({ markerEnd: { type: MarkerType.ArrowClosed } }),
    [],
  );

  return (
    <main
      className={isDraggingNode ? 'workspace-canvas-surface dragging-node' : 'workspace-canvas-surface'}
      aria-label="Workspace Canvas"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onContextMenu={openCreateMenu}
    >
      <CanvasToolbar
        connectionMode={connectionMode}
        edgeViewMode={edgeViewMode}
        focusedWorkflowId={focusedWorkflowId}
        workflowRun={workflowRun}
        onEdgeViewMode={onEdgeViewMode}
        onExitFocus={() => onFocusedWorkflow(null)}
      />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeDragStart={(event, node) => handleNodeDragStart(event, node as CanvasFlowNode)}
        onNodeDragStop={(_, node) => handleNodeDragStop(node as CanvasFlowNode)}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={openCreateMenu}
        fitView
        minZoom={0.18}
        maxZoom={1.7}
        defaultEdgeOptions={defaultEdgeOptions}
      >
        <MiniMap />
        <Controls />
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      </ReactFlow>
      {nodeCreateMenu ? (
        <NodeCreateMenu
          x={nodeCreateMenu.x}
          y={nodeCreateMenu.y}
          focused={Boolean(focusedWorkflowId)}
          workflows={workflows}
          capsules={capsules}
          onPick={createMenuItem}
          onClose={() => setNodeCreateMenu(null)}
        />
      ) : null}
    </main>
  );
}

function CanvasToolbar({
  connectionMode,
  edgeViewMode,
  focusedWorkflowId,
  workflowRun,
  onEdgeViewMode,
  onExitFocus,
}: {
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  focusedWorkflowId: string | null;
  workflowRun: WorkflowRunResult | null;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onExitFocus: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="Canvas Toolbar">
      <span className={`mode-pill ${connectionMode === 'data' ? 'data' : 'control'}`}>
        {connectionMode === 'data' ? 'Data Edge: 浅灰虚线' : 'Control Edge: 灰黑实线'}
      </span>
      <span>状态：{workflowRun ? statusLabel(workflowRun.status) : '未运行'}</span>
      <div className="segmented-control compact" aria-label="Edge display mode">
        {(['all', 'control', 'data'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={edgeViewMode === mode ? 'active' : ''}
            aria-label={
              mode === 'all' ? '显示全部边' : mode === 'control' ? '显示控制边' : '显示数据边'
            }
            onClick={() => onEdgeViewMode(mode)}
          >
            {mode === 'all' ? '全部' : mode === 'control' ? '控制' : '数据'}
          </button>
        ))}
      </div>
      {focusedWorkflowId ? (
        <button type="button" onClick={onExitFocus}>
          返回 Workspace
        </button>
      ) : null}
    </div>
  );
}

function NodeCreateMenu({
  x,
  y,
  focused,
  workflows,
  capsules,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  focused: boolean;
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const agentItems = capsules.filter((capsule) => capsule.id !== 'file-source.local').slice(0, 8);
  const workflowItems = workflows.slice(0, 8);
  return (
    <div
      className="node-create-menu"
      style={{
        left: `clamp(12px, ${x}px, calc(100vw - 332px))`,
        top: `clamp(12px, ${y}px, calc(100vh - 492px))`,
      }}
      role="menu"
      aria-label="新增节点"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header>
        <strong>{focused ? '新增 Agent / Tool' : '新增 Workflow'}</strong>
        <button type="button" onClick={onClose} aria-label="关闭新增菜单">
          ×
        </button>
      </header>
      {focused ? (
        <>
          {agentItems.map((capsule) => (
            <button
              key={capsule.id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({ kind: 'agent', capsuleId: capsule.id, label: capsule.name || capsule.id })
              }
            >
              <CircleDot size={14} aria-hidden="true" />
              <span>{capsule.name || capsule.id}</span>
              <small>{capsule.id}</small>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'tool', capsuleId: 'fake-agent.generic', label: 'Generic Tool' })}
          >
            <TestTube size={14} aria-hidden="true" />
            <span>Generic Tool</span>
            <small>fake-agent.generic</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'file_source', capsuleId: 'file-source.local', label: 'File Source' })}
          >
            <FileText size={14} aria-hidden="true" />
            <span>File Source</span>
            <small>file-source.local</small>
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => onPick({ kind: 'workflow', label: 'New Workflow' })}>
            <GitBranch size={14} aria-hidden="true" />
            <span>New Workflow</span>
            <small>workflow template</small>
          </button>
          {workflowItems.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({
                  kind: 'workflow',
                  workflowRef: workflow.path,
                  label: workflow.name || workflow.workflow_id,
                })
              }
            >
              <GitBranch size={14} aria-hidden="true" />
              <span>{workflow.name || workflow.workflow_id}</span>
              <small>{workflow.path}</small>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function WorkflowContainer({
  id,
  data,
}: NodeProps<WorkflowFlowNode>) {
  const workflow = data.workflow;
  return (
    <article
      className={[
        'workflow-container',
        workflow.boundaryKind ? 'workflow-boundary-container' : '',
        `status-${workflow.status}`,
        data.selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`workflow-container-${id}`}
      data-workflow-id={workflow.id}
      style={{ width: workflow.size.width, minHeight: workflow.size.height }}
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
        className="workflow-control-handle input"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="workflow-control-handle output"
      />
      <WorkflowDirectoryPill
        directory={bindingDirectory(workflow, data.binding)}
        status={data.binding?.status || 'unbound'}
        onConfigure={() => data.onConfigureWorkflow(workflow.id)}
      />
      <WorkflowHeader workflow={workflow} />
      {!data.showDataPorts ? <HiddenWorkflowPortHandles workflow={workflow} /> : null}
      <div className={data.showDataPorts ? 'workflow-nested-canvas advanced-data' : 'workflow-nested-canvas'}>
        {data.showDataPorts ? (
          <WorkflowPortColumn
            workflowId={workflow.id}
            direction="input"
            ports={workflow.inputPorts}
            onSelectPort={data.onSelectPort}
          />
        ) : null}
        <div className="internal-node-grid" aria-label={`${workflow.title} internal nodes`}>
          {workflow.internalNodes.length === 0 ? (
            <div className="empty-internal-node">内部节点未展开</div>
          ) : null}
        </div>
        {data.showDataPorts ? (
          <WorkflowPortColumn
            workflowId={workflow.id}
            direction="output"
            ports={workflow.outputPorts}
            onSelectPort={data.onSelectPort}
          />
        ) : null}
      </div>
    </article>
  );
}

function HiddenWorkflowPortHandles({ workflow }: { workflow: WorkflowContainerModel }) {
  return (
    <div className="workflow-hidden-port-handles" aria-hidden="true">
      {workflow.inputPorts.map((port) => (
        <Handle
          key={`input-${port.id}`}
          type="target"
          position={Position.Left}
          id={portHandleId(workflow.id, 'input', port.id)}
          className="workflow-port-handle hidden input"
        />
      ))}
      {workflow.outputPorts.map((port) => (
        <Handle
          key={`output-${port.id}`}
          type="source"
          position={Position.Right}
          id={portHandleId(workflow.id, 'output', port.id)}
          className="workflow-port-handle hidden output"
        />
      ))}
    </div>
  );
}

function AgentToolNode({
  data,
}: NodeProps<AgentToolFlowNode>) {
  return (
    <button
      type="button"
      className={[
        'agent-tool-node',
        data.kind === 'Tool' ? 'tool' : 'agent',
        `status-${data.status}`,
        data.selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`agent-tool-node-${data.id}`}
      onClick={data.onSelect}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="workflow-control-handle input"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="workflow-control-handle output"
      />
      {data.showDataPorts
        ? data.inputPorts.map((portValue, index) => (
            <Handle
              key={portValue.id}
              id={portHandleId(data.id, 'input', portValue.id)}
              type="target"
              position={Position.Left}
              className="workflow-port-handle input"
              style={{ top: 42 + index * 14 }}
            />
          ))
        : null}
      {data.showDataPorts
        ? data.outputPorts.map((portValue, index) => (
            <Handle
              key={portValue.id}
              id={portHandleId(data.id, 'output', portValue.id)}
              type="source"
              position={Position.Right}
              className="workflow-port-handle output"
              style={{ top: 42 + index * 14 }}
            />
          ))
        : null}
      <span className={`status-dot ${data.status}`} />
      <div>
        <strong>{data.title}</strong>
        <p>{data.capsuleId || data.kind}</p>
      </div>
      <small>{data.kind}</small>
    </button>
  );
}

function WorkflowDirectoryPill({
  directory,
  status,
  onConfigure,
}: {
  directory: string;
  status: string;
  onConfigure: () => void;
}) {
  return (
    <div className={`workflow-directory-pill ${status}`}>
      <span>{directory}</span>
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
  );
}

function WorkflowHeader({ workflow }: { workflow: WorkflowContainerModel }) {
  return (
    <header className="workflow-container-header">
      <div>
        <h3>{workflow.title}</h3>
        <p>{workflowSubtitle(workflow)}</p>
      </div>
      <span className={`status-dot ${workflow.status}`} aria-label={statusLabel(workflow.status)} />
      <span className={`pill ${statusTone(workflow.status)}`}>{statusLabel(workflow.status)}</span>
    </header>
  );
}

function workflowSubtitle(workflow: WorkflowContainerModel): string {
  if (workflow.boundaryKind === 'workflow_input') {
    return 'Workflow Input Ports';
  }
  if (workflow.boundaryKind === 'workflow_output') {
    return 'Workflow Output Ports';
  }
  if (workflow.sourceKind === 'agent_session') {
    return workflow.capsuleId || 'Agent Capsule';
  }
  if (workflow.sourceKind === 'tool') {
    return workflow.capsuleId || 'Tool Capsule';
  }
  return workflow.workflowRef || 'Workflow Template';
}

function WorkflowPortColumn({
  workflowId,
  direction,
  ports,
  onSelectPort,
}: {
  workflowId: string;
  direction: PortDirection;
  ports: WorkflowPortView[];
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
}) {
  return (
    <div className={`workflow-port-column ${direction}`} aria-label={`${workflowId} ${direction}`}>
      {ports.map((port) => (
        <WorkflowPortNode
          key={port.id}
          workflowId={workflowId}
          port={port}
          onSelect={() => onSelectPort(workflowId, port)}
        />
      ))}
    </div>
  );
}

function WorkflowPortNode({
  workflowId,
  port,
  onSelect,
}: {
  workflowId: string;
  port: WorkflowPortView;
  onSelect: () => void;
}) {
  const handleId = portHandleId(workflowId, port.direction, port.id);
  return (
    <button
      type="button"
      className={`workflow-port-node ${port.direction}`}
      data-testid={`workflow-port-${workflowId}-${port.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {port.direction === 'input' ? (
        <Handle
          type="target"
          position={Position.Left}
          id={handleId}
          className="workflow-port-handle input"
        />
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id={handleId}
          className="workflow-port-handle output"
        />
      )}
      <span>{port.id}</span>
      <small>{port.label}</small>
    </button>
  );
}

function InternalNodeCard({
  workflowId,
  node,
  index,
  onClick,
  onMove,
}: {
  workflowId: string;
  node: InternalNodeView;
  index: number;
  onClick: () => void;
  onMove: (workflowId: string, nodeId: string, position: { x: number; y: number }) => void;
}) {
  function startDrag(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget;
    const container = card.closest('.internal-node-grid');
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = node.position || defaultInternalNodePosition(index);
    const maxX = Math.max(0, container.clientWidth - card.offsetWidth - 8);
    const maxY = Math.max(0, container.clientHeight - card.offsetHeight - 8);
    const move = (nextEvent: MouseEvent) => {
      const nextPosition = {
        x: clamp(startPosition.x + nextEvent.clientX - startX, 8, maxX),
        y: clamp(startPosition.y + nextEvent.clientY - startY, 8, maxY),
      };
      onMove(workflowId, node.id, nextPosition);
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }
  return (
    <button
      type="button"
      className={`internal-node-card nodrag nopan status-${node.status}`}
      onClick={onClick}
      onMouseDown={startDrag}
      style={{
        left: finiteNumber(node.position?.x, defaultInternalNodePosition(index).x),
        top: finiteNumber(node.position?.y, defaultInternalNodePosition(index).y),
      }}
    >
      <span className={`status-dot ${node.status}`} />
      <div>
        <strong>{node.name}</strong>
        <p>{node.task}</p>
      </div>
      <span className={node.kind === 'Agent' ? 'node-badge agent' : 'node-badge tool'}>
        {node.kind}
      </span>
    </button>
  );
}

function MiniMap() {
  return <ReactFlowMiniMap pannable zoomable nodeClassName="workflow-minimap-node" />;
}

function ResourceInspector({ resource }: { resource: ResourceTemplate }) {
  const title =
    resource.kind === 'workflow_class'
      ? resource.name
      : resource.kind === 'agent_class'
        ? resource.name
        : resource.name;
  return (
    <aside className="right-inspector" aria-label="资源详情面板">
      <header className="inspector-title-row">
        <h3>{title}</h3>
      </header>
      <dl className="definition-grid compact">
        <dt>类型</dt>
        <dd>
          {resource.kind === 'workflow_class'
            ? 'Workflow Class'
            : resource.kind === 'agent_class'
              ? 'Agent Class'
              : 'Tool Class'}
        </dd>
        <dt>ID</dt>
        <dd>{resource.kind === 'workflow_class' ? resource.workflowId : resource.capsuleId}</dd>
        {resource.kind === 'workflow_class' ? (
          <>
            <dt>路径</dt>
            <dd>{resource.path}</dd>
          </>
        ) : null}
      </dl>
      <p className="muted">资源是可复用类；拖入任务画布后才会创建本次任务里的调用实例。</p>
    </aside>
  );
}

function RightInspector({
  canvas,
  selection,
  selectedWorkflow,
  selectedPort,
  selectedEdge,
  selectedInternalNode,
  connectionMode,
  workflowRun,
  workflowEvents,
  binding,
  onConnectionMode,
  onReadEvidence,
  onConfigureBinding,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedPort?: WorkflowPortView;
  selectedEdge?: WorkflowCanvasEdge;
  selectedInternalNode?: InternalNodeView;
  connectionMode: ConnectionMode;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  binding?: WorkflowBindingView;
  onConnectionMode: (mode: ConnectionMode) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
}) {
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    setTab('overview');
  }, [selection]);

  return (
    <aside className="right-inspector" aria-label="属性面板">
      <header className="inspector-title-row">
        <h3>Inspector</h3>
        <div className="segmented-control" aria-label="连接模式">
          <button
            type="button"
            className={connectionMode === 'data' ? 'active' : ''}
            onClick={() => onConnectionMode('data')}
          >
            数据
          </button>
          <button
            type="button"
            className={connectionMode === 'control' ? 'active' : ''}
            onClick={() => onConnectionMode('control')}
          >
            控制
          </button>
        </div>
      </header>
      <InspectorTabs
        selection={selection}
        activeTab={tab}
        onTab={setTab}
      />
      {selection.type === 'workflow' && selectedWorkflow ? (
        <WorkflowInspector
          workflow={selectedWorkflow}
          tab={tab}
          workflowRun={workflowRun}
          events={workflowEvents}
          binding={binding}
          onReadEvidence={onReadEvidence}
          onConfigureBinding={onConfigureBinding}
        />
      ) : null}
      {selection.type === 'port' && selectedWorkflow && selectedPort ? (
        <PortInspector workflow={selectedWorkflow} port={selectedPort} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'edge' && selectedEdge ? (
        <EdgeInspector edge={selectedEdge} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'internal' && selectedWorkflow && selectedInternalNode ? (
        <InternalNodeInspector workflow={selectedWorkflow} node={selectedInternalNode} tab={tab} />
      ) : null}
    </aside>
  );
}

function InspectorTabs({
  selection,
  activeTab,
  onTab,
}: {
  selection: CanvasSelection;
  activeTab: string;
  onTab: (tab: string) => void;
}) {
  const tabs =
    selection.type === 'edge'
      ? ['overview', 'upstream', 'downstream', 'mapping', 'raw']
      : selection.type === 'port'
        ? ['overview', 'contract', 'connections', 'evidence']
        : selection.type === 'internal'
          ? ['overview', 'input', 'output', 'artifacts', 'events', 'logs', 'raw']
          : ['overview', 'input', 'output', 'config', 'history', 'raw'];
  const labels: Record<string, string> = {
    overview: '概览',
    input: '输入',
    output: '输出',
    config: '配置',
    history: '运行历史',
    raw: '原始数据',
    contract: 'Contract',
    connections: '连接',
    evidence: '运行证据',
    upstream: '上游',
    downstream: '下游',
    mapping: '数据映射',
    artifacts: '产物',
    events: '事件',
    logs: '日志',
  };
  return (
    <div className="tab-strip compact-tabs" role="tablist" aria-label="Inspector tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={activeTab === tab ? 'active' : ''}
          onClick={() => onTab(tab)}
        >
          {labels[tab] || tab}
        </button>
      ))}
    </div>
  );
}

function WorkflowInspector({
  workflow,
  tab,
  workflowRun,
  events,
  binding,
  onReadEvidence,
  onConfigureBinding,
}: {
  workflow: WorkflowContainerModel;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  events: RunEvent[];
  binding?: WorkflowBindingView;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
}) {
  const nodeRun = workflowRun?.nodes.find((node) => node.node_id === workflow.id);
  if (tab === 'input') {
    return <PortList title="输入端口" ports={workflow.inputPorts} />;
  }
  if (tab === 'output') {
    return <PortList title="输出端口" ports={workflow.outputPorts} />;
  }
  if (tab === 'config') {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>workflow_ref</dt>
          <dd>{workflow.workflowRef || 'inline/demo'}</dd>
          <dt>cwd</dt>
          <dd>{bindingDirectory(workflow, binding)}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOf(binding) || 'unbound'}</dd>
          <dt>size</dt>
          <dd>
            {workflow.size.width} x {workflow.size.height}
          </dd>
          <dt>binding status</dt>
          <dd>{binding?.status || 'unbound'}</dd>
        </dl>
        <button type="button" className="secondary-action" onClick={() => onConfigureBinding(workflow.id)}>
          <FolderCog aria-hidden="true" size={16} />
          配置工作目录
        </button>
      </section>
    );
  }
  if (tab === 'history') {
    return (
      <section className="inspector-stack">
        <button
          type="button"
          className="path-button"
          disabled={!nodeRun?.output_path}
          onClick={() => onReadEvidence(nodeRun?.output_path, '节点输出')}
        >
          <FileText aria-hidden="true" size={16} />
          <span>输出</span>
          <small>{shortPath(nodeRun?.output_path)}</small>
        </button>
        <EventTimeline events={events} title="工作流事件" />
      </section>
    );
  }
  if (tab === 'raw') {
    return (
      <CodeBlock
        title="workflow-container.json"
        content={JSON.stringify(workflow, null, 2)}
        variant="json"
      />
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>名称</dt>
      <dd>{workflow.title}</dd>
      <dt>状态</dt>
      <dd>{statusLabel(workflow.status)}</dd>
      <dt>目录</dt>
      <dd>{bindingDirectory(workflow, binding)}</dd>
      <dt>端口</dt>
      <dd>
        {workflow.inputPorts.length} in / {workflow.outputPorts.length} out
      </dd>
      <dt>内部节点</dt>
      <dd>{workflow.internalNodes.length}</dd>
    </dl>
  );
}

function PortInspector({
  workflow,
  port,
  tab,
  canvas,
}: {
  workflow: WorkflowContainerModel;
  port: WorkflowPortView;
  tab: string;
  canvas: WorkspaceCanvasModel;
}) {
  const relatedEdges = canvas.edges.filter(
    (edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => {
    if (edge.kind !== 'data') {
      return false;
    }
    return (
      (edge.source.workflowId === workflow.id && edge.source.portId === port.id) ||
      (edge.target.workflowId === workflow.id && edge.target.portId === port.id)
    );
    },
  );
  if (tab === 'connections') {
    return (
      <section className="inspector-stack">
        {relatedEdges.map((edge) => (
          <article key={edge.id} className="edge-summary-row">
            {edge.source.workflowId}.{edge.source.portId} {'->'} {edge.target.workflowId}.
            {edge.target.portId}
          </article>
        ))}
        {relatedEdges.length === 0 ? <p className="muted">暂无连接</p> : null}
      </section>
    );
  }
  if (tab === 'contract' || tab === 'overview') {
    return (
      <dl className="definition-grid compact">
        <dt>workflow</dt>
        <dd>{workflow.title}</dd>
        <dt>port</dt>
        <dd>{port.id}</dd>
        <dt>方向</dt>
        <dd>{port.direction}</dd>
        <dt>说明</dt>
        <dd>{port.label}</dd>
        <dt>required</dt>
        <dd>{String(Boolean(port.required))}</dd>
        <dt>cardinality</dt>
        <dd>{port.cardinality || 'one'}</dd>
      </dl>
    );
  }
  return <p className="muted">运行证据会在 workflow run 后按 inbox/outbox manifest 展示。</p>;
}

function EdgeInspector({
  edge,
  tab,
  canvas,
}: {
  edge: WorkflowCanvasEdge;
  tab: string;
  canvas: WorkspaceCanvasModel;
}) {
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.source.workflowId);
  const targetWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.target.workflowId);
  if (tab === 'raw') {
    return <CodeBlock title="edge.json" content={JSON.stringify(edge, null, 2)} variant="json" />;
  }
  return (
    <dl className="definition-grid compact">
      <dt>类型</dt>
      <dd>{edge.kind === 'data' ? 'Data Edge' : 'Control Edge'}</dd>
      <dt>上游</dt>
      <dd>
        {sourceWorkflow?.title || edge.source.workflowId}
        {'portId' in edge.source ? `.${edge.source.portId}` : ''}
      </dd>
      <dt>下游</dt>
      <dd>
        {targetWorkflow?.title || edge.target.workflowId}
        {'portId' in edge.target ? `.${edge.target.portId}` : ''}
      </dd>
      <dt>样式</dt>
      <dd>{edge.kind === 'data' ? '浅灰虚线' : '灰黑实线'}</dd>
    </dl>
  );
}

function InternalNodeInspector({
  workflow,
  node,
  tab,
}: {
  workflow: WorkflowContainerModel;
  node: InternalNodeView;
  tab: string;
}) {
  if (tab === 'raw') {
    return (
      <CodeBlock
        title="internal-node.json"
        content={JSON.stringify({ workflow: workflow.id, node }, null, 2)}
        variant="json"
      />
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>节点</dt>
      <dd>{node.name}</dd>
      <dt>任务</dt>
      <dd>{node.task}</dd>
      <dt>类型</dt>
      <dd>{node.kind}</dd>
      <dt>状态</dt>
      <dd>{statusLabel(node.status)}</dd>
      <dt>runtime</dt>
      <dd>{node.runtime || 'n/a'}</dd>
    </dl>
  );
}

function PortList({ title, ports }: { title: string; ports: WorkflowPortView[] }) {
  return (
    <section className="inspector-stack">
      <h4>{title}</h4>
      {ports.map((port) => (
        <article key={port.id} className="port-contract-row">
          <strong>{port.id}</strong>
          <span>{port.label}</span>
          <small>
            {port.required ? 'required' : 'optional'} / {port.cardinality || 'one'}
          </small>
        </article>
      ))}
    </section>
  );
}

function EvidenceDock({
  state,
  message,
  workflowRun,
  workflowEvents,
  onToggle,
}: {
  state: EvidenceDockState;
  message: string;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  onToggle: () => void;
}) {
  return (
    <footer className={state.open ? 'evidence-dock open' : 'evidence-dock'} aria-label="Evidence Dock">
      <button type="button" className="evidence-dock-toggle" onClick={onToggle}>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        <strong>{workflowRun ? statusLabel(workflowRun.status) : '未运行'}</strong>
        <span>{message}</span>
      </button>
      {state.open ? (
        <div className="evidence-dock-body">
          <section>
            <h3>{state.title}</h3>
            {state.content ? <ReadableArtifact content={state.content} /> : <p>暂无打开的证据。</p>}
          </section>
          <EventTimeline events={workflowEvents} title="最近事件" />
        </div>
      ) : null}
    </footer>
  );
}

function WorkflowBindingDialog({
  workflowId,
  binding,
  onClose,
  onValidate,
  onSave,
  onOpenFolder,
}: {
  workflowId: string;
  binding?: WorkflowBindingView;
  onClose: () => void;
  onValidate: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onSave: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onOpenFolder: (workflowId: string) => Promise<void>;
}) {
  const [workspaceRoot, setWorkspaceRoot] = useState(workspaceRootOf(binding) || '');
  const [message, setMessage] = useState(binding?.status || 'unbound');
  useEffect(() => {
    setWorkspaceRoot(workspaceRootOf(binding) || '');
    setMessage(binding?.status || 'unbound');
  }, [workflowId, binding]);

  async function validate() {
    const result = await onValidate(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  async function save() {
    const result = await onSave(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  return (
    <div className="binding-dialog" role="dialog" aria-label="配置工作目录">
      <div className="binding-dialog-panel">
        <header>
          <div>
            <span className="topbar-kicker">Workspace Binding</span>
            <h3>{workflowId}</h3>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <label>
          workspace_root
          <input
            aria-label="workspace_root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            placeholder="F:\\Agent-Capsule-Conductor\\WorkFlowTest\\paper1"
          />
        </label>
        <dl className="definition-grid compact">
          <dt>状态</dt>
          <dd>{message}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOf(binding) || `bindings/${workflowId}.binding.local.json`}</dd>
        </dl>
        <div className="toolbar-actions">
          <button type="button" onClick={validate}>
            校验目录
          </button>
          <button type="button" className="primary-action" onClick={save}>
            保存绑定
          </button>
          <button type="button" onClick={() => void onOpenFolder(workflowId)}>
            打开 bindings 目录
          </button>
        </div>
      </div>
    </div>
  );
}

function EventTimeline({ events, title }: { events: RunEvent[]; title: string }) {
  const visibleEvents = events.slice(-12).reverse();
  return (
    <section className="event-timeline" aria-label={title}>
      <h3>{title}</h3>
      {visibleEvents.length === 0 ? <p className="muted">暂无事件</p> : null}
      {visibleEvents.map((event, index) => (
        <article key={String(event.event_id || `${event.type}-${index}`)} className="event-row">
          <strong>{String(event.type || event.event || 'event')}</strong>
          <span>{event.node_id ? `node=${event.node_id}` : ''}</span>
          <small>{String(event.status || '')}</small>
          <small>{event.timestamp}</small>
        </article>
      ))}
    </section>
  );
}

function reconcileFlowNodes(
  current: CanvasFlowNode[],
  projected: CanvasFlowNode[],
  options: { preservePositions: boolean },
): CanvasFlowNode[] {
  if (!options.preservePositions) {
    return projected;
  }
  const currentById = new Map(current.map((node) => [node.id, node]));
  return projected.map((node) => {
    const existing = currentById.get(node.id);
    if (!existing) {
      return node;
    }
    return {
      ...node,
      position: existing.position,
      dragging: existing.dragging,
      measured: existing.measured ?? node.measured,
      width: existing.width ?? node.width,
      height: existing.height ?? node.height,
    };
  }) as CanvasFlowNode[];
}

function flowNodeIdentityKey(nodes: CanvasFlowNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.type || ''}:${node.parentId || ''}`)
    .sort()
    .join('|');
}

function flowNodeLayoutKey(nodes: CanvasFlowNode[]): string {
  return nodes
    .map((node) => {
      const size = flowNodeSize(node);
      return `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}:${size.width}:${size.height}`;
    })
    .sort()
    .join('|');
}

function flowNodeSize(node: CanvasFlowNode): { width: number | string; height: number | string } {
  if (node.type === 'workflowContainer') {
    return {
      width: node.data.workflow.size.width,
      height: node.data.workflow.size.height,
    };
  }
  return {
    width: node.width ?? node.measured?.width ?? '',
    height: node.height ?? node.measured?.height ?? '',
  };
}

function dragCommitKey(node: CanvasFlowNode): string {
  return `${node.id}:${node.parentId || ''}`;
}

function toFlowNodes(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  bindings: Record<string, WorkflowBindingView>,
  onSelectPortFn: (workflowId: string, port: WorkflowPortView) => void,
  onSelectInternalFn: (workflowId: string, nodeId: string) => void,
  onOpenFocus: (workflowId: string) => void,
  onConfigureWorkflow: (workflowId: string) => void,
  showDataPorts: boolean,
  onResize: (workflowId: string, size: { width: number; height: number }) => void,
  onMoveInternal: (
    workflowId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void,
): CanvasFlowNode[] {
  return canvas.workflows.flatMap((workflow) => {
    if (isExecutableNodeWorkflow(workflow)) {
      return [topLevelAgentToolFlowNode(workflow, selection, showDataPorts)];
    }
    const workflowNode: WorkflowFlowNode = {
      id: workflow.id,
      type: 'workflowContainer',
      position: workflow.position,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      data: {
        workflow,
        binding: bindings[workflow.id],
        selected: selection.type === 'workflow' && selection.id === workflow.id,
        showDataPorts,
        onSelectPort: onSelectPortFn,
        onSelectInternal: onSelectInternalFn,
        onOpenFocus,
        onConfigureWorkflow,
        onResize,
        onMoveInternal,
      },
    };
    const internalNodes = workflow.internalNodes.map((node, index): AgentToolFlowNode => ({
      id: internalFlowNodeId(workflow.id, node.id),
      type: 'agentToolNode',
      parentId: workflow.id,
      position: node.position || defaultInternalNodePosition(index),
      selected:
        selection.type === 'internal' &&
        selection.workflowId === workflow.id &&
        selection.nodeId === node.id,
      data: {
        id: internalFlowNodeId(workflow.id, node.id),
        title: node.name,
        kind: node.kind,
        status: node.status,
        capsuleId: node.capsuleId || node.runtime,
        workflowId: workflow.id,
        internalNodeId: node.id,
        inputPorts: node.inputPorts || [port('main', 'input', 'input')],
        outputPorts: node.outputPorts || [port('main', 'output', 'output')],
        selected:
          selection.type === 'internal' &&
          selection.workflowId === workflow.id &&
          selection.nodeId === node.id,
        showDataPorts,
        onSelect: () => onSelectInternalFn(workflow.id, node.id),
      },
    }));
    return [workflowNode, ...internalNodes];
  });
}

function topLevelAgentToolFlowNode(
  workflow: WorkflowContainerModel,
  selection: CanvasSelection,
  showDataPorts: boolean,
): AgentToolFlowNode {
  const kind = workflow.sourceKind === 'tool' ? 'Tool' : 'Agent';
  return {
    id: workflow.id,
    type: 'agentToolNode',
    position: workflow.position,
    selected: selection.type === 'workflow' && selection.id === workflow.id,
    data: {
      id: workflow.id,
      title: workflow.title,
      kind,
      status: workflow.status,
      capsuleId: workflow.capsuleId,
      inputPorts: workflow.inputPorts,
      outputPorts: workflow.outputPorts,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      showDataPorts,
      onSelect: () => undefined,
    },
  };
}

function toFlowEdges(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  edgeViewMode: EdgeViewMode,
  showDataPorts: boolean,
): Edge[] {
  const rootEdges = canvas.edges.flatMap((edge) =>
    canvasEdgeToFlowEdge(edge, selection, connectionMode, undefined, edgeViewMode, showDataPorts),
  );
  const internalEdges = canvas.workflows.flatMap((workflow) =>
    workflow.internalEdges.flatMap((edge) =>
      canvasEdgeToFlowEdge(edge, selection, connectionMode, workflow.id, edgeViewMode, showDataPorts),
    ),
  );
  return [...rootEdges, ...internalEdges];
}

function canvasEdgeToFlowEdge(
  edge: WorkflowCanvasEdge,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  parentWorkflowId?: string,
  edgeViewMode: EdgeViewMode = 'all',
  showDataPorts = false,
): Edge[] {
    if (edgeViewMode !== 'all' && edge.kind !== edgeViewMode) {
      return [];
    }
    const isSelected = selection.type === 'edge' && selection.id === edge.id;
    const sourceId = parentWorkflowId
      ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.source.workflowId)
      : edge.source.workflowId;
    const targetId = parentWorkflowId
      ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.target.workflowId)
      : edge.target.workflowId;
    if (edge.kind === 'data') {
      return [{
        id: edge.id,
        source: sourceId,
        target: targetId,
        sourceHandle: showDataPorts ? portHandleId(sourceId, 'output', edge.source.portId) : undefined,
        targetHandle: showDataPorts ? portHandleId(targetId, 'input', edge.target.portId) : undefined,
        label: `${edge.source.portId} -> ${edge.target.portId}`,
        selected: isSelected,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#aab4bd' },
        className: 'workflow-edge-data',
        style: { stroke: '#aab4bd', strokeWidth: isSelected ? 3 : 2, strokeDasharray: '6 6' },
      }];
    }
    return [{
      id: edge.id,
      source: sourceId,
      target: targetId,
      label: 'control',
      selected: isSelected,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#303943' },
      className: 'workflow-edge-control',
      style: {
        stroke: connectionMode === 'control' || isSelected ? '#303943' : '#4c5661',
        strokeWidth: isSelected ? 2.5 : 1.6,
      },
    }];
}

function scopedEdgeFromConnection(
  canvas: WorkspaceCanvasModel,
  connection: Connection,
  connectionMode: ConnectionMode,
): { edge: WorkflowCanvasEdge; scopeWorkflowId: string | null } | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }
  const source = flowEndpoint(connection.source);
  const target = flowEndpoint(connection.target);
  if (connectionMode === 'control') {
    return scopedControlEdge(canvas, source, target);
  }
  const sourceHandle = parsePortHandle(connection.sourceHandle);
  const targetHandle = parsePortHandle(connection.targetHandle);
  if (
    !sourceHandle ||
    !targetHandle ||
    sourceHandle.direction !== 'output' ||
    targetHandle.direction !== 'input'
  ) {
    return null;
  }
  return scopedDataEdge(canvas, source, target, sourceHandle.portId, targetHandle.portId);
}

function scopedControlEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
): { edge: WorkflowCanvasEdge; scopeWorkflowId: string | null } | null {
  if (source.internal && target.internal && source.workflowId === target.workflowId) {
    return {
      scopeWorkflowId: source.workflowId,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (!source.internal && target.internal && source.nodeId === target.workflowId) {
    const boundaryId = workflowInputBoundaryId(target.workflowId);
    return {
      scopeWorkflowId: target.workflowId,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.workflowId, 'control', boundaryId, target.nodeId),
        boundaryId,
        target.nodeId,
      ),
    };
  }
  if (source.internal && !target.internal && target.nodeId === source.workflowId) {
    const boundaryId = workflowOutputBoundaryId(source.workflowId);
    return {
      scopeWorkflowId: source.workflowId,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'control', source.nodeId, boundaryId),
        source.nodeId,
        boundaryId,
      ),
    };
  }
  if (!source.internal && !target.internal) {
    return {
      scopeWorkflowId: null,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  return null;
}

function scopedDataEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  sourcePortId: string,
  targetPortId: string,
): { edge: WorkflowCanvasEdge; scopeWorkflowId: string | null } | null {
  if (source.internal && target.internal && source.workflowId === target.workflowId) {
    return {
      scopeWorkflowId: source.workflowId,
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (!source.internal && !target.internal) {
    return {
      scopeWorkflowId: null,
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  return null;
}

function graphToWorkspaceCanvas(
  graph: WorkflowGraph,
  workflowRun: WorkflowRunResult | null,
): WorkspaceCanvasModel {
  const nodeStatus = new Map(workflowRun?.nodes.map((node) => [node.node_id, node.status]) || []);
  const isWorkflowFocusGraph =
    graph.metadata?.layout === 'workflow-focus' ||
    graph.nodes.every((node) => (node.kind || 'agent_session') !== 'workflow');
  const runtimeWorkflows = graph.nodes.map((node, index) =>
    workflowFromGraphNode(node, index, nodeStatus, isWorkflowFocusGraph),
  );
  const workflows = isWorkflowFocusGraph
    ? [
        workflowFocusInputBoundary(graph),
        ...runtimeWorkflows,
        workflowFocusOutputBoundary(graph),
      ]
    : runtimeWorkflows;
  const metadata = (graph.metadata || {}) as Record<string, unknown>;
  const edges = [
    ...(graph.data_edges || []).map(dataEdgeToCanvasEdge),
    ...(graph.control_edges || graph.edges || []).map(controlEdgeToCanvasEdge),
    ...workflowPortEdgesFromMetadata(metadata),
  ];
  return {
    id: graph.id,
    name: graph.name || graph.id,
    layout: isWorkflowFocusGraph ? 'workflow-focus' : 'workspace-canvas',
    rootWorkflowId: runtimeWorkflows[0]?.id || graph.id,
    workflows,
    edges,
  };
}

function workflowFocusInputBoundary(graph: WorkflowGraph): WorkflowContainerModel {
  return {
    id: workflowInputBoundaryId(graph.id),
    title: 'Workflow Inputs',
    boundaryKind: 'workflow_input',
    directory: 'Workflow boundary',
    status: 'not_run',
    inputPorts: [],
    outputPorts: workflowPortsFromGraph(graph.exposed_inputs, 'input').map((item) =>
      boundaryPort(item, 'output'),
    ),
    internalNodes: [],
    internalEdges: [],
    position: { x: 40, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
}

function workflowFocusOutputBoundary(graph: WorkflowGraph): WorkflowContainerModel {
  return {
    id: workflowOutputBoundaryId(graph.id),
    title: 'Workflow Outputs',
    boundaryKind: 'workflow_output',
    directory: 'Workflow boundary',
    status: 'not_run',
    inputPorts: workflowPortsFromGraph(graph.exposed_outputs, 'output').map((item) =>
      boundaryPort(item, 'input'),
    ),
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: Math.max(820, 360 + graph.nodes.length * 420), y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
}

function workflowPortEdgesFromMetadata(metadata: Record<string, unknown>): WorkflowCanvasEdge[] {
  const rawEdges = metadata.workflow_port_edges;
  if (!Array.isArray(rawEdges)) {
    return [];
  }
  return rawEdges.flatMap((edge) => {
    if (isWorkflowDataEdge(edge)) {
      return [dataEdgeToCanvasEdge(edge)];
    }
    if (isWorkflowGraphEdge(edge)) {
      return [controlEdgeToCanvasEdge(edge)];
    }
    return [];
  });
}

function workflowFromGraphNode(
  node: WorkflowGraphNode,
  index: number,
  nodeStatus: Map<string, string>,
  isWorkflowFocusGraph = false,
): WorkflowContainerModel {
  const metadata = (node.ui || {}) as Record<string, unknown>;
  const explicitWorkflowContainer = metadata.semantic_kind === 'workflow_container';
  const internalNodes =
    Array.isArray(metadata.internal_nodes)
      ? (metadata.internal_nodes as InternalNodeView[])
      : [
          {
            id: `${node.id}_session`,
            name: node.label || node.id,
            task: node.capsule_id || 'Capsule Session',
            kind: node.kind === 'tool' ? ('Tool' as const) : ('Agent' as const),
            status: (nodeStatus.get(node.id) as WorkflowStatus) || 'not_run',
            runtime: node.capsule_id,
          },
        ];
  const isWrappedCapsuleNode =
    !explicitWorkflowContainer &&
    node.kind === 'workflow' &&
    node.capsule_id === 'fake-agent.generic' &&
    !node.workflow_ref &&
    internalNodes.length === 1 &&
    typeof internalNodes[0]?.runtime === 'string' &&
    internalNodes[0].runtime !== node.capsule_id;
  const recoveredCapsuleId = isWrappedCapsuleNode ? internalNodes[0].runtime : node.capsule_id;
  const recoveredKind =
    (isWorkflowFocusGraph || isWrappedCapsuleNode) &&
    node.kind === 'workflow' &&
    recoveredCapsuleId !== node.capsule_id
      ? internalNodes[0]?.kind === 'Tool'
        ? 'tool'
        : 'agent_session'
      : node.kind;
  return {
    id: node.id,
    title: node.label || node.id,
    sourceKind: explicitWorkflowContainer ? 'workflow' : recoveredKind,
    capsuleId: recoveredCapsuleId,
    sourceInput: node.input,
    sourceInputMapping: node.input_mapping,
    workflowRef: node.workflow_ref,
    directory:
      typeof metadata.directory === 'string'
        ? metadata.directory
        : directoryForNode(node.id, node.relative_cwd),
    relativeCwd: node.relative_cwd,
    status: (nodeStatus.get(node.id) as WorkflowStatus) || 'not_run',
    inputPorts: workflowPortsFromGraph(node.input_ports, 'input'),
    outputPorts: workflowPortsFromGraph(node.output_ports, 'output'),
    internalNodes,
    internalEdges: internalEdgesFromMetadata(metadata),
    position: node.position || { x: 80 + index * 500, y: 220 },
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
}

function canvasToWorkflowGraph(canvas: WorkspaceCanvasModel): WorkflowGraph {
  const executableEdges = runtimeCanvasEdges(canvas.edges);
  const boundaryEdges = workflowBoundaryEdges(canvas.edges);
  const runtimeWorkflows = canvas.workflows.filter((workflow) => !workflow.boundaryKind);
  const controlEdges = executableEdges
    .filter((edge): edge is Extract<WorkflowCanvasEdge, { kind: 'control' }> => edge.kind === 'control')
    .map((edge) => ({
      id: edge.id,
      from: edge.source.workflowId,
      to: edge.target.workflowId,
      label: 'control',
      condition: edge.condition || null,
      context: 'upstream_output',
      mapping: {},
    }));
  const dataEdges = executableEdges
    .filter((edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => edge.kind === 'data')
    .map((edge) => ({
      id: edge.id,
      from: { node: edge.source.workflowId, port: edge.source.portId },
      to: { node: edge.target.workflowId, port: edge.target.portId },
      materialization: edge.materialization,
      required: true,
    }));
  return {
    id: canvas.id,
    version: '0.4.0',
    name: canvas.name,
    description: 'Graph-first workspace canvas generated by ACC Workbench.',
    nodes: runtimeWorkflows.map(workflowToGraphNode),
    edges: controlEdges,
    control_edges: controlEdges,
    data_edges: dataEdges,
    workspace_policy: {
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    },
    policy: { failure_mode: 'fail_fast', max_concurrency: 4 },
    metadata: {
      layout: canvas.layout || 'workspace-canvas',
      root_workflow_id: canvas.rootWorkflowId,
      directory_display_only: true,
      ...(canvas.layout === 'workflow-focus'
        ? {
            workflow_port_edges: boundaryEdges.map(canvasEdgeToGraphMetadataEdge),
          }
        : {}),
    },
    ...(canvas.layout === 'workflow-focus'
      ? focusBoundaryPortsForGraph(canvas)
      : {}),
  };
}

function focusBoundaryPortsForGraph(canvas: WorkspaceCanvasModel): Pick<
  WorkflowGraph,
  'exposed_inputs' | 'exposed_outputs'
> {
  const inputBoundary = canvas.workflows.find(
    (workflow) => workflow.boundaryKind === 'workflow_input',
  );
  const outputBoundary = canvas.workflows.find(
    (workflow) => workflow.boundaryKind === 'workflow_output',
  );
  return {
    exposed_inputs: (inputBoundary?.outputPorts || []).map((item) =>
      portViewToGraphPort(boundaryPort(item, 'input')),
    ),
    exposed_outputs: (outputBoundary?.inputPorts || []).map((item) =>
      portViewToGraphPort(boundaryPort(item, 'output')),
    ),
  };
}

function graphForCurrentView(
  canvas: WorkspaceCanvasModel,
  focusedWorkflowId: string | null,
): WorkflowGraph {
  if (!focusedWorkflowId) {
    return canvasToWorkflowGraph(canvas);
  }
  const workflow = canvas.workflows.find((item) => item.id === focusedWorkflowId);
  if (!workflow) {
    return canvasToWorkflowGraph(canvas);
  }
  return internalWorkflowToGraph(workflow);
}

function reusableWorkflowClassGraph(graph: WorkflowGraph): WorkflowGraph {
  const metadata = omitEmptyRecord(omitKeys(graph.metadata || {}, ['binding_ref']));
  return {
    ...graph,
    nodes: graph.nodes.map(reusableWorkflowClassNode),
    workspace_policy: {
      ...(graph.workspace_policy || {}),
      save_mode: 'stateless_template',
      default_state_mode: 'stateless',
    },
    metadata,
  };
}

function reusableWorkflowClassNode(node: WorkflowGraphNode): WorkflowGraphNode {
  const ui = node.ui
    ? omitEmptyRecord(sanitizeWorkflowClassNodeUi(omitKeys(node.ui, ['binding_ref'])))
    : undefined;
  const nextNode: WorkflowGraphNode = {
    ...node,
    cwd_policy: 'inherit_environment',
    relative_cwd: undefined,
    ui,
  };
  if (!nextNode.ui) {
    delete nextNode.ui;
  }
  delete nextNode.relative_cwd;
  return nextNode;
}

function sanitizeWorkflowClassNodeUi(ui: Record<string, unknown>): Record<string, unknown> {
  const nextUi = { ...ui };
  if (Array.isArray(nextUi.internal_nodes)) {
    nextUi.internal_nodes = nextUi.internal_nodes.map((node) =>
      isRecord(node) ? omitKeys(node, ['status', 'runId', 'sessionId', 'event_log', 'output_path']) : node,
    );
  }
  return nextUi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitKeys<T extends Record<string, unknown>>(record: T, keys: string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
}

function omitEmptyRecord<T extends Record<string, unknown>>(record: T): T | undefined {
  return Object.keys(record).length ? record : undefined;
}

function internalWorkflowToGraph(workflow: WorkflowContainerModel): WorkflowGraph {
  const executableEdges = runtimeCanvasEdges(workflow.internalEdges);
  const boundaryEdges = workflowBoundaryEdges(workflow.internalEdges);
  const controlEdges = executableEdges
    .filter((edge): edge is Extract<WorkflowCanvasEdge, { kind: 'control' }> => edge.kind === 'control')
    .map((edge) => ({
      id: edge.id,
      from: edge.source.workflowId,
      to: edge.target.workflowId,
      label: 'control',
      condition: edge.condition || null,
      context: 'upstream_output',
      mapping: {},
    }));
  const dataEdges = executableEdges
    .filter((edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => edge.kind === 'data')
    .map((edge) => ({
      id: edge.id,
      from: { node: edge.source.workflowId, port: edge.source.portId },
      to: { node: edge.target.workflowId, port: edge.target.portId },
      materialization: edge.materialization,
      required: true,
    }));
  return {
    id: workflow.id,
    version: '0.4.0',
    name: workflow.title,
    description: 'Workflow Focus Mode graph generated by ACC Workbench.',
    nodes: workflow.internalNodes.map(internalNodeToGraphNode),
    edges: controlEdges,
    control_edges: controlEdges,
    data_edges: dataEdges,
    exposed_inputs: workflow.inputPorts.map(portViewToGraphPort),
    exposed_outputs: workflow.outputPorts.map(portViewToGraphPort),
    workspace_policy: {
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    },
    policy: { failure_mode: 'fail_fast', max_concurrency: 4 },
    metadata: {
      layout: 'workflow-focus',
      binding_ref: workflow.bindingPath || `bindings/${workflow.id}.binding.local.json`,
      workflow_port_edges: boundaryEdges.map(canvasEdgeToGraphMetadataEdge),
    },
  };
}

function internalNodeToGraphNode(node: InternalNodeView): WorkflowGraphNode {
  return {
    id: node.id,
    capsule_id: node.capsuleId || 'fake-agent.generic',
    kind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    label: node.name,
    input: internalNodeInput(node),
    input_mapping: {},
    cwd_policy: 'inherit_environment',
    input_ports: (node.inputPorts || [port('main', 'input', 'input')]).map(portViewToGraphPort),
    output_ports: (node.outputPorts || [port('main', 'output', 'output')]).map(portViewToGraphPort),
    position: node.position,
  };
}

function internalNodeInput(node: InternalNodeView): Record<string, unknown> {
  if (node.input && Object.keys(node.input).length > 0) {
    return node.capsuleId === 'file-source.local'
      ? { path: String(node.input.path || '') }
      : { topic: String(node.input.topic || node.task || node.name) };
  }
  if (node.capsuleId === 'file-source.local') {
    return { path: '' };
  }
  return { topic: node.task || node.name };
}

function workflowToGraphNode(workflow: WorkflowContainerModel): WorkflowGraphNode {
  const wrappedRuntime = workflow.internalNodes[0]?.runtime;
  const isWrappedCapsuleWorkflow =
    workflow.sourceKind !== 'workflow' &&
    !workflow.workflowRef &&
    (workflow.capsuleId ?? 'fake-agent.generic') === 'fake-agent.generic' &&
    workflow.internalNodes.length === 1 &&
    typeof wrappedRuntime === 'string' &&
    wrappedRuntime !== workflow.capsuleId;
  if ((workflow.sourceKind && workflow.sourceKind !== 'workflow') || isWrappedCapsuleWorkflow) {
    const recoveredKind = isWrappedCapsuleWorkflow
      ? workflow.internalNodes[0]?.kind === 'Tool'
        ? 'tool'
        : 'agent_session'
      : workflow.sourceKind || 'agent_session';
    return {
      id: workflow.id,
      capsule_id: isWrappedCapsuleWorkflow
        ? wrappedRuntime
        : workflow.capsuleId || workflow.internalNodes[0]?.capsuleId || 'fake-agent.generic',
      kind: recoveredKind,
      label: workflow.title,
      input: workflow.sourceInput || (workflow.internalNodes[0] ? internalNodeInput(workflow.internalNodes[0]) : {}),
      input_mapping: workflow.sourceInputMapping || {},
      cwd_policy: workflow.relativeCwd ? 'relative_subdir' : 'inherit_environment',
      relative_cwd: workflow.relativeCwd,
      input_ports: workflow.inputPorts.map(portViewToGraphPort),
      output_ports: workflow.outputPorts.map(portViewToGraphPort),
      position: workflow.position,
    };
  }
  return {
    id: workflow.id,
    capsule_id: 'fake-agent.generic',
    kind: 'workflow',
    workflow_ref: workflow.workflowRef,
    label: workflow.title,
    input: { topic: `${workflow.title} workflow container` },
    input_mapping: {},
    cwd_policy: workflow.relativeCwd ? 'relative_subdir' : 'inherit_environment',
    relative_cwd: workflow.relativeCwd,
    input_ports: workflow.inputPorts.map(portViewToGraphPort),
    output_ports: workflow.outputPorts.map(portViewToGraphPort),
    position: workflow.position,
    ui: {
      semantic_kind: 'workflow_container',
      binding_ref: workflow.bindingPath || `bindings/${workflow.id}.binding.local.json`,
      internal_nodes: workflow.internalNodes,
      internal_edges: workflow.internalEdges.map(canvasEdgeToGraphMetadataEdge),
    },
  };
}

function workspaceDemoCanvas(): WorkspaceCanvasModel {
  return {
    id: 'acc_workspace_canvas',
    name: 'ACC Workspace Canvas',
    layout: 'workspace-canvas',
    rootWorkflowId: 'Root_Pipeline',
    workflows: [
      {
        id: 'Research_Flow',
        title: 'Research_Flow',
        workflowRef: 'workflows/research.accflow.json',
        directory: `${ROOT_WORKSPACE}\\workflows\\research`,
        status: 'not_run',
        inputPorts: [
          port('in_requirements', '需求文档', 'input', true),
          port('in_constraints', '约束条件', 'input', true),
          port('in_reference', '参考资料', 'input'),
        ],
        outputPorts: [
          port('out_findings', '调研发现', 'output'),
          port('out_refs', '参考链接', 'output'),
          port('out_report', '调研报告', 'output'),
        ],
        internalNodes: [
          internalNode('research_codex', 'Codex CLI', '论文与 GDC 调研', 'Agent'),
          internalNode('research_claude', 'Claude Code', '开源实现分析', 'Agent'),
          internalNode('research_cursor', 'Cursor', '当前源码检查', 'Agent'),
          internalNode('research_merge', 'Merge', '调研结果整合', 'Tool'),
        ],
        internalEdges: [
          controlEdge('research_codex', 'research_merge'),
          controlEdge('research_claude', 'research_merge'),
          controlEdge('research_cursor', 'research_merge'),
        ],
        position: { x: 120, y: 190 },
        size: DEFAULT_CONTAINER_SIZE,
        warnings: [],
      },
      {
        id: 'Paper_Digest_Pipeline',
        title: 'Paper_Digest_Pipeline',
        workflowRef: 'workflows/paper_digest.accflow.json',
        directory: `${ROOT_WORKSPACE}\\workflows\\paper_digest`,
        status: 'not_run',
        inputPorts: [port('in_reference', '参考资料', 'input')],
        outputPorts: [
          port('out_digest', '论文精读', 'output'),
          port('out_refs', '参考链接', 'output'),
        ],
        internalNodes: [
          internalNode('paper_reader', 'Codex CLI', '论文结构化精读', 'Agent'),
          internalNode('paper_extract', 'Artifact Collect', '提取图表与引用', 'Tool'),
        ],
        internalEdges: [controlEdge('paper_reader', 'paper_extract')],
        position: { x: 120, y: 610 },
        size: DEFAULT_CONTAINER_SIZE,
        warnings: [],
      },
      {
        id: 'Implementation_Flow',
        title: 'Implementation_Flow',
        workflowRef: 'workflows/implementation.accflow.json',
        directory: `${ROOT_WORKSPACE}\\workflows\\implementation`,
        status: 'not_run',
        inputPorts: [
          port('in_research_report', '调研报告', 'input', true),
          port('in_refs', '参考链接', 'input'),
          port('in_constraints', '约束条件', 'input'),
        ],
        outputPorts: [
          port('out_patch', '代码变更', 'output'),
          port('out_test_report', '测试报告', 'output'),
          port('out_artifacts', '实现产物', 'output'),
        ],
        internalNodes: [
          internalNode('impl_cursor', 'Cursor', '代码实现', 'Agent'),
          internalNode('impl_test', 'Atomic Script', '单元测试', 'Tool'),
          internalNode('impl_collect', 'Artifact Collect', '收集产物', 'Tool'),
        ],
        internalEdges: [
          controlEdge('impl_cursor', 'impl_test'),
          controlEdge('impl_test', 'impl_collect'),
        ],
        position: { x: 690, y: 190 },
        size: DEFAULT_CONTAINER_SIZE,
        warnings: [],
      },
      {
        id: 'Review_Flow',
        title: 'Review_Flow',
        workflowRef: 'workflows/review.accflow.json',
        directory: `${ROOT_WORKSPACE}\\workflows\\review`,
        status: 'not_run',
        inputPorts: [
          port('in_patch', '代码变更', 'input', true),
          port('in_test_report', '测试报告', 'input'),
          port('in_research_report', '调研报告', 'input'),
          port('in_paper_digest', '论文精读', 'input'),
        ],
        outputPorts: [
          port('out_review', '评审报告', 'output'),
          port('out_risk_matrix', '风险矩阵', 'output'),
          port('out_scorecard', '评分卡', 'output'),
        ],
        internalNodes: [
          internalNode('review_claude', 'Claude Code', '架构评审', 'Agent'),
          internalNode('review_hermes', 'Hermes Review', '批判性 Review', 'Agent'),
          internalNode('review_collect', 'Artifact Collect', '评审产物', 'Tool'),
        ],
        internalEdges: [
          controlEdge('review_claude', 'review_collect'),
          controlEdge('review_hermes', 'review_collect'),
        ],
        position: { x: 1260, y: 300 },
        size: DEFAULT_CONTAINER_SIZE,
        warnings: [],
      },
      {
        id: 'Root_Pipeline',
        title: 'Root Pipeline',
        workflowRef: 'root.accflow.json',
        directory: ROOT_WORKSPACE,
        status: 'not_run',
        inputPorts: [
          port('in_final_report', '最终报告输入', 'input'),
          port('in_risk_matrix', '风险矩阵输入', 'input'),
          port('in_scorecard', '评分卡输入', 'input'),
        ],
        outputPorts: [
          port('out_final_report', '最终报告', 'output'),
          port('out_risk_matrix', '风险矩阵', 'output'),
          port('out_scorecard', '评分卡', 'output'),
        ],
        internalNodes: [
          internalNode('root_publish', 'Artifact Collect', '发布最终产物', 'Tool'),
        ],
        internalEdges: [],
        position: { x: 1830, y: 300 },
        size: DEFAULT_CONTAINER_SIZE,
        warnings: [],
      },
    ],
    edges: [
      dataEdge('Research_Flow', 'out_report', 'Implementation_Flow', 'in_research_report'),
      dataEdge('Research_Flow', 'out_refs', 'Implementation_Flow', 'in_refs'),
      dataEdge('Implementation_Flow', 'out_patch', 'Review_Flow', 'in_patch'),
      dataEdge('Implementation_Flow', 'out_test_report', 'Review_Flow', 'in_test_report'),
      dataEdge('Research_Flow', 'out_report', 'Review_Flow', 'in_research_report'),
      dataEdge('Paper_Digest_Pipeline', 'out_digest', 'Review_Flow', 'in_paper_digest'),
      dataEdge('Review_Flow', 'out_review', 'Root_Pipeline', 'in_final_report'),
      dataEdge('Review_Flow', 'out_risk_matrix', 'Root_Pipeline', 'in_risk_matrix'),
      dataEdge('Review_Flow', 'out_scorecard', 'Root_Pipeline', 'in_scorecard'),
      controlEdge('Research_Flow', 'Implementation_Flow'),
      controlEdge('Implementation_Flow', 'Review_Flow'),
      controlEdge('Research_Flow', 'Paper_Digest_Pipeline'),
      controlEdge('Paper_Digest_Pipeline', 'Review_Flow'),
      controlEdge('Review_Flow', 'Root_Pipeline'),
    ],
  };
}

function normalizeWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const controlEdges = graph.control_edges || graph.edges || [];
  const dataEdges = graph.data_edges || [];
  return {
    ...graph,
    edges: controlEdges,
    control_edges: controlEdges,
    data_edges: dataEdges,
  };
}

function graphFromLegacyWorkflow(workflow: WorkflowDetail): WorkflowGraph {
  if (workflow.graph) {
    return workflow.graph;
  }
  const tasks = workflow.workflow.tasks || [];
  return {
    id: workflow.workflow_id,
    version: workflow.workflow.version || '0.2.0',
    name: workflow.workflow.name || workflow.workflow_id,
    description: workflow.workflow.description,
    nodes: tasks.map((task, index) => ({
      id: task.name,
      capsule_id: findCapsuleId(task.command) || 'fake-agent.generic',
      kind: 'agent_session',
      label: task.name,
      input: { topic: task.name },
      input_mapping: {},
      position: { x: index * 500, y: 220 },
    })),
    edges: tasks.flatMap((task) =>
      (task.depends_on || []).map((dependency) => ({
        id: `edge_${dependency}_${task.name}`,
        from: dependency,
        to: task.name,
        label: '依赖',
        mapping: {},
        condition: null,
      })),
    ),
    metadata: { source: 'legacy-yaml' },
  };
}

function layoutWorkspaceCanvas(canvas: WorkspaceCanvasModel): WorkspaceCanvasModel {
  const workflowsWithInternalLayout = canvas.workflows.map(layoutWorkflowInternalNodes);
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 110, ranksep: 130 });
  workflowsWithInternalLayout.forEach((workflow) =>
    layout.setNode(workflow.id, {
      width: workflow.size.width,
      height: workflow.size.height + 52,
    }),
  );
  canvas.edges.forEach((edge) => layout.setEdge(edge.source.workflowId, edge.target.workflowId));
  dagre.layout(layout);
  return {
    ...canvas,
    workflows: workflowsWithInternalLayout.map((workflow) => {
      const position = layout.node(workflow.id);
      return position
        ? {
            ...workflow,
            position: {
              x: position.x - workflow.size.width / 2,
              y: position.y - workflow.size.height / 2,
            },
          }
        : workflow;
    }),
  };
}

function layoutCanvasForSelection(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): WorkspaceCanvasModel {
  const workflowId =
    selection.type === 'workflow'
      ? selection.id
      : selection.type === 'internal' || selection.type === 'port'
        ? selection.workflowId
        : null;
  if (!workflowId) {
    return layoutWorkspaceCanvas(canvas);
  }
  const selectedWorkflow = canvas.workflows.find((workflow) => workflow.id === workflowId);
  if (!selectedWorkflow || isExecutableNodeWorkflow(selectedWorkflow)) {
    return layoutWorkspaceCanvas(canvas);
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId ? layoutWorkflowInternalNodes(workflow) : workflow,
    ),
  };
}

function layoutWorkflowInternalNodes(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const nodeIds = new Set(workflow.internalNodes.map((node) => node.id));
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 52, ranksep: 92 });
  workflow.internalNodes.forEach((node) =>
    layout.setNode(node.id, {
      width: AGENT_TOOL_NODE_SIZE.width,
      height: AGENT_TOOL_NODE_SIZE.height,
    }),
  );
  workflow.internalEdges
    .filter((edge) => nodeIds.has(edge.source.workflowId) && nodeIds.has(edge.target.workflowId))
    .forEach((edge) => layout.setEdge(edge.source.workflowId, edge.target.workflowId));
  dagre.layout(layout);
  const nextNodes = workflow.internalNodes.map((node) => {
    const position = layout.node(node.id);
    return position
      ? {
          ...node,
          position: {
            x: Math.round(position.x - AGENT_TOOL_NODE_SIZE.width / 2 + WORKFLOW_CHILD_START_PADDING),
            y: Math.round(position.y - AGENT_TOOL_NODE_SIZE.height / 2 + WORKFLOW_CHILD_START_PADDING),
          },
        }
      : node;
  });
  return expandWorkflowToFitChildren({ ...workflow, internalNodes: nextNodes });
}

function focusCanvas(
  canvas: WorkspaceCanvasModel,
  focusedWorkflowId: string | null,
): WorkspaceCanvasModel {
  if (!focusedWorkflowId) {
    return canvas;
  }
  const workflow = canvas.workflows.find((item) => item.id === focusedWorkflowId);
  if (!workflow) {
    return canvas;
  }
  const inputBoundaryId = workflowInputBoundaryId(workflow.id);
  const outputBoundaryId = workflowOutputBoundaryId(workflow.id);
  const inputBoundary: WorkflowContainerModel = {
    id: inputBoundaryId,
    title: 'Workflow Inputs',
    boundaryKind: 'workflow_input',
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: workflow.status,
    inputPorts: [],
    outputPorts: workflow.inputPorts.map((item) => boundaryPort(item, 'output')),
    internalNodes: [],
    internalEdges: [],
    position: { x: 40, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
  const outputBoundary: WorkflowContainerModel = {
    id: outputBoundaryId,
    title: 'Workflow Outputs',
    boundaryKind: 'workflow_output',
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: workflow.status,
    inputPorts: workflow.outputPorts.map((item) => boundaryPort(item, 'input')),
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 1240, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
  const editableNodes = workflow.internalNodes.map((node, index) => ({
    id: node.id,
    title: node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    capsuleId: node.capsuleId || node.runtime,
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: node.status,
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: node.outputPorts || [port('main', 'output', 'output')],
    internalNodes: [node],
    internalEdges: [],
    position: node.position || { x: 360 + index * 420, y: 260 },
    size: { width: 360, height: 220 },
    warnings: [],
  }));
  return {
    id: `${canvas.id}_${focusedWorkflowId}`,
    name: `${workflow.title} Focus Mode`,
    layout: 'workflow-focus',
    rootWorkflowId: editableNodes[0]?.id || workflow.id,
    workflows: [inputBoundary, ...editableNodes, outputBoundary],
    edges: workflow.internalEdges,
  };
}

function singleNodeWorkflowGraph(node: InternalNodeView, ownerId: string): WorkflowGraph {
  return {
    id: `${ownerId}_${node.id}_single_node`,
    version: '0.4.0',
    name: `${node.name} single node run`,
    description: 'Single-node graph generated by ACC Workbench.',
    nodes: [internalNodeToGraphNode(stripRuntimeStateFromNode(node))],
    edges: [],
    control_edges: [],
    data_edges: [],
    workspace_policy: {
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    },
    policy: { failure_mode: 'fail_fast', max_concurrency: 1 },
    metadata: {
      layout: 'single-node-run',
      parent_workflow_id: ownerId,
    },
  };
}

function stripRuntimeStateFromNode(node: InternalNodeView): InternalNodeView {
  return { ...node, status: 'not_run' };
}

function workflowPortsFromGraph(
  ports: WorkflowPort[] | undefined,
  direction: PortDirection,
): WorkflowPortView[] {
  if (!ports || ports.length === 0) {
    return direction === 'input' ? [port('main', '输入', 'input')] : [port('main', '输出', 'output')];
  }
  return ports.map((item) =>
    port(
      item.id,
      item.artifact_types?.join(', ') || item.id,
      direction,
      item.required,
      item.cardinality,
    ),
  );
}

function port(
  id: string,
  label: string,
  direction: PortDirection,
  required = false,
  cardinality = 'one',
): WorkflowPortView {
  return { id, label, direction, required, cardinality, artifactTypes: ['artifact'] };
}

function internalNode(
  id: string,
  name: string,
  task: string,
  kind: 'Agent' | 'Tool',
): InternalNodeView {
  return {
    id,
    name,
    task,
    kind,
    status: 'not_run',
    capsuleId: 'fake-agent.generic',
    input: { topic: task || name },
  };
}

function dataEdge(
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return dataEdgeWithId(
    `data_${sourceWorkflowId}_${sourcePortId}_${targetWorkflowId}_${targetPortId}`,
    sourceWorkflowId,
    sourcePortId,
    targetWorkflowId,
    targetPortId,
  );
}

function controlEdge(sourceWorkflowId: string, targetWorkflowId: string): WorkflowCanvasEdge {
  return controlEdgeWithId(`control_${sourceWorkflowId}_${targetWorkflowId}`, sourceWorkflowId, targetWorkflowId);
}

function dataEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'data',
    source: { workflowId: sourceWorkflowId, portId: sourcePortId },
    target: { workflowId: targetWorkflowId, portId: targetPortId },
    materialization: 'copy',
  };
}

function controlEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  targetWorkflowId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'control',
    source: { workflowId: sourceWorkflowId },
    target: { workflowId: targetWorkflowId },
    condition: null,
    context: 'upstream_output',
  };
}

function dataEdgeToCanvasEdge(edge: WorkflowDataEdge): WorkflowCanvasEdge {
  const sourcePort = edge.from.port || edge.from.output || edge.from.artifact || 'main';
  const targetPort = edge.to.port || edge.to.input || 'main';
  return {
    id: edge.id || `data_${edge.from.node}_${sourcePort}_${edge.to.node}_${targetPort}`,
    kind: 'data',
    source: { workflowId: edge.from.node, portId: sourcePort },
    target: { workflowId: edge.to.node, portId: targetPort },
    materialization: edge.materialization === 'reference' ? 'reference' : 'copy',
  };
}

function controlEdgeToCanvasEdge(edge: WorkflowGraphEdge): WorkflowCanvasEdge {
  return {
    id: edge.id || `control_${edge.from}_${edge.to}`,
    kind: 'control',
    source: { workflowId: edge.from },
    target: { workflowId: edge.to },
    condition: edge.condition || null,
    context: edge.context === 'none' ? 'none' : 'upstream_output',
  };
}

function canvasEdgeToGraphMetadataEdge(edge: WorkflowCanvasEdge): WorkflowDataEdge | WorkflowGraphEdge {
  if (edge.kind === 'data') {
    return {
      id: edge.id,
      from: { node: edge.source.workflowId, port: edge.source.portId },
      to: { node: edge.target.workflowId, port: edge.target.portId },
      materialization: edge.materialization,
      required: true,
    };
  }
  return {
    id: edge.id,
    from: edge.source.workflowId,
    to: edge.target.workflowId,
    label: 'control',
    condition: edge.condition || null,
    context: 'upstream_output',
    mapping: {},
  };
}

function internalEdgesFromMetadata(metadata: Record<string, unknown>): WorkflowCanvasEdge[] {
  const rawEdges = metadata.internal_edges;
  if (!Array.isArray(rawEdges)) {
    return [];
  }
  return rawEdges.flatMap((edge) => {
    if (isWorkflowDataEdge(edge)) {
      return [dataEdgeToCanvasEdge(edge)];
    }
    if (isWorkflowGraphEdge(edge)) {
      return [controlEdgeToCanvasEdge(edge)];
    }
    return [];
  });
}

function isWorkflowDataEdge(edge: unknown): edge is WorkflowDataEdge {
  if (!edge || typeof edge !== 'object') {
    return false;
  }
  const candidate = edge as WorkflowDataEdge;
  return Boolean(candidate.from && typeof candidate.from === 'object' && 'node' in candidate.from);
}

function isWorkflowGraphEdge(edge: unknown): edge is WorkflowGraphEdge {
  if (!edge || typeof edge !== 'object') {
    return false;
  }
  const candidate = edge as WorkflowGraphEdge;
  return typeof candidate.from === 'string' && typeof candidate.to === 'string';
}

function portViewToGraphPort(portView: WorkflowPortView): WorkflowPort {
  return {
    id: portView.id,
    direction: portView.direction,
    required: portView.required,
    cardinality: portView.cardinality || 'one',
    artifact_types: portView.artifactTypes || ['artifact'],
  };
}

function portHandleId(workflowId: string, direction: PortDirection, portId: string): string {
  return `${workflowId}:${direction}:${portId}`;
}

function parsePortHandle(handle: string | null | undefined):
  | { workflowId: string; direction: PortDirection; portId: string }
  | null {
  if (!handle) {
    return null;
  }
  const [workflowId, direction, portId] = handle.split(':');
  if (!workflowId || (direction !== 'input' && direction !== 'output') || !portId) {
    return null;
  }
  return { workflowId, direction, portId };
}

function uniqueEdgeId(
  canvas: WorkspaceCanvasModel,
  kind: 'data' | 'control',
  sourceWorkflowId: string,
  targetWorkflowId: string,
): string {
  const existing = new Set(canvas.edges.map((edge) => edge.id));
  let index = 1;
  let edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}`;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}_${index}`;
  }
  return edgeId;
}

function uniqueEdgeIdForScope(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  kind: 'data' | 'control',
  sourceWorkflowId: string,
  targetWorkflowId: string,
): string {
  const scopedEdges =
    scopeWorkflowId === null
      ? canvas.edges
      : canvas.workflows.find((workflow) => workflow.id === scopeWorkflowId)?.internalEdges || [];
  const existing = new Set(scopedEdges.map((edge) => edge.id));
  let index = 1;
  let edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}`;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}_${index}`;
  }
  return edgeId;
}

function internalFlowNodeId(workflowId: string, nodeId: string): string {
  return `${workflowId}__internal__${nodeId}`;
}

function parseInternalFlowNodeId(nodeId: string): { workflowId: string; nodeId: string } | null {
  const marker = '__internal__';
  const index = nodeId.lastIndexOf(marker);
  if (index < 0) {
    return null;
  }
  return {
    workflowId: nodeId.slice(0, index),
    nodeId: nodeId.slice(index + marker.length),
  };
}

function flowEndpoint(flowNodeId: string): FlowEndpoint {
  const internal = parseInternalFlowNodeId(flowNodeId);
  if (internal) {
    return { nodeId: internal.nodeId, workflowId: internal.workflowId, internal: true };
  }
  return { nodeId: flowNodeId, workflowId: null, internal: false };
}

function internalEdgeEndpointToFlowId(workflowId: string, nodeId: string): string {
  if (nodeId === workflowInputBoundaryId(workflowId) || nodeId === workflowOutputBoundaryId(workflowId)) {
    return workflowId;
  }
  return internalFlowNodeId(workflowId, nodeId);
}

function normalizeBinding(
  binding: WorkflowBindingView | null | undefined,
  workflowId: string,
): WorkflowBindingView {
  return {
    workflow_id: binding?.workflow_id || binding?.workflowId || workflowId,
    workflowId: binding?.workflowId || binding?.workflow_id || workflowId,
    binding_path:
      binding?.binding_path || binding?.bindingPath || `bindings/${workflowId}.binding.local.json`,
    bindingPath:
      binding?.bindingPath || binding?.binding_path || `bindings/${workflowId}.binding.local.json`,
    workspace_root: binding?.workspace_root ?? binding?.workspaceRoot ?? null,
    workspaceRoot: binding?.workspaceRoot ?? binding?.workspace_root ?? null,
    exists: Boolean(binding?.exists),
    status: binding?.status || 'unbound',
    valid: binding?.valid,
    error: binding?.error ?? null,
  };
}

function workspaceRootOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.workspaceRoot || binding?.workspace_root || '';
}

function bindingPathOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.bindingPath || binding?.binding_path || '';
}

function bindingDirectory(
  workflow: WorkflowContainerModel,
  binding: WorkflowBindingView | null | undefined,
): string {
  const workspaceRoot = workspaceRootOf(binding);
  if (workspaceRoot) {
    return workspaceRoot;
  }
  return workflow.directory || '未绑定工作目录';
}

function setPaletteDragData(event: DragEvent<HTMLElement>, item: PaletteItem) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-acc-palette', JSON.stringify(item));
}

function parsePaletteItem(raw: string): PaletteItem | null {
  if (!raw) {
    return null;
  }
  try {
    const item = JSON.parse(raw) as PaletteItem;
    if (item.kind === 'workflow' && item.label) {
      return item;
    }
    if (
      (item.kind === 'agent' || item.kind === 'tool' || item.kind === 'file_source') &&
      item.capsuleId &&
      item.label
    ) {
      return item;
    }
  } catch {
    return null;
  }
  return null;
}

function edgeConnectsRemainingNodes(edge: WorkflowCanvasEdge, remainingIds: Set<string>): boolean {
  return (
    (remainingIds.has(edge.source.workflowId) || isWorkflowBoundaryId(edge.source.workflowId)) &&
    (remainingIds.has(edge.target.workflowId) || isWorkflowBoundaryId(edge.target.workflowId))
  );
}

function isWorkflowBoundaryEdge(edge: WorkflowCanvasEdge): boolean {
  return isWorkflowBoundaryId(edge.source.workflowId) || isWorkflowBoundaryId(edge.target.workflowId);
}

function runtimeCanvasEdges(edges: WorkflowCanvasEdge[]): WorkflowCanvasEdge[] {
  return edges.filter((edge) => !isWorkflowBoundaryEdge(edge));
}

function workflowBoundaryEdges(edges: WorkflowCanvasEdge[]): WorkflowCanvasEdge[] {
  return edges.filter(isWorkflowBoundaryEdge);
}

function isExecutableNodeWorkflow(workflow: WorkflowContainerModel): boolean {
  if (workflow.boundaryKind) {
    return false;
  }
  if (workflow.sourceKind === 'workflow') {
    return false;
  }
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return true;
  }
  const wrappedRuntime = workflow.internalNodes[0]?.runtime;
  return (
    !workflow.workflowRef &&
    (workflow.capsuleId ?? 'fake-agent.generic') === 'fake-agent.generic' &&
    workflow.internalNodes.length === 1 &&
    typeof wrappedRuntime === 'string' &&
    wrappedRuntime !== workflow.capsuleId
  );
}

function workflowAtPosition(
  canvas: WorkspaceCanvasModel,
  position: { x: number; y: number },
): WorkflowContainerModel | null {
  const candidates = canvas.workflows
    .filter((workflow) => !workflow.boundaryKind && (workflow.sourceKind || 'workflow') === 'workflow')
    .filter(
      (workflow) =>
        position.x >= workflow.position.x &&
        position.y >= workflow.position.y &&
        position.x <= workflow.position.x + workflow.size.width &&
        position.y <= workflow.position.y + workflow.size.height,
    );
  return candidates[candidates.length - 1] || null;
}

function workflowAtNodeRect(
  canvas: WorkspaceCanvasModel,
  rect: { x: number; y: number; width: number; height: number },
  excludeWorkflowId?: string,
): WorkflowContainerModel | null {
  const candidates = canvas.workflows
    .map((workflow, index) => ({ workflow, index }))
    .filter(
      ({ workflow }) =>
        workflow.id !== excludeWorkflowId &&
        !workflow.boundaryKind &&
        (workflow.sourceKind || 'workflow') === 'workflow',
    )
    .map(({ workflow, index }) => ({
      workflow,
      index,
      area: rectIntersectionArea(rect, {
        x: workflow.position.x,
        y: workflow.position.y,
        width: workflow.size.width,
        height: workflow.size.height,
      }),
    }))
    .filter((candidate) => candidate.area > 0)
    .sort((left, right) => left.area - right.area || left.index - right.index);
  return candidates.at(-1)?.workflow || null;
}

function rectIntersectionArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function workflowFromDropTarget(
  canvas: WorkspaceCanvasModel,
  target: EventTarget | null,
): WorkflowContainerModel | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const container = target.closest<HTMLElement>('[data-workflow-id]');
  const workflowId = container?.dataset.workflowId;
  if (!workflowId) {
    return null;
  }
  return (
    canvas.workflows.find(
      (workflow) =>
        workflow.id === workflowId &&
        !workflow.boundaryKind &&
        (workflow.sourceKind || 'workflow') === 'workflow',
    ) || null
  );
}

function resizeWorkflowContainer(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  size: { width: number; height: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            size: {
              width: Math.max(260, size.width),
              height: Math.max(190, size.height),
            },
          }
        : workflow,
    ),
  };
}

function moveInternalNode(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  nodeId: string,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            internalNodes: workflow.internalNodes.map((node) =>
              node.id === nodeId ? { ...node, position } : node,
            ),
          }
        : workflow,
    ),
  };
}

function commitFlowNodePositions(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  positions: Map<string, { x: number; y: number }>,
  remainingIds: Set<string>,
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows
      .filter((workflow) => remainingIds.has(workflow.id) || !visibleCanvas.workflows.includes(workflow))
      .map((workflow) => updateWorkflowPositionsFromFlow(workflow, positions, remainingIds)),
    edges: canvas.edges.filter(
      (edge) =>
        !remainingIds.size ||
        (remainingIds.has(edge.source.workflowId) && remainingIds.has(edge.target.workflowId)),
    ),
  };
}

function commitFlowNodeLayout(
  canvas: WorkspaceCanvasModel,
  flowNodes: CanvasFlowNode[],
): WorkspaceCanvasModel {
  const positions = new Map(flowNodes.map((node) => [node.id, node.position]));
  const workflowSizes = new Map(
    flowNodes
      .filter((node): node is WorkflowFlowNode => node.type === 'workflowContainer')
      .map((node) => [
        node.id,
        {
          width: finiteNumber(node.width ?? node.measured?.width, node.data.workflow.size.width),
          height: finiteNumber(node.height ?? node.measured?.height, node.data.workflow.size.height),
        },
      ]),
  );
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const workflowPosition = positions.get(workflow.id);
      const workflowSize = workflowSizes.get(workflow.id);
      return {
        ...workflow,
        position: workflowPosition || workflow.position,
        size: workflowSize || workflow.size,
        internalNodes: workflow.internalNodes.map((node) => {
          const position = positions.get(internalFlowNodeId(workflow.id, node.id));
          return position ? { ...node, position } : node;
        }),
      };
    }),
  };
}

function updateWorkflowPositionsFromFlow(
  workflow: WorkflowContainerModel,
  positions: Map<string, { x: number; y: number }>,
  remainingIds: Set<string>,
): WorkflowContainerModel {
  const workflowPosition = positions.get(workflow.id);
  const nextWorkflow = workflowPosition ? { ...workflow, position: workflowPosition } : workflow;
  if (isExecutableNodeWorkflow(nextWorkflow)) {
    return nextWorkflow;
  }
  const keptNodes = nextWorkflow.internalNodes
    .filter((node) => remainingIds.has(internalFlowNodeId(nextWorkflow.id, node.id)))
    .map((node) => {
      const position = positions.get(internalFlowNodeId(nextWorkflow.id, node.id));
      return position ? { ...node, position } : node;
    });
  const keptIds = new Set(keptNodes.map((node) => node.id));
  return expandWorkflowToFitChildren({
    ...nextWorkflow,
    internalNodes: keptNodes,
    internalEdges: nextWorkflow.internalEdges.filter((edge) =>
      edgeConnectsRemainingNodes(edge, keptIds),
    ),
  });
}

function commitDraggedNodeToCanvas(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
): WorkspaceCanvasModel {
  const internal = parseInternalFlowNodeId(node.id);
  if (internal) {
    return reparentInternalNodeAtAbsolutePosition(
      canvas,
      internal.workflowId,
      internal.nodeId,
      absoluteDraggedInternalPosition(canvas, committedFlowNodes, node, internal.workflowId),
    );
  }
  const workflow = canvas.workflows.find((item) => item.id === node.id);
  if (!workflow) {
    return canvas;
  }
  if (!isExecutableNodeWorkflow(workflow)) {
    return moveRootWorkflow(canvas, workflow.id, node.position);
  }
  const targetWorkflow = workflowAtNodeRect(canvas, {
    x: node.position.x,
    y: node.position.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  });
  if (!targetWorkflow) {
    return moveRootWorkflow(canvas, workflow.id, node.position);
  }
  const internalNode = internalNodeFromExecutableWorkflow(workflow, {
    x: node.position.x - targetWorkflow.position.x,
    y: node.position.y - targetWorkflow.position.y,
  });
  return {
    ...canvas,
    workflows: canvas.workflows
      .filter((item) => item.id !== workflow.id)
      .map((item) =>
        item.id === targetWorkflow.id
          ? expandWorkflowToFitChildrenCenterLocked({
              ...item,
              internalNodes: [...item.internalNodes, internalNode],
            })
          : item,
      ),
    edges: canvas.edges.filter((edge) => !edgeTouchesNode(edge, workflow.id)),
  };
}

function selectionForDraggedNodeCommit(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  selection: CanvasSelection,
): CanvasSelection | null {
  const internal = parseInternalFlowNodeId(node.id);
  if (internal) {
    if (
      selection.type !== 'internal' ||
      selection.workflowId !== internal.workflowId ||
      selection.nodeId !== internal.nodeId
    ) {
      return null;
    }
    const absolutePosition = absoluteDraggedInternalPosition(
      canvas,
      committedFlowNodes,
      node,
      internal.workflowId,
    );
    const targetWorkflow = workflowAtNodeRect(
      canvas,
      {
        x: absolutePosition.x,
        y: absolutePosition.y,
        width: AGENT_TOOL_NODE_SIZE.width,
        height: AGENT_TOOL_NODE_SIZE.height,
      },
      internal.workflowId,
    );
    if (targetWorkflow) {
      return { type: 'internal', workflowId: targetWorkflow.id, nodeId: internal.nodeId };
    }
    const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === internal.workflowId);
    if (!sourceWorkflow) {
      return null;
    }
    const sourceRect = {
      x: sourceWorkflow.position.x,
      y: sourceWorkflow.position.y,
      width: sourceWorkflow.size.width,
      height: sourceWorkflow.size.height,
    };
    const draggedRect = {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: AGENT_TOOL_NODE_SIZE.width,
      height: AGENT_TOOL_NODE_SIZE.height,
    };
    return rectIntersectionArea(sourceRect, draggedRect) === 0
      ? { type: 'workflow', id: internal.nodeId }
      : null;
  }
  if (selection.type !== 'workflow' || selection.id !== node.id) {
    return null;
  }
  const workflow = canvas.workflows.find((item) => item.id === node.id);
  if (!workflow || !isExecutableNodeWorkflow(workflow)) {
    return null;
  }
  const targetWorkflow = workflowAtNodeRect(canvas, {
    x: node.position.x,
    y: node.position.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  });
  return targetWorkflow
    ? { type: 'internal', workflowId: targetWorkflow.id, nodeId: workflow.id }
    : null;
}

function absoluteDraggedInternalPosition(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  sourceWorkflowId: string,
): { x: number; y: number } {
  const sourceFlowNode = committedFlowNodes.find((candidate) => candidate.id === sourceWorkflowId);
  if (sourceFlowNode) {
    return {
      x: sourceFlowNode.position.x + node.position.x,
      y: sourceFlowNode.position.y + node.position.y,
    };
  }
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === sourceWorkflowId);
  return {
    x: (sourceWorkflow?.position.x || 0) + node.position.x,
    y: (sourceWorkflow?.position.y || 0) + node.position.y,
  };
}

function moveRootWorkflow(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId ? { ...workflow, position } : workflow,
    ),
  };
}

function reparentInternalNodeAtAbsolutePosition(
  canvas: WorkspaceCanvasModel,
  sourceWorkflowId: string,
  nodeId: string,
  absolutePosition: { x: number; y: number },
): WorkspaceCanvasModel {
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === sourceWorkflowId);
  const node = sourceWorkflow?.internalNodes.find((item) => item.id === nodeId);
  if (!sourceWorkflow || !node) {
    return canvas;
  }
  const targetWorkflow = workflowAtNodeRect(
    canvas,
    {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: AGENT_TOOL_NODE_SIZE.width,
      height: AGENT_TOOL_NODE_SIZE.height,
    },
    sourceWorkflowId,
  );
  if (targetWorkflow) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id === sourceWorkflowId) {
          return {
            ...workflow,
            internalNodes: workflow.internalNodes.filter((item) => item.id !== nodeId),
            internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, nodeId)),
          };
        }
        if (workflow.id === targetWorkflow.id) {
          return expandWorkflowToFitChildrenCenterLocked({
            ...workflow,
            internalNodes: [
              ...workflow.internalNodes,
              {
                ...node,
                position: {
                  x: absolutePosition.x - workflow.position.x,
                  y: absolutePosition.y - workflow.position.y,
                },
              },
            ],
          });
        }
        return workflow;
      }),
    };
  }
  const sourceRect = {
    x: sourceWorkflow.position.x,
    y: sourceWorkflow.position.y,
    width: sourceWorkflow.size.width,
    height: sourceWorkflow.size.height,
  };
  const draggedRect = {
    x: absolutePosition.x,
    y: absolutePosition.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  };
  if (rectIntersectionArea(sourceRect, draggedRect) === 0) {
    const rootNode = executableWorkflowFromInternalNode(node, absolutePosition, canvas);
    return {
      ...canvas,
      workflows: [
        ...canvas.workflows
          .map((workflow) =>
            workflow.id === sourceWorkflowId
              ? {
                  ...workflow,
                  internalNodes: workflow.internalNodes.filter((item) => item.id !== nodeId),
                  internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, nodeId)),
                }
      : workflow,
          ),
        rootNode,
      ],
    };
  }
  const relativePosition = {
    x: absolutePosition.x - sourceWorkflow.position.x,
    y: absolutePosition.y - sourceWorkflow.position.y,
  };
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === sourceWorkflowId
        ? expandWorkflowToFitChildrenCenterLocked({
            ...workflow,
            internalNodes: workflow.internalNodes.map((item) =>
              item.id === nodeId ? { ...item, position: relativePosition } : item,
            ),
          })
        : workflow,
    ),
  };
}

function edgeTouchesNode(edge: WorkflowCanvasEdge, nodeId: string): boolean {
  return edge.source.workflowId === nodeId || edge.target.workflowId === nodeId;
}

function internalNodeFromExecutableWorkflow(
  workflow: WorkflowContainerModel,
  position: { x: number; y: number },
): InternalNodeView {
  const wrapped = workflow.internalNodes[0];
  return {
    id: workflow.id,
    name: workflow.title,
    task: wrapped?.task || workflow.capsuleId || workflow.title,
    kind: workflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
    status: workflow.status,
    capsuleId: workflow.capsuleId || wrapped?.capsuleId,
    runtime: workflow.capsuleId || wrapped?.runtime,
    input: workflow.sourceInput || wrapped?.input,
    inputPorts: workflow.inputPorts,
    outputPorts: workflow.outputPorts,
    position,
  };
}

function executableWorkflowFromInternalNode(
  node: InternalNodeView,
  position: { x: number; y: number },
  canvas: WorkspaceCanvasModel,
): WorkflowContainerModel {
  const id = uniqueId(node.id, new Set(canvas.workflows.map((workflow) => workflow.id)));
  return {
    id,
    title: node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    capsuleId: node.capsuleId || node.runtime,
    sourceInput: node.input,
    directory: 'Root canvas environment',
    status: node.status,
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: node.outputPorts || [port('main', 'output', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: AGENT_TOOL_NODE_SIZE,
    warnings: [],
  };
}

function expandWorkflowToFitChildren(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const bounds = normalizeWorkflowChildBounds(workflow.internalNodes);
  const offsetX = Math.max(0, WORKFLOW_CHILD_START_PADDING - bounds.minX);
  const offsetY = Math.max(0, WORKFLOW_CHILD_START_PADDING - bounds.minY);
  const nextInternalNodes =
    offsetX || offsetY
      ? workflow.internalNodes.map((node) => ({
          ...node,
          position: {
            x: finiteNumber(node.position?.x, 0) + offsetX,
            y: finiteNumber(node.position?.y, 0) + offsetY,
          },
        }))
      : workflow.internalNodes;
  const nextMaxX = bounds.maxX + offsetX;
  const nextMaxY = bounds.maxY + offsetY;
  return {
    ...workflow,
    position: {
      x: workflow.position.x - offsetX,
      y: workflow.position.y - offsetY,
    },
    internalNodes: nextInternalNodes,
    size: {
      width: Math.max(workflow.size.width + offsetX, nextMaxX + WORKFLOW_CHILD_PADDING),
      height: Math.max(workflow.size.height + offsetY, nextMaxY + WORKFLOW_CHILD_PADDING),
    },
  };
}

function expandWorkflowToFitChildrenCenterLocked(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const center = {
    x: workflow.position.x + workflow.size.width / 2,
    y: workflow.position.y + workflow.size.height / 2,
  };
  const childBounds = normalizeWorkflowAbsoluteChildBounds(workflow);
  const nextSize = {
    width: Math.max(
      workflow.size.width,
      2 * Math.max(center.x - childBounds.minX, childBounds.maxX - center.x),
    ),
    height: Math.max(
      workflow.size.height,
      2 * Math.max(center.y - childBounds.minY, childBounds.maxY - center.y),
    ),
  };
  const nextPosition = {
    x: center.x - nextSize.width / 2,
    y: center.y - nextSize.height / 2,
  };
  const shift = {
    x: workflow.position.x - nextPosition.x,
    y: workflow.position.y - nextPosition.y,
  };
  return {
    ...workflow,
    position: nextPosition,
    size: nextSize,
    internalNodes: workflow.internalNodes.map((node) => ({
      ...node,
      position: {
        x: finiteNumber(node.position?.x, 0) + shift.x,
        y: finiteNumber(node.position?.y, 0) + shift.y,
      },
    })),
  };
}

function normalizeWorkflowAbsoluteChildBounds(workflow: WorkflowContainerModel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return workflow.internalNodes.reduce(
    (bounds, node) => {
      const x = workflow.position.x + finiteNumber(node.position?.x, 0);
      const y = workflow.position.y + finiteNumber(node.position?.y, 0);
      return {
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x + AGENT_TOOL_NODE_SIZE.width),
        maxY: Math.max(bounds.maxY, y + AGENT_TOOL_NODE_SIZE.height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function normalizeWorkflowChildBounds(nodes: InternalNodeView[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return nodes.reduce(
    (bounds, node) => {
      const x = finiteNumber(node.position?.x, 0);
      const y = finiteNumber(node.position?.y, 0);
      return {
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x + AGENT_TOOL_NODE_SIZE.width),
        maxY: Math.max(bounds.maxY, y + AGENT_TOOL_NODE_SIZE.height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finitePosition(
  position: { x: number; y: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  return Number.isFinite(position.x) && Number.isFinite(position.y) ? position : fallback;
}

function defaultInternalNodePosition(index: number): { x: number; y: number } {
  return {
    x: 12,
    y: 12 + index * 78,
  };
}

function nextRootPalettePosition(canvas: WorkspaceCanvasModel): { x: number; y: number } {
  const rootNodes = canvas.workflows.filter((workflow) => !workflow.boundaryKind);
  if (!rootNodes.length) {
    return { x: 120, y: 180 };
  }
  const maxRight = Math.max(
    ...rootNodes.map((workflow) => workflow.position.x + workflow.size.width),
  );
  const rootAgentCount = rootNodes.filter(isExecutableNodeWorkflow).length;
  return {
    x: maxRight + AGENT_TOOL_NODE_SIZE.width + 120,
    y: 180 + rootAgentCount * 140,
  };
}

function boundaryPort(portValue: WorkflowPortView, direction: PortDirection): WorkflowPortView {
  return { ...portValue, direction };
}

function addWorkflowFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Extract<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const baseId = slugId(item.workflowRef || item.label || 'workflow');
  const id = uniqueId(baseId || 'workflow', new Set(canvas.workflows.map((workflow) => workflow.id)));
  const workflow: WorkflowContainerModel = {
    id,
    title: item.label || id,
    sourceKind: 'workflow',
    workflowRef: item.workflowRef,
    directory: '未绑定工作目录',
    bindingPath: `bindings/${id}.binding.local.json`,
    status: 'not_run',
    inputPorts: [port('in_main', '输入', 'input')],
    outputPorts: [port('out_main', '输出', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

function addCapsuleNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const existingIds = new Set(canvas.workflows.map((workflow) => workflow.id));
  const node = internalNodeFromPaletteItem(item, position, existingIds);
  const id = node.id;
  const workflow: WorkflowContainerModel = {
    id,
    title: node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    capsuleId: node.capsuleId,
    sourceInput: node.input,
    directory: 'Root canvas environment',
    status: 'not_run',
    inputPorts: [port('main', 'input', 'input')],
    outputPorts: [port('main', 'output', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: AGENT_TOOL_NODE_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

function addInternalNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== workflowId) {
        return workflow;
      }
      const existingIds = new Set(workflow.internalNodes.map((node) => node.id));
      const node = internalNodeFromPaletteItem(item, position, existingIds);
      return expandWorkflowToFitChildren({ ...workflow, internalNodes: [...workflow.internalNodes, node] });
    }),
  };
}

function addInternalNodeFromPaletteWithConnection(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
  pendingConnection?: PendingCanvasConnection,
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== workflowId) {
        return workflow;
      }
      const existingIds = new Set(workflow.internalNodes.map((node) => node.id));
      const node = internalNodeFromPaletteItem(item, position, existingIds);
      const pendingEdge = pendingConnection
        ? edgeFromPendingConnection(
            { ...focusCanvas(canvas, workflowId), workflows: [] },
            pendingConnection,
            node.id,
          )
        : null;
      return expandWorkflowToFitChildren({
        ...workflow,
        internalNodes: [...workflow.internalNodes, node],
        internalEdges: pendingEdge
          ? [...workflow.internalEdges.filter((edge) => edge.id !== pendingEdge.id), pendingEdge]
          : workflow.internalEdges,
      });
    }),
  };
}

function internalNodeFromPaletteItem(
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
  existingIds: Set<string>,
): InternalNodeView {
  const capsuleId = item.kind === 'file_source' ? 'file-source.local' : item.capsuleId;
  const id = uniqueId(paletteItemBaseId(item), existingIds);
  const isTool = item.kind === 'tool' || item.kind === 'file_source';
  const task = isTool ? '本地工具节点' : item.label;
  return {
    id,
    name: item.label,
    task,
    kind: isTool ? 'Tool' : 'Agent',
    status: 'not_run',
    capsuleId,
    runtime: capsuleId,
    input:
      item.kind === 'file_source'
        ? { path: '' }
        : { topic: item.label || capsuleId },
    inputPorts: [port('main', 'input', 'input')],
    outputPorts: [port('main', 'output', 'output')],
    position,
  };
}

function paletteItemBaseId(item: Exclude<PaletteItem, { kind: 'workflow' }>): string {
  const stableRef = item.kind === 'file_source' ? item.capsuleId : item.capsuleId;
  return slugId(stableRef || item.label || 'node');
}

function edgeFromPendingConnection(
  canvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  newNodeId: string,
): WorkflowCanvasEdge | null {
  const sourceHandle = parsePortHandle(pending.handleId);
  if (pending.mode === 'control') {
    const sourceNodeId = sourceHandle?.workflowId || pending.nodeId;
    if (!sourceNodeId || isWorkflowBoundaryId(sourceNodeId) || isWorkflowBoundaryId(newNodeId)) {
      return null;
    }
    return controlEdge(sourceNodeId, newNodeId);
  }
  if (!sourceHandle) {
    return null;
  }
  if (sourceHandle.direction === 'output') {
    return dataEdge(sourceHandle.workflowId, sourceHandle.portId, newNodeId, 'main');
  }
  return dataEdge(newNodeId, 'main', sourceHandle.workflowId, sourceHandle.portId);
}

function flowPositionFromEvent(
  flowInstance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } } | null,
  event: { clientX: number; clientY: number; currentTarget: HTMLElement },
): { x: number; y: number } {
  return flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, event.currentTarget);
}

function flowPositionFromPoint(
  flowInstance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } } | null,
  point: { x: number; y: number },
  fallbackElement?: HTMLElement,
): { x: number; y: number } {
  if (flowInstance) {
    return flowInstance.screenToFlowPosition(point);
  }
  if (fallbackElement) {
    const bounds = fallbackElement.getBoundingClientRect();
    return { x: point.x - bounds.left, y: point.y - bounds.top };
  }
  return point;
}

function pointerPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  return slug || 'node';
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  let id = baseId;
  let index = 1;
  while (existingIds.has(id)) {
    index += 1;
    id = `${baseId}_${index}`;
  }
  return id;
}

function directoryForNode(nodeId: string, relativeCwd?: string): string {
  if (relativeCwd) {
    return `${ROOT_WORKSPACE}\\${relativeCwd.replaceAll('/', '\\')}`;
  }
  return nodeId === 'Root_Pipeline' ? ROOT_WORKSPACE : `${ROOT_WORKSPACE}\\workflows\\${nodeId}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    success: '成功',
    failed: '失败',
    timeout: '超时',
    schema_error: 'Schema 错误',
    artifact_error: '产物错误',
    running: '运行中',
    scheduled: '已调度',
    manual_review: '等待人工确认',
    not_run: '未运行',
  };
  return labels[status] || status;
}

function textArtifact(name: string, content: string, type: ArtifactContent['type']): ArtifactContent {
  return { name, path: name, content, type, size_bytes: content.length };
}

function truncateLargeLog(content: ArtifactContent): ArtifactContent {
  if (content.type !== 'log') {
    return content;
  }
  const lines = content.content.split(/\r?\n/u);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return content;
  }
  return {
    ...content,
    content: [
      `日志较大，仅显示最后 ${MAX_LOG_PREVIEW_LINES} 行。`,
      '',
      ...lines.slice(-MAX_LOG_PREVIEW_LINES),
    ].join('\n'),
  };
}

function findCapsuleId(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const runIndex = command.lastIndexOf('run');
  const candidate = command[runIndex + 1];
  return typeof candidate === 'string' && candidate.includes('.') ? candidate : '';
}

export const __workflowViewerTestables = {
  WorkspaceCanvas,
  addCapsuleNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  canvasToWorkflowGraph,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  graphToWorkspaceCanvas,
  isExecutableNodeWorkflow,
  layoutCanvasForSelection,
  reusableWorkflowClassGraph,
  layoutWorkspaceCanvas,
  nextRootPalettePosition,
};
