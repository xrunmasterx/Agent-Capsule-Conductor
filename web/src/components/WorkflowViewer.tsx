import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap as ReactFlowMiniMap,
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
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
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

type Props = {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

type WorkflowStatus =
  | 'not_run'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'schema_error'
  | 'artifact_error'
  | 'manual_review';

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

type CanvasSelection =
  | { type: 'workflow'; id: string }
  | { type: 'port'; workflowId: string; portId: string; direction: PortDirection }
  | { type: 'edge'; id: string }
  | { type: 'internal'; workflowId: string; nodeId: string };

type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
};

type WorkflowNodeData = {
  workflow: WorkflowContainerModel;
  binding?: WorkflowBindingView;
  selected: boolean;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onSelectInternal: (workflowId: string, nodeId: string) => void;
  onOpenFocus: (workflowId: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
};

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowContainer'>;

const nodeTypes = { workflowContainer: memo(WorkflowContainer) };
const DEFAULT_CONTAINER_SIZE = { width: 430, height: 328 };
const BOUNDARY_NODE_SIZE = { width: 270, height: 240 };
const ROOT_WORKSPACE = 'F:\\UE5_Project_A';
const MAX_LOG_PREVIEW_LINES = 180;

export function WorkflowViewer({
  workflows,
  capsules,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const [canvas, setCanvas] = useState<WorkspaceCanvasModel>(() => workspaceDemoCanvas());
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() =>
    canvasToWorkflowGraph(workspaceDemoCanvas()),
  );
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'workflow',
    id: 'Research_Flow',
  });
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('data');
  const [message, setMessage] = useState('已加载 Workspace Canvas Demo');
  const [workflowRun, setWorkflowRun] = useState<WorkflowRunResult | null>(null);
  const [workflowEvents, setWorkflowEvents] = useState<RunEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>(null);
  const [workflowBindings, setWorkflowBindings] = useState<Record<string, WorkflowBindingView>>({});
  const [bindingEditorWorkflowId, setBindingEditorWorkflowId] = useState<string | null>(null);
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });
  const graphRef = useRef(sourceGraph);
  const workflowBindingKey = useMemo(
    () => [canvas.id, ...canvas.workflows.map((item) => item.id)].sort().join('|'),
    [canvas.id, canvas.workflows],
  );

  function updateCanvas(next: SetStateAction<WorkspaceCanvasModel>) {
    setCanvas((current) => {
      return typeof next === 'function'
        ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
        : next;
    });
  }

  function resetCanvas(nextCanvas: WorkspaceCanvasModel) {
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
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
      setEvidenceDock({ open: false, title: '运行证据', content: null });
    });
    return () => {
      ignore = true;
    };
  }, [openedExternalWorkflow, selectedWorkflowId]);

  const selectedWorkflow =
    selection.type === 'workflow'
      ? canvas.workflows.find((workflow) => workflow.id === selection.id)
      : selection.type === 'port' || selection.type === 'internal'
        ? canvas.workflows.find((workflow) => workflow.id === selection.workflowId)
        : undefined;
  const selectedEdge =
    selection.type === 'edge'
      ? canvas.edges.find((edge) => edge.id === selection.id) ||
        canvas.workflows.flatMap((workflow) => workflow.internalEdges).find((edge) => edge.id === selection.id)
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

  function createDemo() {
    const nextCanvas = workspaceDemoCanvas();
    resetCanvas(nextCanvas);
    setSelection({ type: 'workflow', id: 'Research_Flow' });
    setWorkflowRun(null);
    setWorkflowEvents([]);
    setOpenedExternalWorkflow(false);
    setMessage('已重置为 Workspace Canvas Demo');
  }

  function openWorkflow(workflowId: string) {
    setOpenedExternalWorkflow(true);
    onSelect(workflowId);
  }

  function autoLayout() {
    updateCanvasAndGraph((current) => layoutWorkspaceCanvas(current));
    setMessage('已按 DAG 重新布局 workflow 容器');
  }

  async function saveGraph(options: { selectSavedWorkflow?: boolean; refreshIndex?: boolean } = {}) {
    const { selectSavedWorkflow = true, refreshIndex = true } = options;
    const graph = graphForCurrentView(canvas, focusedWorkflowId);
    graphRef.current = graph;
    setSourceGraph(graph);
    const result = await api.saveWorkflow(graph, true);
    setMessage(`已保存 ${result.workflow_id}`);
    if (selectSavedWorkflow) {
      onSelect(result.workflow_id);
    }
    if (refreshIndex) {
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
    const graph = graphForCurrentView(canvas, focusedWorkflowId);
    const runId = `ui_workflow_${graph.id}`;
    const runDir = `runs/${runId}`;
    const bindingPath = bindingPathOf(workflowBindings[graph.id]);
    let pollTimer: number | undefined;
    let pollingStopped = false;

    async function pollWorkflowEvents() {
      try {
        const result = await api.runEvents(runId);
        setWorkflowEvents(result.events);
        setWorkflowRun(liveWorkflowRunFromEvents(graph, runDir, result.events));
        setCanvas((current) =>
          applyRunStatusToCanvas(current, liveWorkflowRunFromEvents(graph, runDir, result.events)),
        );
      } catch {
        setWorkflowRun(liveWorkflowRunFromEvents(graph, runDir, []));
      }
      if (!pollingStopped) {
        pollTimer = window.setTimeout(() => {
          void pollWorkflowEvents();
        }, 1000);
      }
    }

    try {
      await saveGraph({ selectSavedWorkflow: false, refreshIndex: false });
      setIsRunning(true);
      setWorkflowEvents([]);
      setWorkflowRun(liveWorkflowRunFromEvents(graph, runDir, []));
      setMessage(`运行 ${graph.id}: 已提交，等待节点事件...`);
      void pollWorkflowEvents();
      const result = await api.runWorkflow(
        graph.id,
        runDir,
        bindingPath ? { bindingPath } : undefined,
      );
      pollingStopped = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
      setWorkflowRun(result);
      setCanvas((current) => applyRunStatusToCanvas(current, result));
      const events = await api.runEvents(runId).catch(() => null);
      setWorkflowEvents(events?.events || []);
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
        onNew={createDemo}
        onSave={saveGraph}
        onValidate={validateGraph}
        onRun={runGraph}
        onAutoLayout={autoLayout}
      />
      <div className="workspace-canvas-layout">
        <LeftNavigator
          workflows={workflows}
          capsules={capsules}
          selectedWorkflowId={selectedWorkflowId}
          onOpenWorkflow={openWorkflow}
          focusedWorkflowId={focusedWorkflowId}
          onAddPaletteItem={(item) => {
            if (!focusedWorkflowId) {
              setMessage('请先双击 Workflow 进入 Focus Mode');
              return;
            }
            updateCanvas((current) => {
              const workflow = current.workflows.find((candidate) => candidate.id === focusedWorkflowId);
              const nodeCount = workflow?.internalNodes.length || 0;
              return addInternalNodeFromPalette(current, focusedWorkflowId, item, {
                x: 120 + (nodeCount % 4) * 210,
                y: 130 + Math.floor(nodeCount / 4) * 170,
              });
            });
            setMessage(`已加入 ${item.label} 到 ${focusedWorkflowId}`);
          }}
        />
        <WorkspaceCanvas
          canvas={canvas}
          selection={selection}
          connectionMode={connectionMode}
          workflowRun={workflowRun}
          focusedWorkflowId={focusedWorkflowId}
          capsules={capsules}
          workflows={workflows}
          bindings={workflowBindings}
          onFocusedWorkflow={setFocusedWorkflowId}
          onCanvasChange={updateCanvas}
          onSelect={setSelection}
          onConfigureWorkflow={(workflowId) => {
            setSelection({ type: 'workflow', id: workflowId });
            setBindingEditorWorkflowId(workflowId);
          }}
        />
        <RightInspector
          canvas={canvas}
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

function TopBar({
  title,
  subtitle,
  isRunning,
  onNew,
  onSave,
  onValidate,
  onRun,
  onAutoLayout,
}: {
  title: string;
  subtitle: string;
  isRunning: boolean;
  onNew: () => void;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  onAutoLayout: () => void;
}) {
  return (
    <header className="workbench-topbar">
      <div className="topbar-title">
        <span className="topbar-kicker">Workspace Canvas</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="toolbar-actions" aria-label="工作流工具栏">
        <button type="button" onClick={onNew}>
          <GitBranch aria-hidden="true" size={16} />
          新建
        </button>
        <button type="button" onClick={onSave} disabled={isRunning}>
          <Save aria-hidden="true" size={16} />
          保存
        </button>
        <button type="button" onClick={onValidate} disabled={isRunning}>
          <TestTube aria-hidden="true" size={16} />
          校验
        </button>
        <button type="button" className="primary-action" onClick={onRun} disabled={isRunning}>
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
  focusedWorkflowId,
  onAddPaletteItem,
}: {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onOpenWorkflow: (workflowId: string) => void;
  focusedWorkflowId: string | null;
  onAddPaletteItem: (item: Exclude<PaletteItem, { kind: 'workflow' }>) => void;
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
              onClick={() => onOpenWorkflow(workflow.workflow_id)}
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
            title={focusedWorkflowId ? '双击加入当前 Workflow' : '拖入 Focus Mode 后加入 Workflow'}
            onDoubleClick={() => onAddPaletteItem(item)}
            onDragStart={(event) => setPaletteDragData(event, item)}
          >
            <Boxes aria-hidden="true" size={16} />
            <div>
              <strong>{capsule.name || capsule.id}</strong>
              <small>{capsule.id}</small>
            </div>
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
          title={focusedWorkflowId ? '双击加入当前 Workflow' : '拖入 Focus Mode 后加入 Workflow'}
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
        </article>
      </section>
    </aside>
  );
}

function WorkspaceCanvas({
  canvas,
  selection,
  connectionMode,
  workflowRun,
  focusedWorkflowId,
  capsules,
  workflows,
  bindings,
  onFocusedWorkflow,
  onCanvasChange,
  onSelect,
  onConfigureWorkflow,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  workflowRun: WorkflowRunResult | null;
  focusedWorkflowId: string | null;
  capsules: CapsuleSummary[];
  workflows: WorkflowSummary[];
  bindings: Record<string, WorkflowBindingView>;
  onFocusedWorkflow: (workflowId: string | null) => void;
  onCanvasChange: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  onSelect: (selection: CanvasSelection) => void;
  onConfigureWorkflow: (workflowId: string) => void;
}) {
  const [flowInstance, setFlowInstance] = useState<{
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  } | null>(null);
  const [nodeCreateMenu, setNodeCreateMenu] = useState<NodeCreateMenuState>(null);
  const [connectStart, setConnectStart] = useState<PendingCanvasConnection | null>(null);
  const visibleCanvas = useMemo(
    () => focusCanvas(canvas, focusedWorkflowId),
    [canvas, focusedWorkflowId],
  );
  function handleSelectInternal(workflowId: string, nodeId: string) {
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
  }
  const flowNodes = useMemo(
    () =>
      toFlowNodes(
        visibleCanvas,
        selection,
        bindings,
        onSelectPort(onSelect),
        handleSelectInternal,
        onFocusedWorkflow,
        onConfigureWorkflow,
      ),
    [visibleCanvas, selection, bindings, handleSelectInternal, onSelect, onFocusedWorkflow, onConfigureWorkflow],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(visibleCanvas, selection, connectionMode),
    [visibleCanvas, selection, connectionMode],
  );

  function handleNodesChange(changes: NodeChange<WorkflowFlowNode>[]) {
    const nextNodes = applyNodeChanges(changes, flowNodes) as WorkflowFlowNode[];
    const shouldPersist = changes.some(
      (change) => change.type === 'position' || change.type === 'remove',
    );
    if (!shouldPersist) {
      return;
    }
    const positions = new Map(nextNodes.map((node) => [node.id, node.position]));
    const remainingIds = new Set(nextNodes.map((node) => node.id));
    if (focusedWorkflowId) {
      onCanvasChange((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === focusedWorkflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes
                  .filter((node) => remainingIds.has(node.id))
                  .map((node) =>
                    positions.has(node.id)
                      ? { ...node, position: positions.get(node.id) || node.position }
                      : node,
                  ),
                internalEdges: workflow.internalEdges.filter((edge) =>
                  edgeConnectsRemainingNodes(edge, remainingIds),
                ),
              }
            : workflow,
        ),
      }));
      return;
    }
    onCanvasChange((current) => ({
      ...current,
      workflows: current.workflows
        .filter((workflow) => remainingIds.has(workflow.id) || !visibleCanvas.workflows.includes(workflow))
        .map((workflow) =>
          positions.has(workflow.id)
            ? { ...workflow, position: positions.get(workflow.id) || workflow.position }
            : workflow,
        ),
      edges: current.edges.filter(
        (edge) =>
          !remainingIds.size ||
          ('portId' in edge.source
            ? remainingIds.has(edge.source.workflowId) && remainingIds.has(edge.target.workflowId)
            : remainingIds.has(edge.source.workflowId) && remainingIds.has(edge.target.workflowId)),
      ),
    }));
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    const nextEdges = applyEdgeChanges(changes, flowEdges);
    if (!changes.some((change) => change.type === 'remove')) {
      return;
    }
    const remaining = new Set(nextEdges.map((edge) => edge.id));
    if (focusedWorkflowId) {
      onCanvasChange((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === focusedWorkflowId
            ? {
                ...workflow,
                internalEdges: workflow.internalEdges.filter((edge) => remaining.has(edge.id)),
              }
            : workflow,
        ),
      }));
      return;
    }
    onCanvasChange((current) => ({
      ...current,
      edges: current.edges.filter((edge) => remaining.has(edge.id)),
    }));
  }

  const handleConnect: OnConnect = (connection) => {
    const edge = edgeFromConnection(visibleCanvas, connection, connectionMode);
    if (!edge) {
      return;
    }
    if (focusedWorkflowId) {
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
    onCanvasChange((current) => ({
      ...current,
      edges: [...current.edges.filter((item) => item.id !== edge.id), edge],
    }));
    onSelect({ type: 'edge', id: edge.id });
  };

  function handleDrop(event: DragEvent<HTMLElement>) {
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
    if (item.kind !== 'workflow') {
      return;
    }
    onCanvasChange((current) => addWorkflowFromPalette(current, item, position));
  }

  function openCreateMenu(event: ReactMouseEvent<Element> | MouseEvent) {
    event.preventDefault();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    setNodeCreateMenu({
      x: event.clientX,
      y: event.clientY,
      position: flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, target),
    });
  }

  function handleConnectEnd(event: MouseEvent | TouchEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (!connectStart || target?.closest('.react-flow__handle, .react-flow__node')) {
      setConnectStart(null);
      return;
    }
    const point = pointerPoint(event);
    setNodeCreateMenu({
      x: point.x,
      y: point.y,
      position: flowPositionFromPoint(flowInstance, point),
      pendingConnection: connectStart,
    });
    setConnectStart(null);
  }

  function createMenuItem(item: PaletteItem) {
    if (focusedWorkflowId && item.kind === 'workflow') {
      return;
    }
    if (!focusedWorkflowId && item.kind !== 'workflow') {
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
    }
    setNodeCreateMenu(null);
  }

  return (
    <main
      className="workspace-canvas-surface"
      aria-label="Workspace Canvas"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onContextMenu={openCreateMenu}
    >
      <CanvasToolbar
        connectionMode={connectionMode}
        focusedWorkflowId={focusedWorkflowId}
        workflowRun={workflowRun}
        onExitFocus={() => onFocusedWorkflow(null)}
      />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectStart={(_, params) =>
          setConnectStart({
            nodeId: String(params.nodeId || ''),
            handleId: params.handleId || null,
            mode: connectionMode,
          })
        }
        onConnectEnd={handleConnectEnd}
        onInit={(instance) => setFlowInstance(instance)}
        onNodeClick={(_, node) => {
          if (focusedWorkflowId) {
            handleSelectInternal(node.id, node.id);
            return;
          }
          onSelect({ type: 'workflow', id: node.id });
        }}
        onNodeDoubleClick={(_, node) => {
          if (!focusedWorkflowId) {
            onFocusedWorkflow(node.id);
          }
        }}
        onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })}
        onPaneClick={() => onSelect({ type: 'workflow', id: canvas.rootWorkflowId })}
        onPaneContextMenu={openCreateMenu}
        fitView
        minZoom={0.18}
        maxZoom={1.7}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
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
  focusedWorkflowId,
  workflowRun,
  onExitFocus,
}: {
  connectionMode: ConnectionMode;
  focusedWorkflowId: string | null;
  workflowRun: WorkflowRunResult | null;
  onExitFocus: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="Canvas Toolbar">
      <span className={`mode-pill ${connectionMode === 'data' ? 'data' : 'control'}`}>
        {connectionMode === 'data' ? 'Data Edge: 蓝色实线' : 'Control Edge: 灰色虚线'}
      </span>
      <span>状态：{workflowRun ? statusLabel(workflowRun.status) : '未运行'}</span>
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
      style={{ left: x, top: y }}
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
  const focusNode = workflow.internalNodes.length === 1 && workflow.internalNodes[0]?.id === workflow.id;
  return (
    <article
      className={[
        'workflow-container',
        workflow.boundaryKind ? 'workflow-boundary-container' : '',
        data.selected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`workflow-container-${id}`}
      style={{ width: workflow.size.width, minHeight: workflow.size.height }}
      onClick={() => {
        if (focusNode) {
          data.onSelectInternal(workflow.id, workflow.id);
        }
      }}
      onDoubleClick={() => data.onOpenFocus(workflow.id)}
    >
      <WorkflowDirectoryPill
        directory={bindingDirectory(workflow, data.binding)}
        status={data.binding?.status || 'unbound'}
        onConfigure={() => data.onConfigureWorkflow(workflow.id)}
      />
      <WorkflowHeader workflow={workflow} />
      <div className="workflow-nested-canvas">
        <WorkflowPortColumn
          workflowId={workflow.id}
          direction="input"
          ports={workflow.inputPorts}
          onSelectPort={data.onSelectPort}
        />
        <div className="internal-node-grid" aria-label={`${workflow.title} internal nodes`}>
          {workflow.internalNodes.map((node) => (
            <InternalNodeCard
              key={node.id}
              node={node}
              onClick={() => data.onSelectInternal(workflow.id, node.id)}
            />
          ))}
          {workflow.internalNodes.length === 0 ? (
            <div className="empty-internal-node">内部节点未展开</div>
          ) : null}
        </div>
        <WorkflowPortColumn
          workflowId={workflow.id}
          direction="output"
          ports={workflow.outputPorts}
          onSelectPort={data.onSelectPort}
        />
      </div>
    </article>
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

function InternalNodeCard({ node, onClick }: { node: InternalNodeView; onClick: () => void }) {
  return (
    <button type="button" className="internal-node-card" onClick={onClick}>
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
      <dd>{edge.kind === 'data' ? '蓝色实线' : '灰色虚线'}</dd>
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

function toFlowNodes(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  bindings: Record<string, WorkflowBindingView>,
  onSelectPortFn: (workflowId: string, port: WorkflowPortView) => void,
  onSelectInternalFn: (workflowId: string, nodeId: string) => void,
  onOpenFocus: (workflowId: string) => void,
  onConfigureWorkflow: (workflowId: string) => void,
): WorkflowFlowNode[] {
  return canvas.workflows.map((workflow) => ({
    id: workflow.id,
    type: 'workflowContainer',
    position: workflow.position,
    selected: selection.type === 'workflow' && selection.id === workflow.id,
    data: {
      workflow,
      binding: bindings[workflow.id],
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      onSelectPort: onSelectPortFn,
      onSelectInternal: onSelectInternalFn,
      onOpenFocus,
      onConfigureWorkflow,
    },
  }));
}

function toFlowEdges(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
): Edge[] {
  return canvas.edges.map((edge) => {
    const isSelected = selection.type === 'edge' && selection.id === edge.id;
    if (edge.kind === 'data') {
      return {
        id: edge.id,
        source: edge.source.workflowId,
        target: edge.target.workflowId,
        sourceHandle: portHandleId(edge.source.workflowId, 'output', edge.source.portId),
        targetHandle: portHandleId(edge.target.workflowId, 'input', edge.target.portId),
        label: `${edge.source.portId} -> ${edge.target.portId}`,
        selected: isSelected,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#1d78d6' },
        className: 'workflow-edge-data',
        style: { stroke: '#1d78d6', strokeWidth: isSelected ? 3 : 2 },
      };
    }
    return {
      id: edge.id,
      source: edge.source.workflowId,
      target: edge.target.workflowId,
      label: 'control',
      selected: isSelected,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#7a8793' },
      className: 'workflow-edge-control',
      style: {
        stroke: connectionMode === 'control' || isSelected ? '#5d6670' : '#8b96a1',
        strokeWidth: isSelected ? 2.5 : 1.6,
        strokeDasharray: '7 7',
      },
    };
  });
}

function edgeFromConnection(
  canvas: WorkspaceCanvasModel,
  connection: Connection,
  connectionMode: ConnectionMode,
): WorkflowCanvasEdge | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }
  const sourceHandle = parsePortHandle(connection.sourceHandle);
  const targetHandle = parsePortHandle(connection.targetHandle);
  if (connectionMode === 'control') {
    if (isWorkflowBoundaryId(connection.source) || isWorkflowBoundaryId(connection.target)) {
      return null;
    }
    return {
      id: uniqueEdgeId(canvas, 'control', connection.source, connection.target),
      kind: 'control',
      source: { workflowId: connection.source },
      target: { workflowId: connection.target },
      condition: null,
    };
  }
  if (
    !sourceHandle ||
    !targetHandle ||
    sourceHandle.direction !== 'output' ||
    targetHandle.direction !== 'input'
  ) {
    return null;
  }
  return {
    id: uniqueEdgeId(canvas, 'data', sourceHandle.workflowId, targetHandle.workflowId),
    kind: 'data',
    source: { workflowId: sourceHandle.workflowId, portId: sourceHandle.portId },
    target: { workflowId: targetHandle.workflowId, portId: targetHandle.portId },
    materialization: 'copy',
  };
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
    sourceKind: recoveredKind,
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
    version: '0.3.0',
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
    version: '0.3.0',
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
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 110, ranksep: 130 });
  canvas.workflows.forEach((workflow) =>
    layout.setNode(workflow.id, {
      width: workflow.size.width,
      height: workflow.size.height + 52,
    }),
  );
  canvas.edges
    .filter((edge) => edge.kind === 'control')
    .forEach((edge) => layout.setEdge(edge.source.workflowId, edge.target.workflowId));
  dagre.layout(layout);
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
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

function applyRunStatusToCanvas(
  canvas: WorkspaceCanvasModel,
  workflowRun: WorkflowRunResult,
): WorkspaceCanvasModel {
  const statusByNode = new Map(workflowRun.nodes.map((node) => [node.node_id, node.status]));
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const workflowStatus =
        (statusByNode.get(workflow.id) as WorkflowStatus | undefined) ||
        (workflow.id === workflowRun.workflow_id ? (workflowRun.status as WorkflowStatus) : undefined);
      return {
        ...workflow,
        status: workflowStatus || workflow.status,
        internalNodes: workflow.internalNodes.map((node) => ({
          ...node,
          status: (statusByNode.get(node.id) as WorkflowStatus | undefined) || workflowStatus || node.status,
        })),
      };
    }),
  };
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
  return {
    id: `data_${sourceWorkflowId}_${sourcePortId}_${targetWorkflowId}_${targetPortId}`,
    kind: 'data',
    source: { workflowId: sourceWorkflowId, portId: sourcePortId },
    target: { workflowId: targetWorkflowId, portId: targetPortId },
    materialization: 'copy',
  };
}

