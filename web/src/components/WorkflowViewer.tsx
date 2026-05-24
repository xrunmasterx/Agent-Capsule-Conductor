import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
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
  FileJson,
  FileText,
  GitBranch,
  LayoutDashboard,
  Play,
  Save,
  ScrollText,
  Search,
  Terminal,
  TestTube,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import dagre from 'dagre';

import { api } from '../api';
import { shortPath, statusTone } from '../format';
import { zhCN as t } from '../i18n/zh-CN';
import type {
  ArtifactContent,
  ArtifactLink,
  CapsuleSummary,
  NodeRunSummary,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowRunResult,
  WorkflowSummary,
} from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

type Selection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'workflow'; id: string };

type CapsuleNodeData = {
  label: string;
  capsuleId: string;
  runtime: string;
  status: string;
  warning?: string;
  artifactDir?: string | null;
};

type CapsuleFlowNode = Node<CapsuleNodeData, 'capsuleNode'>;

const nodeTypes = { capsuleNode: CapsuleNodeCard };

export function WorkflowViewer({
  workflows,
  capsules,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph>(emptyGraph());
  const [selection, setSelection] = useState<Selection>({ type: 'workflow', id: 'ui_demo_graph' });
  const [selectedCapsuleId, setSelectedCapsuleId] = useState('');
  const [nodeInputText, setNodeInputText] = useState('{}');
  const [nodeMappingText, setNodeMappingText] = useState('{}');
  const [edgeMappingText, setEdgeMappingText] = useState('{}');
  const [message, setMessage] = useState('');
  const [workflowRun, setWorkflowRun] = useState<WorkflowRunResult | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);

  useEffect(() => {
    if (!selectedWorkflowId) {
      return;
    }
    let ignore = false;
    api.workflow(selectedWorkflowId).then((workflow) => {
      if (!ignore) {
        const nextGraph = workflow.graph || graphFromLegacyWorkflow(workflow);
        setDetail(workflow);
        setGraph(nextGraph);
        setSelection(
          nextGraph.nodes[0]
            ? { type: 'node', id: nextGraph.nodes[0].id }
            : { type: 'workflow', id: nextGraph.id },
        );
        setWorkflowRun(null);
        setMessage('');
      }
    });
    return () => {
      ignore = true;
    };
  }, [selectedWorkflowId]);

  useEffect(() => {
    setSelectedCapsuleId((current) => current || capsules[0]?.id || '');
  }, [capsules]);

  const selectedNode =
    selection.type === 'node' ? graph.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge =
    selection.type === 'edge' ? graph.edges.find((edge) => edge.id === selection.id) : undefined;
  const selectedNodeRun = selectedNode
    ? workflowRun?.nodes.find((node) => node.node_id === selectedNode.id)
    : undefined;

  useEffect(() => {
    setNodeInputText(JSON.stringify(selectedNode?.input || {}, null, 2));
    setNodeMappingText(JSON.stringify(selectedNode?.input_mapping || {}, null, 2));
  }, [selectedNode?.id]);

  useEffect(() => {
    setEdgeMappingText(JSON.stringify(selectedEdge?.mapping || {}, null, 2));
  }, [selectedEdge?.id]);

  useEffect(() => {
    if (!workflowRun?.run_dir || !selectedNode?.id) {
      setArtifacts([]);
      return;
    }
    const runId = workflowRun.run_dir.split(/[\\/]/).filter(Boolean).at(-1) || workflowRun.run_dir;
    let ignore = false;
    api
      .nodeArtifacts(runId, selectedNode.id)
      .then((result) => {
        if (!ignore) {
          setArtifacts(result.artifacts);
        }
      })
      .catch(() => {
        if (!ignore) {
          setArtifacts([]);
        }
      });
    return () => {
      ignore = true;
    };
  }, [workflowRun?.run_dir, selectedNode?.id]);

  function createGraph() {
    const nextGraph = emptyGraph();
    setDetail(null);
    setGraph(nextGraph);
    setSelection({ type: 'workflow', id: nextGraph.id });
    setWorkflowRun(null);
    setMessage('已新建工作流画布');
  }

  function loadDemo(kind: 'serial' | 'parallel') {
    const nextGraph = kind === 'serial' ? serialDemoGraph() : parallelDemoGraph();
    setDetail(null);
    setGraph(nextGraph);
    setSelection({ type: 'node', id: nextGraph.nodes[0].id });
    setWorkflowRun(null);
    setMessage(kind === 'serial' ? '已加载串行 Demo' : '已加载并行 Demo');
  }

  function addNode() {
    const capsule = capsules.find((item) => item.id === selectedCapsuleId);
    if (!capsule) {
      return;
    }
    const nodeId = uniqueNodeId(graph, capsule.id.split('.')[0].replaceAll('-', '_'));
    const nextNode: WorkflowGraphNode = {
      id: nodeId,
      capsule_id: capsule.id,
      label: capsule.name,
      input: {},
      input_mapping: {},
      notes: '',
      position: { x: 120 + graph.nodes.length * 280, y: 180 },
    };
    setGraph({ ...graph, nodes: [...graph.nodes, nextNode] });
    setSelection({ type: 'node', id: nodeId });
  }

  function updateSelectedNode(patch: Partial<WorkflowGraphNode>) {
    if (!selectedNode) {
      return;
    }
    setGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === selectedNode.id ? { ...node, ...patch } : node,
      ),
    });
  }

  function applyNodeJson() {
    const input = JSON.parse(nodeInputText || '{}') as Record<string, unknown>;
    const inputMapping = JSON.parse(nodeMappingText || '{}') as Record<string, unknown>;
    updateSelectedNode({ input, input_mapping: inputMapping });
    setMessage(`已更新节点 ${selectedNode?.id} 的输入`);
  }

  function applyEdgeJson() {
    if (!selectedEdge) {
      return;
    }
    const mapping = JSON.parse(edgeMappingText || '{}') as Record<string, unknown>;
    setGraph({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === selectedEdge.id ? { ...edge, mapping } : edge,
      ),
    });
    setMessage(`已更新连接 ${selectedEdge.id} 的映射`);
  }

  function autoLayout() {
    const nextGraph = layoutGraph(graph);
    setGraph(nextGraph);
    setMessage('已执行自动布局');
  }

  async function saveGraph() {
    const result = await api.saveWorkflow(graph, true);
    setMessage(`已保存 ${result.workflow_id}`);
    onSelect(result.workflow_id);
    onChanged?.();
  }

  async function validateGraph() {
    try {
      await saveGraph();
      const result = await api.validateWorkflow(graph.id);
      setMessage(`${t.validationPassed}: ${result.workflow_id}`);
    } catch (error) {
      setMessage(`${t.validationFailed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runGraph() {
    try {
      await saveGraph();
      const result = await api.runWorkflow(graph.id, `runs/ui_workflow_${graph.id}`);
      setWorkflowRun(result);
      setMessage(`运行 ${result.workflow_id}: ${statusLabel(result.status)}`);
      onChanged?.();
    } catch (error) {
      setMessage(`运行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function readPath(path: string | null | undefined) {
    if (!path) {
      return;
    }
    setContent(await api.artifact(path));
  }

  return (
    <section className="panel workflow-viewer graph-workbench" aria-label="工作流">
      <header className="graph-toolbar">
        <div>
          <h2>{t.workflow}</h2>
          <p>{graph.name || detail?.workflow.name || graph.id}</p>
        </div>
        <div className="toolbar-actions" aria-label="工作流工具栏">
          <button type="button" className="primary-action" onClick={createGraph}>
            <GitBranch aria-hidden="true" size={16} />
            {t.new}
          </button>
          <button type="button" onClick={() => loadDemo('serial')}>
            {t.loadDemo} 串行
          </button>
          <button type="button" onClick={() => loadDemo('parallel')}>
            {t.loadDemo} 并行
          </button>
          <button type="button" onClick={saveGraph}>
            <Save aria-hidden="true" size={16} />
            {t.save}
          </button>
          <button type="button" onClick={validateGraph}>
            <TestTube aria-hidden="true" size={16} />
            {t.validate}
          </button>
          <button type="button" onClick={runGraph}>
            <Play aria-hidden="true" size={16} />
            {t.run}
          </button>
          <button type="button" onClick={autoLayout}>
            <LayoutDashboard aria-hidden="true" size={16} />
            {t.autoLayout}
          </button>
        </div>
      </header>

      <div className="graph-layout">
        <aside className="node-library" aria-label="节点库">
          <header>
            <h3>{t.capsuleLibrary}</h3>
            <span>{capsules.length}</span>
          </header>
          <label className="search-box">
            <Search aria-hidden="true" size={15} />
            <select
              aria-label="搜索节点"
              value={selectedCapsuleId}
              onChange={(event) => setSelectedCapsuleId(event.target.value)}
            >
              {capsules.map((capsule) => (
                <option key={capsule.id} value={capsule.id}>
                  {capsule.id}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary-action" onClick={addNode}>
            <Boxes aria-hidden="true" size={16} />
            {t.addNode}
          </button>
          <div className="workflow-list" aria-label="打开工作流">
            <h4>{t.open}</h4>
            {workflows.map((workflow) => (
              <button
                key={workflow.workflow_id}
                type="button"
                className={
                  selectedWorkflowId === workflow.workflow_id ? 'list-item selected' : 'list-item'
                }
                onClick={() => onSelect(workflow.workflow_id)}
              >
                <strong>{workflow.name || workflow.workflow_id}</strong>
                <span>{workflow.path}</span>
                <small>{workflow.task_count} nodes</small>
              </button>
            ))}
          </div>
        </aside>

        <WorkflowGraphCanvas
          graph={graph}
          capsules={capsules}
          workflowRun={workflowRun}
          selectedNodeId={selection.type === 'node' ? selection.id : ''}
          selectedEdgeId={selection.type === 'edge' ? selection.id : ''}
          onGraphChange={setGraph}
          onSelect={setSelection}
        />

        <aside className="graph-inspector" aria-label="属性面板">
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              capsule={capsules.find((capsule) => capsule.id === selectedNode.capsule_id)}
              nodeRun={selectedNodeRun}
              artifacts={artifacts}
              content={content}
              inputText={nodeInputText}
              mappingText={nodeMappingText}
              onInputText={setNodeInputText}
              onMappingText={setNodeMappingText}
              onApplyJson={applyNodeJson}
              onReadPath={readPath}
              onUpdate={updateSelectedNode}
            />
          ) : null}
          {selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              mappingText={edgeMappingText}
              onMappingText={setEdgeMappingText}
              onApplyJson={applyEdgeJson}
              onUpdate={(patch) =>
                setGraph({
                  ...graph,
                  edges: graph.edges.map((edge) =>
                    edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
                  ),
                })
              }
            />
          ) : null}
          {!selectedNode && !selectedEdge ? <WorkflowInspector graph={graph} /> : null}
        </aside>
      </div>

      <footer className="graph-bottom-panel" aria-label="运行面板">
        <strong>{workflowRun ? statusLabel(workflowRun.status) : t.notRun}</strong>
        <span>{message || '可从节点库添加节点，拖拽节点右侧输出连接到另一个节点左侧输入。'}</span>
        {workflowRun?.errors?.length ? <span>{workflowRun.errors.join('; ')}</span> : null}
      </footer>
    </section>
  );
}

function WorkflowGraphCanvas({
  graph,
  capsules,
  workflowRun,
  selectedNodeId,
  selectedEdgeId,
  onGraphChange,
  onSelect,
}: {
  graph: WorkflowGraph;
  capsules: CapsuleSummary[];
  workflowRun: WorkflowRunResult | null;
  selectedNodeId: string;
  selectedEdgeId: string;
  onGraphChange: (graph: WorkflowGraph) => void;
  onSelect: (selection: Selection) => void;
}) {
  const flowNodes = useMemo(
    () => toFlowNodes(graph, capsules, workflowRun, selectedNodeId),
    [graph, capsules, workflowRun, selectedNodeId],
  );
  const flowEdges = useMemo(() => toFlowEdges(graph, selectedEdgeId), [graph, selectedEdgeId]);
  const [nodes, setNodes] = useState(flowNodes);
  const [edges, setEdges] = useState(flowEdges);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges]);

  function handleNodesChange(changes: NodeChange<CapsuleFlowNode>[]) {
    setNodes((current) => {
      const nextNodes = applyNodeChanges(changes, current) as CapsuleFlowNode[];
      const positions = new Map(nextNodes.map((node) => [node.id, node.position]));
      onGraphChange({
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          position: positions.get(node.id) || node.position,
        })),
      });
      return nextNodes;
    });
  }

  function handleEdgesChange(changes: EdgeChange[]) {
    setEdges((current) => {
      const nextEdges = applyEdgeChanges(changes, current);
      const remaining = new Set(nextEdges.map((edge) => edge.id));
      onGraphChange({
        ...graph,
        edges: graph.edges.filter((edge) => remaining.has(edge.id)),
      });
      return nextEdges;
    });
  }

  const handleConnect: OnConnect = (connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }
    const edgeId = uniqueEdgeId(graph, connection.source, connection.target);
    const edge: WorkflowGraphEdge = {
      id: edgeId,
      from: connection.source,
      to: connection.target,
      label: '依赖',
      mapping: {},
      condition: null,
    };
    onGraphChange({ ...graph, edges: [...graph.edges, edge] });
    onSelect({ type: 'edge', id: edgeId });
  };

  return (
    <div className="graph-canvas" aria-label="图谱画布">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => onSelect({ type: 'node', id: node.id })}
        onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })}
        onPaneClick={() => onSelect({ type: 'workflow', id: graph.id })}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
      </ReactFlow>
    </div>
  );
}

