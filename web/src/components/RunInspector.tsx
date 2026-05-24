import { FileJson, FileText, ScrollText, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import { formatDuration, shortPath, statusTone } from '../format';
import type { ArtifactContent, ArtifactLink, NodeRunSummary, RunSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  runId: string;
};

export function RunInspector({ runId }: Props) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!runId) {
      return;
    }
    let ignore = false;
    async function loadRun() {
      setError('');
      const detail = await api.run(runId);
      if (!ignore) {
        setRun(detail);
        setSelectedNodeId(detail.nodes[0]?.node_id || '');
      }
    }
    loadRun().catch((requestError) => {
      if (!ignore) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    });
    return () => {
      ignore = true;
    };
  }, [runId]);

  const selectedNode = run?.nodes.find((node) => node.node_id === selectedNodeId) || run?.nodes[0];

  useEffect(() => {
    if (!run?.run_id || !selectedNode?.node_id) {
      return;
    }
    let ignore = false;
    api
      .nodeArtifacts(run.run_id, selectedNode.node_id)
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
  }, [run?.run_id, selectedNode?.node_id]);

  async function readPath(path: string | null | undefined) {
    if (!path) {
      return;
    }
    setContent(await api.artifact(path));
  }

  return (
    <section className="panel inspector" aria-label="Run Inspector">
      <header className="panel-header">
        <div>
          <h2>Run Inspector</h2>
          <p>{run ? run.run_id : 'No run selected'}</p>
        </div>
        {run ? <span className={`pill ${statusTone(run.status)}`}>{run.status}</span> : null}
      </header>
      {error ? <div className="notice">Run error: {error}</div> : null}
      {run ? (
        <div className="inspector-grid">
          <div className="dag-list" aria-label="Run node list">
            {run.nodes.map((node, index) => (
              <button
                key={node.node_id}
                type="button"
                className={selectedNode?.node_id === node.node_id ? 'node selected' : 'node'}
                onClick={() => setSelectedNodeId(node.node_id)}
              >
                <span className="node-index">{index + 1}</span>
                <span>
                  <strong>{node.node_id}</strong>
                  <small>{node.capsule_id}</small>
                </span>
                <span className={`pill ${statusTone(node.status)}`}>{node.status}</span>
              </button>
            ))}
          </div>
          {selectedNode ? (
            <NodeDetail
              node={selectedNode}
              artifacts={artifacts}
              content={content}
              onReadPath={readPath}
            />
          ) : null}
        </div>
      ) : (
        <div className="empty-state">Select a run to inspect its Session and Artifact Bundle.</div>
      )}
    </section>
  );
}

type NodeDetailProps = {
  node: NodeRunSummary;
  artifacts: ArtifactLink[];
  content: ArtifactContent | null;
  onReadPath: (path: string | null | undefined) => void;
};

function NodeDetail({ node, artifacts, content, onReadPath }: NodeDetailProps) {
  const paths = [
    { label: 'Input', icon: FileJson, path: node.input_path },
    { label: 'Prompt', icon: FileText, path: node.prompt_path },
    { label: 'Output', icon: FileJson, path: node.output_path },
    { label: 'Events', icon: ScrollText, path: node.event_log },
    { label: 'Stdout', icon: Terminal, path: node.stdout_log },
    { label: 'Stderr', icon: Terminal, path: node.stderr_log },
  ];
  return (
    <div className="node-detail">
      <div className="metric-strip">
        <div>
          <span>Session</span>
          <strong>{node.session_id || 'n/a'}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatDuration(node.duration_ms)}</strong>
        </div>
        <div>
          <span>Summary</span>
          <strong>{node.summary || 'n/a'}</strong>
        </div>
      </div>
      <div className="path-grid">
        {paths.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              className="path-button"
              onClick={() => onReadPath(item.path)}
              disabled={!item.path}
              title={item.path || item.label}
            >
              <Icon aria-hidden="true" size={16} />
              <span>{item.label}</span>
              <small>{shortPath(item.path)}</small>
            </button>
          );
        })}
      </div>
      <section className="artifact-list" aria-label="Node artifacts">
        <h3>Artifacts</h3>
        {artifacts.length === 0 ? <p className="muted">No visible artifacts.</p> : null}
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
      </section>
      {content ? (
        <CodeBlock title={content.path} content={content.content} variant={content.type} />
      ) : (
        <div className="empty-state">Choose input, output, logs, events, or an artifact.</div>
      )}
    </div>
  );
}

