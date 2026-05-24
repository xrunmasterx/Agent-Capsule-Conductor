import { ArrowRight, Box, GitBranch, Play, Plus, Save, TestTube } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import type { CapsuleSummary, WorkflowDetail, WorkflowGraph, WorkflowSummary } from '../types';

type Props = {
  workflows: WorkflowSummary[];
  capsules: CapsuleSummary[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

export function WorkflowViewer({ workflows, capsules, selectedWorkflowId, onSelect, onChanged }: Props) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph>(emptyGraph());
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedCapsuleId, setSelectedCapsuleId] = useState('');
  const [nodeInputText, setNodeInputText] = useState('{}');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!selectedWorkflowId) {
      return;
    }
    let ignore = false;
    api.workflow(selectedWorkflowId).then((workflow) => {
      if (!ignore) {
        setDetail(workflow);
        const nextGraph = workflow.graph || graphFromLegacyWorkflow(workflow);
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes[0]?.id || '');
      }
    });
    return () => {
      ignore = true;
    };
  }, [selectedWorkflowId]);

  const tasks = detail?.workflow.tasks || [];
  const taskNames = useMemo(() => new Set(tasks.map((task) => task.name)), [tasks]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || graph.nodes[0];

  useEffect(() => {
    setSelectedCapsuleId((current) => current || capsules[0]?.id || '');
  }, [capsules]);

  useEffect(() => {
    setNodeInputText(JSON.stringify(selectedNode?.input || {}, null, 2));
  }, [selectedNode?.id]);

  function createGraph() {
    const nextGraph = emptyGraph();
    setDetail(null);
    setGraph(nextGraph);
    setSelectedNodeId('');
    setMessage('New workflow graph ready to edit');
  }

  function addNode() {
    if (!selectedCapsuleId) {
      return;
    }
    const nodeId = `node_${graph.nodes.length + 1}`;
    setGraph({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: nodeId,
          capsule_id: selectedCapsuleId,
          input: {},
          position: { x: graph.nodes.length * 280, y: 0 },
        },
      ],
    });
    setSelectedNodeId(nodeId);
  }

  function connectLastTwoNodes() {
    if (graph.nodes.length < 2) {
      return;
    }
    const from = graph.nodes[graph.nodes.length - 2].id;
    const to = graph.nodes[graph.nodes.length - 1].id;
    const edge = { id: `edge_${from}_${to}`, from, to };
    setGraph({ ...graph, edges: [...graph.edges.filter((item) => item.id !== edge.id), edge] });
  }

  function applyNodeInput() {
    const parsed = JSON.parse(nodeInputText || '{}') as Record<string, unknown>;
    setGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === selectedNode?.id ? { ...node, input: parsed } : node,
      ),
    });
    setMessage(`Updated input for ${selectedNode?.id}`);
  }

  async function saveGraph() {
    const result = await api.saveWorkflow(graph, true);
    setMessage(`Saved ${result.workflow_id}`);
    onSelect(result.workflow_id);
    onChanged?.();
  }

  async function validateGraph() {
    await saveGraph();
    const result = await api.validateWorkflow(graph.id);
    setMessage(`Validate ${result.workflow_id}: ${result.status}`);
  }

  async function runGraph() {
    await saveGraph();
    const result = await api.runWorkflow(graph.id, `runs/ui_workflow_${graph.id}`);
    setMessage(`Run ${result.workflow_id}: ${result.status}`);
  }

  return (
    <section className="panel workflow-viewer" aria-label="Workflow Viewer">
      <header className="panel-header">
        <div>
          <h2>Workflow Builder</h2>
          <p>{workflows.length} workflow files</p>
        </div>
        <button type="button" className="primary-action" onClick={createGraph}>
          <GitBranch aria-hidden="true" size={16} />
          New Graph
        </button>
      </header>
      <div className="split compact">
        <div className="list-stack">
          <section className="inline-form" aria-label="Capsule Palette">
            <h3>Capsule Palette</h3>
            <select
              aria-label="Capsule palette"
              value={selectedCapsuleId}
              onChange={(event) => setSelectedCapsuleId(event.target.value)}
            >
              {capsules.map((capsule) => (
                <option key={capsule.id} value={capsule.id}>
                  {capsule.id}
                </option>
              ))}
            </select>
            <button type="button" onClick={addNode}>
              <Plus aria-hidden="true" size={16} />
              Add Node
            </button>
            <button type="button" onClick={connectLastTwoNodes}>
              <ArrowRight aria-hidden="true" size={16} />
              Connect Last Two
            </button>
          </section>
          {workflows.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              className={
                selectedWorkflowId === workflow.workflow_id ? 'list-item selected' : 'list-item'
              }
              onClick={() => onSelect(workflow.workflow_id)}
            >
              <strong>{workflow.workflow_id}</strong>
              <span>{workflow.path}</span>
              <small>{workflow.task_count} nodes</small>
            </button>
          ))}
        </div>
        {detail || graph.nodes.length > 0 ? (
          <div className="detail-surface">
            <h3>{graph.name || graph.id}</h3>
            <p>{graph.description || detail?.workflow.description || 'Editable workflow graph'}</p>
            {message ? <div className="notice neutral">{message}</div> : null}
            <div className="editor-toolbar">
              <button type="button" onClick={saveGraph}>
                <Save aria-hidden="true" size={16} />
                Save Graph
              </button>
              <button type="button" onClick={validateGraph}>
                <TestTube aria-hidden="true" size={16} />
                Validate Graph
              </button>
              <button type="button" onClick={runGraph}>
                <Play aria-hidden="true" size={16} />
                Run Graph
              </button>
            </div>
            <div className="workflow-dag" aria-label="Workflow DAG">
              {graph.nodes.length > 0
                ? graph.nodes.map((node) => (
                    <article
                      key={node.id}
                      className={selectedNode?.id === node.id ? 'workflow-node selected' : 'workflow-node'}
                    >
                      <button type="button" className="node-select" onClick={() => setSelectedNodeId(node.id)}>
                        <Box aria-hidden="true" size={16} />
                        <strong>{node.id}</strong>
                      </button>
                      <p>Capsule: {node.capsule_id}</p>
                      {graph.edges
                        .filter((edge) => edge.to === node.id)
                        .map((edge) => (
                          <p key={edge.id} className="edge-line">
                            {edge.from}
                            <ArrowRight aria-hidden="true" size={14} />
                            {edge.to}
                          </p>
                        ))}
                    </article>
                  ))
                : tasks.map((task) => {
                const dependencies = task.depends_on || [];
                const capsuleId = findCapsuleId(task.command);
                const runDir = findRunDir(task.command);
                return (
                  <article key={task.name} className="workflow-node">
                    <header>
                      <Box aria-hidden="true" size={16} />
                      <strong>{task.name}</strong>
                      <span>{task.type || 'task'}</span>
                    </header>
                    {dependencies.length > 0 ? (
                      <p className="edge-line">
                        {dependencies.filter((dependency) => taskNames.has(dependency)).join(', ')}
                        <ArrowRight aria-hidden="true" size={14} />
                        {task.name}
                      </p>
                    ) : (
                      <p className="edge-line">Entry node</p>
                    )}
                    {capsuleId ? <p>Capsule: {capsuleId}</p> : null}
                    {runDir ? <p>Run dir: {runDir}</p> : null}
                  </article>
                );
              })}
            </div>
            {selectedNode ? (
              <section className="editor-panel" aria-label="Node Inspector">
                <h3>Node Input</h3>
                <p>{selectedNode.id}</p>
                <textarea
                  aria-label="Node input JSON"
                  value={nodeInputText}
                  onChange={(event) => setNodeInputText(event.target.value)}
                />
                <button type="button" onClick={applyNodeInput}>
                  Apply Node Input
                </button>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">Select a workflow.</div>
        )}
      </div>
    </section>
  );
}

function emptyGraph(): WorkflowGraph {
  return {
    id: 'ui_demo_graph',
    version: '0.1.0',
    name: 'UI Demo Graph',
    description: 'Editable workflow graph',
    nodes: [],
    edges: [],
  };
}

function graphFromLegacyWorkflow(workflow: WorkflowDetail): WorkflowGraph {
  if (workflow.graph) {
    return workflow.graph;
  }
  const tasks = workflow.workflow.tasks || [];
  return {
    id: workflow.workflow_id,
    version: workflow.workflow.version || '0.1.0',
    name: workflow.workflow.name || workflow.workflow_id,
    description: workflow.workflow.description,
    nodes: tasks.map((task, index) => ({
      id: task.name,
      capsule_id: findCapsuleId(task.command) || 'unknown',
      input: {},
      position: { x: index * 280, y: 0 },
    })),
    edges: tasks.flatMap((task) =>
      (task.depends_on || []).map((dependency) => ({
        id: `edge_${dependency}_${task.name}`,
        from: dependency,
        to: task.name,
      })),
    ),
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

function findRunDir(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const optionIndex = command.findIndex((item) => item === '--run-dir');
  const candidate = command[optionIndex + 1];
  return typeof candidate === 'string' ? candidate : '';
}