function CapsuleNodeCard({ data, selected }: NodeProps<CapsuleFlowNode>) {
  return (
    <article className={selected ? 'capsule-flow-node selected' : 'capsule-flow-node'}>
      <Handle type="target" position={Position.Left} aria-label="输入" />
      <header>
        <strong>{data.label}</strong>
        <span className={`pill ${statusTone(data.status)}`}>{statusLabel(data.status)}</span>
      </header>
      <p>{data.capsuleId}</p>
      <small>
        {t.runtime}: {data.runtime}
      </small>
      {data.warning ? <small className="warning-text">{data.warning}</small> : null}
      {data.artifactDir ? <small>{t.artifacts}: {shortPath(data.artifactDir)}</small> : null}
      <Handle type="source" position={Position.Right} aria-label="输出" />
    </article>
  );
}

function NodeInspector({
  node,
  capsule,
  nodeRun,
  artifacts,
  content,
  inputText,
  mappingText,
  onInputText,
  onMappingText,
  onApplyJson,
  onReadPath,
  onUpdate,
}: {
  node: WorkflowGraphNode;
  capsule?: CapsuleSummary;
  nodeRun?: NodeRunSummary;
  artifacts: ArtifactLink[];
  content: ArtifactContent | null;
  inputText: string;
  mappingText: string;
  onInputText: (value: string) => void;
  onMappingText: (value: string) => void;
  onApplyJson: () => void;
  onReadPath: (path: string | null | undefined) => void;
  onUpdate: (patch: Partial<WorkflowGraphNode>) => void;
}) {
  const paths = [
    { label: t.input, icon: FileJson, path: nodeRun?.input_path },
    { label: t.prompt, icon: FileText, path: nodeRun?.prompt_path },
    { label: t.output, icon: FileJson, path: nodeRun?.output_path },
    { label: 'Events', icon: ScrollText, path: nodeRun?.event_log },
    { label: 'Stdout', icon: Terminal, path: nodeRun?.stdout_log },
    { label: 'Stderr', icon: Terminal, path: nodeRun?.stderr_log },
  ];
  return (
    <section className="inspector-section" aria-label="节点属性">
      <h3>{t.nodeProperties}</h3>
      <label>
        Label
        <input
          value={node.label || node.id}
          onChange={(event) => onUpdate({ label: event.target.value })}
        />
      </label>
      <dl className="definition-grid compact">
        <dt>capsule id</dt>
        <dd>{node.capsule_id}</dd>
        <dt>{t.runtime}</dt>
        <dd>{capsule?.runtime || 'unknown'}</dd>
        <dt>{t.status}</dt>
        <dd>{nodeRun ? statusLabel(nodeRun.status) : t.notRun}</dd>
        <dt>output path</dt>
        <dd>{shortPath(nodeRun?.output_path)}</dd>
        <dt>artifact path</dt>
        <dd>{shortPath(nodeRun?.artifact_dir)}</dd>
        <dt>logs path</dt>
        <dd>{shortPath(nodeRun?.stderr_log || nodeRun?.event_log)}</dd>
      </dl>
      <label>
        {t.input}
        <textarea value={inputText} onChange={(event) => onInputText(event.target.value)} />
      </label>
      <label>
        {t.mapping}
        <textarea value={mappingText} onChange={(event) => onMappingText(event.target.value)} />
      </label>
      <label>
        Notes
        <textarea
          value={node.notes || ''}
          onChange={(event) => onUpdate({ notes: event.target.value })}
        />
      </label>
      <button type="button" onClick={onApplyJson}>
        {t.save} {t.input}
      </button>
      <div className="path-grid single">
        {paths.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              className="path-button"
              onClick={() => onReadPath(item.path)}
              disabled={!item.path}
            >
              <Icon aria-hidden="true" size={16} />
              <span>{item.label}</span>
              <small>{shortPath(item.path)}</small>
            </button>
          );
        })}
      </div>
      <section className="artifact-list" aria-label="产物">
        <h3>{t.artifacts}</h3>
        {artifacts.map((artifact) => (
          <button
            key={artifact.path}
            type="button"
            className="artifact-row"
            onClick={() => onReadPath(artifact.path)}
          >
            <span>{artifact.name}</span>
            <small>{artifact.size_bytes} bytes</small>
          </button>
        ))}
        {artifacts.length === 0 ? <p className="muted">暂无产物</p> : null}
      </section>
      {content ? (
        <CodeBlock title={content.path} content={content.content} variant={content.type} />
      ) : null}
    </section>
  );
}

