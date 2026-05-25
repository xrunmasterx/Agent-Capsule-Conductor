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
  RunDiffPayload,
  RunSummary,
} from '../types';
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
  const [debugMessage, setDebugMessage] = useState('');
  const [forkOverrideText, setForkOverrideText] = useState('{}');
  const [replayPayload, setReplayPayload] = useState<ReplayPayload | null>(null);
  const [diffPayload, setDiffPayload] = useState<RunDiffPayload | null>(null);
  const [lastDerivedRunDir, setLastDerivedRunDir] = useState('');
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

  useEffect(() => {
    if (!selectedNode?.input_path) {
      setForkOverrideText('{}');
      return;
    }
    let ignore = false;
    api
      .artifact(selectedNode.input_path)
      .then((result) => {
        if (!ignore) {
          setForkOverrideText(result.content || '{}');
        }
      })
      .catch(() => {
        if (!ignore) {
          setForkOverrideText('{}');
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedNode?.input_path]);

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
                  <small>{node.capsule_id}</small>
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
                forkOverrideText={forkOverrideText}
                replayPayload={replayPayload}
                diffPayload={diffPayload}
                debugMessage={debugMessage}
                isBusy={isBusy}
                onForkOverrideText={setForkOverrideText}
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
                onRerunNode={async () => {
                  setIsBusy(true);
                  try {
                    const outDir = nextDerivedRunDir('rerun_node', run.run_id, selectedNode.node_id);
                    const payload = await api.rerunNode(run.run_id, selectedNode.node_id, outDir);
                    setLastDerivedRunDir(payload.run_dir);
                    setDiffPayload(await api.diffRuns(run.run_dir, payload.run_dir));
                    setDebugMessage(`已重跑节点 ${selectedNode.node_id}`);
                  } finally {
                    setIsBusy(false);
                  }
                }}
                onRerunFrom={async () => {
                  setIsBusy(true);
                  try {
                    const outDir = nextDerivedRunDir('rerun_from', run.run_id, selectedNode.node_id);
                    const payload = await api.rerunFrom(run.run_id, selectedNode.node_id, outDir);
                    setLastDerivedRunDir(payload.run_dir);
                    setDiffPayload(await api.diffRuns(run.run_dir, payload.run_dir));
                    setDebugMessage(`已从节点 ${selectedNode.node_id} 重跑下游`);
                  } finally {
                    setIsBusy(false);
                  }
                }}
                onFork={async () => {
                  setIsBusy(true);
                  try {
                    const override = JSON.parse(forkOverrideText || '{}') as Record<string, unknown>;
                    const outDir = nextDerivedRunDir('fork', run.run_id, selectedNode.node_id);
                    const payload = await api.forkRun(run.run_id, selectedNode.node_id, outDir, override);
                    setLastDerivedRunDir(payload.run_dir);
                    setDiffPayload(await api.diffRuns(run.run_dir, payload.run_dir));
                    setDebugMessage(`已 Fork ${selectedNode.node_id}`);
                  } finally {
                    setIsBusy(false);
                  }
                }}
                onCompare={async () => {
                  if (!lastDerivedRunDir) {
                    return;
                  }
                  setIsBusy(true);
                  try {
                    setDiffPayload(await api.diffRuns(run.run_dir, lastDerivedRunDir));
                    setDebugMessage('已刷新运行对比');
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
  forkOverrideText: string;
  replayPayload: ReplayPayload | null;
  diffPayload: RunDiffPayload | null;
  debugMessage: string;
  isBusy: boolean;
  onForkOverrideText: (value: string) => void;
  onReplay: () => Promise<void>;
  onRerunNode: () => Promise<void>;
  onRerunFrom: () => Promise<void>;
  onFork: () => Promise<void>;
  onCompare: () => Promise<void>;
};

function RunDebuggerPanel({
  run,
  node,
  forkOverrideText,
  replayPayload,
  diffPayload,
  debugMessage,
  isBusy,
  onForkOverrideText,
  onReplay,
  onRerunNode,
  onRerunFrom,
  onFork,
  onCompare,
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
        <button type="button" onClick={() => void onRerunNode()} disabled={isBusy}>
          {t.rerunNode}
        </button>
        <button type="button" onClick={() => void onRerunFrom()} disabled={isBusy}>
          {t.rerunFrom}
        </button>
        <button type="button" onClick={() => void onFork()} disabled={isBusy}>
          {t.forkRun}
        </button>
        <button type="button" onClick={() => void onCompare()} disabled={isBusy || !diffPayload}>
          {t.compareRuns}
        </button>
      </div>
      <label className="inspector-label">
        Fork override JSON
        <textarea
          value={forkOverrideText}
          onChange={(event) => onForkOverrideText(event.target.value)}
        />
      </label>
      {debugMessage ? <div className="notice neutral">{debugMessage}</div> : null}
      {replayPayload ? (
        <CodeBlock
          title="replay.json"
          content={JSON.stringify(replayPayload, null, 2)}
          variant="json"
        />
      ) : null}
      {diffPayload ? (
        <CodeBlock
          title="run_diff.json"
          content={JSON.stringify(diffPayload, null, 2)}
          variant="json"
        />
      ) : null}
    </section>
  );
}

function nextDerivedRunDir(kind: string, runId: string, nodeId: string): string {
  return `runs/ui_${kind}_${runId}_${nodeId}_${Date.now()}`;
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
