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
  Bot,
  Play,
  Save,
  Search,
  TestTube,
  Trash2,
} from 'lucide-react';
import dagre from 'dagre';
import {
  Fragment,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  type TouchEvent as ReactTouchEvent,
} from 'react';

import { api } from '../api';
import { shortPath, statusTone } from '../format';
import type {
  ArtifactContent,
  CallableDetail,
  CallableSummary,
  NodeLogDelta,
  NodeRunSummary,
  RunEvent,
  RuntimeConfig,
  RunSummary,
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
import { CodeBlock } from './CodeBlock';
import { WorkflowEvidenceDock } from './workflow-viewer/WorkflowEvidenceDock';
import {
  edgeAddressEquals,
  edgeAddressFromFlowEdgeId,
  flowEdgeId,
  rootEdgeAddress,
  type EdgeAddress,
  workflowEdgeAddress,
} from './workflow-viewer/workflowConnectionState';
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
  callables: CallableSummary[];
  resourceErrors?: {
    callables?: string;
    workflows?: string;
  };
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
  invocationLabel?: string;
  task: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId?: string;
  runtime?: string;
  input?: Record<string, unknown>;
  inputPorts?: WorkflowPortView[];
  outputPorts?: WorkflowPortView[];
  control?: WorkflowGraphNode['control'];
  outputSchema?: Record<string, unknown>;
  forwardMainOutputOnControl?: boolean | null;
  position?: { x: number; y: number };
};

type WorkflowContainerModel = {
  id: string;
  title: string;
  invocationLabel?: string;
  boundaryKind?: 'workflow_input' | 'workflow_output';
  sourceKind?: WorkflowGraphNode['kind'];
  workflowBodyKind?: 'inline_container' | 'external_ref';
  callableId?: string;
  sourceInput?: Record<string, unknown>;
  sourceInputMapping?: Record<string, unknown>;
  control?: WorkflowGraphNode['control'];
  outputSchema?: Record<string, unknown>;
  forwardMainOutputOnControl?: boolean | null;
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
      materialization: 'copy' | 'reference';
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
  focusedWorkflowId?: string;
  rootWorkflowId: string;
  workflows: WorkflowContainerModel[];
  edges: WorkflowCanvasEdge[];
};

