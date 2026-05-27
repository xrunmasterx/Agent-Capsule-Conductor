import { FileCode2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { ArtifactContent, ArtifactLink, RunSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  run?: RunSummary;
};

export function ArtifactViewer({ run }: Props) {
  const firstNode = run?.nodes[0];
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);

  useEffect(() => {
    if (!run?.run_id || !firstNode?.node_id) {
      setArtifacts([]);
      return;
    }
    let ignore = false;
    api.nodeArtifacts(run.run_id, firstNode.node_id).then((result) => {
      if (!ignore) {
        setArtifacts(result.artifacts);
      }
    });
    return () => {
      ignore = true;
    };
  }, [run?.run_id, firstNode?.node_id]);

  async function readArtifact(path: string) {
    setContent(await api.artifact(path));
  }

  return (
    <section className="panel artifact-viewer" aria-label="产物查看器">
      <header className="panel-header">
        <div>
          <h2>产物查看器</h2>
          <p>{run ? `${run.run_id} / ${firstNode?.node_id || '无节点'}` : '未选择运行'}</p>
        </div>
        <FileCode2 aria-hidden="true" size={20} />
      </header>
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
    const entries = Object.entries(payload as Record<string, unknown>);
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
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `数组，${value.length} 项`;
  }
  if (typeof value === 'object') {
    return `对象，${Object.keys(value as Record<string, unknown>).length} 个字段`;
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