function EdgeInspector({
  edge,
  mappingText,
  onMappingText,
  onApplyJson,
  onUpdate,
}: {
  edge: WorkflowGraphEdge;
  mappingText: string;
  onMappingText: (value: string) => void;
  onApplyJson: () => void;
  onUpdate: (patch: Partial<WorkflowGraphEdge>) => void;
}) {
  return (
    <section className="inspector-section" aria-label="连接属性">
      <h3>{t.edgeProperties}</h3>
      <dl className="definition-grid compact">
        <dt>from</dt>
        <dd>{edge.from}</dd>
        <dt>to</dt>
        <dd>{edge.to}</dd>
      </dl>
      <label>
        Label
        <input
          value={edge.label || ''}
          onChange={(event) => onUpdate({ label: event.target.value })}
        />
      </label>
      <label>
        {t.mapping}
        <textarea value={mappingText} onChange={(event) => onMappingText(event.target.value)} />
      </label>
      <button type="button" onClick={onApplyJson}>
        {t.save} {t.mapping}
      </button>
    </section>
  );
}

function WorkflowInspector({ graph }: { graph: WorkflowGraph }) {
  return (
    <section className="inspector-section" aria-label="工作流属性">
      <h3>{t.workflowProperties}</h3>
      <dl className="definition-grid compact">
        <dt>id</dt>
        <dd>{graph.id}</dd>
        <dt>version</dt>
        <dd>{graph.version}</dd>
        <dt>nodes</dt>
        <dd>{graph.nodes.length}</dd>
        <dt>edges</dt>
        <dd>{graph.edges.length}</dd>
      </dl>
    </section>
  );
}

