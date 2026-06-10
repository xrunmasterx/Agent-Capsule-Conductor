import { FileCode2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { ArtifactContent, ArtifactLink, RunSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  run?: RunSummary;
};

export function ArtifactViewer({ run }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);

  const selectedNode = run?.nodes.find((n) => n.node_id === selectedNodeId) || run?.nodes[0];

  useEffect(() => {
    if (run?.nodes[0]?.node_id) {
      setSelectedNodeId(run.nodes[0].node_id);
    } else {
      setSelectedNodeId('');
    }
    setContent(null);
  }, [run?.run_id]);

  useEffect(() => {
    if (!run?.run_id || !selectedNode?.node_id) {
      setArtifacts([]);
      return;
    }
    let ignore = false;
    api.nodeArtifacts(run.run_id, selectedNode.node_id).then((result) => {
      if (!ignore) {
        setArtifacts(result.artifacts);
      }
    });
    return () => {
      ignore = true;
    };
  }, [run?.run_id, selectedNode?.node_id]);

  async function readArtifact(path: string) {
    setContent(await api.artifact(path));
  }

  function handleNodeChange(nodeId: string) {
    setSelectedNodeId(nodeId);
    setContent(null);
  }

  return (
    <section className="panel artifact-viewer" aria-label="产物查看器">
      <header className="panel-header">
        <div>
          <h2>产物查看器</h2>
          <p>{run ? `${run.run_id} / ${selectedNode?.node_id || '无节点'}` : '未选择运行'}</p>
        </div>
        <FileCode2 aria-hidden="true" size={20} />
      </header>
      {run && run.nodes.length > 1 ? (
        <div className="node-selector" role="tablist" aria-label="选择节点">
          {run.nodes.map((node) => (
            <button
              key={node.node_id}
              type="button"
              role="tab"
              aria-selected={selectedNode?.node_id === node.node_id}
              className={selectedNode?.node_id === node.node_id ? 'node-tab active' : 'node-tab'}
              onClick={() => handleNodeChange(node.node_id)}
            >
              {node.node_id}
            </button>
          ))}
        </div>
      ) : null}
      <div className="artifact-layout">
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <button
              key={artifact.path}
              type="button"
              className="artifact-row"
              onClick={() => readArtifact(artifact.path)}
            >
              <span>{artifact.name}</span>
              <small>{artifact.path}</small>
            </button>
          ))}
          {artifacts.length === 0 ? <div className="empty-state">暂无可用产物。</div> : null}
        </div>
        {content ? (
          <ReadableArtifact content={content} />
        ) : (
          <div className="empty-state">选择一个产物查看 markdown、JSON、文本、日志或 patch。</div>
        )}
      </div>
    </section>
  );
}

type ArtifactTab = 'readable' | 'raw';

export function ReadableArtifact({ content }: { content: ArtifactContent }) {
  const [tab, setTab] = useState<ArtifactTab>('readable');

  useEffect(() => {
    setTab('readable');
  }, [content.path]);

  return (
    <section className="readable-artifact" aria-label={`产物 ${content.name}`}>
      <header>
        <div>
          <h3>{content.name}</h3>
          <p>{content.path}</p>
        </div>
        <span className="pill">{artifactTypeLabel(content.type)}</span>
      </header>
      <div className="tab-strip" role="tablist" aria-label="产物视图">
        <button
          type="button"
          className={tab === 'readable' ? 'active' : ''}
          onClick={() => setTab('readable')}
        >
          可读视图
        </button>
        <button
          type="button"
          className={tab === 'raw' ? 'active' : ''}
          onClick={() => setTab('raw')}
        >
          原始数据
        </button>
      </div>
      {tab === 'readable' ? renderReadableContent(content) : null}
      {tab === 'raw' ? (
        <CodeBlock title={content.path} content={content.content} variant={content.type} />
      ) : null}
    </section>
  );
}

function renderReadableContent(content: ArtifactContent) {
  if (content.type === 'markdown') {
    return <MarkdownPreview content={content.content} />;
  }
  if (content.type === 'json') {
    return <JsonSummary content={content.content} />;
  }
  if (content.type === 'log') {
    return <LogPreview content={content.content} />;
  }
  if (content.type === 'patch') {
    return <PatchPreview content={content.content} />;
  }
  return <TextPreview content={content.content} />;
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split(/\r?\n/u);
  return (
    <article className="readable-document">
      {lines.map((line, index) => {
        const key = `${index}-${line}`;
        if (!line.trim()) {
          return <div key={key} className="doc-spacer" />;
        }
        if (line.startsWith('# ')) {
          return <h3 key={key}>{line.slice(2)}</h3>;
        }
        if (line.startsWith('## ')) {
          return <h4 key={key}>{line.slice(3)}</h4>;
        }
        if (line.startsWith('- ')) {
          return <p key={key} className="doc-list-item">{line.slice(2)}</p>;
        }
        return <p key={key}>{line}</p>;
      })}
    </article>
  );
}