type PaletteItem =
  | { kind: 'workflow'; workflowRef?: string; label: string }
  | {
      kind: 'agent';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | {
      kind: 'tool';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | { kind: 'file_source'; callableId: 'file-source.local'; label: string };

type PaletteAddOptions = {
  forceRoot?: boolean;
};

type PaletteDropTarget =
  | { kind: 'root_canvas'; position: { x: number; y: number } }
  | { kind: 'workflow_internal'; workflowId: string; position: { x: number; y: number } }
  | { kind: 'rejected'; reason: string };

type PendingCanvasConnection = {
  nodeId: string;
  handleId: string | null;
  mode: ConnectionMode;
  side: EndpointSide;
  endpoint: EndpointDescriptor | null;
};

type ConnectPreviewState = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  snapped?: boolean;
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

type ConnectionHandles = {
  sourceHandle: string | null | undefined;
  targetHandle: string | null | undefined;
};

type CanvasSelection =
  | { type: 'task_canvas'; taskId: string }
  | { type: 'workflow'; id: string }
  | { type: 'port'; workflowId: string; portId: string; direction: PortDirection }
  | { type: 'edge'; id: string; scopeWorkflowId?: string | null }
  | { type: 'internal'; workflowId: string; nodeId: string };

type DataConnectionDraft = {
  scopeWorkflowId: string | null;
  sourceNodeId: string;
  sourceNodeLabel: string;
  sourcePortId: string;
  materialization: 'copy' | 'reference';
} | null;

type DataEdgeCommandRequest = {
  scopeWorkflowId: string | null;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  materialization: 'copy' | 'reference';
  replaceExisting?: boolean;
};

type DataEdgeCommandResult = {
  canvas: WorkspaceCanvasModel;
  edge: WorkflowCanvasEdge;
  autoAddedControlEdge: boolean;
};

type ScopedEdgeSemantic =
  | 'workflow_input_main_binding'
  | 'workflow_output_main_binding'
  | 'internal_control'
  | 'internal_data'
  | 'root_control_main'
  | 'root_control_main_to_workflow'
  | 'root_control_main_from_workflow'
  | 'root_workflow_to_workflow_control'
  | 'root_data';

type ScopedEdgeResult = {
  edge: WorkflowCanvasEdge;
  scopeWorkflowId: string | null;
  semantic: ScopedEdgeSemantic;
  sourceHandle?: string;
  targetHandle?: string;
  rejectionReason?: string;
};

type EndpointRole =
  | 'root_executable_output'
  | 'root_executable_input'
  | 'workflow_outer_input'
  | 'workflow_outer_output'
  | 'workflow_inner_input'
  | 'workflow_inner_output'
  | 'internal_executable_output'
  | 'internal_executable_input'
  | 'focus_boundary_input_output'
  | 'focus_boundary_output_input';

type EndpointSide = 'source' | 'target';

type EndpointDescriptor = {
  view: 'root-shell' | 'workflow-focus';
  role: EndpointRole;
  nodeId: string;
  workflowId: string | null;
  portId: string;
  handleId: string | null;
};

type ConnectionResolution =
  | {
      accepted: true;
      edge: WorkflowCanvasEdge;
      scopeWorkflowId: string | null;
      semantic: ScopedEdgeSemantic;
      sourceHandle?: string;
      targetHandle?: string;
    }
  | {
      accepted: false;
      reason: string;
    };

type CommitConnectionResult = {
  canvas: WorkspaceCanvasModel;
  edge: WorkflowCanvasEdge;
};

type DomConnectionEndpoint = {
  nodeId: string;
  handleId: string | null;
  side: EndpointSide;
};

type ConnectionTraceEvent = {
  event: string;
  detail: Record<string, unknown>;
  timestamp: number;
};

type DataConnectNodeOption = {
  nodeId: string;
  label: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  subtitle?: string;
};

type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
  owner?: {
    kind: 'validation' | 'run' | 'node' | 'artifact';
    taskId?: string;
    runId?: string;
    nodeId?: string;
    createdAt?: string;
  };
};

type SaveWorkflowDialogState = {
  name: string;
  saving: boolean;
  error: string | null;
};

type WorkbenchTask = {
  taskId: string;
  title: string;
  canvas: WorkspaceCanvasModel;
  savedWorkflowRef?: string;
  status: Extract<
    WorkflowStatus,
    'not_run' | 'queued' | 'running' | 'success' | 'failed' | 'cancel_requested' | 'cancelled' | 'crashed'
  >;
  activeRunId?: string;
  latestRunId?: string;
};

type WorkbenchTaskStorePayload = {
  version: 1;
  activeTaskId: string;
  tasks: WorkbenchTask[];
};

type ResourceTemplate =
  | { kind: 'workflow_class'; workflowId: string; path: string; name: string }
  | { kind: 'agent_class'; callableId: string; name: string }
  | { kind: 'tool_class'; callableId: string; name: string };

type WorkbenchChromeState = {
  leftPanel: 'none' | 'tasks' | 'resources';
  rightPanel: 'none' | 'inspector' | 'resourceDetail' | 'runEvidence';
  inspectorWidth: number;
};

type RunProjection = {
  runId: string;
  taskId: string;
  status: WorkflowStatus;
  scope: RunOverlayState['scope'];
  targetId: string;
  graph: WorkflowGraph;
  runDir: string;
  summary?: RunSummary;
  run: WorkflowRunResult | null;
  events: RunEvent[];
  overlay: RunOverlayState | null;
  pollState: 'idle' | 'polling' | 'error';
};

type NodeLiveLogs = {
  stdout: string;
  stderr: string;
  stdoutOffset: number;
  stderrOffset: number;
};

type EdgeViewMode = 'all' | 'control' | 'data';

type WorkflowNodeData = {
  workflow: WorkflowContainerModel;
  binding?: WorkflowBindingView;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  selected: boolean;
  showDataPorts: boolean;
  onSelectEdge: (address: EdgeAddress) => void;
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
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

type AgentToolNodeData = {
  id: string;
  title: string;
  subtitle?: string;
  scopeLabel?: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId?: string;
  workflowId?: string;
  internalNodeId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  selected: boolean;
  showDataPorts: boolean;
  onSelect: () => void;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowContainer'>;
type AgentToolFlowNode = Node<AgentToolNodeData, 'agentToolNode'>;
type CanvasFlowNode = WorkflowFlowNode | AgentToolFlowNode;
const FlowNodeLayoutContext = createContext<CanvasFlowNode[]>([]);

const nodeTypes = { workflowContainer: memo(WorkflowContainer), agentToolNode: memo(AgentToolNode) };
const DEFAULT_CONTAINER_SIZE = { width: 430, height: 328 };
const BOUNDARY_NODE_SIZE = { width: 270, height: 240 };
const AGENT_TOOL_NODE_SIZE = { width: 276, height: 132 };
const AGENT_CONTROL_HANDLE_TOP = 26;
const AGENT_DATA_PORT_TOP = 88;
const AGENT_DATA_PORT_GAP = 28;
const WORKFLOW_INNER_HANDLE_TOP = 129;
const WORKFLOW_INNER_HANDLE_X = 25;
const WORKFLOW_CHILD_PADDING = 24;
const WORKFLOW_CHILD_START_PADDING = 8;
const INSPECTOR_DEFAULT_WIDTH = 390;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 640;

type CanvasPointerEvent =
  | PointerEvent
  | MouseEvent
  | TouchEvent
  | ReactPointerEvent<Element>
  | ReactMouseEvent<Element>
  | ReactTouchEvent<Element>;
const MAX_LOG_PREVIEW_LINES = 180;
const TASK_STORE_KEY = 'acc.workbench.tasks.v1';
const DEFAULT_TASK_ID = 'task_canvas_default';

function agentDataPortTop(index: number): number {
  return AGENT_DATA_PORT_TOP + index * AGENT_DATA_PORT_GAP;
}

function trimLiveLog(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return value;
  }
  return lines.slice(-MAX_LOG_PREVIEW_LINES).join('\n');
}

export function WorkflowViewer({
  workflows,
  callables,
  resourceErrors,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const initialTaskStore = useMemo(() => loadTaskStore(), []);
  const initialTask = useMemo(
    () =>
      initialTaskStore.tasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
      initialTaskStore.tasks[0],
    [initialTaskStore],
  );
  const [tasks, setTasks] = useState<WorkbenchTask[]>(() => initialTaskStore.tasks);
  const [activeTaskId, setActiveTaskId] = useState(initialTaskStore.activeTaskId);
  const currentTask = useMemo(
    () => tasks.find((task) => task.taskId === activeTaskId) || tasks[0],
    [activeTaskId, tasks],
  );
  const [canvas, setCanvas] = useState<WorkspaceCanvasModel>(() => initialTask.canvas);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() =>
    canvasToWorkflowGraph(initialTask.canvas),
  );
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: initialTask.canvas.id,
  });
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('control');
  const [message, setMessage] = useState('已加载持久任务');
  const [runsById, setRunsById] = useState<Record<string, RunProjection>>({});
  const [runLogsById, setRunLogsById] = useState<Record<string, Record<string, NodeLiveLogs>>>({});
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>(null);
  const [dataConnectionDraft, setDataConnectionDraft] = useState<DataConnectionDraft>(null);
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
  const [saveWorkflowDialog, setSaveWorkflowDialog] = useState<SaveWorkflowDialogState | null>(
    null,
  );
  const graphRef = useRef(sourceGraph);
  const selectedRunId = currentTask?.activeRunId || currentTask?.latestRunId || null;
  const selectedRunProjection = selectedRunId ? runsById[selectedRunId] : undefined;
  const workflowRun = selectedRunProjection?.run || null;
  const workflowEvents = selectedRunProjection?.events || [];
  const runOverlay = selectedRunProjection?.overlay || null;
  const isRunning = currentTask ? isActiveTaskStatus(currentTask.status) : false;
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

  const updateRunProjection = useCallback((runId: string, update: (current: RunProjection) => RunProjection) => {
    setRunsById((current) => {
      const projection = current[runId];
      if (!projection) {
        return current;
      }
      return { ...current, [runId]: update(projection) };
    });
  }, []);

  const appendNodeLogDelta = useCallback((delta: NodeLogDelta) => {
    setRunLogsById((current) => {
      const runLogs = current[delta.run_id] || {};
      const previous = runLogs[delta.node_id] || {
        stdout: '',
        stderr: '',
        stdoutOffset: 0,
        stderrOffset: 0,
      };
      const nextNodeLogs: NodeLiveLogs =
        delta.stream === 'stdout'
          ? {
              ...previous,
              stdout: trimLiveLog(previous.stdout + delta.text),
              stdoutOffset: delta.next_offset,
            }
          : {
              ...previous,
              stderr: trimLiveLog(previous.stderr + delta.text),
              stderrOffset: delta.next_offset,
            };
      return {
        ...current,
        [delta.run_id]: { ...runLogs, [delta.node_id]: nextNodeLogs },
      };
    });
  }, []);

  useEffect(() => {
    let ignore = false;
    api
      .runtimeConfig()
      .then((config) => {
        if (!ignore) {
          setRuntimeConfig(config);
        }
      })
      .catch(() => {
        if (!ignore) {
          setRuntimeConfig(null);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRunId || typeof EventSource === 'undefined') {
      return undefined;
    }
    const source = new EventSource(api.runStreamUrl(selectedRunId));
    const onLogDelta = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as NodeLogDelta;
        if (payload.type === 'node_log_delta') {
          appendNodeLogDelta(payload);
        }
      } catch {
        // Ignore malformed stream chunks; polling still owns durable run state.
      }
    };
    const onSummary = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; summary?: RunSummary };
        if (payload.type === 'summary' && payload.summary) {
          updateRunProjection(selectedRunId, (current) => ({
            ...current,
            summary: payload.summary,
            status: payload.summary?.status as WorkflowStatus,
          }));
        }
      } catch {
        // Keep the stream best-effort; existing run polling remains the fallback.
      }
    };
    source.addEventListener('node_log_delta', onLogDelta as EventListener);
    source.addEventListener('summary', onSummary as EventListener);
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [appendNodeLogDelta, selectedRunId, updateRunProjection]);

  useEffect(() => {
    saveTaskStore({ version: 1, activeTaskId, tasks });
  }, [activeTaskId, tasks]);

  const updateCanvas = useCallback((next: SetStateAction<WorkspaceCanvasModel>) => {
    setCanvas((current) => {
      const nextCanvas = normalizeCanvasEdges(
        typeof next === 'function'
          ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
          : next,
      );
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
    const normalizedCanvas = normalizeCanvasEdges(nextCanvas);
    const nextGraph = canvasToWorkflowGraph(normalizedCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(normalizedCanvas);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? { ...task, title: normalizedCanvas.name, canvas: stripRuntimeStateFromCanvas(normalizedCanvas) }
          : task,
      ),
    );
  }

  function updateCanvasAndGraph(next: SetStateAction<WorkspaceCanvasModel>) {
    setCanvas((current) => {
      const nextCanvas =
        normalizeCanvasEdges(
          typeof next === 'function'
            ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
            : next,
        );
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
    if (!currentTask) {
      return;
    }
    const runId = currentTask.activeRunId || currentTask.latestRunId;
    if (!runId || runsById[runId]?.run) {
      return;
    }

    let ignore = false;
    const taskGraph = canvasToWorkflowGraph(currentTask.canvas);
    api
      .run(runId)
      .then(async (summary) => {
        if (ignore) {
          return;
        }
        const restoredRun = workflowRunFromRunSummary(summary, taskGraph);
        const events = await api.runEvents(runId).catch(() => null);
        if (ignore) {
          return;
        }
        const liveRun = events
          ? mergeWorkflowRunWithEvents(
              restoredRun,
              liveWorkflowRunFromEvents(taskGraph, summary.run_dir || `runs/${runId}`, events.events || []),
            )
          : restoredRun;
        const overlay = runOverlayFromRun(liveRun, {
          runId,
          scope: 'task',
          targetId: taskGraph.id,
        });
        setRunsById((current) => ({
          ...current,
          [runId]: {
            runId,
            taskId: currentTask.taskId,
            status: normalizeTaskRunStatus(restoredRun.status),
            scope: 'task',
            targetId: taskGraph.id,
            graph: taskGraph,
            runDir: summary.run_dir,
            summary,
            run: liveRun,
            events: events?.events || [],
            overlay,
            pollState: 'idle',
          },
        }));
        setTasks((current) =>
          current.map((task) =>
            task.taskId === currentTask.taskId
              ? {
                  ...task,
                  status: taskStatusFromRunStatus(restoredRun.status),
                  latestRunId: runId,
                  activeRunId: isActiveRunStatus(restoredRun.status) ? runId : undefined,
                }
              : task,
          ),
        );
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setRunsById((current) => {
          const next = { ...current };
          delete next[runId];
          return next;
        });
      });

    return () => {
      ignore = true;
    };
  }, [currentTask?.activeRunId, currentTask?.latestRunId, currentTask?.taskId, runsById]);

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
      const nextCanvas = normalizeCanvasEdges(graphToWorkspaceCanvas(nextGraph, workflowRun));
      const nextNormalizedGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextNormalizedGraph;
      setSourceGraph(nextNormalizedGraph);
      setCanvas(nextCanvas);
      setSelection(
        nextCanvas.workflows[0]
          ? { type: 'workflow', id: nextCanvas.workflows[0].id }
          : { type: 'workflow', id: nextCanvas.rootWorkflowId },
      );
      setMessage(`已打开 ${workflow.workflow_id}`);
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
  const selectedEdgeAddress = selectionEdgeAddress(displayCanvas, selection);
  const selectedEdge = findCanvasEdgeByAddress(displayCanvas, selectedEdgeAddress);
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
  const normalizedSelection = useMemo(
    () => normalizeWorkbenchSelection(displayCanvas, selection, focusedWorkflowId),
    [displayCanvas, focusedWorkflowId, selection],
  );
  const paletteTargetWorkflow =
    focusedWorkflowId
      ? canvas.workflows.find((workflow) => workflow.id === focusedWorkflowId)
      : selectedWorkflow &&
          !isExecutableNodeWorkflow(selectedWorkflow)
        ? selectedWorkflow
        : null;
  const canRunSelectedWorkflow = Boolean(selectedWorkflow && !isExecutableNodeWorkflow(selectedWorkflow));
  const canRunSelectedNode = Boolean(
    selectedInternalNode || (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)),
  );

  useEffect(() => {
    if (selectionKey(normalizedSelection) !== selectionKey(selection)) {
      setSelection(normalizedSelection);
      if (normalizedSelection.type === 'task_canvas') {
        setChrome((current) => ({ ...current, rightPanel: 'none' }));
      }
    }
  }, [normalizedSelection, selection]);

  useEffect(() => {
    if (connectionMode !== 'data') {
      setDataConnectionDraft(null);
    }
  }, [connectionMode]);

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
  }, [dataConnectionDraft, displayCanvas]);

  function createDemo() {
    const nextCanvas = workspaceDemoCanvas();
    resetCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
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
    const nextCanvas = normalizeCanvasEdges(task.canvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setFocusedWorkflowId(null);
    setChrome((current) => ({ ...current, rightPanel: 'none' }));
    closeEvidenceDock();
  }

  function newTask() {
    const taskId = `task_canvas_${Date.now()}`;
    const task = createEmptyTask(taskId, nextTaskTitle(tasks));
    const nextCanvas = normalizeCanvasEdges(task.canvas);
    setTasks((current) => [...current, { ...task, canvas: nextCanvas }]);
    setActiveTaskId(task.taskId);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setFocusedWorkflowId(null);
    setChrome((current) => ({ ...current, rightPanel: 'none' }));
    closeEvidenceDock();
  }

  function deleteTask(taskId: string) {
    const targetTask = tasks.find((task) => task.taskId === taskId);
    if (targetTask && isActiveTaskStatus(targetTask.status)) {
      setMessage('任务正在运行，请先停止后再删除');
      return;
    }
    const remaining = tasks.filter((task) => task.taskId !== taskId);
    const nextTasks = remaining.length > 0 ? remaining : [createEmptyTask(DEFAULT_TASK_ID, '任务 1')];
    const nextActiveTask =
      taskId === activeTaskId
        ? nextTasks[0]
        : nextTasks.find((task) => task.taskId === activeTaskId) || nextTasks[0];
    setTasks(nextTasks);
    setActiveTaskId(nextActiveTask.taskId);
    const nextCanvas = normalizeCanvasEdges(nextActiveTask.canvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setMessage(`已删除任务 ${taskId}`);
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

  const handleCanvasLayoutPointerDown = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {},
    [],
  );
  const handleCanvasLayoutClick = useCallback(
    (_event: ReactMouseEvent<HTMLDivElement>) => {},
    [],
  );
  const selectCanvasObject = useCallback((nextSelection: CanvasSelection) => {
    setSelection(nextSelection);
    if (nextSelection.type !== 'task_canvas') {
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
    }
  }, []);

  const deleteSelectedCanvasObject = useCallback((targetSelection = selection) => {
    const eligibility = selectionCanBeDeleted(canvas, targetSelection, isRunning);
    if (!eligibility.ok) {
      if (eligibility.reason) {
        setMessage(eligibility.reason);
      }
      return;
    }
    updateCanvas((current) => deleteSelectionFromCanvas(current, targetSelection));
    setSelection({ type: 'task_canvas', taskId: canvas.id });
    setMessage('已删除选中的画布对象');
  }, [canvas, isRunning, selection, updateCanvas]);

  function requestSaveWorkflow() {
    if (isJsdomRuntime()) {
      void saveGraph();
      return;
    }
    const baseGraph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    setSaveWorkflowDialog({
      name: baseGraph.name || canvas.name || 'workflow',
      saving: false,
      error: null,
    });
  }

  async function confirmSaveWorkflow() {
    const requestedName = saveWorkflowDialog?.name.trim() || '';
    if (!requestedName) {
      setSaveWorkflowDialog((current) =>
        current ? { ...current, error: 'Workflow 名称不能为空' } : current,
      );
      return;
    }
    setSaveWorkflowDialog((current) =>
      current ? { ...current, saving: true, error: null } : current,
    );
    try {
      await saveGraph({ requestedName });
      setSaveWorkflowDialog(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSaveWorkflowDialog((current) =>
        current ? { ...current, saving: false, error: text } : current,
      );
    }
  }

  async function saveGraph(
    options: {
      selectSavedWorkflow?: boolean;
      refreshIndex?: boolean;
      requestedName?: string | null;
    } = {},
  ) {
    const { selectSavedWorkflow = true, refreshIndex = true, requestedName = null } = options;
    const baseGraph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    const graph = requestedName
      ? {
          ...baseGraph,
          id: slugId(requestedName) === 'node' ? `workflow_${Date.now()}` : slugId(requestedName),
          name: requestedName,
        }
      : baseGraph;
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
        owner: {
          kind: 'validation',
          taskId: activeTaskId,
          createdAt: new Date().toISOString(),
        },
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
    const taskId = activeTaskId;

    async function pollRunUntilTerminal() {
      try {
        const [summary, result] = await Promise.all([
          api.run(runId),
          api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
        ]);
        const liveRun = mergeWorkflowRunWithEvents(
          workflowRunFromRunSummary(summary, runnableGraph),
          liveWorkflowRunFromEvents(runnableGraph, summary.run_dir || runDir, result.events),
        );
        const runStatus = normalizeTaskRunStatus(summary.status || liveRun.status);
        const overlay = runOverlayFromRun({ ...liveRun, status: runStatus }, { runId, scope, targetId });
        setRunsById((current) => ({
          ...current,
          [runId]: {
            ...(current[runId] || {
              runId,
              taskId,
              scope,
              targetId,
              graph: runnableGraph,
              runDir,
            }),
            status: runStatus,
            summary,
            run: { ...liveRun, status: runStatus },
            events: result.events,
            overlay,
            pollState: 'polling',
          },
        }));
        setTasks((current) =>
          current.map((task) =>
            task.taskId === taskId
              ? {
                  ...task,
                  status: taskStatusFromRunStatus(runStatus),
                  activeRunId: isActiveRunStatus(runStatus) ? runId : undefined,
                  latestRunId: runId,
                }
              : task,
          ),
        );
        if (isActiveRunStatus(runStatus)) {
          window.setTimeout(() => {
            void pollRunUntilTerminal();
          }, selectedRunId === runId ? 1000 : 2500);
          return;
        }
        setMessage(`运行 ${liveRun.workflow_id}: ${statusLabel(runStatus)}`);
        onChanged?.();
      } catch {
        updateRunProjection(runId, (current) => ({ ...current, pollState: 'error' }));
        window.setTimeout(() => {
          void pollRunUntilTerminal();
        }, 2500);
      }
    }

    try {
      if (scope === 'task') {
        graphRef.current = graph;
        setSourceGraph(graph);
      }
      const initialRun = liveWorkflowRunFromEvents(runnableGraph, runDir, []);
      const initialOverlay = runOverlayFromRun({ ...initialRun, status: 'queued' }, { runId, scope, targetId });
      setRunsById((current) => ({
        ...current,
        [runId]: {
          runId,
          taskId,
          status: 'queued',
          scope,
          targetId,
          graph: runnableGraph,
          runDir,
          run: { ...initialRun, status: 'queued' },
          events: [],
          overlay: initialOverlay,
          pollState: 'idle',
        },
      }));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? { ...task, status: 'queued', activeRunId: runId, latestRunId: runId }
            : task,
        ),
      );
      setMessage(`运行 ${graph.id}: 已提交，等待节点事件...`);
      setEvidenceDock((current) => ({
        open: current.open,
        title: '运行证据',
        content: null,
        owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
      }));
      const submitted = await api.submitGraphRun(
        runnableGraph,
        runDir,
        { taskId, ...(bindingPath ? { bindingPath } : {}) },
      );
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? {
                ...task,
                status: taskStatusFromRunStatus(submitted.status),
                activeRunId: runId,
                latestRunId: runId,
              }
            : task,
        ),
      );
      void pollRunUntilTerminal();
      setMessage(`运行 ${runId}: 已提交`);
      onChanged?.();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`运行失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '运行错误',
        content: textArtifact('run-error.log', text, 'log'),
        owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
      });
      updateRunProjection(runId, (current) => ({ ...current, status: 'failed', pollState: 'error' }));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? { ...task, status: 'failed', activeRunId: undefined, latestRunId: runId }
            : task,
        ),
      );
    }
  }

  async function readEvidence(path: string | null | undefined, title = '运行证据') {
    if (!path) {
      return;
    }
    const content = await api.artifact(path);
    setEvidenceDock({
      open: true,
      title,
      content: truncateLargeLog(content),
      owner: {
        kind: 'artifact',
        taskId: activeTaskId,
        runId: selectedRunId || undefined,
        createdAt: new Date().toISOString(),
      },
    });
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

  function updateWorkflowInvocationInput(workflowId: string, input: Record<string, unknown>) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId ? { ...workflow, sourceInput: input } : workflow,
      ),
    }));
  }

  function updateInternalInvocationInput(
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId ? { ...node, input } : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowInvocationLabel(workflowId: string, label: string) {
    const nextLabel = label.trim();
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              invocationLabel: nextLabel || workflow.id,
              title: nextLabel || workflow.id,
            }
          : workflow,
      ),
    }));
  }

  function updateInternalInvocationLabel(workflowId: string, nodeId: string, label: string) {
    const nextLabel = label.trim();
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      invocationLabel: nextLabel || node.id,
                      name: nextLabel || node.id,
                    }
                  : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowForwardMainOutput(workflowId: string, value: boolean) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, forwardMainOutputOnControl: value }
          : workflow,
      ),
    }));
  }

  function updateInternalForwardMainOutput(
    workflowId: string,
    nodeId: string,
    value: boolean,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, forwardMainOutputOnControl: value }
                  : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function beginDataConnection(draft: Exclude<DataConnectionDraft, null>) {
    setConnectionMode('data');
    setDataConnectionDraft(draft);
    setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
    setMessage(`正在连接: ${draft.sourceNodeLabel}.${draft.sourcePortId} -> 请选择目标输入`);
  }

  function cancelDataConnection() {
    setDataConnectionDraft(null);
    setMessage('已取消 Data Edge 连接');
  }

  function updateDataConnectionMaterialization(materialization: 'copy' | 'reference') {
    setDataConnectionDraft((current) => (current ? { ...current, materialization } : current));
  }

  function completeDataConnection(
    targetNodeId: string,
    targetPortId: string,
    options: { replaceExisting?: boolean } = {},
  ) {
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
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
      setMessage(
        `已创建 Data Edge: ${dataConnectionDraft.sourceNodeLabel}.${dataConnectionDraft.sourcePortId} -> ${targetNodeId}.${targetPortId}` +
          (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
    }
  }

  function completeDataConnectionWithNewInputPort(targetNodeId: string, requestedPortId: string) {
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
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
      setMessage(
        `已创建输入端口 ${targetNodeId}.${portId} 并连接 Data Edge` +
          (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
    }
  }

  function addDataConnectPort(
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) {
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
  }

  return (
    <WorkbenchShell>
      <TopBar
        title={canvas.name}
        subtitle="Workflow Template / EnvironmentFrame / Port / Artifact 统一视图"
        isRunning={isRunning}
        onNew={newTask}
        onLoadDemo={createDemo}
        onSave={requestSaveWorkflow}
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
        <TaskRail
          tasks={tasks}
          activeTaskId={activeTaskId}
          onSelectTask={switchTask}
          onNewTask={newTask}
          onDeleteTask={deleteTask}
        />
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
              callables={callables}
              resourceErrors={resourceErrors}
              selectedWorkflowId={selectedWorkflowId}
              onOpenWorkflow={(workflowId) => openWorkflow(workflowId)}
              onSelectResource={(resource) => {
                setSelectedResource(resource);
                setChrome((current) => ({ ...current, rightPanel: 'resourceDetail' }));
              }}
              focusedWorkflowId={focusedWorkflowId}
              addTargetLabel={paletteTargetWorkflow?.title}
              onAddPaletteItem={(item, options) => {
                const selectedContainerId =
                  selectedWorkflow &&
                  !isExecutableNodeWorkflow(selectedWorkflow)
                    ? selectedWorkflow.id
                    : null;
                const requestedTargetWorkflowId = options?.forceRoot
                  ? null
                  : focusedWorkflowId || selectedContainerId;
                if (item.kind === 'workflow') {
                  const nextWorkflowId = uniqueId(
                    slugId(item.workflowRef || item.label || 'workflow') || 'workflow',
                    new Set(canvas.workflows.map((workflow) => workflow.id)),
                  );
                  updateCanvas((current) =>
                    addWorkflowFromPalette(current, item, nextRootPalettePosition(current)),
                  );
                  setSelection({ type: 'workflow', id: nextWorkflowId });
                  setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
                  setMessage(`已加入 Root canvas: ${item.label}`);
                  return;
                }
                const nextSelection = nextPaletteSelection(canvas, item, requestedTargetWorkflowId);
                updateCanvas((current) => {
                  const targetWorkflowId = requestedTargetWorkflowId;
                  if (!targetWorkflowId) {
                    return addCallableNodeFromPalette(current, item, nextRootPalettePosition(current));
                  }
                  const workflow = current.workflows.find((candidate) => candidate.id === targetWorkflowId);
                  const nodeCount = workflow?.internalNodes.length || 0;
                  return addInternalNodeFromPalette(current, targetWorkflowId, item, {
                    x: 120 + (nodeCount % 4) * (AGENT_TOOL_NODE_SIZE.width + 80),
                    y: 130 + Math.floor(nodeCount / 4) * 170,
                  });
                });
                setSelection(nextSelection);
                setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
                if (!requestedTargetWorkflowId) {
                  setMessage(`已加入 Root canvas: ${item.label}`);
                } else {
                  setMessage(`已加入 Workflow: ${requestedTargetWorkflowId} / ${item.label}`);
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
          callables={callables}
          workflows={workflows}
          bindings={workflowBindings}
          onFocusedWorkflow={setFocusedWorkflowId}
          onCanvasChange={updateCanvas}
          onSelect={selectCanvasObject}
          onDeleteSelection={deleteSelectedCanvasObject}
          edgeViewMode={edgeViewMode}
          onEdgeViewMode={setEdgeViewMode}
          onBlankCanvas={() => undefined}
          onNotice={setMessage}
          onConfigureWorkflow={(workflowId) => {
            setSelection({ type: 'workflow', id: workflowId });
            setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
            setBindingEditorWorkflowId(workflowId);
          }}
        />
        <ExecutionDock
          isRunning={isRunning}
          runtimeConfig={runtimeConfig}
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
              aria-label="调整节点设置面板宽度"
              aria-orientation="vertical"
              onPointerDown={startInspectorResize}
            />
            <div className="drawer-title-row">
              <strong>{inspectorDrawerTitle(selection)}</strong>
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
                dataConnectionDraft={dataConnectionDraft}
                runtimeConfig={runtimeConfig}
                liveLogs={selectedRunId ? runLogsById[selectedRunId] || {} : {}}
                workflowRun={workflowRun}
                workflowEvents={workflowEvents}
                workflows={workflows}
                binding={selectedWorkflow ? workflowBindings[selectedWorkflow.id] : undefined}
                onConnectionMode={setConnectionMode}
                onBeginDataConnection={beginDataConnection}
                onCancelDataConnection={cancelDataConnection}
                onUpdateDataConnectionMaterialization={updateDataConnectionMaterialization}
                onCompleteDataConnection={completeDataConnection}
                onCompleteDataConnectionWithNewInputPort={completeDataConnectionWithNewInputPort}
                onAddDataConnectPort={addDataConnectPort}
                onReadEvidence={readEvidence}
                onConfigureBinding={(workflowId) => setBindingEditorWorkflowId(workflowId)}
                onUpdateWorkflowInput={updateWorkflowInvocationInput}
                onUpdateInternalInput={updateInternalInvocationInput}
                onUpdateWorkflowLabel={updateWorkflowInvocationLabel}
                onUpdateInternalLabel={updateInternalInvocationLabel}
                onUpdateWorkflowForwardMainOutput={updateWorkflowForwardMainOutput}
                onUpdateInternalForwardMainOutput={updateInternalForwardMainOutput}
                onOpenCallableResource={(callableId, name, kind) => {
                  setSelectedResource({
                    kind: kind === 'tool_class' ? 'tool_class' : 'agent_class',
                    callableId,
                    name: name || callableId,
                  });
                  setChrome((current) => ({ ...current, rightPanel: 'resourceDetail' }));
                }}
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
      {saveWorkflowDialog ? (
        <SaveWorkflowDialog
          state={saveWorkflowDialog}
          onName={(name) =>
            setSaveWorkflowDialog((current) => (current ? { ...current, name } : current))
          }
          onCancel={() => setSaveWorkflowDialog(null)}
          onConfirm={confirmSaveWorkflow}
        />
      ) : null}
      <WorkflowEvidenceDock
        state={evidenceDock}
        message={message}
        workflowRun={workflowRun}
        workflowEvents={workflowEvents}
        currentTaskId={currentTask?.taskId}
        selectedRunId={selectedRunId}
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

function SaveWorkflowDialog({
  state,
  onName,
  onCancel,
  onConfirm,
}: {
  state: SaveWorkflowDialogState;
  onName: (name: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-panel save-workflow-dialog"
        aria-label="保存 Workflow"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="modal-title-row">
          <h3>保存任务为 Workflow</h3>
          <button type="button" onClick={onCancel} disabled={state.saving}>
            关闭
          </button>
        </div>
        <label className="form-field">
          <span>Workflow 名称</span>
          <input
            value={state.name}
            onChange={(event) => onName(event.target.value)}
            disabled={state.saving}
            autoFocus
          />
        </label>
        {state.error ? <p className="form-error">{state.error}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={state.saving}>
            取消
          </button>
          <button type="submit" className="primary-action" disabled={state.saving}>
            {state.saving ? '保存中' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExecutionDock({
  isRunning,
  runtimeConfig,
  canRunWorkflow,
  canRunNode,
  onRunTask,
  onRunWorkflow,
  onRunNode,
}: {
  isRunning: boolean;
  runtimeConfig: RuntimeConfig | null;
  canRunWorkflow: boolean;
  canRunNode: boolean;
  onRunTask: () => void;
  onRunWorkflow: () => void;
  onRunNode: () => void;
}) {
  const modeLabel = runtimeConfig?.real_external_agents_enabled
    ? 'Production: real external agents'
    : runtimeConfig?.run_mode === 'production'
      ? 'Production gate disabled'
      : 'Hermetic: no external agents';
  return (
    <div className="execution-dock" aria-label="执行控制">
      <span className="runtime-mode-pill">{modeLabel}</span>
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
  onDeleteTask,
}: {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <aside className="task-rail" aria-label="任务列表">
      <button type="button" className="task-rail-new" onClick={onNewTask}>
        新建任务
      </button>
      {tasks.map((task) => (
        <article
          key={task.taskId}
          className={[
            'task-rail-item',
            task.taskId === activeTaskId ? 'active' : '',
            `status-${task.status}`,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <button type="button" className="task-rail-select" onClick={() => onSelectTask(task.taskId)}>
            <strong>{task.title}</strong>
            <small>{task.activeRunId || task.latestRunId || '未运行'}</small>
          </button>
          <button
            type="button"
            className="task-rail-delete"
            aria-label={`删除任务 ${task.title}`}
            title="删除任务"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteTask(task.taskId);
            }}
          >
            <Trash2 aria-hidden="true" size={15} />
          </button>
        </article>
      ))}
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  isRunning,
  onNew,
  onLoadDemo,
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
  onLoadDemo: () => void;
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
          节点设置
        </button>
        <button type="button" aria-label="新建任务（工具栏）" onClick={onNew}>
          <GitBranch aria-hidden="true" size={16} />
          新建任务
        </button>
        <button type="button" onClick={onLoadDemo}>
          <LayoutDashboard aria-hidden="true" size={16} />
          加载示例
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
  callables,
  resourceErrors,
  selectedWorkflowId,
  onOpenWorkflow,
  onSelectResource,
  focusedWorkflowId,
  addTargetLabel,
  onAddPaletteItem,
}: {
  workflows: WorkflowSummary[];
  callables: CallableSummary[];
  resourceErrors?: {
    callables?: string;
    workflows?: string;
  };
  selectedWorkflowId: string;
  onOpenWorkflow: (workflowId: string) => void;
  onSelectResource: (resource: ResourceTemplate) => void;
  focusedWorkflowId: string | null;
  addTargetLabel?: string;
  onAddPaletteItem: (item: PaletteItem, options?: PaletteAddOptions) => void;
}) {
  const [workflowSearch, setWorkflowSearch] = useState('');
  const paletteCallables = callables.filter((callable) => callable.id !== 'file-source.local').slice(0, 40);
  const workflowCallableCount = callables.filter((callable) =>
    /workflow|subworkflow|agent-workflow/u.test(callable.id),
  );
  const normalizedWorkflowSearch = workflowSearch.trim().toLowerCase();
  const visibleWorkflows = workflows.filter((workflow) => {
    if (!normalizedWorkflowSearch) {
      return true;
    }
    return workflowSearchHaystack(workflow).includes(normalizedWorkflowSearch);
  });
  const rootWorkflows = visibleWorkflows.filter((workflow) => !isChildWorkflowSummary(workflow));
  const childWorkflows = visibleWorkflows.filter(isChildWorkflowSummary);
  const addHint = addTargetLabel
    ? `拖入 ${addTargetLabel}，或双击快速添加`
    : focusedWorkflowId
      ? '拖入当前 Workflow，或双击快速添加'
      : '拖入画布或任务流，双击快速添加';
  return (
    <aside className="left-navigator" aria-label="Workspace Navigator">
      <section className="navigator-section">
        <header>
          <h3>工作区</h3>
          <span>{workflows.length}</span>
        </header>
        <div className="search-box">
          <Search aria-hidden="true" size={15} />
          <input
            type="search"
            value={workflowSearch}
            onChange={(event) => setWorkflowSearch(event.target.value)}
            placeholder="搜索 workflow id / path"
            aria-label="搜索 Workflow Template"
          />
        </div>
        {resourceErrors?.workflows ? (
          <div className="notice compact-notice">Workflow 模板加载失败：{resourceErrors.workflows}</div>
        ) : null}
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
          <WorkflowResourceGroup
            title="Root workflows"
            workflows={rootWorkflows}
            selectedWorkflowId={selectedWorkflowId}
            onSelectResource={onSelectResource}
            onAddPaletteItem={onAddPaletteItem}
          />
          {childWorkflows.length ? (
            <WorkflowResourceGroup
              title="依赖 workflows"
              workflows={childWorkflows}
              selectedWorkflowId={selectedWorkflowId}
              onSelectResource={onSelectResource}
              onAddPaletteItem={onAddPaletteItem}
              dependency
            />
          ) : null}
          {visibleWorkflows.length === 0 ? <p className="empty-state">未找到匹配的 workflow。</p> : null}
        </div>
      </section>
      <section className="navigator-section">
        <header>
          <h3>Agent / Tool Callable</h3>
          <span>{paletteCallables.length}</span>
        </header>
        {addTargetLabel ? <div className="scope-target-banner">当前拖入目标：{addTargetLabel}</div> : null}
        {resourceErrors?.callables ? (
          <div className="notice compact-notice">Callable 模板加载失败：{resourceErrors.callables}</div>
        ) : null}
        {paletteCallables.map((callable) => {
          const item: Exclude<PaletteItem, { kind: 'workflow' }> = {
            kind: callable.kind === 'tool_class' ? 'tool' : 'agent',
            callableId: callable.id,
            label: callable.name || callable.id,
            inputPorts: workflowPortsFromPortContracts(callable.input_ports, 'input'),
            outputPorts: workflowPortsFromPortContracts(callable.output_ports, 'output'),
            outputSchema: outputSchemaFromArtifactContract(callable.artifact_contract),
          };
          return (
          <article
            key={callable.id}
            className={`callable-palette-item resource-kind-${item.kind}`}
            draggable
            title={addHint}
            onClick={() =>
              onSelectResource({
                kind: item.kind === 'tool' ? 'tool_class' : 'agent_class',
                callableId: callable.id,
                name: callable.name || callable.id,
              })
            }
            onDoubleClick={() => onAddPaletteItem(item)}
            onDragStart={(event) => setPaletteDragData(event, item)}
          >
            <Boxes aria-hidden="true" size={16} />
            <div>
              <strong>{callable.name || callable.id}</strong>
              <small>{callable.id}</small>
            </div>
          </article>
          );
        })}
        {workflowCallableCount.length > 0 ? (
          <small className="navigator-hint">
            Workflow callables: {workflowCallableCount.length}
          </small>
        ) : null}
        <article
          className="callable-palette-item resource-kind-file-source"
          draggable
          title={addHint}
          onClick={() =>
            onSelectResource({
              kind: 'tool_class',
              callableId: 'file-source.local',
              name: 'File Source',
            })
          }
          onDoubleClick={() =>
            onAddPaletteItem({
              kind: 'file_source',
              callableId: 'file-source.local',
              label: 'File Source',
            })
          }
          onDragStart={(event) =>
            setPaletteDragData(event, {
              kind: 'file_source',
              callableId: 'file-source.local',
              label: 'File Source',
            })
          }
        >
          <FileText aria-hidden="true" size={16} />
          <div>
            <strong>File Source</strong>
            <small>file-source.local</small>
          </div>
        </article>
      </section>
    </aside>
  );
}

function WorkflowResourceGroup({
  title,
  workflows,
  selectedWorkflowId,
  onSelectResource,
  onAddPaletteItem,
  dependency = false,
}: {
  title: string;
  workflows: WorkflowSummary[];
  selectedWorkflowId: string;
  onSelectResource: (resource: ResourceTemplate) => void;
  onAddPaletteItem: (item: PaletteItem, options?: PaletteAddOptions) => void;
  dependency?: boolean;
}) {
  if (workflows.length === 0) {
    return null;
  }
  return (
    <>
      <h4>{title}</h4>
      {workflows.map((workflow) => {
        const item: Extract<PaletteItem, { kind: 'workflow' }> = {
          kind: 'workflow',
          workflowRef: workflow.path,
          label: workflow.name || workflow.workflow_id,
        };
        const stableKey = workflow.path || workflow.file_id || workflow.workflow_id;
        return (
          <article key={stableKey} className="workflow-resource-entry resource-kind-workflow">
            <button
              type="button"
              className={selectedWorkflowId === workflow.workflow_id ? 'list-item selected' : 'list-item'}
              onClick={() =>
                onSelectResource({
                  kind: 'workflow_class',
                  workflowId: workflow.workflow_id,
                  path: workflow.path,
                  name: workflow.name || workflow.workflow_id,
                })
              }
              onDoubleClick={() => onAddPaletteItem(item)}
              draggable
              onDragStart={(event) => setPaletteDragData(event, item)}
            >
              <strong>{workflow.name || workflow.workflow_id}</strong>
              <span>{workflow.workflow_id}</span>
              <span>{workflow.path}</span>
              <small>
                {workflow.task_count} nodes {dependency ? 'dependency' : 'root'}
              </small>
            </button>
            <div className="palette-add-actions">
              <button
                type="button"
                className="palette-add-action"
                onClick={() => onAddPaletteItem(item, { forceRoot: true })}
              >
                加入到画布
              </button>
            </div>
          </article>
        );
      })}
    </>
  );
}

function WorkspaceCanvas({
  canvas,
  selection,
  connectionMode,
  edgeViewMode,
  workflowRun,
  focusedWorkflowId,
  callables,
  workflows,
  bindings,
  onFocusedWorkflow,
  onCanvasChange,
  onSelect,
  onDeleteSelection,
  onEdgeViewMode,
  onBlankCanvas,
  onNotice,
  onConfigureWorkflow,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  workflowRun: WorkflowRunResult | null;
  focusedWorkflowId: string | null;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  bindings: Record<string, WorkflowBindingView>;
  onFocusedWorkflow: (workflowId: string | null) => void;
  onCanvasChange: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  onSelect: (selection: CanvasSelection) => void;
  onDeleteSelection: (selection?: CanvasSelection) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onBlankCanvas: () => void;
  onNotice?: (message: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
}) {
  const [flowInstance, setFlowInstance] = useState<{
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    fitView?: (options?: { padding?: number; duration?: number }) => void;
  } | null>(null);
  const [nodeCreateMenu, setNodeCreateMenu] = useState<NodeCreateMenuState>(null);
  const [connectStart, setConnectStart] = useState<PendingCanvasConnection | null>(null);
  const [connectPreview, setConnectPreview] = useState<ConnectPreviewState | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const flowNodesRef = useRef<CanvasFlowNode[]>([]);
  const connectionModeRef = useRef(connectionMode);
  const connectStartRef = useRef<PendingCanvasConnection | null>(null);
  const connectCompletedRef = useRef(false);
  const connectCommitVersionRef = useRef(0);
  const internalClickConnectRef = useRef<{
    workflowId: string;
    nodeId: string;
    mode: ConnectionMode;
  } | null>(null);
  const nodeDragStartPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeDragEligibleRef = useRef<Map<string, boolean>>(new Map());
  const draggingRef = useRef(false);
  const suppressInternalClickConnectRef = useRef(false);
  const lastDragCommitRef = useRef<string | null>(null);
  const forceCommittedProjectionRef = useRef(false);
  const projectionKeysRef = useRef({ identity: '', layout: '' });
  const lastFitViewNodeCountRef = useRef(0);
  const visibleCanvas = useMemo(
    () => focusCanvas(canvas, focusedWorkflowId),
    [canvas, focusedWorkflowId],
  );
  useEffect(() => {
    setNodeCreateMenu(null);
    connectStartRef.current = null;
    internalClickConnectRef.current = null;
    setConnectStart(null);
    setConnectPreview(null);
  }, [canvas.id]);
  useEffect(() => {
    connectionModeRef.current = connectionMode;
    internalClickConnectRef.current = null;
  }, [connectionMode]);
  useEffect(() => {
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || isTextEditingKeyboardTarget(event.target)) {
        return;
      }
      event.preventDefault();
      onDeleteSelection();
    };
    window.addEventListener('keydown', handleDeleteShortcut);
    return () => window.removeEventListener('keydown', handleDeleteShortcut);
  }, [onDeleteSelection]);
  useEffect(() => {
    const visibleNodeCount = flowNodes.length;
    if (!flowInstance?.fitView || visibleNodeCount === 0 || visibleNodeCount === lastFitViewNodeCountRef.current) {
      return;
    }
    lastFitViewNodeCountRef.current = visibleNodeCount;
    window.setTimeout(() => flowInstance.fitView?.({ padding: 0.18, duration: 180 }), 0);
  }, [flowInstance, flowNodes.length]);
  const handleSelectPort = useCallback(
    (workflowId: string, portValue: WorkflowPortView) => {
      const nextSelection: CanvasSelection = {
        type: 'port',
        workflowId,
        portId: portValue.id,
        direction: portValue.direction,
      };
      if (connectionMode === 'data' && selection.type === 'port') {
        const endpoints = [selection, nextSelection];
        const source = endpoints.find((item) => item.direction === 'output');
        const target = endpoints.find((item) => item.direction === 'input');
        if (!source || !target) {
          onSelect(nextSelection);
          onNotice?.('Data Edge 必须从 output port 连接到 input port');
          return;
        }
        const resolved = resolveScopedConnection(
          visibleCanvas,
          {
            source: source.workflowId,
            sourceHandle: portHandleId(source.workflowId, 'output', source.portId),
            target: target.workflowId,
            targetHandle: portHandleId(target.workflowId, 'input', target.portId),
          },
          'data',
        );
        if (!resolved.accepted) {
          onSelect(nextSelection);
          onNotice?.(resolved.reason);
          return;
        }
        let storedEdge = resolved.edge;
        onCanvasChange((current) => {
          const committed = commitResolvedConnection(current, resolved);
          storedEdge = committed.edge;
          return committed.canvas;
        });
        onSelect(selectionForEdgeAddress(edgeAddressForScope(resolved.scopeWorkflowId, storedEdge.id)));
        return;
      }
      onSelect(nextSelection);
    },
    [connectionMode, onCanvasChange, onNotice, onSelect, selection, visibleCanvas],
  );
  const handleSelectInternal = useCallback((workflowId: string, nodeId: string) => {
    if (isWorkflowBoundaryId(workflowId)) {
      onSelect({ type: 'workflow', id: workflowId });
      return;
    }
    if (suppressInternalClickConnectRef.current) {
      internalClickConnectRef.current = null;
      onSelect({ type: 'internal', workflowId, nodeId });
      return;
    }
    onSelect({ type: 'internal', workflowId, nodeId });
  }, [onSelect]);
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
  const handleControlHandleMouseDown = useCallback(
    (nodeId: string, handleId: string, side: EndpointSide, modeOverride?: ConnectionMode) => {
      const mode = modeOverride || connectionModeRef.current;
      const pending = {
        nodeId,
        handleId,
        mode,
        side,
        endpoint: describeEndpoint(visibleCanvas, nodeId, handleId, side, mode),
      };
      if (!pending.endpoint) {
        onNotice?.('无法识别连接起点');
        recordConnectionTrace('begin_rejected', { nodeId, handleId, side, mode });
        connectStartRef.current = null;
        setConnectStart(null);
        setConnectPreview(null);
        return;
      }
      connectCompletedRef.current = false;
      connectStartRef.current = pending;
      recordConnectionTrace('begin', { nodeId, handleId, side, mode, endpoint: pending.endpoint });
    },
    [onNotice, visibleCanvas],
  );
  const projectedFlowNodes = useMemo(
    () =>
      toFlowNodes(
        visibleCanvas,
        selection,
        bindings,
        (workflowId) => onSelect({ type: 'workflow', id: workflowId }),
        handleSelectPort,
        handleSelectInternal,
        onFocusedWorkflow,
        onConfigureWorkflow,
        connectionMode === 'data',
        handleResizeWorkflow,
        handleMoveInternal,
        handleControlHandleMouseDown,
        connectionMode,
        edgeViewMode,
        (address) => onSelect(selectionForEdgeAddress(address)),
      ),
    [
      visibleCanvas,
      selection,
      bindings,
      onSelect,
      handleSelectPort,
      handleSelectInternal,
      onFocusedWorkflow,
      onConfigureWorkflow,
      connectionMode,
      handleResizeWorkflow,
      handleMoveInternal,
      handleControlHandleMouseDown,
      edgeViewMode,
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
      commitDraggedNodeToCanvas(current, committedFlowNodes, node, visibleCanvas.focusedWorkflowId || null),
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
    if (hasRemoveChange) {
      if (isTextEditingKeyboardTarget(document.activeElement)) {
        flowNodesRef.current = projectedFlowNodes;
        setFlowNodes(projectedFlowNodes);
        return;
      }
      onDeleteSelection();
      flowNodesRef.current = projectedFlowNodes;
      setFlowNodes(projectedFlowNodes);
    }
  }, [commitDraggedFlowNode, onDeleteSelection, projectedFlowNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!changes.some((change) => change.type === 'remove')) {
      return;
    }
    if (isTextEditingKeyboardTarget(document.activeElement)) {
      return;
    }
    onDeleteSelection();
  }, [onDeleteSelection]);

  const commitResolved = useCallback((resolved: Extract<ConnectionResolution, { accepted: true }>) => {
    connectCompletedRef.current = true;
    connectCommitVersionRef.current += 1;
    setConnectPreview(null);
    recordConnectionTrace('commit', { resolved });
    let storedEdge = resolved.edge;
    onCanvasChange((current) => {
      const committed = commitResolvedConnection(current, resolved);
      storedEdge = committed.edge;
      return committed.canvas;
    });
    onSelect(selectionForEdgeAddress(edgeAddressForScope(resolved.scopeWorkflowId, storedEdge.id)));
  }, [onCanvasChange, onSelect]);

  const beginPendingConnection = useCallback(
    (
      nodeId: string,
      handleId: string | null,
      side: EndpointSide,
      mode: ConnectionMode = connectionMode,
    ): boolean => {
      const pending = {
        nodeId,
        handleId,
        mode,
        side,
        endpoint: describeEndpoint(visibleCanvas, nodeId, handleId, side, mode),
      };
      if (!pending.endpoint) {
        onNotice?.('无法识别连接起点');
        recordConnectionTrace('begin_rejected', { nodeId, handleId, side, mode });
        connectStartRef.current = null;
        setConnectStart(null);
        return false;
      }
      connectCompletedRef.current = false;
      connectStartRef.current = pending;
      recordConnectionTrace('begin', { nodeId, handleId, side, mode, endpoint: pending.endpoint });
      return true;
    },
    [connectionMode, onNotice, visibleCanvas],
  );

  const handleConnect: OnConnect = useCallback((connection) => {
    const resolved = resolveScopedConnection(visibleCanvas, connection, connectionMode);
    recordConnectionTrace('on_connect', { connection, mode: connectionMode, resolved });
    if (resolved.accepted) {
      commitResolved(resolved);
      return;
    }
    const reversed = reverseConnection(connection);
    if (reversed) {
      const reversedResolved = resolveScopedConnection(visibleCanvas, reversed, connectionMode);
      recordConnectionTrace('on_connect_reversed', { connection: reversed, mode: connectionMode, resolved: reversedResolved });
      if (reversedResolved.accepted) {
        commitResolved(reversedResolved);
        return;
      }
    }
    const pendingConnection = connectStartRef.current || connectStart;
    for (const candidate of connectionCandidatesFromPendingEndpoint(pendingConnection, connection)) {
      const retryResolved = resolveScopedConnection(visibleCanvas, candidate, pendingConnection?.mode || connectionMode);
      recordConnectionTrace('on_connect_retry', {
        connection: candidate,
        mode: pendingConnection?.mode || connectionMode,
        resolved: retryResolved,
      });
      if (retryResolved.accepted) {
        commitResolved(retryResolved);
        return;
      }
    }
    connectCompletedRef.current = false;
    onNotice?.(resolved.reason);
  }, [commitResolved, connectStart, connectionMode, onNotice, visibleCanvas]);

  const commitPendingConnectionAtPoint = useCallback(
    (
      point: { x: number; y: number },
      pendingConnection: PendingCanvasConnection,
      targetEndpointOverride?: DomConnectionEndpoint | null,
    ): boolean => {
      const targetEndpoint = targetEndpointOverride || domConnectionEndpointAtPoint(point, pendingConnection.mode);
      recordConnectionTrace('release_target', { point, pendingConnection, targetEndpoint });
      const connection = connectionFromPendingEndpoint(pendingConnection, targetEndpoint);
      if (!connection) {
        recordConnectionTrace('release_no_connection', { point, pendingConnection, targetEndpoint });
        return false;
      }
      const resolved = resolveScopedConnection(visibleCanvas, connection, pendingConnection.mode);
      recordConnectionTrace('release_resolved', { connection, mode: pendingConnection.mode, resolved });
      if (!resolved.accepted) {
        onNotice?.(resolved.reason);
        return false;
      }
      commitResolved(resolved);
      return true;
    },
    [commitResolved, onNotice, visibleCanvas],
  );

  const beginPendingFromHandleEvent = useCallback(
    (event: CanvasPointerEvent & { button?: number }) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      const handleElement = closestConnectionHandle(eventTarget);
      if (!(handleElement instanceof HTMLElement)) {
        return false;
      }
      const handleMode = connectionModeForHandleElement(handleElement);
      if (!handleMode) {
        return false;
      }
      if (typeof event.button === 'number' && event.button !== 0) {
        return false;
      }
      const nodeId = handleElement.getAttribute('data-nodeid');
      if (!nodeId) {
        return false;
      }
      const side = connectionSideFromHandleElement(handleElement);
      if (!side) {
        return false;
      }
      const didBegin = beginPendingConnection(
        nodeId,
        handleElement.getAttribute('data-handleid'),
        side,
        handleMode,
      );
      if (didBegin) {
        setConnectPreview(connectionPreviewFromHandle(handleElement, pointerPoint(event)));
        recordConnectionTrace('begin_from_dom', {
          nodeId,
          handleId: handleElement.getAttribute('data-handleid'),
          side,
          mode: handleMode,
        });
      }
      return didBegin;
    },
    [beginPendingConnection],
  );

  const commitPendingFromReleaseEvent = useCallback(
    (event: CanvasPointerEvent): boolean => {
      const point = pointerPoint(event);
      const pendingAtRelease = connectStartRef.current;
      const targetAtRelease =
        pendingAtRelease && event.target instanceof Element
          ? domConnectionEndpointFromElement(event.target, pendingAtRelease.mode)
          : null;
      const commitVersionAtRelease = connectCommitVersionRef.current;
      recordConnectionTrace('release_event', {
        point,
        pendingAtRelease,
        targetAtRelease,
        commitVersionAtRelease,
      });
      window.setTimeout(() => {
        const pendingConnection = pendingAtRelease;
        if (!pendingConnection) {
          return;
        }
        if (connectCommitVersionRef.current === commitVersionAtRelease) {
          commitPendingConnectionAtPoint(point, pendingConnection, targetAtRelease);
        }
        if (connectStartRef.current === pendingConnection) {
          connectStartRef.current = null;
        }
        connectCompletedRef.current = false;
        setConnectStart(null);
        setConnectPreview(null);
      }, 0);
      return Boolean(pendingAtRelease);
    },
    [commitPendingConnectionAtPoint],
  );

  const handleNodeDragStart = useCallback((event?: unknown, node?: CanvasFlowNode) => {
    if (connectStartRef.current) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      return;
    }
    draggingRef.current = true;
    lastDragCommitRef.current = null;
    nodeDragStartPositionRef.current.clear();
    nodeDragEligibleRef.current.clear();
    const eventTarget = event && typeof event === 'object' && 'target' in event ? event.target : null;
    const hasBrowserEvent = eventTarget !== null;
    const startsFromHandle =
      eventTarget instanceof Element && Boolean(closestConnectionHandle(eventTarget));
    if (startsFromHandle) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      return;
    }
    connectStartRef.current = null;
    connectCompletedRef.current = false;
    setConnectStart(null);
    setConnectPreview(null);
    if (!startsFromHandle) {
      internalClickConnectRef.current = null;
      suppressInternalClickConnectRef.current = true;
    }
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
    window.setTimeout(() => {
      suppressInternalClickConnectRef.current = false;
    }, 80);
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
        onNotice?.('Workflow 内部不能嵌套拖入新的 Workflow');
        return;
      }
      onCanvasChange((current) => addInternalNodeFromPalette(current, focusedWorkflowId, item, position));
      onSelect(nextPaletteSelection(canvas, item, focusedWorkflowId));
      onNotice?.(`已加入 Workflow: ${focusedWorkflowId} / ${item.label}`);
      return;
    }
    const dropTarget = resolvePaletteDropTarget(canvas, item, event.target, position);
    if (dropTarget.kind === 'rejected') {
      onNotice?.(dropTarget.reason);
      return;
    }
    const nextSelection =
      item.kind === 'workflow'
        ? ({
            type: 'workflow',
            id: uniqueId(
              slugId(item.workflowRef || item.label || 'workflow') || 'workflow',
              new Set(canvas.workflows.map((workflow) => workflow.id)),
            ),
          } as CanvasSelection)
        : nextPaletteSelection(canvas, item, dropTarget.kind === 'workflow_internal' ? dropTarget.workflowId : null);
    onCanvasChange((current) => {
      if (item.kind === 'workflow') {
        return dropTarget.kind === 'root_canvas'
          ? addWorkflowFromPalette(current, item, dropTarget.position)
          : current;
      }
      return dropTarget.kind === 'workflow_internal'
        ? addInternalNodeFromPalette(current, dropTarget.workflowId, item, dropTarget.position)
        : addCallableNodeFromPalette(current, item, dropTarget.position);
    });
    onSelect(nextSelection);
    onNotice?.(
      dropTarget.kind === 'workflow_internal'
        ? `已加入 Workflow: ${dropTarget.workflowId} / ${item.label}`
        : `已加入 Root canvas: ${item.label}`,
    );
  }, [canvas, flowInstance, focusedWorkflowId, onCanvasChange, onNotice, onSelect]);

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
    const point = pointerPoint(event);
    if (!connectCompletedRef.current && pendingConnection) {
      const targetEndpoint = domConnectionEndpointFromElement(target, pendingConnection.mode);
      if (commitPendingConnectionAtPoint(point, pendingConnection, targetEndpoint)) {
        connectStartRef.current = null;
        setConnectStart(null);
        setConnectPreview(null);
        return;
      }
    }
    if (
      connectCompletedRef.current ||
      !pendingConnection ||
      (target && (closestConnectionHandle(target) || target.closest('.react-flow__node')))
    ) {
      connectCompletedRef.current = false;
      connectStartRef.current = null;
      setConnectStart(null);
      setConnectPreview(null);
      return;
    }
    setNodeCreateMenu({
      x: point.x,
      y: point.y,
      position: flowPositionFromPoint(flowInstance, point),
      pendingConnection,
    });
    connectStartRef.current = null;
    connectCompletedRef.current = false;
    setConnectStart(null);
    setConnectPreview(null);
  }, [commitPendingConnectionAtPoint, connectStart, flowInstance]);

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
      onCanvasChange((current) => addCallableNodeFromPalette(current, item, menu.position));
    }
    setNodeCreateMenu(null);
  }, [focusedWorkflowId, nodeCreateMenu, onCanvasChange]);

  const handleConnectStart = useCallback(
    (event: unknown, params: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }) => {
      const nodeId = String(params.nodeId || '');
      const handleId = params.handleId || null;
      const eventTarget = event && typeof event === 'object' && 'target' in event ? event.target : null;
      const handleElement =
        eventTarget instanceof Element ? closestConnectionHandle(eventTarget) : null;
      const handleMode =
        handleElement instanceof HTMLElement ? connectionModeForHandleElement(handleElement) : connectionMode;
      if (!handleMode) {
        connectStartRef.current = null;
        setConnectStart(null);
        return;
      }
      const domSide = handleElement instanceof HTMLElement ? connectionSideFromHandleElement(handleElement) : null;
      const side: EndpointSide =
        domSide ||
        (params.handleType === 'target' || params.handleType === 'source'
          ? params.handleType
          : 'source');
      beginPendingConnection(nodeId, handleId, side, handleMode);
    },
    [beginPendingConnection, connectionMode],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent | MouseEvent | TouchEvent) => {
      beginPendingFromHandleEvent(event);
    };
    const handlePointerUp = (event: PointerEvent | MouseEvent | TouchEvent) => {
      commitPendingFromReleaseEvent(event);
    };
    const handlePointerMove = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const pendingConnection = connectStartRef.current;
      if (!pendingConnection) {
        return;
      }
      const point = pointerPoint(event);
      const targetEndpoint = domConnectionEndpointAtPoint(point, pendingConnection.mode);
      const connection = connectionFromPendingEndpoint(pendingConnection, targetEndpoint);
      const resolved = connection ? resolveScopedConnection(visibleCanvas, connection, pendingConnection.mode) : null;
      const snapHandle =
        resolved?.accepted && targetEndpoint
          ? connectionHandleElementForEndpoint(targetEndpoint)
          : null;
      const snapRect = snapHandle?.getBoundingClientRect();
      const end = snapRect && (snapRect.width > 0 || snapRect.height > 0)
        ? rectCenter(snapRect)
        : point;
      setConnectPreview((current) => current ? { ...current, end, snapped: Boolean(snapRect) } : null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('mouseup', handlePointerUp, true);
    document.addEventListener('mousemove', handlePointerMove, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    document.addEventListener('touchend', handlePointerUp, true);
    document.addEventListener('touchmove', handlePointerMove, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('mouseup', handlePointerUp, true);
      document.removeEventListener('mousemove', handlePointerMove, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
      document.removeEventListener('touchend', handlePointerUp, true);
      document.removeEventListener('touchmove', handlePointerMove, true);
    };
  }, [beginPendingFromHandleEvent, commitPendingFromReleaseEvent, visibleCanvas]);

  const handleInit = useCallback(
    (instance: {
      screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
      fitView?: (options?: { padding?: number; duration?: number }) => void;
    }) =>
      setFlowInstance(instance),
    [],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: CanvasFlowNode) => {
      setNodeCreateMenu(null);
      const endpoint = flowEndpointForCanvas(visibleCanvas, node.id);
      if (endpoint.internal && endpoint.workflowId) {
        handleSelectInternal(endpoint.workflowId, endpoint.nodeId);
        return;
      }
      onSelect({ type: 'workflow', id: node.id });
    },
    [handleSelectInternal, onSelect, visibleCanvas],
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      setNodeCreateMenu(null);
      const address = edgeAddressFromFlowEdge(edge);
      if (!address) {
        return;
      }
      const edgeSelection = selectionForEdgeAddress(address);
      if (shouldDisconnectEdgeOnClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        onDeleteSelection(edgeSelection);
        return;
      }
      onSelect(edgeSelection);
    },
    [onDeleteSelection, onSelect],
  );

  const handlePaneClick = useCallback(() => {
    setNodeCreateMenu(null);
    connectStartRef.current = null;
    internalClickConnectRef.current = null;
    setConnectStart(null);
    setConnectPreview(null);
    onBlankCanvas();
  }, [onBlankCanvas]);

  const defaultEdgeOptions = useMemo(
    () => ({ markerEnd: { type: MarkerType.ArrowClosed } }),
    [],
  );

  return (
    <main
      className={isDraggingNode ? 'workspace-canvas-surface dragging-node' : 'workspace-canvas-surface'}
      aria-label="任务画布"
      onPointerDownCapture={beginPendingFromHandleEvent}
      onPointerUpCapture={commitPendingFromReleaseEvent}
      onMouseDownCapture={beginPendingFromHandleEvent}
      onMouseUpCapture={commitPendingFromReleaseEvent}
      onTouchStartCapture={beginPendingFromHandleEvent}
      onTouchEndCapture={commitPendingFromReleaseEvent}
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
      <FlowNodeLayoutContext.Provider value={flowNodes}>
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
          connectOnClick={false}
          fitView
          minZoom={0.18}
          maxZoom={1.7}
          deleteKeyCode={['Backspace', 'Delete']}
          defaultEdgeOptions={defaultEdgeOptions}
        >
          <MiniMap />
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        </ReactFlow>
      </FlowNodeLayoutContext.Provider>
      {connectPreview ? <ConnectPreviewLine preview={connectPreview} /> : null}
      {nodeCreateMenu ? (
        <NodeCreateMenu
          x={nodeCreateMenu.x}
          y={nodeCreateMenu.y}
          focused={Boolean(focusedWorkflowId)}
          workflows={workflows}
          callables={callables}
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
  callables,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  focused: boolean;
  workflows: WorkflowSummary[];
  callables: CallableSummary[];
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const agentItems = callables.filter((callable) => callable.id !== 'file-source.local').slice(0, 8);
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
          {agentItems.map((callable) => (
            <button
              key={callable.id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({ kind: 'agent', callableId: callable.id, label: callable.name || callable.id })
              }
            >
              <CircleDot size={14} aria-hidden="true" />
              <span>{callable.name || callable.id}</span>
              <small>{callable.id}</small>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'tool', callableId: 'fake-agent.generic', label: 'Generic Tool' })}
          >
            <TestTube size={14} aria-hidden="true" />
            <span>Generic Tool</span>
            <small>fake-agent.generic</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'file_source', callableId: 'file-source.local', label: 'File Source' })}
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
        id={workflowInputOuterTargetHandleId(workflow.id)}
        className="workflow-control-handle input workflow-shell-outer-input"
        data-nodeid={workflow.id}
        data-handleid={workflowInputOuterTargetHandleId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetHandleId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetHandleId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputOuterTargetHandleId(workflow.id)}
        side="target"
        className="input workflow-shell-outer-input"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowInputInnerSourceHandleId(workflow.id)}
        className="workflow-control-handle input workflow-shell-inner-input workflow-boundary-source"
        data-nodeid={workflow.id}
        data-handleid={workflowInputInnerSourceHandleId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceHandleId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceHandleId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputInnerSourceHandleId(workflow.id)}
        side="source"
        className="input workflow-shell-inner-input workflow-boundary-source"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowOutputOuterSourceHandleId(workflow.id)}
        className="workflow-control-handle output workflow-shell-outer-output"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputOuterSourceHandleId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceHandleId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceHandleId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputOuterSourceHandleId(workflow.id)}
        side="source"
        className="output workflow-shell-outer-output"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={workflowOutputInnerTargetHandleId(workflow.id)}
        className="workflow-control-handle output workflow-shell-inner-output workflow-boundary-target"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputInnerTargetHandleId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetHandleId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetHandleId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputInnerTargetHandleId(workflow.id)}
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
      {!data.showDataPorts ? <HiddenWorkflowPortHandles workflow={workflow} /> : null}
      <WorkflowInternalEdgeLayer
        workflow={workflow}
        selection={data.selection}
        connectionMode={data.connectionMode}
        edgeViewMode={data.edgeViewMode}
        onSelectEdge={data.onSelectEdge}
      />
      <div
        className={data.showDataPorts ? 'workflow-nested-canvas advanced-data' : 'workflow-nested-canvas'}
        data-drop-scope="workflow-internal"
        data-workflow-id={workflow.id}
      >
        {data.showDataPorts ? (
          <WorkflowPortColumn
            workflowId={workflow.id}
            direction="input"
            ports={workflow.inputPorts}
            onSelectPort={data.onSelectPort}
          />
        ) : null}
        <div className="internal-node-grid" aria-label={`${workflow.title} internal nodes`} />
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

type WorkflowInternalEdgePath = {
  edge: WorkflowCanvasEdge;
  address: EdgeAddress;
  path: string;
  selected: boolean;
  className: string;
};

type LayoutOverlay = Map<string, { x: number; y: number }>;

function WorkflowInternalEdgeLayer({
  workflow,
  selection,
  connectionMode,
  edgeViewMode,
  onSelectEdge,
}: {
  workflow: WorkflowContainerModel;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  onSelectEdge: (address: EdgeAddress) => void;
}) {
  const liveFlowNodes = useContext(FlowNodeLayoutContext);
  const layoutOverlay = useMemo(
    () => workflowInternalLayoutOverlay(workflow, liveFlowNodes),
    [workflow, liveFlowNodes],
  );
  const paths = workflowInternalEdgePaths(workflow, selection, connectionMode, edgeViewMode, layoutOverlay);
  if (!paths.length) {
    return null;
  }
  const markerPrefix = safeSvgId(`workflow-internal-edge-${workflow.id}`);
  const markerId = `${markerPrefix}-arrow`;
  const selectedMarkerId = `${markerPrefix}-arrow-selected`;
  return (
    <svg
      className="workflow-internal-edge-layer"
      width={workflow.size.width}
      height={workflow.size.height}
      viewBox={`0 0 ${workflow.size.width} ${workflow.size.height}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f8fafc" />
        </marker>
        <marker
          id={selectedMarkerId}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
        </marker>
      </defs>
      {paths.map((item) => (
        <g
          key={`${item.address.scopeWorkflowId || 'root'}::${item.address.edgeId}`}
          className={item.className}
          data-edge-id={flowEdgeId(item.address)}
          data-selected={item.selected ? 'true' : 'false'}
        >
          <path
            className="workflow-internal-edge-hit"
            d={item.path}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectEdge(item.address);
            }}
          />
          <path
            className={item.selected ? 'workflow-internal-edge-visible selected' : 'workflow-internal-edge-visible'}
            d={item.path}
            markerEnd={`url(#${item.selected ? selectedMarkerId : markerId})`}
          />
        </g>
      ))}
    </svg>
  );
}