function toFlowNodes(
  graph: WorkflowGraph,
  capsules: CapsuleSummary[],
  workflowRun: WorkflowRunResult | null,
  selectedNodeId: string,
): CapsuleFlowNode[] {
  return graph.nodes.map((node) => {
    const capsule = capsules.find((item) => item.id === node.capsule_id);
    const nodeRun = workflowRun?.nodes.find((item) => item.node_id === node.id);
    return {
      id: node.id,
      type: 'capsuleNode',
      selected: node.id === selectedNodeId,
      position: node.position || { x: 0, y: 0 },
      data: {
        label: node.label || node.id,
        capsuleId: node.capsule_id,
        runtime: capsule?.runtime || 'unknown',
        status: nodeRun?.status || 'not_run',
        warning: capsule ? undefined : t.missingNode,
        artifactDir: nodeRun?.artifact_dir,
      },
    };
  });
}

function toFlowEdges(graph: WorkflowGraph, selectedEdgeId: string): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    selected: edge.id === selectedEdgeId,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120 });
  graph.nodes.forEach((node) => layout.setNode(node.id, { width: 230, height: 112 }));
  graph.edges.forEach((edge) => layout.setEdge(edge.from, edge.to));
  dagre.layout(layout);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = layout.node(node.id);
      return position
        ? { ...node, position: { x: position.x - 115, y: position.y - 56 } }
        : node;
    }),
    metadata: { ...(graph.metadata || {}), layout: 'dagre-lr' },
  };
}