function controlEdge(sourceWorkflowId: string, targetWorkflowId: string): WorkflowCanvasEdge {
  return {
    id: `control_${sourceWorkflowId}_${targetWorkflowId}`,
    kind: 'control',
    source: { workflowId: sourceWorkflowId },
    target: { workflowId: targetWorkflowId },
    condition: null,
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

function onSelectPort(onSelect: (selection: CanvasSelection) => void) {
  return (workflowId: string, portValue: WorkflowPortView) =>
    onSelect({
      type: 'port',
      workflowId,
      portId: portValue.id,
      direction: portValue.direction,
    });
}

function onSelectInternal(onSelect: (selection: CanvasSelection) => void) {
  return (workflowId: string, nodeId: string) => onSelect({ type: 'internal', workflowId, nodeId });
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
    remainingIds.has(edge.source.workflowId) &&
    remainingIds.has(edge.target.workflowId)
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
      const capsuleId = item.kind === 'file_source' ? 'file-source.local' : item.capsuleId;
      const id = uniqueId(slugId(item.label || capsuleId), existingIds);
      const isTool = item.kind === 'tool' || item.kind === 'file_source';
      const task = isTool ? '本地工具节点' : item.label;
      const node: InternalNodeView = {
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
      return { ...workflow, internalNodes: [...workflow.internalNodes, node] };
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
      return {
        ...workflow,
        internalNodes: [...workflow.internalNodes, node],
        internalEdges: pendingEdge
          ? [...workflow.internalEdges.filter((edge) => edge.id !== pendingEdge.id), pendingEdge]
          : workflow.internalEdges,
      };
    }),
  };
}