function workflowInternalEdgePaths(
  workflow: WorkflowContainerModel,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  edgeViewMode: EdgeViewMode,
  layoutOverlay: LayoutOverlay = new Map(),
): WorkflowInternalEdgePath[] {
  const nodeById = new Map(workflow.internalNodes.map((node, index) => [
    node.id,
    layoutOverlay.get(node.id) || node.position || defaultInternalNodePosition(index),
  ]));
  return uniqueCanvasEdges(workflow.internalEdges).flatMap((edge) => {
    if (edgeViewMode !== 'all' && edge.kind !== edgeViewMode) {
      return [];
    }
    if (isImplicitMainDataEdge(edge)) {
      return [];
    }
    const source = workflowLocalEdgeEndpoint(workflow, nodeById, edge, 'source');
    const target = workflowLocalEdgeEndpoint(workflow, nodeById, edge, 'target');
    if (!source || !target) {
      return [];
    }
    const address = edgeAddressForScope(workflow.id, edge.id);
    const selected = selectionMatchesEdgeAddress(selection, address);
    return [{
      edge,
      address,
      selected,
      path: localBezierPath(source, target),
      className: [
        'workflow-internal-edge',
        edge.kind === 'data' ? 'workflow-internal-edge-data' : 'workflow-internal-edge-control',
        edge.kind === 'data' && isWorkflowBoundaryEdge(edge) ? 'workflow-internal-edge-boundary-main' : '',
        connectionMode === edge.kind ? 'active-mode' : '',
        selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
    }];
  });
}

function workflowInternalLayoutOverlay(
  workflow: WorkflowContainerModel,
  flowNodes: Array<Pick<CanvasFlowNode, 'id' | 'position'>>,
): LayoutOverlay {
  const overlay: LayoutOverlay = new Map();
  if (!flowNodes.length || !workflow.internalNodes.length) {
    return overlay;
  }
  const flowNodeById = new Map(flowNodes.map((node) => [node.id, node]));
  workflow.internalNodes.forEach((node) => {
    const liveNode = flowNodeById.get(internalFlowNodeId(workflow.id, node.id));
    if (liveNode?.position) {
      overlay.set(node.id, liveNode.position);
    }
  });
  return overlay;
}

function workflowLocalEdgeEndpoint(
  workflow: WorkflowContainerModel,
  nodeById: Map<string, { x: number; y: number }>,
  edge: WorkflowCanvasEdge,
  side: 'source' | 'target',
): { x: number; y: number } | null {
  const endpoint = side === 'source' ? edge.source.workflowId : edge.target.workflowId;
  if (side === 'source' && endpoint === workflowInputBoundaryId(workflow.id)) {
    return workflowInnerInputPoint();
  }
  if (side === 'target' && endpoint === workflowOutputBoundaryId(workflow.id)) {
    return workflowInnerOutputPoint(workflow);
  }
  if (isWorkflowBoundaryId(endpoint)) {
    return null;
  }
  const position = nodeById.get(endpoint);
  if (!position) {
    return null;
  }
  return side === 'source'
    ? {
        x: position.x + AGENT_TOOL_NODE_SIZE.width,
        y: position.y + AGENT_CONTROL_HANDLE_TOP,
      }
    : {
        x: position.x,
        y: position.y + AGENT_CONTROL_HANDLE_TOP,
      };
}

function workflowInnerInputPoint(): { x: number; y: number } {
  return {
    x: WORKFLOW_INNER_HANDLE_X,
    y: WORKFLOW_INNER_HANDLE_TOP,
  };
}

function workflowInnerOutputPoint(workflow: WorkflowContainerModel): { x: number; y: number } {
  return {
    x: Math.max(WORKFLOW_INNER_HANDLE_X, workflow.size.width - WORKFLOW_INNER_HANDLE_X),
    y: WORKFLOW_INNER_HANDLE_TOP,
  };
}

function localBezierPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const controlOffset = Math.max(48, Math.abs(target.x - source.x) * 0.45);
  return [
    `M ${source.x} ${source.y}`,
    `C ${source.x + controlOffset} ${source.y}`,
    `${target.x - controlOffset} ${target.y}`,
    `${target.x} ${target.y}`,
  ].join(' ');
}

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function HiddenWorkflowPortHandles({ workflow }: { workflow: WorkflowContainerModel }) {
  return (
    <div
      className="workflow-hidden-port-handles"
      aria-hidden="true"
      data-drop-scope="workflow-internal"
      data-workflow-id={workflow.id}
    >
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

function ConnectPreviewLine({ preview }: { preview: ConnectPreviewState }) {
  const controlOffset = Math.max(48, Math.abs(preview.end.x - preview.start.x) * 0.45);
  const path = [
    `M ${preview.start.x} ${preview.start.y}`,
    `C ${preview.start.x + controlOffset} ${preview.start.y}`,
    `${preview.end.x - controlOffset} ${preview.end.y}`,
    `${preview.end.x} ${preview.end.y}`,
  ].join(' ');
  return (
    <svg
      className={preview.snapped ? 'acc-connect-preview snapped' : 'acc-connect-preview'}
      aria-hidden="true"
      viewBox={viewportViewBox()}
    >
      <path d={path} />
    </svg>
  );
}

function elementByDataHandleId(handleId: string, nodeId?: string): HTMLElement | null {
  const allHandles = Array.from(document.querySelectorAll<HTMLElement>('[data-handleid]'))
    .filter((handle) => handle.getAttribute('data-handleid') === handleId);
  const handles = nodeId
    ? allHandles.filter((handle) => handle.getAttribute('data-nodeid') === nodeId)
    : allHandles;
  const candidatesForNode = handles.length ? handles : allHandles;
  if (!candidatesForNode.length) {
    return null;
  }
  const visibleHandles = candidatesForNode.filter((handle) => {
    const rect = handle.getBoundingClientRect();
    const style = window.getComputedStyle(handle);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const candidates = visibleHandles.length ? visibleHandles : candidatesForNode;
  return (
    candidates.find((handle) => handle.classList.contains('workflow-control-handle') || handle.classList.contains('agent-control-handle')) ||
    candidates.find((handle) => handle.classList.contains('workflow-port-handle')) ||
    candidates.find((handle) => handle.classList.contains('acc-connect-hitbox')) ||
    candidates[0] ||
    null
  );
}

function rectCenter(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function HiddenAgentPortHandles({
  nodeId,
  inputPorts,
  outputPorts,
}: {
  nodeId: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
}) {
  return (
    <div className="workflow-hidden-port-handles" aria-hidden="true">
      {inputPorts.map((portValue, index) => (
        <Handle
          key={`input-${portValue.id}`}
          id={portHandleId(nodeId, 'input', portValue.id)}
          type="target"
          position={Position.Left}
          className="workflow-port-handle hidden input"
          style={{ top: agentDataPortTop(index) }}
        />
      ))}
      {outputPorts.map((portValue, index) => (
        <Handle
          key={`output-${portValue.id}`}
          id={portHandleId(nodeId, 'output', portValue.id)}
          type="source"
          position={Position.Right}
          className="workflow-port-handle hidden output"
          style={{ top: agentDataPortTop(index) }}
        />
      ))}
    </div>
  );
}

function AgentToolNode({
  data,
}: NodeProps<AgentToolFlowNode>) {
  function queuePortSelection(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    const portHandle = target.closest('.workflow-port-handle');
    const parsed = parsePortHandle(portHandle?.getAttribute('data-handleid'));
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
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`agent-tool-node-${data.id}`}
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
        const parsed = parsePortHandle(handle?.getAttribute('data-handleid'));
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
        id={controlTargetHandleId(data.id)}
        type="target"
        position={Position.Left}
        className="workflow-control-handle input agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlTargetHandleId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlTargetHandleId(data.id), 'target', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlTargetHandleId(data.id), 'target', 'control')}
        title="控制输入：只决定执行顺序，不传输数据"
        aria-label="控制输入端口，只决定执行顺序，不传输数据"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlTargetHandleId(data.id)}
        side="target"
        className="input agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        id={controlSourceHandleId(data.id)}
        type="source"
        position={Position.Right}
        className="workflow-control-handle output agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlSourceHandleId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlSourceHandleId(data.id), 'source', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlSourceHandleId(data.id), 'source', 'control')}
        title="控制输出：只决定执行顺序，不传输数据"
        aria-label="控制输出端口，只决定执行顺序，不传输数据"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlSourceHandleId(data.id)}
        side="source"
        className="output agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      {!data.showDataPorts ? (
        <HiddenAgentPortHandles
          nodeId={data.id}
          inputPorts={data.inputPorts}
          outputPorts={data.outputPorts}
        />
      ) : null}
      {data.showDataPorts
        ? data.inputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portHandleId(data.id, 'input', portValue.id)}
                  type="target"
                  position={Position.Left}
                  className="workflow-port-handle input"
                  style={{ top: portTop }}
                  title={`数据输入端口：${portValue.id}`}
                  aria-label={`数据输入端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target input nodrag nopan"
                  style={{ top: portTop }}
                  title={`数据输入端口：${portValue.id}`}
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
              </Fragment>
            );
          })
        : null}
      {data.showDataPorts
        ? data.outputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portHandleId(data.id, 'output', portValue.id)}
                  type="source"
                  position={Position.Right}
                  className="workflow-port-handle output"
                  style={{ top: portTop }}
                  title={`数据输出端口：${portValue.id}`}
                  aria-label={`数据输出端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target output nodrag nopan"
                  style={{ top: portTop }}
                  title={`数据输出端口：${portValue.id}`}
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
              </Fragment>
            );
          })
        : null}
      <div className="agent-node-topline">
        <span className={`agent-node-icon ${data.kind === 'Tool' ? 'tool' : 'agent'}`}>
          {data.kind === 'Tool' ? <TestTube aria-hidden="true" size={14} /> : <Bot aria-hidden="true" size={14} />}
        </span>
        <span className={`node-status-chip ${data.status}`}>{statusLabel(data.status)}</span>
      </div>
      <div className="agent-node-main">
        <strong title={data.title}>{data.title}</strong>
        <p title={data.subtitle || data.callableId || ''}>{data.subtitle || data.callableId || '未绑定模板'}</p>
        {data.scopeLabel ? <span className="node-scope-badge">{data.scopeLabel}</span> : null}
      </div>
      <div className="agent-node-footer">
        <span className={data.kind === 'Tool' ? 'node-badge tool' : 'node-badge agent'}>
          {data.kind === 'Tool' ? '工具' : '智能体'}
        </span>
        <small>{data.callableId ? '已绑定模板' : '未配置模板'}</small>
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
  return (
    <header className="workflow-container-header">
      <span className={`workflow-status-marker ${workflow.status}`} aria-label={statusLabel(workflow.status)} />
      <h3>{workflowInvocationLabel(workflow)}</h3>
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
        <strong>{internalInvocationLabel(node)}</strong>
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
        <dd>{resource.kind === 'workflow_class' ? resource.workflowId : resource.callableId}</dd>
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

type CallableDetailLoadState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  detail: CallableDetail | null;
  error: string;
};