function emptyGraph(): WorkflowGraph {
  return {
    id: 'ui_demo_graph',
    version: '0.2.0',
    name: 'UI Demo 工作流',
    description: '可编辑工作流图',
    nodes: [],
    edges: [],
    metadata: { layout: 'manual' },
  };
}

function serialDemoGraph(): WorkflowGraph {
  return {
    id: 'demo_serial',
    version: '0.2.0',
    name: '串行 Demo 工作流',
    description: '两个节点串行连接的最小 Demo。',
    nodes: [
      {
        id: 'echo',
        capsule_id: 'echo-test.generic',
        label: '输入回显',
        position: { x: 80, y: 180 },
        input: { message: 'hello from graph' },
        input_mapping: {},
        notes: '第一个节点',
      },
      {
        id: 'fake',
        capsule_id: 'fake-agent.generic',
        label: '下游处理',
        position: { x: 440, y: 180 },
        input: {},
        input_mapping: { topic: '{{ nodes.echo.output.summary }}' },
        notes: '读取上游 output.summary',
      },
    ],
    edges: [
      {
        id: 'edge_echo_fake',
        from: 'echo',
        to: 'fake',
        label: '输出给下游',
        mapping: { topic: '{{ nodes.echo.output.summary }}' },
        condition: null,
      },
    ],
    metadata: { layout: 'left-to-right' },
  };
}