function JsonSummary({ content }: { content: string }) {
  try {
    const payload = JSON.parse(content) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return <TextPreview content={JSON.stringify(payload, null, 2)} />;
    }
    const focusedSummary = renderFocusedJsonSummary(payload as Record<string, unknown>);
    if (focusedSummary) {
      return focusedSummary;
    }
    const entries = Object.entries(payload as Record<string, unknown>).filter(([, value]) => !isEmptyCollection(value));
    return (
      <article className="json-summary">
        <h4>摘要</h4>
        <dl className="definition-grid compact">
          {entries.slice(0, 12).map(([key, value]) => (
            <div key={key} className="definition-pair">
              <dt>{key}</dt>
              <dd>{briefValue(value)}</dd>
            </div>
          ))}
        </dl>
        {entries.length > 12 ? <p className="muted">还有 {entries.length - 12} 个字段在原始数据中。</p> : null}
      </article>
    );
  } catch {
    return <TextPreview content={content} />;
  }
}

function renderFocusedJsonSummary(payload: Record<string, unknown>) {
  const knownOutputKeys = ['summary', 'report_markdown', 'status', 'findings', 'next_actions', 'quality', 'outputs'];
  if (!knownOutputKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
    return null;
  }
  const summary = textField(payload.summary) || textField(payload.report_markdown);
  const report = textField(payload.report_markdown);
  const findings = arrayTextItems(payload.findings);
  const nextActions = arrayTextItems(payload.next_actions);
  const quality = isRecord(payload.quality) ? payload.quality : null;
  const outputs = isRecord(payload.outputs)
    ? Object.entries(payload.outputs)
        .filter(([, value]) => !isEmptyCollection(value))
        .map(([key]) => key)
    : [];
  const confidence = quality ? textField(quality.confidence) : '';
  const status = textField(payload.status);
  const hasFocusedContent = Boolean(summary || status || findings.length || nextActions.length || confidence || outputs.length);
  if (!hasFocusedContent) {
    return null;
  }
  return (
    <article className="json-summary json-summary-conclusion">
      <h4>结论</h4>
      {status || confidence ? (
        <div className="summary-meta-row">
          {status ? <span>状态：{status}</span> : null}
          {confidence ? <span>置信度：{confidence}</span> : null}
        </div>
      ) : null}
      {summary ? <p className="summary-lead">{summary}</p> : null}
      {report && report !== summary ? <pre className="summary-report">{report}</pre> : null}
      {renderSummaryList('发现', findings)}
      {renderSummaryList('下一步', nextActions)}
      {outputs.length ? (
        <section className="summary-section">
          <h5>命名输出</h5>
          <p>{outputs.join(', ')}</p>
        </section>
      ) : null}
    </article>
  );
}

function renderSummaryList(title: string, items: string[]) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="summary-section">
      <h5>{title}</h5>
      <ul>
        {items.slice(0, 6).map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textField(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function arrayTextItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => briefValue(item)).filter((item) => item && item !== '空');
}

function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function LogPreview({ content }: { content: string }) {
  const lines = content.split(/\r?\n/u);
  const visible = lines.slice(Math.max(0, lines.length - 200));
  return (
    <article className="log-preview">
      <h4>日志预览</h4>
      {lines.length > visible.length ? (
        <p className="muted">日志较长，仅展示最后 {visible.length} 行；完整内容在原始数据中。</p>
      ) : null}
      <pre>{visible.join('\n') || '(空日志)'}</pre>
    </article>
  );
}

function PatchPreview({ content }: { content: string }) {
  const additions = content.split(/\r?\n/u).filter((line) => line.startsWith('+')).length;
  const deletions = content.split(/\r?\n/u).filter((line) => line.startsWith('-')).length;
  return (
    <article className="patch-preview">
      <div className="metric-strip">
        <div>
          <span>新增行</span>
          <strong>{additions}</strong>
        </div>
        <div>
          <span>删除行</span>
          <strong>{deletions}</strong>
        </div>
        <div>
          <span>总行数</span>
          <strong>{content.split(/\r?\n/u).length}</strong>
        </div>
      </div>
      <pre>{content}</pre>
    </article>
  );
}

function TextPreview({ content }: { content: string }) {
  return (
    <article className="readable-document">
      <pre>{content || '(空内容)'}</pre>
    </article>
  );
}

function briefValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '空';
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => briefValue(item)).filter(Boolean).join('；') : '空';
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, item]) => !isEmptyCollection(item));
    if (entries.length === 0) {
      return '空';
    }
    const summary = entries
      .slice(0, 3)
      .map(([key, item]) => `${key}: ${briefValue(item)}`)
      .join('；');
    return entries.length > 3 ? `${summary}；...` : summary;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

function artifactTypeLabel(type: ArtifactContent['type']) {
  const labels: Record<ArtifactContent['type'], string> = {
    markdown: 'Markdown',
    json: 'JSON',
    log: '日志',
    patch: 'Patch',
    text: '文本',
  };
  return labels[type] || type;
}
