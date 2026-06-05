import { FileJson, FileText, ScrollText, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import { formatDuration, shortPath, statusTone } from '../format';
import { zhCN as t } from '../i18n/zh-CN';
import type {
  ArtifactContent,
  ArtifactLink,
  NodeRunSummary,
  ReplayPayload,
  RunSummary,
} from '../types';
import { CodeBlock } from './CodeBlock';
import { InteractionPanel } from './InteractionPanel';

type Props = {
  runId: string;
};

export function RunInspector({ runId }: Props) {
  return <RunInspectorCore runId={runId} />;
}

export function RunInspectorCore({ runId }: Props) {
  const [run, setRun] = useState<RunSummary | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [error, setError] = useState<string>('');
  const [debugMessage, setDebugMessage] = useState('');
  const [replayPayload, setReplayPayload] = useState<ReplayPayload | null>(null);
  const [isBusy, setIsBusy] = useState(false);

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
    <section className="panel inspector" aria-label="运行检查器">
      <header className="panel-header">
        <div>
          <h2>运行检查器</h2>
          <p>{run ? run.run_id : '未选择运行'}</p>
        </div>
        {run ? <span className={`pill ${statusTone(run.status)}`}>{run.status}</span> : null}
      </header>
      {error ? <div className="notice">运行错误: {error}</div> : null}
      {run ? <InteractionPanel runId={run.run_id} /> : null}
      {run ? (
        <div className="inspector-grid">
          <div className="dag-list" aria-label="运行节点列表">
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
                  <small>{node.callable_id}</small>
                </span>
                <span className={`pill ${statusTone(node.status)}`}>{node.status}</span>
              </button>
            ))}
          </div>
          {selectedNode ? (
            <div className="node-detail-stack">
              <NodeDetail
                node={selectedNode}
                artifacts={artifacts}
                content={content}
                onReadPath={readPath}
              />
              <RunDebuggerPanel
                run={run}
                node={selectedNode}
                replayPayload={replayPayload}
                debugMessage={debugMessage}
                isBusy={isBusy}
                onReplay={async () => {
                  setIsBusy(true);
                  try {
                    const payload = await api.replayRun(run.run_id, selectedNode.node_id);
                    setReplayPayload(payload);
                    setDebugMessage(`已回放 ${selectedNode.node_id}`);
                  } finally {
                    setIsBusy(false);
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">选择一个运行来检查它的 Session 和 Artifact Bundle。</div>
      )}
    </section>
  );
}

type RunDebuggerPanelProps = {
  run: RunSummary;
  node: NodeRunSummary;
  replayPayload: ReplayPayload | null;
  debugMessage: string;
  isBusy: boolean;
  onReplay: () => Promise<void>;
};

function RunDebuggerPanel({
  run,
  node,
  replayPayload,
  debugMessage,
  isBusy,
  onReplay,
}: RunDebuggerPanelProps) {
  return (
    <section className="detail-surface debugger-panel" aria-label="调试面板">
      <header className="panel-header compact">
        <div>
          <h3>{t.debugger}</h3>
          <p>
            {run.run_id} / {node.node_id}
          </p>
        </div>
      </header>
      <div className="debugger-actions">
        <button type="button" onClick={() => void onReplay()} disabled={isBusy}>
          {t.replay}
        </button>
      </div>
      {debugMessage ? <div className="notice neutral">{debugMessage}</div> : null}
      {replayPayload ? (
        <CodeBlock
          title="replay.json"
          content={JSON.stringify(replayPayload, null, 2)}
          variant="json"
        />
      ) : null}
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
    { label: '输入', icon: FileJson, path: node.input_path },
    { label: 'Prompt', icon: FileText, path: node.prompt_path },
    { label: '输出', icon: FileJson, path: node.output_path },
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
          <span>耗时</span>
          <strong>{formatDuration(node.duration_ms)}</strong>
        </div>
        <div>
          <span>摘要</span>
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
      <section className="artifact-list" aria-label="节点产物">
        <h3>产物</h3>
        {artifacts.length === 0 ? <p className="muted">暂无可见产物。</p> : null}
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
        <div className="empty-state">选择输入、输出、日志、事件或产物。</div>
      )}
    </div>
  );
}