function parallelDemoGraph(): WorkflowGraph {
  return {
    id: 'demo_parallel',
    version: '0.2.0',
    name: '并行 Demo 工作流',
    description: '一个上游节点扇出到两个并行节点，再汇入最终节点。',
    nodes: [
      {
        id: 'plan',
        capsule_id: 'echo-test.generic',
        label: '任务规划',
        position: { x: 80, y: 240 },
        input: { message: 'plan research task' },
        input_mapping: {},
      },
      {
        id: 'branch_a',
        capsule_id: 'fake-agent.generic',
        label: '分支 A',
        position: { x: 420, y: 120 },
        input: {},
        input_mapping: { topic: '{{ nodes.plan.output.summary }}' },
      },
      {
        id: 'branch_b',
        capsule_id: 'fake-agent.generic',
        label: '分支 B',
        position: { x: 420, y: 360 },
        input: {},
        input_mapping: { topic: '{{ nodes.plan.output.summary }}' },
      },
      {
        id: 'merge',
        capsule_id: 'fake-agent.generic',
        label: '结果汇总',
        position: { x: 800, y: 240 },
        input: {},
        input_mapping: {
          topic: 'A={{ nodes.branch_a.output.summary }}; B={{ nodes.branch_b.output.summary }}',
        },
      },
    ],
    edges: [
      { id: 'edge_plan_a', from: 'plan', to: 'branch_a', label: '并行 A', mapping: {}, condition: null },
      { id: 'edge_plan_b', from: 'plan', to: 'branch_b', label: '并行 B', mapping: {}, condition: null },
      { id: 'edge_a_merge', from: 'branch_a', to: 'merge', label: '汇入', mapping: {}, condition: null },
      { id: 'edge_b_merge', from: 'branch_b', to: 'merge', label: '汇入', mapping: {}, condition: null },
    ],
    metadata: { layout: 'left-to-right' },
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
      capsule_id: findCapsuleId(task.command) || 'unknown',
      label: task.name,
      input: {},
      input_mapping: {},
      position: { x: index * 320, y: 160 },
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

function findCapsuleId(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const runIndex = command.lastIndexOf('run');
  const candidate = command[runIndex + 1];
  return typeof candidate === 'string' && candidate.includes('.') ? candidate : '';
}

function uniqueNodeId(graph: WorkflowGraph, prefix: string): string {
  const normalized = prefix.replace(/[^a-zA-Z0-9_-]/g, '_') || 'node';
  let index = graph.nodes.length + 1;
  let nodeId = `${normalized}_${index}`;
  const existing = new Set(graph.nodes.map((node) => node.id));
  while (existing.has(nodeId)) {
    index += 1;
    nodeId = `${normalized}_${index}`;
  }
  return nodeId;
}

function uniqueEdgeId(graph: WorkflowGraph, from: string, to: string): string {
  let edgeId = `edge_${from}_${to}`;
  const existing = new Set(graph.edges.map((edge) => edge.id));
  let index = 2;
  while (existing.has(edgeId)) {
    edgeId = `edge_${from}_${to}_${index}`;
    index += 1;
  }
  return edgeId;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    success: t.success,
    failed: t.failed,
    timeout: 'timeout',
    schema_error: t.schemaError,
    artifact_error: t.artifactError,
    running: t.running,
    not_run: t.notRun,
  };
  return labels[status] || status;
}