type AgentNodeSettingsModel = {
  scopeLabel: string;
  nodeId: string;
  label: string;
  task: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId: string;
  input: Record<string, unknown>;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  forwardMainOutputOnControl?: boolean | null;
  run?: NodeRunSummary;
  logs?: NodeLiveLogs;
  preview: Record<string, unknown>;
  raw: unknown;
};

type SchemaFieldCard = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
};

function useCallableDetail(callableId: string): CallableDetailLoadState {
  const cacheRef = useRef<Record<string, CallableDetail>>({});
  const [state, setState] = useState<CallableDetailLoadState>({
    status: callableId ? 'loading' : 'idle',
    detail: null,
    error: '',
  });

  useEffect(() => {
    let ignore = false;
    if (!callableId) {
      setState({ status: 'idle', detail: null, error: '' });
      return () => {
        ignore = true;
      };
    }
    const cached = cacheRef.current[callableId];
    if (cached) {
      setState({ status: 'loaded', detail: cached, error: '' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', detail: null, error: '' });
    api
      .callable(callableId)
      .then((payload) => {
        if (ignore) {
          return;
        }
        cacheRef.current[callableId] = payload.callable;
        setState({ status: 'loaded', detail: payload.callable, error: '' });
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            detail: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [callableId]);

  return state;
}

function AgentNodeSettings({
  node,
  runtimeConfig,
  callableState,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onReadEvidence,
  onOpenCallableResource,
}: {
  node: AgentNodeSettingsModel;
  runtimeConfig: RuntimeConfig | null;
  callableState: CallableDetailLoadState;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const detail = callableState.detail;
  const templateName = detail ? callableDisplayTitle(detail) : node.callableId || '未绑定模板';
  const templateDescription = detail ? callableDescription(detail) : '';
  const inputFields = schemaFieldsFromPorts(detail?.input_ports, node.inputPorts);
  const outputFields = [
    ...schemaFieldsFromPorts(detail?.output_ports, node.outputPorts),
    ...schemaFieldsFromArtifactContract(detail?.artifact_contract),
  ];
  const provider = detail ? providerLabelFromCallable(detail) : node.kind === 'Tool' ? '工具' : '智能体';
  const metadata = detail?.metadata || {};
  const skills = skillsFromMetadata(metadata);
  const templateKind = detail?.kind === 'tool_class' ? 'tool_class' : 'agent_class';
  const runLabel = node.run?.run_dir ? shortPath(node.run.run_dir) : '尚未运行';

  return (
    <div className="node-settings-content">
      <section className="node-settings-card current-node-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">当前节点</span>
            <h4>{node.label}</h4>
          </div>
          <span className={`node-settings-status status-${node.status}`}>{statusLabel(node.status)}</span>
        </div>
        <label className="node-settings-field">
          <span>节点名称</span>
          <input
            value={node.label}
            onChange={(event) => onUpdateLabel(event.target.value)}
            aria-label="节点名称"
          />
        </label>
        <dl className="node-settings-facts">
          <dt>节点类型</dt>
          <dd>{node.kind === 'Tool' ? '工具' : '智能体'}</dd>
          <dt>使用模板</dt>
          <dd>{templateName}</dd>
          <dt>运行状态</dt>
          <dd>{runLabel}</dd>
        </dl>
        <label className="node-settings-checkbox">
          <input
            type="checkbox"
            checked={node.forwardMainOutputOnControl !== false}
            onChange={(event) => onUpdateForwardMainOutput(event.currentTarget.checked)}
          />
          <span>通过控制线传递 main 输出</span>
        </label>
      </section>

      <NodePromptEditor nodeKey={node.nodeId} input={node.input} onChange={onUpdateInput} />

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">智能体模板</span>
            <h4>{templateName}</h4>
          </div>
          {node.callableId ? (
            <button
              type="button"
              className="secondary-action compact-action"
              onClick={() => onOpenCallableResource(node.callableId, templateName, templateKind)}
            >
              编辑模板
            </button>
          ) : null}
        </div>
        {callableState.status === 'loading' ? <p className="muted">正在加载模板信息...</p> : null}
        {callableState.status === 'error' ? (
          <p className="notice compact-notice">模板信息暂时不可用：{callableState.error}</p>
        ) : null}
        <div className="template-summary-grid">
          <div>
            <span>Agent</span>
            <strong>{provider}</strong>
          </div>
          <div>
            <span>模型</span>
            <strong>{String(metadata.model || '默认模型')}</strong>
          </div>
          <div>
            <span>思考程度</span>
            <strong>{thinkingLabel(String(metadata.reasoning_effort || 'medium'))}</strong>
          </div>
        </div>
        {templateDescription ? <p className="template-description">{templateDescription}</p> : null}
        <section className="template-readonly-block">
          <h5>系统提示词</h5>
          <p>{detail?.default_prompt || '未填写系统提示词'}</p>
        </section>
        <section className="template-readonly-block">
          <h5>Skills</h5>
          {skills.length > 0 ? (
            <div className="skill-chip-row readonly">
              {skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          ) : (
            <p>未配置固定 skills</p>
          )}
        </section>
      </section>

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">输入与输出</span>
            <h4>这个节点需要什么，会产出什么</h4>
          </div>
        </div>
        <SchemaFieldCards title="输入" fields={inputFields} emptyText="未声明输入字段结构。" />
        <SchemaFieldCards title="输出" fields={dedupeSchemaFields(outputFields)} emptyText="未声明输出字段结构。" />
      </section>

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">本次运行</span>
            <h4>{node.run ? '运行证据' : '尚未运行'}</h4>
          </div>
        </div>
        <RunEvidenceCard
          nodeRun={node.run}
          liveLogs={node.logs}
          runtimeConfig={runtimeConfig}
          onReadEvidence={onReadEvidence}
        />
      </section>

      <TechnicalDetailsDisclosure
        node={node}
        runtimeConfig={runtimeConfig}
        callableDetail={detail}
      />
    </div>
  );
}

function NodePromptEditor({
  nodeKey,
  input,
  onChange,
}: {
  nodeKey: string;
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const initialInputRef = useRef(input);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(staticInputFromInvocationInput(input), null, 2));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    initialInputRef.current = input;
    setJsonText(JSON.stringify(staticInputFromInvocationInput(input), null, 2));
    setAdvancedOpen(false);
    setError('');
  }, [nodeKey]);

  function updatePrompt(value: string) {
    onChange(mergeInvocationInput(input, value, staticInputFromInvocationInput(input)));
  }

  function updateJson(value: string) {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (isPlainRecord(parsed)) {
        setError('');
        onChange(mergeInvocationInput(input, promptFromInvocationInput(input), parsed));
        return;
      }
      setError('高级输入参数必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  function resetInput() {
    const initialInput = initialInputRef.current;
    setJsonText(JSON.stringify(staticInputFromInvocationInput(initialInput), null, 2));
    setError('');
    onChange(initialInput);
  }

  return (
    <section className="node-settings-card node-prompt-card">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">本次任务</span>
          <h4>用户提示词</h4>
        </div>
      </div>
      <p className="node-settings-help">这段说明只影响当前画布节点，不会修改智能体模板里的系统提示词。</p>
      <label className="node-settings-field">
        <span>任务说明</span>
        <textarea
          aria-label="用户提示词"
          rows={6}
          value={promptFromInvocationInput(input)}
          onChange={(event) => updatePrompt(event.target.value)}
          placeholder="告诉这个节点这次具体要做什么"
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={() => updatePrompt('')}>
          清空
        </button>
        <button type="button" className="secondary-action compact-action" onClick={resetInput}>
          恢复当前值
        </button>
        <button type="button" className="secondary-action compact-action" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? '收起高级输入' : '高级输入参数'}
        </button>
      </div>
      {advancedOpen ? (
        <div className="advanced-input-editor">
          <label className="node-settings-field">
            <span>高级输入参数</span>
            <textarea
              aria-label="高级输入参数"
              rows={7}
              value={jsonText}
              onChange={(event) => updateJson(event.target.value)}
            />
          </label>
          {error ? <p className="notice compact-notice">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function SchemaFieldCards({ title, fields, emptyText }: { title: string; fields: SchemaFieldCard[]; emptyText: string }) {
  return (
    <section className="schema-card-section">
      <h5>{title}</h5>
      {fields.length > 0 ? (
        <div className="schema-field-list">
          {fields.map((field) => (
            <article key={`${title}-${field.name}`} className="schema-field-card">
              <div>
                <strong>{field.name}</strong>
                <span>{field.type}</span>
              </div>
              <p>{field.description || '未填写说明'}</p>
              <small>{field.required ? '必填' : '可选'}{field.example ? ` · 示例：${field.example}` : ''}</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyText}</p>
      )}
    </section>
  );
}

function TechnicalDetailsDisclosure({
  node,
  runtimeConfig,
  callableDetail,
}: {
  node: AgentNodeSettingsModel;
  runtimeConfig: RuntimeConfig | null;
  callableDetail: CallableDetail | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="node-settings-card technical-details-card">
      <button type="button" className="technical-details-toggle" onClick={() => setOpen((value) => !value)}>
        <span>更多技术详情</span>
        {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
      </button>
      {open ? (
        <div className="technical-details-content">
          <dl className="node-settings-facts">
            <dt>node id</dt>
            <dd>{node.nodeId}</dd>
            <dt>callable id</dt>
            <dd>{node.callableId || 'n/a'}</dd>
            <dt>scope</dt>
            <dd>{node.scopeLabel}</dd>
            <dt>run mode</dt>
            <dd>{runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}</dd>
          </dl>
          <LiveLogBlocks liveLogs={node.logs} />
          <CodeBlock title="core-v2-invocation-preview.json" content={JSON.stringify(node.preview, null, 2)} variant="json" />
          <CodeBlock title="node-raw.json" content={JSON.stringify(node.raw, null, 2)} variant="json" />
          {callableDetail ? (
            <CodeBlock title="callable-template.json" content={JSON.stringify(callableDetail, null, 2)} variant="json" />
          ) : null}
        </div>
      ) : null}
    </section>
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
  dataConnectionDraft,
  runtimeConfig,
  liveLogs,
  workflowRun,
  workflowEvents,
  workflows,
  binding,
  onConnectionMode,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onReadEvidence,
  onConfigureBinding,
  onUpdateWorkflowInput,
  onUpdateInternalInput,
  onUpdateWorkflowLabel,
  onUpdateInternalLabel,
  onUpdateWorkflowForwardMainOutput,
  onUpdateInternalForwardMainOutput,
  onOpenCallableResource,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedPort?: WorkflowPortView;
  selectedEdge?: WorkflowCanvasEdge;
  selectedInternalNode?: InternalNodeView;
  connectionMode: ConnectionMode;
  dataConnectionDraft: DataConnectionDraft;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  workflows: WorkflowSummary[];
  binding?: WorkflowBindingView;
  onConnectionMode: (mode: ConnectionMode) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
  onUpdateWorkflowInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateInternalInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateWorkflowLabel: (workflowId: string, label: string) => void;
  onUpdateInternalLabel: (workflowId: string, nodeId: string, label: string) => void;
  onUpdateWorkflowForwardMainOutput: (workflowId: string, value: boolean) => void;
  onUpdateInternalForwardMainOutput: (
    workflowId: string,
    nodeId: string,
    value: boolean,
  ) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const [tab, setTab] = useState('overview');
  const selectedNodeCallableId =
    selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
      ? selectedWorkflow.callableId || ''
      : selection.type === 'internal' && selectedInternalNode
        ? selectedInternalNode.callableId || selectedInternalNode.runtime || ''
        : '';
  const callableDetailState = useCallableDetail(selectedNodeCallableId);
  const nodeSettingsTitle = inspectorDrawerTitle(selection);
  useEffect(() => {
    setTab(selection.type === 'edge' ? 'mapping' : 'overview');
  }, [selection]);

  if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        <AgentNodeSettings
          node={{
            scopeLabel: '任务画布',
            nodeId: selectedWorkflow.id,
            label: workflowInvocationLabel(selectedWorkflow),
            task: workflowInvocationLabel(selectedWorkflow),
            kind: selectedWorkflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
            status: selectedWorkflow.status,
            callableId: selectedWorkflow.callableId || '',
            input: selectedWorkflow.sourceInput || {},
            inputPorts: selectedWorkflow.inputPorts,
            outputPorts: selectedWorkflow.outputPorts,
            forwardMainOutputOnControl: selectedWorkflow.forwardMainOutputOnControl,
            run: nodeRunForWorkflow(workflowRun, selectedWorkflow),
            logs: nodeLiveLogsFor(liveLogs, nodeRunForWorkflow(workflowRun, selectedWorkflow)),
            preview: workflowInvocationPreview(selectedWorkflow),
            raw: selectedWorkflow,
          }}
          runtimeConfig={runtimeConfig}
          callableState={callableDetailState}
          onUpdateInput={(nextInput) => onUpdateWorkflowInput(selectedWorkflow.id, nextInput)}
          onUpdateLabel={(label) => onUpdateWorkflowLabel(selectedWorkflow.id, label)}
          onUpdateForwardMainOutput={(value) =>
            onUpdateWorkflowForwardMainOutput(selectedWorkflow.id, value)
          }
          onReadEvidence={onReadEvidence}
          onOpenCallableResource={onOpenCallableResource}
        />
      </aside>
    );
  }

  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    const nodeRun = nodeRunForInternalNode(workflowRun, selectedWorkflow.id, selectedInternalNode.id);
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        <AgentNodeSettings
          node={{
            scopeLabel: `任务流：${workflowInvocationLabel(selectedWorkflow)}`,
            nodeId: selectedInternalNode.id,
            label: internalInvocationLabel(selectedInternalNode),
            task: selectedInternalNode.task,
            kind: selectedInternalNode.kind,
            status: selectedInternalNode.status,
            callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
            input: selectedInternalNode.input || {},
            inputPorts: selectedInternalNode.inputPorts || [port('main', 'input', 'input')],
            outputPorts: selectedInternalNode.outputPorts || [port('main', 'output', 'output')],
            forwardMainOutputOnControl: selectedInternalNode.forwardMainOutputOnControl,
            run: nodeRun,
            logs: nodeLiveLogsFor(liveLogs, nodeRun),
            preview: internalNodeInvocationPreview(selectedInternalNode),
            raw: { workflow: selectedWorkflow.id, node: selectedInternalNode },
          }}
          runtimeConfig={runtimeConfig}
          callableState={callableDetailState}
          onUpdateInput={(nextInput) => onUpdateInternalInput(selectedWorkflow.id, selectedInternalNode.id, nextInput)}
          onUpdateLabel={(label) => onUpdateInternalLabel(selectedWorkflow.id, selectedInternalNode.id, label)}
          onUpdateForwardMainOutput={(value) =>
            onUpdateInternalForwardMainOutput(selectedWorkflow.id, selectedInternalNode.id, value)
          }
          onReadEvidence={onReadEvidence}
          onOpenCallableResource={onOpenCallableResource}
        />
      </aside>
    );
  }

  return (
    <aside className="right-inspector" aria-label={`${nodeSettingsTitle}面板`}>
      <header className="inspector-title-row">
        <h3>{nodeSettingsTitle}</h3>
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
          canvas={canvas}
          workflow={selectedWorkflow}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          events={workflowEvents}
          savedWorkflow={workflowSummaryForRef(workflows, selectedWorkflow.workflowRef)}
          binding={binding}
          dataConnectionDraft={dataConnectionDraft}
          onReadEvidence={onReadEvidence}
          onConfigureBinding={onConfigureBinding}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onUpdateInput={onUpdateWorkflowInput}
          onUpdateLabel={onUpdateWorkflowLabel}
        />
      ) : null}
      {selection.type === 'port' && selectedWorkflow && selectedPort ? (
        <PortInspector workflow={selectedWorkflow} port={selectedPort} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'edge' && selectedEdge ? (
        <EdgeInspector edge={selectedEdge} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'internal' && selectedWorkflow && selectedInternalNode ? (
        <InternalNodeInspector
          canvas={canvas}
          workflow={selectedWorkflow}
          node={selectedInternalNode}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          dataConnectionDraft={dataConnectionDraft}
          onReadEvidence={onReadEvidence}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onUpdateInput={onUpdateInternalInput}
          onUpdateLabel={onUpdateInternalLabel}
        />
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
          ? ['overview', 'invocation', 'connections', 'input', 'output', 'steps', 'artifacts', 'logs', 'raw']
          : ['overview', 'invocation', 'connections', 'input', 'output', 'config', 'history', 'raw'];
  const labels: Record<string, string> = {
    queued: '排队中',
    cancel_requested: '停止中',
    cancelled: '已取消',
    crashed: '已中断',
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
    steps: '步骤',
    logs: '详细日志',
  };
  return (
    <div className="tab-strip compact-tabs" role="tablist" aria-label="Inspector tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={activeTab === tab ? 'active' : ''}
          aria-label={tab === 'input' ? 'Inspector input tab' : undefined}
          onClick={() => onTab(tab)}
        >
          {labels[tab] || tab}
        </button>
      ))}
    </div>
  );
}

function WorkflowInspector({
  canvas,
  workflow,
  tab,
  workflowRun,
  runtimeConfig,
  liveLogs,
  events,
  savedWorkflow,
  binding,
  dataConnectionDraft,
  onReadEvidence,
  onConfigureBinding,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onUpdateInput,
  onUpdateLabel,
}: {
  canvas: WorkspaceCanvasModel;
  workflow: WorkflowContainerModel;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  events: RunEvent[];
  savedWorkflow?: WorkflowSummary;
  binding?: WorkflowBindingView;
  dataConnectionDraft: DataConnectionDraft;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onUpdateInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateLabel: (workflowId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForWorkflow(workflowRun, workflow);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  const executable = isExecutableNodeWorkflow(workflow);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          System/default prompt belongs to the reusable class resource. This panel edits only this invocation's user prompt and static input.
        </div>
        <InvocationInputEditor
          input={workflow.sourceInput || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, nextInput)}
        />
        <CodeBlock
          title="core-v2-invocation-preview.json"
          content={JSON.stringify(workflowInvocationPreview(workflow), null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'connections') {
    if (!executable) {
      return <p className="muted">Workflow container 的边界端口连接会在后续单独建模；当前只支持可执行节点和内部节点。</p>;
    }
    return (
      <DataConnectionsPanel
        canvasNodeKind="workflow"
        canvas={canvas}
        scopeWorkflowId={null}
        nodeId={workflow.id}
        nodeLabel={workflowInvocationLabel(workflow)}
        callableId={workflow.callableId || workflow.workflowRef}
        inputPorts={workflow.inputPorts}
        outputPorts={workflow.outputPorts}
        dataConnectionDraft={dataConnectionDraft}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddPort={onAddDataConnectPort}
      />
    );
  }
  if (tab === 'input') {
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>有效输入</h4>
          <EvidencePreview
            path={nodeRun?.input_path}
            title="input.json"
            emptyText="尚未运行；当前节点没有真实 input.json。"
          />
          <CodeBlock
            title="静态输入"
            content={JSON.stringify(workflow.sourceInput || {}, null, 2)}
            variant="json"
          />
          <CodeBlock
            title="输入映射"
            content={JSON.stringify(workflow.sourceInputMapping || {}, null, 2)}
            variant="json"
          />
        </section>
      );
    }
    return <PortList title="输入端口" ports={workflow.inputPorts} />;
  }
  if (tab === 'output') {
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>真实输出</h4>
          <EvidencePreview
            path={nodeRun?.output_path}
            title="output.json"
            emptyText="尚未运行；当前节点没有真实 output.json。"
          />
        </section>
      );
    }
    return <PortList title="输出端口" ports={workflow.outputPorts} />;
  }
  if (tab === 'config') {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>workflow_ref</dt>
          <dd>{workflow.workflowRef || 'inline/demo'}</dd>
          {savedWorkflow ? (
            <>
              <dt>saved template</dt>
              <dd>{savedWorkflow.workflow_id}</dd>
              <dt>saved nodes</dt>
              <dd>{savedWorkflow.task_count}</dd>
            </>
          ) : null}
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
  if (executable) {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>Agent</dt>
          <dd>{workflow.title}</dd>
          <dt>callable</dt>
          <dd>{workflow.callableId || 'n/a'}</dd>
          <dt>runtime</dt>
          <dd>{workflow.sourceKind === 'tool' ? 'Tool' : 'Agent'}</dd>
          <dt>状态</dt>
          <dd>{statusLabel(workflow.status)}</dd>
          <dt>run</dt>
          <dd>{nodeRun?.run_dir ? shortPath(nodeRun.run_dir) : '尚未运行'}</dd>
        </dl>
        <div className="inspector-note">
          系统提示词属于资源库里的 Agent Class；这里是本次任务里的调用实例，只显示用户输入、映射和运行证据。
        </div>
        <div className="inspector-note">
          Run mode: {runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}
        </div>
        <LiveLogBlocks liveLogs={nodeLogs} />
        <InvocationIdentityCard
          scope="Root canvas"
          nodeId={workflow.id}
          label={workflowInvocationLabel(workflow)}
          callableId={workflow.callableId}
          workflowRef={workflow.workflowRef}
          onLabelChange={(label) => onUpdateLabel(workflow.id, label)}
        />
        <InvocationInputEditor
          input={workflow.sourceInput || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, nextInput)}
        />
        <CodeBlock
          title="用户提示词 / 静态输入"
          content={JSON.stringify(workflow.sourceInput || {}, null, 2)}
          variant="json"
        />
        <CodeBlock
          title="上游输入映射"
          content={JSON.stringify(workflow.sourceInputMapping || {}, null, 2)}
          variant="json"
        />
        <div className="inspector-run-evidence-grid">
          <EvidencePreview
            path={nodeRun?.input_path}
            title="真实输入 input.json"
            emptyText="尚未运行；当前 Agent 实例没有真实 input.json。"
          />
          <EvidencePreview
            path={nodeRun?.output_path}
            title="真实输出 output.json"
            emptyText="尚未运行；当前 Agent 实例没有真实 output.json。"
          />
        </div>
      </section>
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
      <dd>{savedWorkflow ? `${savedWorkflow.task_count} saved` : workflow.internalNodes.length}</dd>
    </dl>
  );
}

function DataConnectionsPanel({
  canvas,
  scopeWorkflowId,
  nodeId,
  nodeLabel,
  callableId,
  inputPorts,
  outputPorts,
  dataConnectionDraft,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddPort,
}: {
  canvasNodeKind: 'workflow' | 'internal';
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  nodeId: string;
  nodeLabel: string;
  callableId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  dataConnectionDraft: DataConnectionDraft;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
}) {
  const [newInputPortId, setNewInputPortId] = useState('');
  const [newOutputPortId, setNewOutputPortId] = useState('');
  const sourceScopeMatches = dataConnectionDraft?.scopeWorkflowId === scopeWorkflowId;
  const targets = dataConnectNodes(canvas, scopeWorkflowId).filter(
    (candidate) => candidate.nodeId !== dataConnectionDraft?.sourceNodeId,
  );
  const incoming = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'input');
  const outgoing = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'output');

  function addPort(direction: PortDirection) {
    const requestedPortId = direction === 'input' ? newInputPortId : newOutputPortId;
    onAddPort(scopeWorkflowId, nodeId, direction, requestedPortId);
    if (direction === 'input') {
      setNewInputPortId('');
    } else {
      setNewOutputPortId('');
    }
  }

  return (
    <section className="inspector-stack data-connections-panel">
      <div className="connection-identity-card">
        <strong>{nodeLabel}</strong>
        <small>{nodeId}</small>
        {callableId ? <small>{callableId}</small> : null}
      </div>

      {dataConnectionDraft ? (
        <div className="data-connect-draft">
          <strong>
            正在连接: {dataConnectionDraft.sourceNodeLabel}.{dataConnectionDraft.sourcePortId}
          </strong>
          <label>
            materialization
            <select
              value={dataConnectionDraft.materialization}
              onChange={(event) =>
                onUpdateDataConnectionMaterialization(
                  event.target.value === 'reference' ? 'reference' : 'copy',
                )
              }
            >
              <option value="copy">copy</option>
              <option value="reference">reference</option>
            </select>
          </label>
          <button type="button" onClick={onCancelDataConnection}>
            取消连接
          </button>
        </div>
      ) : (
        <p className="muted">先从某个 output port 发起连接，再选择目标 input port。</p>
      )}

      <section className="inspector-stack">
        <h4>输出端口</h4>
        {outputPorts.map((portValue) => {
          const related = outgoing.filter((edge) => edge.source.portId === portValue.id);
          return (
            <article key={portValue.id} className="port-contract-row">
              <strong>{portValue.id}</strong>
              <span>{portValue.label}</span>
              {related.length > 0 ? (
                <small>
                  输出到 {related.map((edge) => `${edge.target.workflowId}.${edge.target.portId}`).join(', ')}
                </small>
              ) : (
                <small>暂无下游 data edge</small>
              )}
              <button
                type="button"
                className="secondary-action-button"
                onClick={() =>
                  onBeginDataConnection({
                    scopeWorkflowId,
                    sourceNodeId: nodeId,
                    sourceNodeLabel: nodeLabel,
                    sourcePortId: portValue.id,
                    materialization: 'copy',
                  })
                }
              >
                从此输出连接...
              </button>
            </article>
          );
        })}
        <div className="inline-port-form">
          <input
            value={newOutputPortId}
            onChange={(event) => setNewOutputPortId(event.target.value)}
            placeholder="new_output_port"
            aria-label="new output port id"
          />
          <button type="button" onClick={() => addPort('output')}>
            添加输出端口
          </button>
        </div>
      </section>

      <section className="inspector-stack">
        <h4>输入端口</h4>
        {inputPorts.map((portValue) => {
          const related = incoming.filter((edge) => edge.target.portId === portValue.id);
          return (
            <article key={portValue.id} className="port-contract-row">
              <strong>{portValue.id}</strong>
              <span>{portValue.label}</span>
              {related.length > 0 ? (
                <small>
                  来自 {related.map((edge) => `${edge.source.workflowId}.${edge.source.portId}`).join(', ')}
                </small>
              ) : (
                <small>暂无上游 data edge</small>
              )}
            </article>
          );
        })}
        <div className="inline-port-form">
          <input
            value={newInputPortId}
            onChange={(event) => setNewInputPortId(event.target.value)}
            placeholder="new_input_port"
            aria-label="new input port id"
          />
          <button type="button" onClick={() => addPort('input')}>
            添加输入端口
          </button>
        </div>
      </section>

      {dataConnectionDraft && sourceScopeMatches ? (
        <section className="inspector-stack">
          <h4>可连接目标</h4>
          {targets.map((target) => (
            <article key={target.nodeId} className="connection-target-card">
              <strong>{target.label}</strong>
              <small>{target.nodeId}</small>
              {target.inputPorts.map((targetPort) => {
                const conflicts = dataEdgesForNode(
                  canvas,
                  scopeWorkflowId,
                  target.nodeId,
                  'input',
                ).filter((edge) => edge.target.portId === targetPort.id);
                const hasOneCardinalityConflict =
                  conflicts.length > 0 && (targetPort.cardinality || 'one') !== 'many';
                const requestedPortId = `${dataConnectionDraft.sourceNodeId}_input`;
                return (
                  <div key={targetPort.id} className="connection-target-port">
                    <span>
                      {targetPort.id}
                      {hasOneCardinalityConflict ? '（已有输入）' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onCompleteDataConnection(target.nodeId, targetPort.id, {
                          replaceExisting: hasOneCardinalityConflict,
                        })
                      }
                    >
                      {hasOneCardinalityConflict ? '替换连接' : '连接到此输入'}
                    </button>
                    {hasOneCardinalityConflict ? (
                      <button
                        type="button"
                        onClick={() =>
                          onCompleteDataConnectionWithNewInputPort(
                            target.nodeId,
                            requestedPortId,
                          )
                        }
                      >
                        创建新输入端口并连接
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </article>
          ))}
          {targets.length === 0 ? <p className="muted">当前 scope 没有可连接目标。</p> : null}
        </section>
      ) : null}
      {dataConnectionDraft && !sourceScopeMatches ? (
        <p className="muted">当前连接来源不在这个 scope 内，请回到来源所在的画布层级。</p>
      ) : null}
    </section>
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
          <article
            key={`${edge.kind}:${edge.id}:${edge.source.workflowId}:${edge.source.portId}:${edge.target.workflowId}:${edge.target.portId}`}
            className="edge-summary-row"
          >
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
  if (tab === 'mapping') {
    return (
      <CodeBlock
        title="core-v2-edge-preview.json"
        content={JSON.stringify(edgeCanonicalPreview(edge, canvas), null, 2)}
        variant="json"
      />
    );
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
  canvas,
  workflow,
  node,
  tab,
  workflowRun,
  runtimeConfig,
  liveLogs,
  dataConnectionDraft,
  onReadEvidence,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onUpdateInput,
  onUpdateLabel,
}: {
  canvas: WorkspaceCanvasModel;
  workflow: WorkflowContainerModel;
  node: InternalNodeView;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  dataConnectionDraft: DataConnectionDraft;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onUpdateInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateLabel: (workflowId: string, nodeId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForInternalNode(workflowRun, workflow.id, node.id);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          This is the invocation config for this node instance; class-level methodology remains in the resource library.
        </div>
        <InvocationIdentityCard
          scope={`Workflow: ${workflowInvocationLabel(workflow)}`}
          nodeId={node.id}
          label={internalInvocationLabel(node)}
          callableId={node.callableId || node.runtime}
          onLabelChange={(label) => onUpdateLabel(workflow.id, node.id, label)}
        />
        <InvocationInputEditor
          input={node.input || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, node.id, nextInput)}
        />
        <CodeBlock
          title="core-v2-invocation-preview.json"
          content={JSON.stringify(internalNodeInvocationPreview(node), null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'connections') {
    return (
      <DataConnectionsPanel
        canvasNodeKind="internal"
        canvas={canvas}
        scopeWorkflowId={workflow.id}
        nodeId={node.id}
        nodeLabel={internalInvocationLabel(node)}
        callableId={node.callableId || node.runtime}
        inputPorts={node.inputPorts || [port('main', 'input', 'input')]}
        outputPorts={node.outputPorts || [port('main', 'output', 'output')]}
        dataConnectionDraft={dataConnectionDraft}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddPort={onAddDataConnectPort}
      />
    );
  }
  if (tab === 'input') {
    return (
      <section className="inspector-stack">
        <h4>有效输入</h4>
        <EvidencePreview
          path={nodeRun?.input_path}
          title="input.json"
          emptyText="尚未运行；当前内部节点没有真实 input.json。"
        />
        <CodeBlock
          title="用户提示词 / 静态输入"
          content={JSON.stringify(node.input || {}, null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'output') {
    return (
      <section className="inspector-stack">
        <h4>真实输出</h4>
        <EvidencePreview
          path={nodeRun?.output_path}
          title="output.json"
          emptyText="尚未运行；当前内部节点没有真实 output.json。"
        />
      </section>
    );
  }
  if (tab === 'steps') {
    return (
      <section className="inspector-stack">
        <h4>运行步骤</h4>
        {nodeRun?.steps?.length ? (
          <ul className="inspector-step-list">
            {nodeRun.steps.map((step, index) => (
              <li key={step.event_id || `${step.type}-${index}`}>
                <strong>{step.type || 'event'}</strong>
                <span>{step.summary || step.status || ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">尚无事件摘要。</p>
        )}
      </section>
    );
  }
  if (tab === 'artifacts') {
    return (
      <NodeEvidencePaths
        nodeRun={nodeRun}
        liveLogs={nodeLogs}
        onReadEvidence={onReadEvidence}
      />
    );
  }
  if (tab === 'logs') {
    return (
      <section className="inspector-stack">
        <h4>日志摘要</h4>
        {nodeRun?.log_excerpt ? (
          <CodeBlock title="log excerpt" content={nodeRun.log_excerpt} variant="log" />
        ) : (
          <p className="empty-state">尚无日志摘要。</p>
        )}
        <NodeEvidencePaths nodeRun={nodeRun} liveLogs={nodeLogs} onReadEvidence={onReadEvidence} />
      </section>
    );
  }
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
    <section className="inspector-stack">
      <dl className="definition-grid compact">
        <dt>节点</dt>
        <dd>{node.name}</dd>
        <dt>任务</dt>
        <dd>{node.task}</dd>
        <dt>类型</dt>
        <dd>{node.kind}</dd>
        <dt>状态</dt>
        <dd>{statusLabel(node.status)}</dd>
        <dt>callable</dt>
        <dd>{node.callableId || 'n/a'}</dd>
        <dt>runtime</dt>
        <dd>{node.runtime || 'n/a'}</dd>
      </dl>
      {nodeRun?.summary ? (
        <div className="inspector-note">{nodeRun.summary}</div>
      ) : null}
      <div className="inspector-note">
        这是工作流容器内部的调用实例；系统提示词仍由资源库 Agent Class 管理。
      </div>
      <div className="inspector-note">
        Run mode: {runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}
      </div>
      <LiveLogBlocks liveLogs={nodeLogs} />
      <InvocationIdentityCard
        scope={`Workflow: ${workflowInvocationLabel(workflow)}`}
        nodeId={node.id}
        label={internalInvocationLabel(node)}
        callableId={node.callableId || node.runtime}
        onLabelChange={(label) => onUpdateLabel(workflow.id, node.id, label)}
      />
      <InvocationInputEditor
        input={node.input || {}}
        onChange={(nextInput) => onUpdateInput(workflow.id, node.id, nextInput)}
      />
      {nodeRun?.output_preview ? (
        <CodeBlock
          title="输出摘要"
          content={JSON.stringify(nodeRun.output_preview, null, 2)}
          variant="json"
        />
      ) : (
        <EvidencePreview
          path={nodeRun?.output_path}
          title="output.json"
          emptyText="尚未运行；当前内部节点没有真实 output.json。"
        />
      )}
    </section>
  );
}

function promptFromInvocationInput(input: Record<string, unknown>): string {
  const prompt = input.user_prompt ?? input.prompt ?? input.topic;
  return typeof prompt === 'string' ? prompt : '';
}

function InvocationIdentityCard({
  scope,
  nodeId,
  label,
  callableId,
  workflowRef,
  onLabelChange,
}: {
  scope: string;
  nodeId: string;
  label: string;
  callableId?: string;
  workflowRef?: string;
  onLabelChange?: (label: string) => void;
}) {
  return (
    <dl className="invocation-identity-card">
      <dt>scope</dt>
      <dd>{scope}</dd>
      <dt>node_id</dt>
      <dd>{nodeId}</dd>
      <dt>invocation</dt>
      <dd>
        {onLabelChange ? (
          <input
            type="text"
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            aria-label="Invocation label"
          />
        ) : (
          label
        )}
      </dd>
      {callableId ? (
        <>
          <dt>callable_id</dt>
          <dd>{callableId}</dd>
        </>
      ) : null}
      {workflowRef ? (
        <>
          <dt>workflow_ref</dt>
          <dd>{workflowRef}</dd>
        </>
      ) : null}
    </dl>
  );
}

function staticInputFromInvocationInput(input: Record<string, unknown>): Record<string, unknown> {
  const { user_prompt: _userPrompt, prompt: _prompt, topic: _topic, ...staticInput } = input;
  return staticInput;
}

function mergeInvocationInput(
  input: Record<string, unknown>,
  userPrompt: string,
  staticInput: Record<string, unknown>,
): Record<string, unknown> {
  const nextInput: Record<string, unknown> = { ...staticInput };
  if (userPrompt.trim()) {
    nextInput.user_prompt = userPrompt;
  }
  for (const key of Object.keys(input)) {
    if (key !== 'user_prompt' && key !== 'prompt' && key !== 'topic') {
      continue;
    }
    if (!userPrompt.trim()) {
      delete nextInput[key];
    }
  }
  return nextInput;
}

function InvocationInputEditor({
  input,
  onChange,
}: {
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(staticInputFromInvocationInput(input), null, 2));
  const [error, setError] = useState('');
  const [lastSavedInput, setLastSavedInput] = useState(input);
  useEffect(() => {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(input), null, 2));
    setLastSavedInput(input);
    setError('');
  }, [input]);

  function updatePrompt(value: string) {
    onChange(mergeInvocationInput(input, value, staticInputFromInvocationInput(input)));
  }

  function updateJson(value: string) {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setError('');
        onChange(mergeInvocationInput(input, promptFromInvocationInput(input), parsed as Record<string, unknown>));
        return;
      }
      setError('JSON 必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  function clearPrompt() {
    updatePrompt('');
  }

  function resetInput() {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(lastSavedInput), null, 2));
    setError('');
    onChange(lastSavedInput);
  }

  function formatJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setJsonText(JSON.stringify(parsed, null, 2));
        setError('');
        return;
      }
      setError('JSON 必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  return (
    <section className="invocation-input-editor" aria-label="Invocation 配置">
      <label>
        User Prompt
        <textarea
          aria-label="User Prompt"
          rows={5}
          value={promptFromInvocationInput(input)}
          onChange={(event) => updatePrompt(event.target.value)}
          placeholder="本节点实例的任务说明"
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={clearPrompt}>
          清空 User Prompt
        </button>
        <button type="button" className="secondary-action compact-action" onClick={resetInput}>
          重置为当前值
        </button>
      </div>
      <label>
        Static Input JSON
        <textarea aria-label="Static Input JSON" rows={7} value={jsonText} onChange={(event) => updateJson(event.target.value)} />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={formatJson}>
          格式化 JSON
        </button>
      </div>
      {error ? <p className="notice compact-notice">{error}</p> : null}
    </section>
  );
}

function EvidencePreview({
  path,
  title,
  emptyText,
}: {
  path?: string | null;
  title: string;
  emptyText: string;
}) {
  const [state, setState] = useState<{ status: 'empty' | 'loading' | 'loaded' | 'error'; content: string; type: ArtifactContent['type'] }>({
    status: path ? 'loading' : 'empty',
    content: '',
    type: 'text',
  });

  useEffect(() => {
    let ignore = false;
    if (!path) {
      setState({ status: 'empty', content: '', type: 'text' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', content: '', type: 'text' });
    api
      .artifact(path)
      .then((artifact) => {
        if (!ignore) {
          setState({ status: 'loaded', content: artifact.content, type: artifact.type });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            content: error instanceof Error ? error.message : String(error),
            type: 'log',
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [path]);

  if (state.status === 'empty') {
    return <p className="empty-state">{emptyText}</p>;
  }
  if (state.status === 'loading') {
    return <p className="empty-state">正在读取 {shortPath(path)}...</p>;
  }
  return (
    <CodeBlock
      title={`${title}${path ? ` - ${shortPath(path)}` : ''}`}
      content={state.content}
      variant={state.type}
    />
  );
}

function RunEvidenceCard({
  nodeRun,
  liveLogs,
  runtimeConfig,
  onReadEvidence,
}: {
  nodeRun?: NodeRunSummary;
  liveLogs?: NodeLiveLogs;
  runtimeConfig: RuntimeConfig | null;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  const inputPorts = inputPortsFromRun(nodeRun);
  const transferRows = transferRowsFromRun(nodeRun);
  const outputSummary = outputSummaryFromRun(nodeRun);
  const latestLog = latestLogExcerpt(liveLogs, nodeRun);
  const logPath = nodeRun?.stderr_log || nodeRun?.stdout_log;

  if (!nodeRun) {
    return (
      <div className="run-evidence-card empty">
        <p className="empty-state">尚未运行；运行后这里会显示真实输入、输出、绑定来源和日志入口。</p>
      </div>
    );
  }

  return (
    <div className="run-evidence-card" aria-label="运行证据">
      <div className="run-evidence-facts" aria-label="运行证据摘要">
        <EvidenceFact label="状态" value={statusLabel(nodeRun.status)} tone={nodeRun.status} />
        <EvidenceFact label="Run mode" value={runtimeLabel(runtimeConfig, nodeRun)} />
        <EvidenceFact label="收到输入端口" value={inputPorts.length ? inputPorts.join(', ') : '未记录'} />
      </div>

      <section className="evidence-flow-summary" aria-label="数据流证据">
        <h5>数据流</h5>
        {transferRows.length > 0 ? (
          <div className="evidence-flow-list">
            {transferRows.map((row) => (
              <article key={row.key} className="evidence-flow-row">
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">没有记录到输入绑定；该节点可能只按控制顺序运行。</p>
        )}
      </section>

      <div className="run-evidence-actions">
        <EvidenceAction
          label="真实输入"
          meta="input.json"
          path={nodeRun.input_path}
          onOpen={() => onReadEvidence(nodeRun.input_path, '真实输入')}
        />
        <EvidenceAction
          label="真实输出"
          meta="output.json"
          path={nodeRun.output_path}
          onOpen={() => onReadEvidence(nodeRun.output_path, '真实输出')}
        />
        <EvidenceAction
          label="运行日志"
          meta={nodeRun.stderr_log ? 'stderr.log' : 'stdout.log'}
          path={logPath}
          onOpen={() => onReadEvidence(logPath, '运行日志')}
        />
      </div>

      <section className="evidence-inline-summary" aria-label="运行证据预览">
        <h5>输出摘要</h5>
        <p>{outputSummary}</p>
        {latestLog ? (
          <>
            <h5>最近日志</h5>
            <pre>{latestLog}</pre>
          </>
        ) : null}
      </section>
    </div>
  );
}

function EvidenceFact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={tone ? `evidence-fact tone-${tone}` : 'evidence-fact'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceAction({
  label,
  meta,
  path,
  onOpen,
}: {
  label: string;
  meta: string;
  path?: string | null;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="path-button evidence-path-button" disabled={!path} onClick={onOpen}>
      <FileText aria-hidden="true" size={16} />
      <span>{label}</span>
      <em>{meta}</em>
      <small>{shortPath(path)}</small>
    </button>
  );
}

type EvidenceFlowRow = {
  key: string;
  label: string;
  detail: string;
};

function inputPortsFromRun(nodeRun?: NodeRunSummary): string[] {
  const inputs = arrayOfStrings(nodeRun?.binding_manifest?.inputs);
  if (inputs.length > 0) {
    return inputs;
  }
  const bindings = bindingRecordsFromRun(nodeRun);
  const ports = bindings
    .map((binding) => stringValue(binding.target_port))
    .filter((port): port is string => Boolean(port));
  return [...new Set(ports)];
}

function transferRowsFromRun(nodeRun?: NodeRunSummary): EvidenceFlowRow[] {
  const bindings = bindingRecordsFromRun(nodeRun);
  return bindings.map((binding, index) => {
    const bindingKind = stringValue(binding.binding_kind) || stringValue(binding.kind) || 'binding';
    const sourceNode = stringValue(binding.source_node) || 'upstream';
    const sourcePort = stringValue(binding.source_port) || 'main';
    const targetPort = stringValue(binding.target_port) || 'main';
    if (bindingKind === 'control_main_default') {
      return {
        key: `${bindingKind}-${sourceNode}-${targetPort}-${index}`,
        label: '控制线 main 传输',
        detail: `${sourceNode}.${sourcePort} -> ${targetPort}`,
      };
    }
    return {
      key: `${bindingKind}-${sourceNode}-${targetPort}-${index}`,
      label: bindingKind,
      detail: `${sourceNode}.${sourcePort} -> ${targetPort}`,
    };
  });
}

function bindingRecordsFromRun(nodeRun?: NodeRunSummary): Array<Record<string, unknown>> {
  const manifestBindings = arrayOfRecords(nodeRun?.binding_manifest?.bindings);
  if (manifestBindings.length > 0) {
    return manifestBindings;
  }
  return arrayOfRecords(nodeRun?.binding_resolved);
}

function outputSummaryFromRun(nodeRun?: NodeRunSummary): string {
  if (!nodeRun) {
    return '尚未运行。';
  }
  const preview = nodeRun.output_preview;
  if (isRecordValue(preview)) {
    const status = stringValue(preview.status);
    const summary = stringValue(preview.summary);
    const outputKeys = isRecordValue(preview.outputs) ? Object.keys(preview.outputs) : [];
    const parts = [
      status ? `status=${status}` : '',
      summary ? `summary=${summary}` : '',
      outputKeys.length ? `outputs=${outputKeys.join(', ')}` : 'outputs=空',
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' / ');
    }
  }
  if (nodeRun.summary) {
    return nodeRun.summary;
  }
  return nodeRun.output_path ? '已产生 output.json，点击“真实输出”查看完整内容。' : '没有记录到 output.json。';
}

function latestLogExcerpt(liveLogs?: NodeLiveLogs, nodeRun?: NodeRunSummary): string {
  const liveText = liveLogs?.stderr || liveLogs?.stdout || '';
  const text = liveText || nodeRun?.log_excerpt || '';
  if (!text.trim()) {
    return '';
  }
  const lines = text.trimEnd().split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - 8)).join('\n');
}

function runtimeLabel(runtimeConfig: RuntimeConfig | null, nodeRun?: NodeRunSummary): string {
  if (runtimeConfig) {
    return runtimeConfig.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or gated';
  }
  if (nodeRun?.execution_mode || nodeRun?.adapter) {
    return [nodeRun.execution_mode, nodeRun.adapter].filter(Boolean).join(' / ');
  }
  return '未记录';
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecordValue) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function NodeEvidencePaths({
  nodeRun,
  liveLogs,
  onReadEvidence,
}: {
  nodeRun?: NodeRunSummary;
  liveLogs?: NodeLiveLogs;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  const runtimeEvidence =
    nodeRun?.runtime ||
    (nodeRun?.execution_mode || nodeRun?.adapter
      ? { execution_mode: nodeRun.execution_mode, adapter: nodeRun.adapter }
      : null);
  const bindingEvidence =
    nodeRun?.binding_resolved?.length || nodeRun?.binding_manifest
      ? {
          binding_resolved: nodeRun?.binding_resolved || [],
          binding_manifest: nodeRun?.binding_manifest || null,
        }
      : null;
  const paths = [
    ['输入', nodeRun?.input_path],
    ['提示词', nodeRun?.prompt_path],
    ['输出', nodeRun?.output_path],
    ['事件', nodeRun?.event_log],
    ['stdout', nodeRun?.stdout_log],
    ['stderr', nodeRun?.stderr_log],
  ] as const;
  return (
    <section className="inspector-stack">
      <LiveLogBlocks liveLogs={liveLogs} />
      {paths.map(([label, pathValue]) => (
        <button
          key={label}
          type="button"
          className="path-button"
          disabled={!pathValue}
          onClick={() => onReadEvidence(pathValue, label)}
        >
          <FileText aria-hidden="true" size={16} />
          <span>{label}</span>
          <small>{shortPath(pathValue)}</small>
        </button>
      ))}
      <dl className="definition-grid compact">
        <dt>artifacts</dt>
        <dd>{nodeRun?.artifact_dir ? shortPath(nodeRun.artifact_dir) : '尚未运行'}</dd>
      </dl>
      {runtimeEvidence ? (
        <CodeBlock
          title="runtime.json"
          content={JSON.stringify(runtimeEvidence, null, 2)}
          variant="json"
        />
      ) : null}
      {bindingEvidence ? (
        <CodeBlock
          title="data-binding-evidence.json"
          content={JSON.stringify(bindingEvidence, null, 2)}
          variant="json"
        />
      ) : null}
    </section>
  );
}

function LiveLogBlocks({ liveLogs }: { liveLogs?: NodeLiveLogs }) {
  if (!liveLogs || (!liveLogs.stdout && !liveLogs.stderr)) {
    return null;
  }
  return (
    <>
      {liveLogs.stdout ? (
        <CodeBlock title="Live stdout" content={liveLogs.stdout} variant="log" />
      ) : null}
      {liveLogs.stderr ? (
        <CodeBlock title="Live stderr" content={liveLogs.stderr} variant="log" />
      ) : null}
    </>
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
            placeholder="F:\\Agent-Callable-Conductor\\WorkFlowTest\\paper1"
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
  onSelectWorkflowFn: (workflowId: string) => void,
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
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  connectionMode: ConnectionMode,
  edgeViewMode: EdgeViewMode,
  onSelectEdge: (address: EdgeAddress) => void,
): CanvasFlowNode[] {
  return canvas.workflows.flatMap((workflow) => {
    if (isExecutableNodeWorkflow(workflow)) {
      return [
        topLevelAgentToolFlowNode(
          workflow,
          selection,
          showDataPorts,
          onSelectWorkflowFn,
          onSelectPortFn,
          onControlHandleMouseDown,
        ),
      ];
    }
    const workflowNode: WorkflowFlowNode = {
      id: workflow.id,
      type: 'workflowContainer',
      position: workflow.position,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      data: {
        workflow,
        binding: bindings[workflow.id],
        selection,
        connectionMode,
        edgeViewMode,
        selected: selection.type === 'workflow' && selection.id === workflow.id,
        showDataPorts,
        onSelectEdge,
        onSelectPort: onSelectPortFn,
        onSelectInternal: onSelectInternalFn,
        onOpenFocus,
        onConfigureWorkflow,
        onResize,
        onMoveInternal,
        onControlHandleMouseDown,
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
        title: internalInvocationLabel(node),
        subtitle: node.callableId || node.runtime,
        scopeLabel: `Inside: ${workflowInvocationLabel(workflow)}`,
        kind: node.kind,
        status: node.status,
        callableId: node.callableId || node.runtime,
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
        onSelectPort: onSelectPortFn,
        onControlHandleMouseDown,
      },
    }));
    return [workflowNode, ...internalNodes];
  });
}

function topLevelAgentToolFlowNode(
  workflow: WorkflowContainerModel,
  selection: CanvasSelection,
  showDataPorts: boolean,
  onSelectWorkflowFn: (workflowId: string) => void,
  onSelectPortFn: (workflowId: string, port: WorkflowPortView) => void,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
): AgentToolFlowNode {
  const kind = workflow.sourceKind === 'tool' ? 'Tool' : 'Agent';
  return {
    id: workflow.id,
    type: 'agentToolNode',
    position: workflow.position,
    selected: selection.type === 'workflow' && selection.id === workflow.id,
    data: {
      id: workflow.id,
      title: workflowInvocationLabel(workflow),
      subtitle: workflow.callableId,
      kind,
      status: workflow.status,
      callableId: workflow.callableId,
      inputPorts: workflow.inputPorts,
      outputPorts: workflow.outputPorts,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      showDataPorts,
      onSelect: () => onSelectWorkflowFn(workflow.id),
      onSelectPort: onSelectPortFn,
      onControlHandleMouseDown,
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
  const workflowContainerIds = new Set(
    canvas.workflows
      .filter(isWorkflowShellNode)
      .map((workflow) => workflow.id),
  );
  const edgeScopeWorkflowId =
    canvas.layout === 'workflow-focus' && canvas.focusedWorkflowId ? canvas.focusedWorkflowId : null;
  const rootEdges = uniqueCanvasEdges(canvas.edges).flatMap((edge) =>
    canvasEdgeToFlowEdge(edge, edgeScopeWorkflowId, selection, connectionMode, undefined, edgeViewMode, showDataPorts, workflowContainerIds),
  );
  return uniqueFlowEdgesById(rootEdges);
}

function uniqueFlowEdgesById(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

function uniqueCanvasEdges(edges: WorkflowCanvasEdge[]): WorkflowCanvasEdge[] {
  const unique: WorkflowCanvasEdge[] = [];
  for (const edge of edges) {
    if (unique.some((item) => canvasEdgesAreEquivalent(item, edge))) {
      continue;
    }
    unique.push(edge);
  }
  return unique;
}

function canvasEdgeToFlowEdge(
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  parentWorkflowId?: string,
  edgeViewMode: EdgeViewMode = 'all',
  showDataPorts = false,
  workflowContainerIds: Set<string> = new Set(),
): Edge[] {
    if (edgeViewMode !== 'all' && edge.kind !== edgeViewMode) {
      return [];
    }
    if (isImplicitMainDataEdge(edge)) {
      return [];
    }
    const address = edgeAddressForScope(scopeWorkflowId, edge.id);
    const isSelected = selectionMatchesEdgeAddress(selection, address);
    const shellBoundaryEdge = parentWorkflowId
      ? shellBoundaryFlowEdge(edge, parentWorkflowId, address, isSelected)
      : null;
    if (shellBoundaryEdge) {
      return [shellBoundaryEdge];
    }
    const sourceId = parentWorkflowId
      ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.source.workflowId)
      : edge.source.workflowId;
    const targetId = parentWorkflowId
      ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.target.workflowId)
      : edge.target.workflowId;
    if (edge.kind === 'data') {
      return [{
        id: flowEdgeId(address),
        data: flowEdgeData(address),
        source: sourceId,
        target: targetId,
        sourceHandle: portHandleId(sourceId, 'output', edge.source.portId),
        targetHandle: portHandleId(targetId, 'input', edge.target.portId),
        selected: isSelected,
        markerEnd: { type: MarkerType.ArrowClosed, color: isSelected ? '#fbbf24' : '#f8fafc' },
        className: 'workflow-edge-data',
        style: {
          stroke: isSelected ? '#fbbf24' : '#f8fafc',
          strokeWidth: isSelected ? 4 : 3,
          strokeDasharray: '8 6',
        },
      }];
    }
    return [{
      id: flowEdgeId(address),
      data: flowEdgeData(address),
      source: sourceId,
      target: targetId,
      sourceHandle: controlSourceHandleForFlowNode(sourceId, canvasWorkflowId(sourceId, parentWorkflowId), workflowContainerIds, parentWorkflowId),
      targetHandle: controlTargetHandleForFlowNode(targetId, canvasWorkflowId(targetId, parentWorkflowId), workflowContainerIds, parentWorkflowId),
      selected: isSelected,
      markerEnd: { type: MarkerType.ArrowClosed, color: isSelected ? '#fbbf24' : '#f8fafc' },
      className: 'workflow-edge-control',
      style: {
        stroke: isSelected ? '#fbbf24' : connectionMode === 'control' ? '#f8fafc' : '#94a3b8',
        strokeWidth: isSelected ? 4 : 2.6,
      },
    }];
}

function canvasWorkflowId(flowId: string, parentWorkflowId?: string): string {
  if (!parentWorkflowId) {
    return flowId;
  }
  const internal = parseInternalFlowNodeId(flowId);
  return internal?.nodeId || flowId;
}

function controlSourceHandleForFlowNode(
  flowNodeId: string,
  workflowId: string,
  workflowContainerIds: Set<string>,
  parentWorkflowId?: string,
): string | undefined {
  if (!parentWorkflowId && workflowContainerIds.has(workflowId)) {
    return workflowOutputOuterSourceHandleId(workflowId);
  }
  return controlSourceHandleId(flowNodeId);
}

function controlTargetHandleForFlowNode(
  flowNodeId: string,
  workflowId: string,
  workflowContainerIds: Set<string>,
  parentWorkflowId?: string,
): string | undefined {
  if (!parentWorkflowId && workflowContainerIds.has(workflowId)) {
    return workflowInputOuterTargetHandleId(workflowId);
  }
  return controlTargetHandleId(flowNodeId);
}

function shellBoundaryFlowEdge(
  edge: WorkflowCanvasEdge,
  workflowId: string,
  address: EdgeAddress,
  isSelected: boolean,
): Edge | null {
  if (edge.kind !== 'data') {
    return null;
  }
  const inputBoundaryId = workflowInputBoundaryId(workflowId);
  const outputBoundaryId = workflowOutputBoundaryId(workflowId);
  const sourceIsWorkflowInput = edge.source.workflowId === inputBoundaryId;
  const targetIsWorkflowOutput = edge.target.workflowId === outputBoundaryId;
  if (!sourceIsWorkflowInput && !targetIsWorkflowOutput) {
    return null;
  }
  const sourceId = sourceIsWorkflowInput
    ? workflowId
    : internalEdgeEndpointToFlowId(workflowId, edge.source.workflowId);
  const targetId = targetIsWorkflowOutput
    ? workflowId
    : internalEdgeEndpointToFlowId(workflowId, edge.target.workflowId);
  return {
    id: flowEdgeId(address),
    data: flowEdgeData(address),
    source: sourceId,
    target: targetId,
    sourceHandle: sourceIsWorkflowInput ? workflowInputInnerSourceHandleId(workflowId) : controlSourceHandleId(sourceId),
    targetHandle: targetIsWorkflowOutput ? workflowOutputInnerTargetHandleId(workflowId) : controlTargetHandleId(targetId),
    selected: isSelected,
    markerEnd: { type: MarkerType.ArrowClosed, color: isSelected ? '#fbbf24' : '#f8fafc' },
    className: 'workflow-edge-control workflow-edge-boundary-main',
    style: {
      stroke: isSelected ? '#fbbf24' : '#f8fafc',
      strokeWidth: isSelected ? 4 : 2.8,
    },
  };
}

function isImplicitMainDataEdge(edge: WorkflowCanvasEdge): boolean {
  return (
    edge.kind === 'data' &&
    !isWorkflowBoundaryEdge(edge) &&
    (edge.source.portId || 'main') === 'main' &&
    (edge.target.portId || 'main') === 'main'
  );
}

function resolveScopedConnection(
  canvas: WorkspaceCanvasModel,
  connection: Connection,
  connectionMode: ConnectionMode,
): ConnectionResolution {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return { accepted: false, reason: '连接两端必须是不同节点' };
  }
  if (connectionMode === 'data') {
    return resolveDataConnection(canvas, connection);
  }
  return resolveControlConnection(canvas, connection);
}

function recordConnectionTrace(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  const entry = { event, detail, timestamp: Date.now() };
  try {
    const diagnosticsWindow = window as Window & {
      __ACC_CONNECTION_TRACE__?: ConnectionTraceEvent[];
    };
    const trace = diagnosticsWindow.__ACC_CONNECTION_TRACE__ || [];
    trace.push(entry);
    diagnosticsWindow.__ACC_CONNECTION_TRACE__ = trace.slice(-80);
  } catch {
    // Some browser automation sandboxes expose a non-extensible window proxy.
  }
  if (window.localStorage?.getItem('acc.connection.trace') === '1') {
    console.info('[acc-connection]', event, detail);
  }
}

function scopedEdgeFromConnection(
  canvas: WorkspaceCanvasModel,
  connection: Connection,
  connectionMode: ConnectionMode,
): ScopedEdgeResult | null {
  const resolved = resolveScopedConnection(canvas, connection, connectionMode);
  if (!resolved.accepted) {
    return null;
  }
  return resolved;
}

function scopedControlEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  handles: ConnectionHandles = { sourceHandle: null, targetHandle: null },
): ScopedEdgeResult | null {
  const boundaryDataEdge = scopedBoundaryDataEdge(canvas, source, target, 'main', 'main', handles);
  if (boundaryDataEdge) {
    return boundaryDataEdge;
  }
  if (source.internal && target.internal && source.workflowId === target.workflowId) {
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'internal_control',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (
    !source.internal &&
    target.internal &&
    target.workflowId &&
    source.nodeId === target.workflowId &&
    isWorkflowInputInnerSourceHandle(target.workflowId, handles.sourceHandle)
  ) {
    const boundaryId = workflowInputBoundaryId(target.workflowId);
    return {
      scopeWorkflowId: target.workflowId,
      semantic: 'workflow_input_main_binding',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.workflowId, 'control', boundaryId, target.nodeId),
        boundaryId,
        target.nodeId,
      ),
    };
  }
  if (
    source.internal &&
    source.workflowId &&
    !target.internal &&
    target.nodeId === source.workflowId &&
    isWorkflowOutputInnerTargetHandle(source.workflowId, handles.targetHandle)
  ) {
    const boundaryId = workflowOutputBoundaryId(source.workflowId);
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'workflow_output_main_binding',
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
      semantic: 'root_control_main',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  return null;
}

function resolveControlConnection(canvas: WorkspaceCanvasModel, connection: Connection): ConnectionResolution {
  const source = describeEndpoint(canvas, connection.source || '', connection.sourceHandle, 'source', 'control');
  const target = describeEndpoint(canvas, connection.target || '', connection.targetHandle, 'target', 'control');
  if (!source || !target) {
    return { accepted: false, reason: '无法识别这条控制线的端口方向' };
  }
  const transition = controlTransitionForEndpoints(canvas, source, target);
  if (!transition || !transition.accepted) {
    return { accepted: false, reason: controlConnectionRejectionReason(source, target) };
  }
  if (transition.edge.kind === 'control' && wouldCreateControlCycle(canvas, transition.scopeWorkflowId, transition.edge)) {
    return { accepted: false, reason: '这条控制线会形成循环' };
  }
  return transition;
}

function resolveDataConnection(canvas: WorkspaceCanvasModel, connection: Connection): ConnectionResolution {
  const source = describeEndpoint(canvas, connection.source || '', connection.sourceHandle, 'source', 'data');
  const target = describeEndpoint(canvas, connection.target || '', connection.targetHandle, 'target', 'data');
  if (!source || !target || !endpointCanSource(source) || !endpointCanTarget(target)) {
    return { accepted: false, reason: 'Data Edge 必须从 output port 连接到 input port' };
  }
  const sourceWorkflow = flowEndpointForCanvas(canvas, connection.source || '');
  const targetWorkflow = flowEndpointForCanvas(canvas, connection.target || '');
  const dataEdge = scopedDataEdge(canvas, sourceWorkflow, targetWorkflow, source.portId, target.portId, {
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
  });
  if (!dataEdge) {
    return { accepted: false, reason: 'Data Edge 必须连接同一层级内的节点' };
  }
  return {
    accepted: true,
    edge: dataEdge.edge,
    scopeWorkflowId: dataEdge.scopeWorkflowId,
    semantic: dataEdge.semantic,
  };
}

function controlConnectionRejectionReason(source: EndpointDescriptor, target: EndpointDescriptor): string {
  if (
    source.role === 'workflow_inner_input' ||
    source.role === 'workflow_inner_output' ||
    target.role === 'workflow_inner_input' ||
    target.role === 'workflow_inner_output'
  ) {
    return 'Workflow 内侧端口只能连接本 Workflow 内部节点';
  }
  if (
    source.role === 'workflow_outer_input' ||
    source.role === 'workflow_outer_output' ||
    target.role === 'workflow_outer_input' ||
    target.role === 'workflow_outer_output'
  ) {
    return 'Workflow 外侧端口只能连接父级画布节点';
  }
  return '控制线只能从输出端口连接到输入端口';
}

function connectionFromPendingEndpoint(
  pending: PendingCanvasConnection,
  target: DomConnectionEndpoint | null,
): Connection | null {
  if (!target || (pending.nodeId === target.nodeId && pending.handleId === target.handleId)) {
    return null;
  }
  const pendingCanSource = pending.endpoint ? endpointCanSource(pending.endpoint) : pending.side === 'source';
  const pendingCanTarget = pending.endpoint ? endpointCanTarget(pending.endpoint) : pending.side === 'target';
  if (pendingCanSource && target.side === 'target') {
    return {
      source: pending.nodeId,
      sourceHandle: pending.handleId,
      target: target.nodeId,
      targetHandle: target.handleId,
    };
  }
  if (pendingCanTarget && target.side === 'source') {
    return {
      source: target.nodeId,
      sourceHandle: target.handleId,
      target: pending.nodeId,
      targetHandle: pending.handleId,
    };
  }
  return null;
}

function connectionCandidatesFromPendingEndpoint(
  pending: PendingCanvasConnection | null,
  connection: Connection,
): Connection[] {
  if (!pending?.endpoint) {
    return [];
  }
  const candidates: Connection[] = [];
  const seen = new Set<string>();
  const addCandidate = (endpoint: DomConnectionEndpoint | null) => {
    const candidate = connectionFromPendingEndpoint(pending, endpoint);
    if (!candidate) {
      return;
    }
    const key = [
      candidate.source,
      candidate.sourceHandle || '',
      candidate.target,
      candidate.targetHandle || '',
    ].join('/');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };
  const endpoints: Array<{ nodeId?: string | null; handleId?: string | null }> = [
    { nodeId: connection.source, handleId: connection.sourceHandle },
    { nodeId: connection.target, handleId: connection.targetHandle },
  ];
  for (const endpoint of endpoints) {
    if (!endpoint.nodeId || (endpoint.nodeId === pending.nodeId && (endpoint.handleId || null) === pending.handleId)) {
      continue;
    }
    addCandidate({ nodeId: endpoint.nodeId, handleId: endpoint.handleId || null, side: 'target' });
    addCandidate({ nodeId: endpoint.nodeId, handleId: endpoint.handleId || null, side: 'source' });
  }
  return candidates;
}

function reverseConnection(connection: Connection): Connection | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }
  return {
    source: connection.target,
    sourceHandle: connection.targetHandle || null,
    target: connection.source,
    targetHandle: connection.sourceHandle || null,
  };
}

function domConnectionEndpointAtPoint(
  point: { x: number; y: number },
  mode: ConnectionMode,
): DomConnectionEndpoint | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter(Boolean) as Element[];
  for (const element of stack) {
    const endpoint = domConnectionEndpointFromElement(element, mode);
    if (endpoint) {
      return endpoint;
    }
  }
  const direct = domConnectionEndpointFromElement(document.elementFromPoint(point.x, point.y), mode);
  if (direct) {
    return direct;
  }
  const handles = Array.from(document.querySelectorAll<HTMLElement>(connectionHandleSelector(mode)));
  let best: { endpoint: DomConnectionEndpoint; distance: number } | null = null;
  for (const handle of handles) {
    const endpoint = domConnectionEndpointFromElement(handle, mode);
    if (!endpoint) {
      continue;
    }
    const rect = handle.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    const insideExpandedRect =
      point.x >= rect.left - 12 &&
      point.x <= rect.right + 12 &&
      point.y >= rect.top - 12 &&
      point.y <= rect.bottom + 12;
    if (!insideExpandedRect && distance > 18) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { endpoint, distance };
    }
  }
  return best?.endpoint || null;
}

function domConnectionEndpointFromElement(
  element: Element | null,
  mode?: ConnectionMode,
): DomConnectionEndpoint | null {
  const handle = closestConnectionHandle(element);
  if (!(handle instanceof HTMLElement)) {
    return null;
  }
  if (mode && !isConnectionHandleForMode(handle, mode)) {
    return null;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  if (!nodeId) {
    return null;
  }
  const side = connectionSideFromHandleElement(handle);
  if (!side) {
    return null;
  }
  return {
    nodeId,
    handleId: handle.getAttribute('data-handleid'),
    side,
  };
}

function connectionHandleElementForEndpoint(endpoint: DomConnectionEndpoint): HTMLElement | null {
  return endpoint.handleId ? elementByDataHandleId(endpoint.handleId, endpoint.nodeId) : null;
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

function connectionModeForHandleElement(handle: HTMLElement): ConnectionMode | null {
  if (
    handle.classList.contains('acc-connect-hitbox') ||
    handle.classList.contains('workflow-control-handle') ||
    handle.classList.contains('agent-control-handle')
  ) {
    return 'control';
  }
  if (handle.classList.contains('workflow-port-handle')) {
    return 'data';
  }
  return null;
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

function controlTransitionForEndpoints(
  canvas: WorkspaceCanvasModel,
  source: EndpointDescriptor,
  target: EndpointDescriptor,
): ConnectionResolution | null {
  if (source.nodeId === target.nodeId && source.workflowId === target.workflowId) {
    return null;
  }
  if (
    (source.role === 'root_executable_output' || source.role === 'workflow_outer_output') &&
    (target.role === 'root_executable_input' || target.role === 'workflow_outer_input')
  ) {
    const semantic: ScopedEdgeSemantic =
      source.role === 'workflow_outer_output' && target.role === 'workflow_outer_input'
        ? 'root_workflow_to_workflow_control'
        : source.role === 'workflow_outer_output'
          ? 'root_control_main_from_workflow'
          : target.role === 'workflow_outer_input'
            ? 'root_control_main_to_workflow'
            : 'root_control_main';
    return {
      accepted: true,
      scopeWorkflowId: null,
      semantic,
      sourceHandle: source.role === 'workflow_outer_output' ? workflowOutputOuterSourceHandleId(source.nodeId) : undefined,
      targetHandle: target.role === 'workflow_outer_input' ? workflowInputOuterTargetHandleId(target.nodeId) : undefined,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (
    source.role === 'workflow_inner_input' &&
    target.role === 'internal_executable_input' &&
    source.nodeId === target.workflowId
  ) {
    const boundaryId = workflowInputBoundaryId(source.nodeId);
    return {
      accepted: true,
      scopeWorkflowId: source.nodeId,
      semantic: 'workflow_input_main_binding',
      sourceHandle: workflowInputInnerSourceHandleId(source.nodeId),
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.nodeId, 'data', boundaryId, target.nodeId),
        boundaryId,
        source.portId,
        target.nodeId,
        target.portId,
      ),
    };
  }
  if (
    source.role === 'internal_executable_output' &&
    target.role === 'workflow_inner_output' &&
    source.workflowId === target.nodeId
  ) {
    const boundaryId = workflowOutputBoundaryId(target.nodeId);
    return {
      accepted: true,
      scopeWorkflowId: target.nodeId,
      semantic: 'workflow_output_main_binding',
      targetHandle: workflowOutputInnerTargetHandleId(target.nodeId),
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.nodeId, 'data', source.nodeId, boundaryId),
        source.nodeId,
        source.portId,
        boundaryId,
        target.portId,
      ),
    };
  }
  if (
    source.role === 'internal_executable_output' &&
    target.role === 'internal_executable_input' &&
    source.workflowId === target.workflowId &&
    source.workflowId
  ) {
    return {
      accepted: true,
      scopeWorkflowId: source.workflowId,
      semantic: 'internal_control',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (source.role === 'focus_boundary_input_output' && target.role === 'internal_executable_input') {
    const workflowId = source.workflowId;
    if (!workflowId || workflowId !== target.workflowId) {
      return null;
    }
    const boundaryId = workflowInputBoundaryId(workflowId);
    return {
      accepted: true,
      scopeWorkflowId: workflowId,
      semantic: 'workflow_input_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, workflowId, 'data', boundaryId, target.nodeId),
        boundaryId,
        source.portId,
        target.nodeId,
        target.portId,
      ),
    };
  }
  if (source.role === 'internal_executable_output' && target.role === 'focus_boundary_output_input') {
    const workflowId = target.workflowId;
    if (!workflowId || workflowId !== source.workflowId) {
      return null;
    }
    const boundaryId = workflowOutputBoundaryId(workflowId);
    return {
      accepted: true,
      scopeWorkflowId: workflowId,
      semantic: 'workflow_output_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, workflowId, 'data', source.nodeId, boundaryId),
        source.nodeId,
        source.portId,
        boundaryId,
        target.portId,
      ),
    };
  }
  return null;
}

function describeEndpoint(
  canvas: WorkspaceCanvasModel,
  flowNodeId: string,
  handleId: string | null | undefined,
  side: EndpointSide,
  mode: ConnectionMode,
): EndpointDescriptor | null {
  const view = canvas.layout === 'workflow-focus' ? 'workflow-focus' : 'root-shell';
  const endpointSide = controlHandleSide(flowNodeId, handleId) || side;
  const portHandle = parsePortHandle(handleId);
  const portId = portHandle?.portId || 'main';
  const internal = parseInternalFlowNodeId(flowNodeId);
  if (internal) {
    return {
      view,
      role: endpointSide === 'source' ? 'internal_executable_output' : 'internal_executable_input',
      nodeId: internal.nodeId,
      workflowId: internal.workflowId,
      portId,
      handleId: handleId || null,
    };
  }
  const boundaryKind = workflowBoundaryKind(flowNodeId);
  if (view === 'workflow-focus' && boundaryKind) {
    const workflowId = workflowIdFromBoundaryId(flowNodeId);
    if (!workflowId) {
      return null;
    }
    if (boundaryKind === 'workflow_input' && endpointSide === 'source') {
      return { view, role: 'focus_boundary_input_output', nodeId: flowNodeId, workflowId, portId, handleId: handleId || null };
    }
    if (boundaryKind === 'workflow_output' && endpointSide === 'target') {
      return { view, role: 'focus_boundary_output_input', nodeId: flowNodeId, workflowId, portId, handleId: handleId || null };
    }
    return null;
  }
  if (view === 'workflow-focus') {
    const focusedWorkflowId = canvas.focusedWorkflowId;
    const focusedNode = canvas.workflows.find((workflow) => workflow.id === flowNodeId && !workflow.boundaryKind);
    if (focusedWorkflowId && focusedNode) {
      return {
        view,
        role: endpointSide === 'source' ? 'internal_executable_output' : 'internal_executable_input',
        nodeId: flowNodeId,
        workflowId: focusedWorkflowId,
        portId,
        handleId: handleId || null,
      };
    }
  }
  const workflow = canvas.workflows.find((item) => item.id === flowNodeId);
  if (!workflow || workflow.boundaryKind) {
    return null;
  }
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return {
      view,
      role: endpointSide === 'source' ? 'root_executable_output' : 'root_executable_input',
      nodeId: flowNodeId,
      workflowId: null,
      portId,
      handleId: handleId || null,
    };
  }
  if (endpointSide === 'source') {
    if (handleId === workflowOutputOuterSourceHandleId(flowNodeId)) {
      return { view, role: 'workflow_outer_output', nodeId: flowNodeId, workflowId: null, portId, handleId };
    }
    if (isWorkflowInputInnerSourceHandle(flowNodeId, handleId)) {
      return { view, role: 'workflow_inner_input', nodeId: flowNodeId, workflowId: flowNodeId, portId, handleId: handleId || null };
    }
    return mode === 'data' && portHandle?.direction === 'output'
      ? { view, role: 'root_executable_output', nodeId: flowNodeId, workflowId: null, portId, handleId: handleId || null }
      : null;
  }
  if (handleId === workflowInputOuterTargetHandleId(flowNodeId)) {
    return { view, role: 'workflow_outer_input', nodeId: flowNodeId, workflowId: null, portId, handleId };
  }
  if (isWorkflowOutputInnerTargetHandle(flowNodeId, handleId)) {
    return { view, role: 'workflow_inner_output', nodeId: flowNodeId, workflowId: flowNodeId, portId, handleId: handleId || null };
  }
  return mode === 'data' && portHandle?.direction === 'input'
    ? { view, role: 'root_executable_input', nodeId: flowNodeId, workflowId: null, portId, handleId: handleId || null }
    : null;
}

function endpointCanSource(endpoint: EndpointDescriptor): boolean {
  return endpoint.role.endsWith('_output') || endpoint.role === 'workflow_inner_input';
}

function endpointCanTarget(endpoint: EndpointDescriptor): boolean {
  return endpoint.role.endsWith('_input') || endpoint.role === 'workflow_inner_output';
}

function wouldCreateControlCycle(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: Extract<WorkflowCanvasEdge, { kind: 'control' }>,
): boolean {
  const edges = dataConnectEdges(canvas, scopeWorkflowId).filter(
    (candidate): candidate is Extract<WorkflowCanvasEdge, { kind: 'control' }> => candidate.kind === 'control',
  );
  const adjacency = new Map<string, string[]>();
  for (const candidate of edges) {
    const list = adjacency.get(candidate.source.workflowId) || [];
    list.push(candidate.target.workflowId);
    adjacency.set(candidate.source.workflowId, list);
  }
  const stack = [edge.target.workflowId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    if (nodeId === edge.source.workflowId) {
      return true;
    }
    visited.add(nodeId);
    stack.push(...(adjacency.get(nodeId) || []));
  }
  return false;
}

function scopedDataEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  sourcePortId: string,
  targetPortId: string,
  handles: ConnectionHandles = { sourceHandle: null, targetHandle: null },
): ScopedEdgeResult | null {
  const boundaryDataEdge = scopedBoundaryDataEdge(
    canvas,
    source,
    target,
    sourcePortId,
    targetPortId,
    handles,
  );
  if (boundaryDataEdge) {
    return boundaryDataEdge;
  }
  if (source.internal && target.internal && source.workflowId === target.workflowId) {
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'internal_data',
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
      semantic: 'root_data',
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

function scopedBoundaryDataEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  sourcePortId: string,
  targetPortId: string,
  handles: ConnectionHandles = { sourceHandle: null, targetHandle: null },
): ScopedEdgeResult | null {
  const sourceBoundary = workflowBoundaryKind(source.nodeId);
  const targetBoundary = workflowBoundaryKind(target.nodeId);
  if (sourceBoundary === 'workflow_input' && target.internal) {
    const scopeWorkflowId = workflowIdFromBoundaryId(source.nodeId);
    if (!scopeWorkflowId || target.workflowId !== scopeWorkflowId) {
      return null;
    }
    return {
      scopeWorkflowId,
      semantic: 'workflow_input_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, scopeWorkflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (source.internal && targetBoundary === 'workflow_output') {
    const scopeWorkflowId = workflowIdFromBoundaryId(target.nodeId);
    if (!scopeWorkflowId || source.workflowId !== scopeWorkflowId) {
      return null;
    }
    return {
      scopeWorkflowId,
      semantic: 'workflow_output_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, scopeWorkflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (
    !source.internal &&
    target.internal &&
    source.nodeId === target.workflowId &&
    target.workflowId &&
    isWorkflowInputInnerSourceHandle(target.workflowId, handles.sourceHandle)
  ) {
    const boundaryId = workflowInputBoundaryId(target.workflowId);
    return {
      scopeWorkflowId: target.workflowId,
      semantic: 'workflow_input_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.workflowId, 'data', boundaryId, target.nodeId),
        boundaryId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (
    source.internal &&
    !target.internal &&
    target.nodeId === source.workflowId &&
    source.workflowId &&
    isWorkflowOutputInnerTargetHandle(source.workflowId, handles.targetHandle)
  ) {
    const boundaryId = workflowOutputBoundaryId(source.workflowId);
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'workflow_output_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'data', source.nodeId, boundaryId),
        source.nodeId,
        sourcePortId,
        boundaryId,
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
    graph.nodes.every((node) => node.callable_ref.kind !== 'workflow_function');
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
  const nodeMetadata = (node.metadata || {}) as Record<string, unknown>;
  const uiLabel =
    typeof nodeMetadata.ui_label === 'string' && nodeMetadata.ui_label.trim()
      ? nodeMetadata.ui_label
      : node.label || node.id;
  const explicitWorkflowContainer = metadata.semantic_kind === 'workflow_container';
  const callableId = node.callable_ref.id;
  const callableKind = node.callable_ref.kind;
  const sourceKind =
    callableKind === 'workflow_function'
      ? 'workflow'
      : callableKind === 'tool_class'
        ? 'tool'
        : 'agent_session';
  const internalNodes =
    Array.isArray(metadata.internal_nodes)
      ? (metadata.internal_nodes as InternalNodeView[])
      : explicitWorkflowContainer || callableKind === 'workflow_function'
        ? []
        : [
            {
              id: `${node.id}_session`,
              name: uiLabel,
              invocationLabel: uiLabel,
              task: callableId || 'Callable Session',
              kind: callableKind === 'tool_class' ? ('Tool' as const) : ('Agent' as const),
              status: (nodeStatus.get(node.id) as WorkflowStatus) || 'not_run',
              callableId,
              runtime: callableId,
            },
          ];
  return {
    id: node.id,
    title: uiLabel,
    invocationLabel: uiLabel,
    sourceKind: explicitWorkflowContainer ? 'workflow' : sourceKind,
    workflowBodyKind:
      callableKind === 'workflow_function'
        ? explicitWorkflowContainer
          ? 'inline_container'
          : 'external_ref'
        : undefined,
    callableId,
    sourceInput: node.input,
    sourceInputMapping: node.input_mapping,
    control: node.control,
    outputSchema: outputSchemaFromGraphNode(node),
    forwardMainOutputOnControl: forwardMainOutputFromGraphNode(node),
    workflowRef: callableKind === 'workflow_function' ? callableId : node.workflow_ref,
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
      context: 'none',
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
  const metadata = omitEmptyRecord(
    omitKeys(
      {
        canonical_format: 'accflow',
        ...(graph.metadata || {}),
      },
      ['binding_ref'],
    ),
  );
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
  const callableId = node.callableId || 'fake-agent.generic';
  return {
    id: node.id,
    callable_ref: {
      kind: node.kind === 'Tool' ? 'tool_class' : 'agent_class',
      id: callableId,
    },
    kind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    label: internalInvocationLabel(node),
    input: internalNodeInput(node),
    input_mapping: {},
    cwd_policy: 'inherit_environment',
    input_ports: (node.inputPorts || [port('main', 'input', 'input')]).map(portViewToGraphPort),
    output_ports: (node.outputPorts || [port('main', 'output', 'output')]).map(portViewToGraphPort),
    ...(nodeControlPayload(node.forwardMainOutputOnControl, node.control)
      ? { control: nodeControlPayload(node.forwardMainOutputOnControl, node.control) }
      : {}),
    ...(node.outputSchema ? { output_schema: node.outputSchema } : {}),
    position: node.position,
    metadata: { ui_label: internalInvocationLabel(node) },
  };
}

function internalNodeInput(node: InternalNodeView): Record<string, unknown> {
  if (node.input && Object.keys(node.input).length > 0) {
    return node.callableId === 'file-source.local'
      ? { path: String(node.input.path || '') }
      : node.input;
  }
  if (node.callableId === 'file-source.local') {
    return { path: '' };
  }
  return { user_prompt: node.task || internalInvocationLabel(node) };
}

function workflowInvocationPreview(workflow: WorkflowContainerModel): Record<string, unknown> {
  const input = workflow.sourceInput || {};
  const userPrompt = promptFromInvocationInput(input);
  return {
    prompt_policy: userPrompt ? { user_prompt: userPrompt } : {},
    overrides: { static_input: staticInputFromInvocationInput(input) },
    input_bindings: workflow.sourceInputMapping || {},
    workflow_call_input_bindings: workflow.sourceKind === 'workflow' ? [] : undefined,
    workflow_call_output_bindings: workflow.sourceKind === 'workflow' ? [] : undefined,
  };
}

function internalNodeInvocationPreview(node: InternalNodeView): Record<string, unknown> {
  const input = node.input || {};
  const userPrompt = promptFromInvocationInput(input) || node.task || '';
  return {
    prompt_policy: userPrompt ? { user_prompt: userPrompt } : {},
    overrides: { static_input: staticInputFromInvocationInput(input) },
    input_bindings: {},
  };
}

function workflowToGraphNode(workflow: WorkflowContainerModel): WorkflowGraphNode {
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    const callableId =
      workflow.callableId || workflow.internalNodes[0]?.callableId || 'fake-agent.generic';
    const callableKind = workflow.sourceKind === 'tool' ? 'tool_class' : 'agent_class';
    return {
      id: workflow.id,
      callable_ref: {
        kind: callableKind,
        id: callableId,
      },
      kind: workflow.sourceKind,
      label: workflowInvocationLabel(workflow),
      input: workflow.sourceInput || (workflow.internalNodes[0] ? internalNodeInput(workflow.internalNodes[0]) : {}),
      input_mapping: workflow.sourceInputMapping || {},
      cwd_policy: workflow.relativeCwd ? 'relative_subdir' : 'inherit_environment',
      relative_cwd: workflow.relativeCwd,
      input_ports: workflow.inputPorts.map(portViewToGraphPort),
      output_ports: workflow.outputPorts.map(portViewToGraphPort),
      ...(nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control)
        ? { control: nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control) }
        : {}),
      ...(workflow.outputSchema ? { output_schema: workflow.outputSchema } : {}),
      position: workflow.position,
      metadata: { ui_label: workflowInvocationLabel(workflow) },
    };
  }
  if (!isInlineWorkflowContainer(workflow)) {
    const workflowRef = workflow.workflowRef || workflow.callableId || workflow.id;
    return {
      id: workflow.id,
      callable_ref: {
        kind: 'workflow_function',
        id: workflowRef,
      },
      kind: 'workflow',
      workflow_ref: workflowRef,
      label: workflowInvocationLabel(workflow),
      input: workflow.sourceInput || {},
      input_mapping: workflow.sourceInputMapping || {},
      cwd_policy: workflow.relativeCwd ? 'relative_subdir' : 'inherit_environment',
      relative_cwd: workflow.relativeCwd,
      input_ports: workflow.inputPorts.map(portViewToGraphPort),
      output_ports: workflow.outputPorts.map(portViewToGraphPort),
      ...(nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control)
        ? { control: nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control) }
        : {}),
      ...(workflow.outputSchema ? { output_schema: workflow.outputSchema } : {}),
      position: workflow.position,
      metadata: { ui_label: workflowInvocationLabel(workflow) },
    };
  }
  return {
    id: workflow.id,
    callable_ref: {
      kind: 'workflow_function',
      id: workflow.id,
    },
    kind: 'workflow',
    label: workflowInvocationLabel(workflow),
    input: { topic: `${workflow.title} workflow container` },
    input_mapping: {},
    cwd_policy: workflow.relativeCwd ? 'relative_subdir' : 'inherit_environment',
    relative_cwd: workflow.relativeCwd,
    input_ports: workflow.inputPorts.map(portViewToGraphPort),
    output_ports: workflow.outputPorts.map(portViewToGraphPort),
    ...(nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control)
      ? { control: nodeControlPayload(workflow.forwardMainOutputOnControl, workflow.control) }
      : {}),
    ...(workflow.outputSchema ? { output_schema: workflow.outputSchema } : {}),
    position: workflow.position,
    metadata: { ui_label: workflowInvocationLabel(workflow) },
    ui: {
      semantic_kind: 'workflow_container',
      binding_ref: workflow.bindingPath || `bindings/${workflow.id}.binding.local.json`,
      internal_nodes: workflow.internalNodes,
      internal_edges: workflow.internalEdges.map(canvasEdgeToGraphMetadataEdge),
    },
  };
}

function createEmptyTask(taskId: string, title: string): WorkbenchTask {
  const canvas = emptyWorkspaceCanvas(taskId, title);
  return {
    taskId,
    title,
    canvas,
    status: 'not_run',
  };
}

function emptyWorkspaceCanvas(taskId = DEFAULT_TASK_ID, title = '任务 1'): WorkspaceCanvasModel {
  return {
    ...workspaceDemoCanvas(),
    id: taskId,
    name: title,
    rootWorkflowId: taskId,
    workflows: [],
    edges: [],
  };
}

function nextTaskTitle(tasks: WorkbenchTask[]): string {
  const used = new Set(tasks.map((task) => task.title));
  let index = tasks.length + 1;
  let title = `任务 ${index}`;
  while (used.has(title)) {
    index += 1;
    title = `任务 ${index}`;
  }
  return title;
}

function loadTaskStore(): WorkbenchTaskStorePayload {
  const fallbackTask = createEmptyTask(DEFAULT_TASK_ID, '任务 1');
  if (typeof window === 'undefined') {
    return { version: 1, activeTaskId: fallbackTask.taskId, tasks: [fallbackTask] };
  }
  const stored = window.localStorage.getItem(TASK_STORE_KEY);
  if (!stored) {
    return { version: 1, activeTaskId: fallbackTask.taskId, tasks: [fallbackTask] };
  }
  try {
    const payload = JSON.parse(stored) as Partial<WorkbenchTaskStorePayload>;
    const tasks = Array.isArray(payload.tasks)
      ? payload.tasks.filter(isStoredWorkbenchTask).map(migrateStoredWorkbenchTask)
      : [];
    if (!tasks.length) {
      return { version: 1, activeTaskId: fallbackTask.taskId, tasks: [fallbackTask] };
    }
    const activeTaskId =
      typeof payload.activeTaskId === 'string' &&
      tasks.some((task) => task.taskId === payload.activeTaskId)
        ? payload.activeTaskId
        : tasks[0].taskId;
    return { version: 1, activeTaskId, tasks };
  } catch {
    return { version: 1, activeTaskId: fallbackTask.taskId, tasks: [fallbackTask] };
  }
}

function saveTaskStore(payload: WorkbenchTaskStorePayload): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TASK_STORE_KEY, JSON.stringify(payload));
}

function isStoredWorkbenchTask(value: unknown): value is WorkbenchTask {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.taskId === 'string' &&
    typeof value.title === 'string' &&
    isRecord(value.canvas) &&
    typeof value.canvas.id === 'string' &&
    Array.isArray(value.canvas.workflows) &&
    Array.isArray(value.canvas.edges) &&
    ['not_run', 'queued', 'running', 'success', 'failed', 'cancel_requested', 'cancelled', 'crashed'].includes(
      String(value.status),
    )
  );
}

function migrateStoredWorkbenchTask(task: WorkbenchTask): WorkbenchTask {
  if (task.latestRunId || !task.activeRunId) {
    return task;
  }
  return { ...task, latestRunId: task.activeRunId };
}

function workflowRunFromRunSummary(summary: RunSummary, graph: WorkflowGraph): WorkflowRunResult {
  return {
    workflow_id: summary.workflow_id || graph.id,
    status: summary.status,
    run_dir: summary.run_dir,
    started_at: summary.started_at || undefined,
    ended_at: summary.ended_at || undefined,
    nodes: summary.nodes,
    edges: graph.edges,
    errors: [],
  };
}

function mergeWorkflowRunWithEvents(
  summaryRun: WorkflowRunResult,
  eventRun: WorkflowRunResult,
): WorkflowRunResult {
  const nodesByKey = new Map<string, NodeRunSummary>();
  summaryRun.nodes.forEach((node) => {
    nodesByKey.set(nodeRunProjectionKey(node), node);
  });
  eventRun.nodes.forEach((eventNode) => {
    const key = nodeRunProjectionKey(eventNode);
    const summaryNode = nodesByKey.get(key);
    nodesByKey.set(key, summaryNode
      ? {
          ...eventNode,
          ...summaryNode,
          status: eventNode.status || summaryNode.status,
          ui_node_id: summaryNode.ui_node_id || eventNode.ui_node_id,
          parent_node_id: summaryNode.parent_node_id || eventNode.parent_node_id,
        }
      : eventNode);
  });
  return {
    ...summaryRun,
    status: eventRun.status !== 'not_run' ? eventRun.status : summaryRun.status,
    nodes: Array.from(nodesByKey.values()),
  };
}

function nodeRunProjectionKey(node: NodeRunSummary): string {
  if (node.ui_node_id) {
    return node.ui_node_id;
  }
  if (node.parent_node_id) {
    return internalFlowNodeId(node.parent_node_id, node.node_id);
  }
  return node.node_id;
}

function taskStatusFromRunStatus(status: string): WorkbenchTask['status'] {
  if (status === 'queued') {
    return 'queued';
  }
  if (status === 'success') {
    return 'success';
  }
  if (status === 'running' || status === 'scheduled') {
    return 'running';
  }
  if (status === 'cancel_requested') {
    return 'cancel_requested';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (status === 'crashed') {
    return 'crashed';
  }
  if (status === 'not_run') {
    return 'not_run';
  }
  return 'failed';
}

function normalizeTaskRunStatus(status: string): WorkflowStatus {
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'scheduled' ||
    status === 'success' ||
    status === 'failed' ||
    status === 'cancel_requested' ||
    status === 'cancelled' ||
    status === 'crashed' ||
    status === 'not_run' ||
    status === 'schema_error' ||
    status === 'artifact_error' ||
    status === 'manual_review'
  ) {
    return status;
  }
  return status ? 'failed' : 'not_run';
}

function isActiveRunStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'scheduled' || status === 'cancel_requested';
}

function isActiveTaskStatus(status: WorkbenchTask['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'cancel_requested';
}

function isActiveCanvasObjectStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'scheduled' || status === 'cancel_requested';
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
        directory: 'workflows/research',
        status: 'not_run',
        inputPorts: [
          port('in_requirements', '需求文档', 'input'),
          port('in_constraints', '约束条件', 'input'),
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
        directory: 'workflows/paper_digest',
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
        directory: 'workflows/implementation',
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
        directory: 'workflows/review',
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
        directory: '',
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
      callable_ref: {
        kind: 'agent_class',
        id: findCallableId(task.command) || 'fake-agent.generic',
      },
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
    callableId: node.callableId || node.runtime,
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
    focusedWorkflowId,
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

function workflowPortsFromPortContracts(
  ports: Record<string, unknown> | undefined,
  direction: PortDirection,
): WorkflowPortView[] {
  if (!ports || Object.keys(ports).length === 0) {
    return direction === 'input' ? [port('main', '输入', 'input')] : [port('main', '输出', 'output')];
  }
  return Object.entries(ports).map(([id, value]) => {
    const payload = isPlainRecord(value) ? value : {};
    return port(
      id,
      id,
      direction,
      Boolean(payload.required),
      typeof payload.cardinality === 'string' ? payload.cardinality : 'one',
    );
  });
}

function outputSchemaFromArtifactContract(contract: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(contract) || !isPlainRecord(contract.output_schema)) {
    return undefined;
  }
  return contract.output_schema;
}

function outputSchemaFromGraphNode(node: WorkflowGraphNode): Record<string, unknown> | undefined {
  return isPlainRecord(node.output_schema) ? node.output_schema : undefined;
}

function forwardMainOutputFromGraphNode(node: WorkflowGraphNode): boolean | null {
  const control = node.control;
  if (!control || typeof control.forward_main_output_on_control !== 'boolean') {
    return null;
  }
  return control.forward_main_output_on_control;
}

function nodeControlPayload(
  value: boolean | null | undefined,
  existing?: WorkflowGraphNode['control'],
): WorkflowGraphNode['control'] | undefined {
  const payload = existing ? { ...existing } : {};
  if (typeof value === 'boolean') {
    payload.forward_main_output_on_control = value;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
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
    callableId: 'fake-agent.generic',
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
    context: 'none',
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
    context: 'none',
  };
}

function canvasEdgeToGraphMetadataEdge(edge: WorkflowCanvasEdge): WorkflowDataEdge | WorkflowGraphEdge {
  if (edge.kind === 'data') {
    return {
      id: edge.id,
      from: { node: edge.source.workflowId, port: edge.source.portId },
      to: { node: edge.target.workflowId, port: edge.target.portId },
      materialization: edge.materialization,
      required: workflowBoundaryKind(edge.source.workflowId) === 'workflow_input' ? false : true,
    };
  }
  return {
    id: edge.id,
    from: edge.source.workflowId,
    to: edge.target.workflowId,
    label: 'control',
    condition: edge.condition || null,
    context: 'none',
    mapping: {},
  };
}

function edgeCanonicalPreview(edge: WorkflowCanvasEdge, canvas?: WorkspaceCanvasModel): Record<string, unknown> {
  if (edge.kind === 'data') {
    const hasControlDependency = canvas
      ? allCanvasEdges(canvas).some(
          (candidate) =>
            candidate.kind === 'control' &&
            candidate.source.workflowId === edge.source.workflowId &&
            candidate.target.workflowId === edge.target.workflowId,
        )
      : false;
    return {
      data_edge: {
        source: { node: edge.source.workflowId, port: edge.source.portId || 'main' },
        target: { node: edge.target.workflowId, port: edge.target.portId || 'main' },
        materialization: edge.materialization,
      },
      auto_added_control_edge: !isWorkflowBoundaryEdge(edge) && !hasControlDependency,
    };
  }
  return {
    control_edge: {
      from: edge.source.workflowId,
      to: edge.target.workflowId,
      context: 'none',
    },
  };
}

function allCanvasEdges(canvas: WorkspaceCanvasModel): WorkflowCanvasEdge[] {
  return [...canvas.edges, ...canvas.workflows.flatMap((workflow) => workflow.internalEdges)];
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

function controlSourceHandleId(flowNodeId: string): string {
  return `${flowNodeId}:control:source`;
}

function controlTargetHandleId(flowNodeId: string): string {
  return `${flowNodeId}:control:target`;
}

function controlHandleSide(flowNodeId: string, handleId: string | null | undefined): EndpointSide | null {
  if (handleId === controlSourceHandleId(flowNodeId)) {
    return 'source';
  }
  if (handleId === controlTargetHandleId(flowNodeId)) {
    return 'target';
  }
  return null;
}

function workflowInputOuterTargetHandleId(workflowId: string): string {
  return `${workflowId}:workflow-input-outer-target`;
}

function workflowInputInnerSourceHandleId(workflowId: string): string {
  return `${workflowId}:workflow-input-inner-source`;
}

function workflowOutputInnerTargetHandleId(workflowId: string): string {
  return `${workflowId}:workflow-output-inner-target`;
}

function workflowOutputOuterSourceHandleId(workflowId: string): string {
  return `${workflowId}:workflow-output-outer-source`;
}

function isWorkflowInputInnerSourceHandle(workflowId: string, handle: string | null | undefined): boolean {
  return handle === workflowInputInnerSourceHandleId(workflowId) || handle === `${workflowId}:workflow-input-source`;
}

function isWorkflowOutputInnerTargetHandle(workflowId: string, handle: string | null | undefined): boolean {
  return handle === workflowOutputInnerTargetHandleId(workflowId) || handle === `${workflowId}:workflow-output-target`;
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

function addEdgeWithControlDependency(
  canvas: WorkspaceCanvasModel,
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
): WorkspaceCanvasModel {
  const existing = canvas.edges.find((item) => canvasEdgesAreEquivalent(item, edge));
  const edgeToStore = existing || edge;
  const edges = [
    ...canvas.edges.filter((item) => item.id !== edgeToStore.id && !canvasEdgesAreEquivalent(item, edgeToStore)),
    edgeToStore,
  ];
  if (edgeToStore.kind !== 'data') {
    return { ...canvas, edges };
  }
  if (isWorkflowBoundaryEdge(edgeToStore)) {
    return { ...canvas, edges };
  }
  const hasControlEdge = edges.some(
    (item) =>
      item.kind === 'control' &&
      item.source.workflowId === edgeToStore.source.workflowId &&
      item.target.workflowId === edgeToStore.target.workflowId,
  );
  if (hasControlEdge) {
    return { ...canvas, edges };
  }
  const control = controlEdgeWithId(
    uniqueEdgeIdForScope(
      { ...canvas, edges },
      scopeWorkflowId,
      'control',
      edgeToStore.source.workflowId,
      edgeToStore.target.workflowId,
    ),
    edgeToStore.source.workflowId,
    edgeToStore.target.workflowId,
  );
  return { ...canvas, edges: [...edges, control] };
}

function commitResolvedConnection(
  canvas: WorkspaceCanvasModel,
  resolved: Extract<ConnectionResolution, { accepted: true }>,
): CommitConnectionResult {
  const { edge, scopeWorkflowId } = resolved;
  if (edge.kind === 'data') {
    const result = createDataEdgeCommand(canvas, {
      scopeWorkflowId,
      sourceNodeId: edge.source.workflowId,
      sourcePortId: edge.source.portId,
      targetNodeId: edge.target.workflowId,
      targetPortId: edge.target.portId,
      materialization: edge.materialization,
    });
    return { canvas: result.canvas, edge: result.edge };
  }
  if (scopeWorkflowId) {
    const workflow = canvas.workflows.find((item) => item.id === scopeWorkflowId);
    const existing = workflow?.internalEdges.find((item) => canvasEdgesAreEquivalent(item, edge));
    const edgeToStore = existing || edge;
    return {
      edge: edgeToStore,
      canvas: {
        ...canvas,
        workflows: canvas.workflows.map((item) =>
          item.id === scopeWorkflowId
            ? {
                ...item,
                internalEdges: [
                  ...item.internalEdges.filter(
                    (candidate) =>
                      candidate.id !== edgeToStore.id && !canvasEdgesAreEquivalent(candidate, edgeToStore),
                  ),
                  edgeToStore,
                ],
              }
            : item,
        ),
      },
    };
  }
  const existing = canvas.edges.find((item) => canvasEdgesAreEquivalent(item, edge));
  const edgeToStore = existing || edge;
  return {
    edge: edgeToStore,
    canvas: {
      ...canvas,
      edges: [
        ...canvas.edges.filter(
          (candidate) => candidate.id !== edgeToStore.id && !canvasEdgesAreEquivalent(candidate, edgeToStore),
        ),
        edgeToStore,
      ],
    },
  };
}

function canvasEdgesAreEquivalent(left: WorkflowCanvasEdge, right: WorkflowCanvasEdge): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'control' && right.kind === 'control') {
    return left.source.workflowId === right.source.workflowId && left.target.workflowId === right.target.workflowId;
  }
  if (left.kind !== 'data' || right.kind !== 'data') {
    return false;
  }
  return (
    left.source.workflowId === right.source.workflowId &&
    left.source.portId === right.source.portId &&
    left.target.workflowId === right.target.workflowId &&
    left.target.portId === right.target.portId
  );
}

function normalizeCanvasEdges(canvas: WorkspaceCanvasModel): WorkspaceCanvasModel {
  return {
    ...canvas,
    edges: uniqueCanvasEdges(canvas.edges),
    workflows: canvas.workflows.map((workflow) => ({
      ...workflow,
      internalEdges: uniqueCanvasEdges(workflow.internalEdges),
    })),
  };
}

function selectionForEdgeAddress(address: EdgeAddress): CanvasSelection {
  return {
    type: 'edge',
    id: address.edgeId,
    scopeWorkflowId: address.scopeWorkflowId,
  };
}

function edgeAddressForScope(scopeWorkflowId: string | null | undefined, edgeId: string): EdgeAddress {
  return scopeWorkflowId ? workflowEdgeAddress(scopeWorkflowId, edgeId) : rootEdgeAddress(edgeId);
}

function selectionEdgeAddress(canvas: WorkspaceCanvasModel, selection: CanvasSelection): EdgeAddress | null {
  if (selection.type !== 'edge') {
    return null;
  }
  if ('scopeWorkflowId' in selection && selection.scopeWorkflowId !== undefined) {
    return edgeAddressForScope(selection.scopeWorkflowId, selection.id);
  }
  return resolveLegacyEdgeSelection(canvas, selection.id);
}

function resolveLegacyEdgeSelection(canvas: WorkspaceCanvasModel, edgeId: string): EdgeAddress | null {
  const matches: EdgeAddress[] = [];
  if (canvas.edges.some((edge) => edge.id === edgeId)) {
    matches.push(rootEdgeAddress(edgeId));
  }
  for (const workflow of canvas.workflows) {
    if (workflow.internalEdges.some((edge) => edge.id === edgeId)) {
      matches.push(workflowEdgeAddress(workflow.id, edgeId));
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function findCanvasEdgeByAddress(
  canvas: WorkspaceCanvasModel,
  address: EdgeAddress | null | undefined,
): WorkflowCanvasEdge | undefined {
  if (!address) {
    return undefined;
  }
  if (!address.scopeWorkflowId) {
    return canvas.edges.find((edge) => edge.id === address.edgeId);
  }
  return canvas.workflows
    .find((workflow) => workflow.id === address.scopeWorkflowId)
    ?.internalEdges.find((edge) => edge.id === address.edgeId);
}

function selectionMatchesEdge(
  selection: CanvasSelection,
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: WorkflowCanvasEdge,
): boolean {
  return edgeAddressEquals(selectionEdgeAddress(canvas, selection), edgeAddressForScope(scopeWorkflowId, edge.id));
}

function selectionMatchesEdgeAddress(selection: CanvasSelection, address: EdgeAddress): boolean {
  if (selection.type !== 'edge' || selection.id !== address.edgeId) {
    return false;
  }
  return selection.scopeWorkflowId === undefined || selection.scopeWorkflowId === address.scopeWorkflowId;
}

function flowEdgeData(address: EdgeAddress): Record<string, unknown> {
  return { edgeAddress: address };
}

function edgeAddressFromFlowEdge(edge: Edge): EdgeAddress | null {
  const value = edge.data?.edgeAddress;
  if (value && typeof value === 'object') {
    const record = value as { edgeId?: unknown; scopeWorkflowId?: unknown };
    if (
      typeof record.edgeId !== 'string' ||
      (record.scopeWorkflowId !== undefined &&
        record.scopeWorkflowId !== null &&
        typeof record.scopeWorkflowId !== 'string')
    ) {
      return edgeAddressFromFlowEdgeId(edge.id);
    }
    return {
      edgeId: record.edgeId,
      scopeWorkflowId: typeof record.scopeWorkflowId === 'string' ? record.scopeWorkflowId : null,
    };
  }
  return edgeAddressFromFlowEdgeId(edge.id);
}

function createDataEdgeCommand(
  canvas: WorkspaceCanvasModel,
  request: DataEdgeCommandRequest,
): DataEdgeCommandResult {
  if (request.materialization !== 'copy' && request.materialization !== 'reference') {
    throw new Error(`Unsupported data edge materialization: ${request.materialization}`);
  }
  if (request.sourceNodeId === request.targetNodeId) {
    throw new Error('Data Edge 不能连接到同一个节点');
  }
  const boundaryBinding =
    isWorkflowBoundaryId(request.sourceNodeId) || isWorkflowBoundaryId(request.targetNodeId);
  if (
    !boundaryBinding &&
    (request.sourcePortId || 'main') === 'main' &&
    (request.targetPortId || 'main') === 'main'
  ) {
    throw new Error('main 已通过控制线默认传递；显式 Data Edge 请使用非 main 端口');
  }
  const sourceNode = findDataConnectNode(canvas, request.scopeWorkflowId, request.sourceNodeId);
  const targetNode = findDataConnectNode(canvas, request.scopeWorkflowId, request.targetNodeId);
  if (!sourceNode || !targetNode) {
    throw new Error('Data Edge 必须连接同一层级内的节点');
  }
  if (!sourceNode.outputPorts.some((portValue) => portValue.id === request.sourcePortId)) {
    throw new Error(`Source output port 不存在: ${request.sourceNodeId}.${request.sourcePortId}`);
  }
  const targetPort = targetNode.inputPorts.find((portValue) => portValue.id === request.targetPortId);
  if (!targetPort) {
    throw new Error(`Target input port 不存在: ${request.targetNodeId}.${request.targetPortId}`);
  }
  const scopedEdges = dataConnectEdges(canvas, request.scopeWorkflowId);
  const existingEquivalent = scopedEdges.find(
    (edge) =>
      edge.kind === 'data' &&
      edge.source.workflowId === request.sourceNodeId &&
      edge.source.portId === request.sourcePortId &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId,
  );
  if (existingEquivalent?.kind === 'data') {
    return { canvas, edge: existingEquivalent, autoAddedControlEdge: false };
  }
  const duplicateWorkflowOutputSource = scopedEdges.find(
    (edge) =>
      edge.kind === 'data' &&
      isWorkflowOutputBoundaryId(edge.target.workflowId) &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId &&
      edge.source.workflowId === request.sourceNodeId,
  );
  if (duplicateWorkflowOutputSource?.kind === 'data') {
    return { canvas, edge: duplicateWorkflowOutputSource, autoAddedControlEdge: false };
  }
  const hasTargetConflict = scopedEdges.some(
    (edge) =>
      edge.kind === 'data' &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId,
  );
  if (
    hasTargetConflict &&
    !isWorkflowOutputBoundaryId(request.targetNodeId) &&
    (targetPort.cardinality || 'one') !== 'many' &&
    !request.replaceExisting
  ) {
    throw new Error(`Target input port 已有 data edge: ${request.targetNodeId}.${request.targetPortId}`);
  }
  const dataEdge: Extract<WorkflowCanvasEdge, { kind: 'data' }> = {
    id: uniqueEdgeIdForScope(
      canvas,
      request.scopeWorkflowId,
      'data',
      request.sourceNodeId,
      request.targetNodeId,
    ),
    kind: 'data',
    source: { workflowId: request.sourceNodeId, portId: request.sourcePortId },
    target: { workflowId: request.targetNodeId, portId: request.targetPortId },
    materialization: request.materialization,
  };
  const hadControlDependency = hasControlDependency(
    canvas,
    request.scopeWorkflowId,
    request.sourceNodeId,
    request.targetNodeId,
  );
  const filteredEdges = scopedEdges.filter((item) => {
    if (item.id === dataEdge.id) {
      return false;
    }
    if (!request.replaceExisting || item.kind !== 'data') {
      return true;
    }
    return !(
      item.target.workflowId === request.targetNodeId &&
      item.target.portId === request.targetPortId
    );
  });

  if (request.scopeWorkflowId) {
    const scopedCanvas = { ...canvas, edges: filteredEdges };
    const nextScopedCanvas = addEdgeWithControlDependency(scopedCanvas, dataEdge, request.scopeWorkflowId);
    return {
      canvas: {
        ...canvas,
        workflows: canvas.workflows.map((workflow) =>
          workflow.id === request.scopeWorkflowId
            ? { ...workflow, internalEdges: nextScopedCanvas.edges }
            : workflow,
        ),
      },
      edge: dataEdge,
      autoAddedControlEdge: !boundaryBinding && !hadControlDependency,
    };
  }

  const nextCanvas = addEdgeWithControlDependency({ ...canvas, edges: filteredEdges }, dataEdge, null);
  return {
    canvas: nextCanvas,
    edge: dataEdge,
    autoAddedControlEdge: !boundaryBinding && !hadControlDependency,
  };
}

function applyDataEdgeCommandOrKeep(
  canvas: WorkspaceCanvasModel,
  request: DataEdgeCommandRequest,
  onError?: (message: string) => void,
): WorkspaceCanvasModel {
  try {
    return createDataEdgeCommand(canvas, request).canvas;
  } catch (error) {
    onError?.(error instanceof Error ? error.message : '创建 Data Edge 失败');
    return canvas;
  }
}

function dataConnectNodes(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): DataConnectNodeOption[] {
  if (scopeWorkflowId) {
    const workflow = canvas.workflows.find((item) => item.id === scopeWorkflowId);
    if (!workflow) {
      return [];
    }
    return [
      {
        nodeId: workflowInputBoundaryId(workflow.id),
        label: 'Workflow Inputs',
        subtitle: workflowInvocationLabel(workflow),
        inputPorts: [],
        outputPorts: workflow.inputPorts.map((item) => boundaryPort(item, 'output')),
      },
      ...(workflow.internalNodes || []).map((node) => ({
      nodeId: node.id,
      label: internalInvocationLabel(node),
      subtitle: node.callableId || node.runtime,
      inputPorts: node.inputPorts || [port('main', 'input', 'input')],
      outputPorts: node.outputPorts || [port('main', 'output', 'output')],
      })),
      {
        nodeId: workflowOutputBoundaryId(workflow.id),
        label: 'Workflow Outputs',
        subtitle: workflowInvocationLabel(workflow),
        inputPorts: workflow.outputPorts.map((item) => boundaryPort(item, 'input')),
        outputPorts: [],
      },
    ];
  }
  return canvas.workflows
    .filter((workflow) => !workflow.boundaryKind)
    .map((workflow) => ({
      nodeId: workflow.id,
      label: workflowInvocationLabel(workflow),
      subtitle: workflow.callableId || workflow.workflowRef,
      inputPorts: workflow.inputPorts,
      outputPorts: workflow.outputPorts,
    }));
}

function findDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): DataConnectNodeOption | undefined {
  return dataConnectNodes(canvas, scopeWorkflowId).find((node) => node.nodeId === nodeId);
}

function dataConnectEdges(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): WorkflowCanvasEdge[] {
  if (!scopeWorkflowId) {
    return canvas.edges;
  }
  return canvas.workflows.find((workflow) => workflow.id === scopeWorkflowId)?.internalEdges || [];
}

function dataEdgesForNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
): Extract<WorkflowCanvasEdge, { kind: 'data' }>[] {
  return dataConnectEdges(canvas, scopeWorkflowId).filter(
    (edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => {
      if (edge.kind !== 'data') {
        return false;
      }
      return direction === 'input'
        ? edge.target.workflowId === nodeId
        : edge.source.workflowId === nodeId;
    },
  );
}

function hasControlDependency(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  return dataConnectEdges(canvas, scopeWorkflowId).some(
    (edge) =>
      edge.kind === 'control' &&
      edge.source.workflowId === sourceNodeId &&
      edge.target.workflowId === targetNodeId,
  );
}

function addInputPortToDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  portId: string,
): WorkspaceCanvasModel {
  return addPortToDataConnectNode(canvas, scopeWorkflowId, nodeId, 'input', portId);
}

function addPortToDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
  requestedPortId: string,
): WorkspaceCanvasModel {
  const portId = slugId(requestedPortId);
  if (!portId) {
    throw new Error('端口 id 不能为空');
  }
  const nextPort = port(portId, portId, direction);
  if (scopeWorkflowId) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id !== scopeWorkflowId) {
          return workflow;
        }
        return {
          ...workflow,
          internalNodes: workflow.internalNodes.map((node) => {
            if (node.id !== nodeId) {
              return node;
            }
            const key = direction === 'input' ? 'inputPorts' : 'outputPorts';
            const ports = node[key] || [port('main', direction, direction)];
            if (ports.some((portValue) => portValue.id === portId)) {
              throw new Error(`端口已存在: ${nodeId}.${portId}`);
            }
            return { ...node, [key]: [...ports, nextPort] };
          }),
        };
      }),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== nodeId) {
        return workflow;
      }
      const key = direction === 'input' ? 'inputPorts' : 'outputPorts';
      const ports = workflow[key];
      if (ports.some((portValue) => portValue.id === portId)) {
        throw new Error(`端口已存在: ${nodeId}.${portId}`);
      }
      return { ...workflow, [key]: [...ports, nextPort] };
    }),
  };
}

function uniqueInputPortIdForNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  requestedPortId: string,
): string {
  const target = findDataConnectNode(canvas, scopeWorkflowId, nodeId);
  const existingIds = new Set((target?.inputPorts || []).map((portValue) => portValue.id));
  return uniqueId(slugId(requestedPortId || 'input') || 'input', existingIds);
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

function workflowBoundaryKind(nodeId: string): WorkflowContainerModel['boundaryKind'] | null {
  if (nodeId.endsWith('__workflow_inputs')) {
    return 'workflow_input';
  }
  if (nodeId.endsWith('__workflow_outputs')) {
    return 'workflow_output';
  }
  return null;
}

function isWorkflowOutputBoundaryId(nodeId: string): boolean {
  return workflowBoundaryKind(nodeId) === 'workflow_output';
}

function workflowIdFromBoundaryId(nodeId: string): string | null {
  if (nodeId.endsWith('__workflow_inputs')) {
    return nodeId.slice(0, -'__workflow_inputs'.length);
  }
  if (nodeId.endsWith('__workflow_outputs')) {
    return nodeId.slice(0, -'__workflow_outputs'.length);
  }
  return null;
}

function flowEndpoint(flowNodeId: string): FlowEndpoint {
  const internal = parseInternalFlowNodeId(flowNodeId);
  if (internal) {
    return { nodeId: internal.nodeId, workflowId: internal.workflowId, internal: true };
  }
  return { nodeId: flowNodeId, workflowId: null, internal: false };
}

function flowEndpointForCanvas(canvas: WorkspaceCanvasModel, flowNodeId: string): FlowEndpoint {
  const endpoint = flowEndpoint(flowNodeId);
  if (endpoint.internal || canvas.layout !== 'workflow-focus') {
    return endpoint;
  }
  if (isWorkflowBoundaryId(flowNodeId)) {
    return endpoint;
  }
  const focusedWorkflowId = canvas.focusedWorkflowId;
  if (!focusedWorkflowId) {
    return endpoint;
  }
  const workflow = canvas.workflows.find((item) => item.id === flowNodeId);
  if (!workflow || workflow.boundaryKind) {
    return endpoint;
  }
  return { nodeId: flowNodeId, workflowId: focusedWorkflowId, internal: true };
}

function internalEdgeEndpointToFlowId(workflowId: string, nodeId: string): string {
  if (nodeId === workflowInputBoundaryId(workflowId) || nodeId === workflowOutputBoundaryId(workflowId)) {
    return nodeId;
  }
  return internalFlowNodeId(workflowId, nodeId);
}

function nodeRunForWorkflow(
  workflowRun: WorkflowRunResult | null,
  workflow: WorkflowContainerModel,
): NodeRunSummary | undefined {
  if (!workflowRun) {
    return undefined;
  }
  return workflowRun.nodes.find((nodeRun) => {
    if (nodeRun.ui_node_id === workflow.id || nodeRun.node_id === workflow.id) {
      return true;
    }
    return Boolean(workflow.callableId && nodeRun.callable_id === workflow.callableId && nodeRun.node_id === workflow.id);
  });
}

function nodeLiveLogsFor(
  liveLogs: Record<string, NodeLiveLogs>,
  nodeRun?: NodeRunSummary,
): NodeLiveLogs | undefined {
  if (!nodeRun) {
    return undefined;
  }
  return liveLogs[nodeRun.node_id] || (nodeRun.ui_node_id ? liveLogs[nodeRun.ui_node_id] : undefined);
}

function nodeRunForInternalNode(
  workflowRun: WorkflowRunResult | null,
  workflowId: string,
  nodeId: string,
): NodeRunSummary | undefined {
  if (!workflowRun) {
    return undefined;
  }
  const uiNodeId = internalFlowNodeId(workflowId, nodeId);
  return workflowRun.nodes.find((nodeRun) => {
    if (nodeRun.ui_node_id === uiNodeId || nodeRun.node_id === uiNodeId) {
      return true;
    }
    return nodeRun.parent_node_id === workflowId && nodeRun.node_id === nodeId;
  });
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
      item.callableId &&
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
  return false;
}

function isWorkflowShellNode(workflow: WorkflowContainerModel): boolean {
  return !workflow.boundaryKind && (workflow.sourceKind || 'workflow') === 'workflow';
}

function isInlineWorkflowContainer(workflow: WorkflowContainerModel): boolean {
  if (!isWorkflowShellNode(workflow)) {
    return false;
  }
  if (workflow.workflowBodyKind) {
    return workflow.workflowBodyKind === 'inline_container';
  }
  return !workflow.workflowRef || workflow.internalNodes.length > 0 || workflow.internalEdges.length > 0;
}

function workflowAtPosition(
  canvas: WorkspaceCanvasModel,
  position: { x: number; y: number },
): WorkflowContainerModel | null {
  const candidates = canvas.workflows
    .filter(isWorkflowShellNode)
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
        isWorkflowShellNode(workflow),
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

function resolvePaletteDropTarget(
  canvas: WorkspaceCanvasModel,
  item: PaletteItem,
  target: EventTarget | null,
  position: { x: number; y: number },
): PaletteDropTarget {
  const targetWorkflow = workflowFromDropTarget(canvas, target);
  if (!targetWorkflow) {
    return { kind: 'root_canvas', position };
  }
  if (item.kind === 'workflow') {
    return { kind: 'rejected', reason: 'Workflow 只能拖到主画布，不能拖入另一个 Workflow 内部' };
  }
  return {
    kind: 'workflow_internal',
    workflowId: targetWorkflow.id,
    position: finitePosition(
      {
        x: position.x - targetWorkflow.position.x,
        y: position.y - targetWorkflow.position.y,
      },
      defaultInternalNodePosition(targetWorkflow.internalNodes.length),
    ),
  };
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
  const container = target.closest<HTMLElement>('[data-drop-scope="workflow-internal"][data-workflow-id]');
  const workflowId = container?.dataset.workflowId;
  if (!workflowId) {
    return null;
  }
  return (
    canvas.workflows.find(
      (workflow) =>
        workflow.id === workflowId &&
        isWorkflowShellNode(workflow),
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

function commitDraggedNodeToCanvas(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  focusedWorkflowId: string | null = null,
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
  if (focusedWorkflowId) {
    const focusedWorkflow = canvas.workflows.find((workflow) => workflow.id === focusedWorkflowId);
    if (focusedWorkflow?.internalNodes.some((item) => item.id === node.id)) {
      return moveInternalNode(canvas, focusedWorkflowId, node.id, node.position);
    }
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
  if (
    canvas.focusedWorkflowId &&
    selection.type === 'internal' &&
    selection.workflowId === canvas.focusedWorkflowId &&
    selection.nodeId === node.id
  ) {
    return selection;
  }
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
    task: wrapped?.task || workflow.callableId || workflow.title,
    kind: workflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
    status: workflow.status,
    callableId: workflow.callableId || wrapped?.callableId,
    runtime: workflow.callableId || wrapped?.runtime,
    input: workflow.sourceInput || wrapped?.input,
    inputPorts: workflow.inputPorts,
    outputPorts: workflow.outputPorts,
    control: workflow.control || wrapped?.control,
    outputSchema: workflow.outputSchema || wrapped?.outputSchema,
    forwardMainOutputOnControl:
      workflow.forwardMainOutputOnControl ?? wrapped?.forwardMainOutputOnControl ?? null,
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
    callableId: node.callableId || node.runtime,
    sourceInput: node.input,
    control: node.control,
    outputSchema: node.outputSchema,
    forwardMainOutputOnControl: node.forwardMainOutputOnControl ?? null,
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
  const safeStartX = 620;
  const rootNodes = canvas.workflows.filter((workflow) => !workflow.boundaryKind);
  if (!rootNodes.length) {
    return { x: safeStartX, y: 180 };
  }
  const rootAgentCount = rootNodes.filter(isExecutableNodeWorkflow).length;
  const columns = 1;
  const columnIndex = rootAgentCount % columns;
  const rowIndex = Math.floor(rootAgentCount / columns);
  return {
    x: safeStartX + columnIndex * (AGENT_TOOL_NODE_SIZE.width + 80),
    y: 180 + rowIndex * 160,
  };
}

function boundaryPort(portValue: WorkflowPortView, direction: PortDirection): WorkflowPortView {
  return { ...portValue, direction };
}

function workflowSummaryForRef(
  workflows: WorkflowSummary[],
  workflowRef: string | undefined,
): WorkflowSummary | undefined {
  if (!workflowRef) {
    return undefined;
  }
  const normalized = workflowRef.replace(/\\/gu, '/');
  return workflows.find((workflow) => {
    const path = workflow.path.replace(/\\/gu, '/');
    return path === normalized || workflow.workflow_id === workflowRef || workflow.file_id === workflowRef;
  });
}

function workflowSearchHaystack(workflow: WorkflowSummary): string {
  const workflowType = (workflow as WorkflowSummary & { type?: string }).type;
  return [
    workflow.workflow_id,
    workflow.file_id,
    workflow.name,
    workflow.description,
    workflow.path,
    workflowType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isChildWorkflowSummary(workflow: WorkflowSummary): boolean {
  const id = workflow.workflow_id || workflow.file_id || '';
  const path = workflow.path || '';
  return /__[^/\\]+\.accflow\.json$/u.test(path) || id.includes('__');
}

function workflowInvocationLabel(workflow: WorkflowContainerModel): string {
  return workflow.invocationLabel || workflow.title || workflow.id;
}

function internalInvocationLabel(node: InternalNodeView): string {
  return node.invocationLabel || node.name || node.id;
}

function uniqueInvocationLabel(baseLabel: string, existingLabels: Set<string>): string {
  const normalizedBase = baseLabel.trim() || 'Invocation';
  if (!existingLabels.has(normalizedBase)) {
    return normalizedBase;
  }
  let index = 2;
  let nextLabel = `${normalizedBase} #${index}`;
  while (existingLabels.has(nextLabel)) {
    index += 1;
    nextLabel = `${normalizedBase} #${index}`;
  }
  return nextLabel;
}

function normalizeWorkbenchSelection(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  focusedWorkflowId: string | null,
): CanvasSelection {
  if (selection.type === 'task_canvas') {
    return selection.taskId === canvas.id ? selection : { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'workflow') {
    if (canvas.workflows.some((workflow) => workflow.id === selection.id)) {
      return selection;
    }
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'edge') {
    const address = selectionEdgeAddress(canvas, selection);
    if (!address || !findCanvasEdgeByAddress(canvas, address)) {
      return { type: 'task_canvas', taskId: canvas.id };
    }
    return selectionForEdgeAddress(address);
  }
  const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
  if (!workflow) {
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (focusedWorkflowId && workflow.id !== focusedWorkflowId) {
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'port') {
    const ports = selection.direction === 'input' ? workflow.inputPorts : workflow.outputPorts;
    return ports.some((portValue) => portValue.id === selection.portId)
      ? selection
      : { type: 'task_canvas', taskId: canvas.id };
  }
  return workflow.internalNodes.some((node) => node.id === selection.nodeId)
    ? selection
    : { type: 'task_canvas', taskId: canvas.id };
}

function selectionCanBeDeleted(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  isRunning: boolean,
): { ok: boolean; reason?: string } {
  if (selection.type === 'edge') {
    if (isRunning) {
      return { ok: false, reason: '任务运行中，不能删除画布节点或连接' };
    }
    return findCanvasEdgeByAddress(canvas, selectionEdgeAddress(canvas, selection))
      ? { ok: true }
      : { ok: false, reason: '选中的连接已不存在' };
  }
  if (isRunning) {
    return { ok: false, reason: '任务运行中，不能删除画布节点或连接' };
  }
  if (selection.type === 'task_canvas') {
    return { ok: false, reason: '请先选中要删除的节点或连接' };
  }
  if (selection.type === 'port') {
    return { ok: false, reason: '端口不能通过快捷键删除，请在节点设置中调整输入输出' };
  }
  if ((selection as CanvasSelection).type === 'edge') {
    return canvasHasEdge(canvas, (selection as { id: string }).id)
      ? { ok: true }
      : { ok: false, reason: '选中的连接已不存在' };
  }
  if (selection.type === 'workflow') {
    const workflow = canvas.workflows.find((item) => item.id === selection.id);
    if (!workflow) {
      return { ok: false, reason: '选中的节点已不存在' };
    }
    if (isActiveCanvasObjectStatus(workflow.status)) {
      return { ok: false, reason: '该节点正在运行，不能删除' };
    }
    return { ok: true };
  }
  const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
  const node = workflow?.internalNodes.find((item) => item.id === selection.nodeId);
  if (!workflow || !node) {
    return { ok: false, reason: '选中的节点已不存在' };
  }
  if (isActiveCanvasObjectStatus(node.status)) {
    return { ok: false, reason: '该节点正在运行，不能删除' };
  }
  return { ok: true };
}

function deleteSelectionFromCanvas(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): WorkspaceCanvasModel {
  if (selection.type === 'edge') {
    const address = selectionEdgeAddress(canvas, selection);
    if (!address) {
      return canvas;
    }
    if (!address.scopeWorkflowId) {
      return {
        ...canvas,
        edges: canvas.edges.filter((edge) => edge.id !== address.edgeId),
      };
    }
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => ({
        ...workflow,
        internalEdges:
          workflow.id === address.scopeWorkflowId
            ? workflow.internalEdges.filter((edge) => edge.id !== address.edgeId)
            : workflow.internalEdges,
      })),
    };
  }
  if (selection.type === 'workflow') {
    return {
      ...canvas,
      workflows: canvas.workflows.filter((workflow) => workflow.id !== selection.id),
      edges: canvas.edges.filter((edge) => !edgeTouchesNode(edge, selection.id)),
    };
  }
  if (selection.type === 'internal') {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id !== selection.workflowId) {
          return workflow;
        }
        const nextWorkflow = {
          ...workflow,
          internalNodes: workflow.internalNodes.filter((node) => node.id !== selection.nodeId),
          internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, selection.nodeId)),
        };
        return isExecutableNodeWorkflow(nextWorkflow) ? nextWorkflow : expandWorkflowToFitChildren(nextWorkflow);
      }),
    };
  }
  if ((selection as CanvasSelection).type === 'edge') {
    const legacyEdgeId = (selection as unknown as { id: string }).id;
    return {
      ...canvas,
      edges: canvas.edges.filter((edge) => edge.id !== legacyEdgeId),
      workflows: canvas.workflows.map((workflow) => ({
        ...workflow,
        internalEdges: workflow.internalEdges.filter((edge) => edge.id !== legacyEdgeId),
      })),
    };
  }
  return canvas;
}

function canvasHasEdge(canvas: WorkspaceCanvasModel, edgeId: string): boolean {
  return (
    canvas.edges.some((edge) => edge.id === edgeId) ||
    canvas.workflows.some((workflow) => workflow.internalEdges.some((edge) => edge.id === edgeId))
  );
}

function isTextEditingKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .monaco-editor'));
}

function shouldDisconnectEdgeOnClick(event: { altKey: boolean; button: number }): boolean {
  return event.altKey && event.button === 0;
}

function selectionKey(selection: CanvasSelection): string {
  if (selection.type === 'task_canvas') {
    return `task:${selection.taskId}`;
  }
  if (selection.type === 'workflow') {
    return `${selection.type}:${selection.id}`;
  }
  if (selection.type === 'edge') {
    return `edge:${selection.scopeWorkflowId || 'root'}:${selection.id}`;
  }
  if (selection.type === 'port') {
    return `port:${selection.workflowId}:${selection.direction}:${selection.portId}`;
  }
  return `internal:${selection.workflowId}:${selection.nodeId}`;
}

function addWorkflowFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Extract<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const baseId = slugId(item.workflowRef || item.label || 'workflow');
  const id = uniqueId(baseId || 'workflow', new Set(canvas.workflows.map((workflow) => workflow.id)));
  const invocationLabel = uniqueInvocationLabel(
    item.label || id,
    new Set(canvas.workflows.map(workflowInvocationLabel)),
  );
  const workflow: WorkflowContainerModel = {
    id,
    title: invocationLabel,
    invocationLabel,
    sourceKind: 'workflow',
    workflowBodyKind: 'inline_container',
    workflowRef: item.workflowRef,
    directory: '未绑定工作目录',
    bindingPath: `bindings/${id}.binding.local.json`,
    status: 'not_run',
    inputPorts: [port('main', '输入', 'input')],
    outputPorts: [port('main', '输出', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

function nextPaletteSelection(
  canvas: WorkspaceCanvasModel,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  targetWorkflowId: string | null,
): CanvasSelection {
  if (targetWorkflowId) {
    const workflow = canvas.workflows.find((candidate) => candidate.id === targetWorkflowId);
    const existingIds = new Set(workflow?.internalNodes.map((node) => node.id) || []);
    return {
      type: 'internal',
      workflowId: targetWorkflowId,
      nodeId: uniqueId(paletteItemBaseId(item), existingIds),
    };
  }
  return {
    type: 'workflow',
    id: uniqueId(paletteItemBaseId(item), new Set(canvas.workflows.map((workflow) => workflow.id))),
  };
}

function addCallableNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const existingIds = new Set(canvas.workflows.map((workflow) => workflow.id));
  const existingLabels = new Set(canvas.workflows.map(workflowInvocationLabel));
  const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
  const id = node.id;
  const workflow: WorkflowContainerModel = {
    id,
    title: node.name,
    invocationLabel: node.invocationLabel || node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    callableId: node.callableId,
    sourceInput: node.input,
    control: node.control,
    outputSchema: node.outputSchema,
    forwardMainOutputOnControl: node.forwardMainOutputOnControl ?? null,
    directory: 'Root canvas environment',
    status: 'not_run',
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: node.outputPorts || [port('main', 'output', 'output')],
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
      const existingLabels = new Set(workflow.internalNodes.map(internalInvocationLabel));
      const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
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
      const existingLabels = new Set(workflow.internalNodes.map(internalInvocationLabel));
      const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
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
  existingLabels: Set<string> = new Set(),
): InternalNodeView {
  const callableId = item.kind === 'file_source' ? 'file-source.local' : item.callableId;
  const id = uniqueId(paletteItemBaseId(item), existingIds);
  const isTool = item.kind === 'tool' || item.kind === 'file_source';
  const invocationLabel = uniqueInvocationLabel(item.label || callableId || id, existingLabels);
  const task = isTool ? '本地工具节点' : invocationLabel;
  return {
    id,
    name: invocationLabel,
    invocationLabel,
    task,
    kind: isTool ? 'Tool' : 'Agent',
    status: 'not_run',
    callableId,
    runtime: callableId,
    input:
      item.kind === 'file_source'
        ? { path: '' }
        : { user_prompt: invocationLabel },
    inputPorts:
      item.kind === 'file_source'
        ? [port('main', 'input', 'input')]
        : item.inputPorts || [port('main', 'input', 'input')],
    outputPorts:
      item.kind === 'file_source'
        ? [port('main', 'output', 'output')]
        : item.outputPorts || [port('main', 'output', 'output')],
    outputSchema: item.kind === 'file_source' ? undefined : item.outputSchema,
    forwardMainOutputOnControl: null,
    position,
  };
}

function paletteItemBaseId(item: Exclude<PaletteItem, { kind: 'workflow' }>): string {
  const stableRef = item.kind === 'file_source' ? item.callableId : item.callableId;
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

function pointerPoint(event: CanvasPointerEvent): { x: number; y: number } {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return { x: (event as MouseEvent | ReactMouseEvent<Element>).clientX, y: (event as MouseEvent | ReactMouseEvent<Element>).clientY };
}

function viewportViewBox(): string {
  if (typeof window === 'undefined') {
    return '0 0 1 1';
  }
  return `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`;
}

function connectionPreviewFromHandle(handle: HTMLElement, fallback: { x: number; y: number }): ConnectPreviewState {
  const rect = handle.getBoundingClientRect();
  const start = rect.width > 0 || rect.height > 0
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : fallback;
  return { start, end: fallback };
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  return slug || 'node';
}

function isJsdomRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.navigator?.userAgent?.toLowerCase().includes('jsdom')
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectorDrawerTitle(selection: CanvasSelection): string {
  if (selection.type === 'port') {
    return '端口设置';
  }
  if (selection.type === 'edge') {
    return '连接设置';
  }
  if (selection.type === 'workflow' || selection.type === 'internal') {
    return '节点设置';
  }
  return '任务设置';
}

function callableDisplayTitle(detail: Pick<CallableDetail, 'id' | 'name' | 'metadata'>): string {
  const metadataName = detail.metadata?.name;
  return detail.name || (typeof metadataName === 'string' ? metadataName : '') || detail.id;
}

function callableDescription(detail: Pick<CallableDetail, 'description' | 'metadata'>): string {
  const metadataDescription = detail.metadata?.description;
  return detail.description || (typeof metadataDescription === 'string' ? metadataDescription : '');
}

function providerLabelFromCallable(detail: Pick<CallableDetail, 'runtime' | 'runner' | 'metadata'>): string {
  const provider = detail.metadata?.agent_provider;
  if (typeof provider === 'string' && provider.trim()) {
    return providerLabel(provider);
  }
  const runtime = detail.runtime || detail.runner || '';
  if (runtime.includes('codex')) {
    return 'Codex';
  }
  if (runtime.includes('claude')) {
    return 'Claude';
  }
  if (runtime.includes('generic')) {
    return '自定义 CLI';
  }
  return runtime || '默认 Agent';
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    codex: 'Codex',
    claude: 'Claude',
    hermes: 'Hermes',
    cursor: 'Cursor',
    gemini: 'Gemini',
    generic_cli: '自定义 CLI',
  };
  return labels[provider] || provider;
}

function skillsFromMetadata(metadata?: Record<string, unknown>): string[] {
  const skills = metadata?.skills;
  if (!Array.isArray(skills)) {
    return [];
  }
  return skills.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function thinkingLabel(value: string): string {
  const labels: Record<string, string> = {
    low: '轻量',
    medium: '标准',
    high: '深入',
    max: '极限',
  };
  return labels[value] || value || '标准';
}

function schemaFieldsFromPorts(
  ports: Record<string, unknown> | undefined,
  fallbackPorts: WorkflowPortView[],
): SchemaFieldCard[] {
  if (ports && Object.keys(ports).length > 0) {
    return Object.entries(ports).map(([name, value]) => schemaFieldFromValue(name, value));
  }
  return fallbackPorts.map((portValue) => ({
    name: portValue.label || portValue.id,
    type: portValue.artifactTypes?.join(', ') || '数据',
    required: Boolean(portValue.required),
    description: `${portValue.direction === 'input' ? '输入端口' : '输出端口'}：${portValue.id}`,
  }));
}

function schemaFieldsFromArtifactContract(contract: Record<string, unknown> | unknown[] | undefined): SchemaFieldCard[] {
  if (!isPlainRecord(contract)) {
    return [];
  }
  const outputSchema = contract.output_schema;
  return schemaFieldsFromJsonSchema(outputSchema);
}

function schemaFieldsFromJsonSchema(schema: unknown): SchemaFieldCard[] {
  if (!isPlainRecord(schema)) {
    return [];
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const properties = schema.properties;
  if (isPlainRecord(properties)) {
    return Object.entries(properties).map(([name, value]) => ({
      ...schemaFieldFromValue(name, value),
      required: required.includes(name),
    }));
  }
  return [];
}

function schemaFieldFromValue(name: string, value: unknown): SchemaFieldCard {
  if (!isPlainRecord(value)) {
    return {
      name,
      type: typeof value === 'string' ? value : '数据',
      required: false,
      description: '',
    };
  }
  const nestedSchema = isPlainRecord(value.schema) ? value.schema : undefined;
  const typeValue = value.type || nestedSchema?.type || value.kind || value.format || '数据';
  const description = value.description || value.label || nestedSchema?.description || '';
  const example = value.example ?? value.default ?? nestedSchema?.example ?? nestedSchema?.default;
  return {
    name,
    type: Array.isArray(typeValue) ? typeValue.join(' / ') : String(typeValue),
    required: Boolean(value.required),
    description: typeof description === 'string' ? description : '',
    example: example === undefined ? undefined : String(example),
  };
}

function dedupeSchemaFields(fields: SchemaFieldCard[]): SchemaFieldCard[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.name}:${field.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
    return relativeCwd;
  }
  return nodeId === 'Root_Pipeline' ? '' : `workflows/${nodeId}`;
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

function findCallableId(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const runIndex = command.lastIndexOf('run');
  const candidate = command[runIndex + 1];
  return typeof candidate === 'string' && candidate.includes('.') ? candidate : '';
}

export const __workflowViewerTestables = {
  AgentToolNode,
  WorkspaceCanvas,
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  canvasToWorkflowGraph,
  canvasEdgeToFlowEdge,
  workflowInternalEdgePaths,
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  reverseConnection,
  resolveScopedConnection,
  isConnectionHandleForMode,
  createDataEdgeCommand,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  graphToWorkspaceCanvas,
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  layoutCanvasForSelection,
  reusableWorkflowClassGraph,
  layoutWorkspaceCanvas,
  nextRootPalettePosition,
  normalizeWorkbenchSelection,
  deleteSelectionFromCanvas,
  selectionCanBeDeleted,
  shouldDisconnectEdgeOnClick,
  promptFromInvocationInput,
  staticInputFromInvocationInput,
  workflowInvocationLabel,
};