function internalNodeFromPaletteItem(
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
  existingIds: Set<string>,
): InternalNodeView {
  const capsuleId = item.kind === 'file_source' ? 'file-source.local' : item.capsuleId;
  const id = uniqueId(slugId(item.label || capsuleId), existingIds);
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

function liveWorkflowRunFromEvents(
  graph: WorkflowGraph,
  runDir: string,
  events: RunEvent[],
): WorkflowRunResult {
  const statusByNode = new Map(graph.nodes.map((node) => [node.id, 'not_run']));
  let workflowStatus = events.length ? 'running' : 'not_run';
  for (const event of events) {
    const type = String(event.type || event.event || '');
    const nodeId = typeof event.node_id === 'string' ? event.node_id : '';
    if (nodeId && statusByNode.has(nodeId)) {
      if (type === 'node_scheduled') {
        statusByNode.set(nodeId, 'scheduled');
      } else if (type === 'node_started' || type === 'input_materialized') {
        statusByNode.set(nodeId, 'running');
      } else if (type === 'node_completed') {
        statusByNode.set(nodeId, 'success');
      } else if (type === 'node_failed') {
        statusByNode.set(nodeId, String(event.status || 'failed'));
      }
    }
    if (type === 'workflow_completed') {
      workflowStatus = 'success';
    } else if (type === 'workflow_failed') {
      workflowStatus = String(event.status || 'failed');
    } else if (type === 'workflow_started') {
      workflowStatus = 'running';
    }
  }
  return {
    workflow_id: graph.id,
    status: workflowStatus,
    run_dir: runDir,
    nodes: graph.nodes.map((node) => ({
      node_id: node.id,
      capsule_id: node.capsule_id,
      status: statusByNode.get(node.id) || 'not_run',
      run_dir: `${runDir}/nodes/${node.id}`,
      input_path: `${runDir}/nodes/${node.id}/input.json`,
      prompt_path: `${runDir}/nodes/${node.id}/resolved_prompt.md`,
      output_path: `${runDir}/nodes/${node.id}/output.json`,
      artifact_dir: `${runDir}/nodes/${node.id}/artifacts`,
      event_log: `${runDir}/nodes/${node.id}/events.jsonl`,
      stdout_log: `${runDir}/nodes/${node.id}/stdout.log`,
      stderr_log: `${runDir}/nodes/${node.id}/stderr.log`,
      errors: [],
    })),
    edges: graph.edges,
    errors: [],
  };
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
