import { useEffect, useState } from 'react';

import { shortPath } from '../../format';
import type { ArtifactContent } from '../../types';
import type { SelectedDetailsEvidenceAction, SelectedEntityDetailsModel } from '../../types/workbench';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import { combinedLogText } from '../../workbench/model/selectedNodeModel';
import { CodeBlock } from '../CodeBlock';
import { LiveOutputViewer } from '../execution/RunOverlay';
import { StructuredValueView } from './StructuredValueView';

type SelectionOutputPaneProps = {
  model: SelectedEntityDetailsModel;
  liveState?: WorkbenchLiveStreamState;
  agentEventText?: string;
  artifactCacheByPath: Record<string, ArtifactContent>;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
};

export function SelectionOutputPane({
  model,
  liveState,
  agentEventText = '',
  artifactCacheByPath,
  onEnsureArtifactContent,
}: SelectionOutputPaneProps) {
  const outputAction = evidenceActionByLabel(model.evidenceActions, 'output.json');
  const outputPath = outputAction?.path || '';
  const outputArtifact = outputPath ? artifactCacheByPath[outputPath] || null : null;
  const defaultOutputView: 'live' = 'live';
  const [outputView, setOutputView] = useState<'live' | 'final'>(defaultOutputView);
  const [logStream, setLogStream] = useState<'all' | 'stdout' | 'stderr'>('all');

  useEffect(() => {
    setOutputView(defaultOutputView);
    setLogStream('all');
  }, [defaultOutputView, model.key]);

  useEffect(() => {
    if (outputView === 'final') {
      void onEnsureArtifactContent(outputPath);
    }
  }, [model.status, onEnsureArtifactContent, outputPath, outputView]);

  const combinedLog = combinedLogText(model.log);
  const visibleLog =
    logStream === 'stdout'
      ? model.log.stdout
      : logStream === 'stderr'
        ? model.log.stderr
        : [combinedLog || model.log.excerpt, agentEventText].filter(Boolean).join('\n\n');

  return (
    <section className="selection-output-pane" aria-label="输出">
      <header className="selection-pane-header">
        <div>
          <span>输出</span>
          <h3>{outputView === 'final' ? '最终结果' : '实时输出'}</h3>
        </div>
        <small title={outputPath || undefined}>{outputPath ? shortPath(outputPath) : '没有可用证据'}</small>
      </header>
      <div className="selection-output-view-tabs" role="tablist" aria-label="输出视图">
        <button
          type="button"
          className={outputView === 'live' ? 'active' : ''}
          onClick={() => setOutputView('live')}
        >
          实时输出
        </button>
        <button
          type="button"
          className={outputView === 'final' ? 'active' : ''}
          onClick={() => setOutputView('final')}
          disabled={!outputPath}
        >
          最终结果
        </button>
      </div>
      {outputView === 'live' ? (
        <section className="selection-output-content" aria-label="实时输出内容">
          {liveState?.events.length ? (
            <LiveOutputViewer events={liveState.events} status={liveState.status} emptyText="当前节点还没有实时输出。" />
          ) : (
            <>
              <div className="selection-log-stream-tabs" role="tablist" aria-label="Live output stream">
                {(['all', 'stdout', 'stderr'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={logStream === tab ? 'active' : ''}
                    onClick={() => setLogStream(tab)}
                  >
                    {tab === 'all' ? 'all' : tab}
                  </button>
                ))}
              </div>
              <div className="selection-log-output selection-live-output" role="log" aria-live="polite">
                {visibleLog.trim() ? (
                  <pre>{visibleLog}</pre>
                ) : (
                  <p className="empty-state">当前节点还没有实时输出。</p>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="selection-open-artifact inline selection-output-final" aria-label="最终结果内容">
          {outputArtifact ? (
            <ReadableOutputResult content={outputArtifact} />
          ) : (
            <div className="selection-log-output artifact-empty">
              <p className="empty-state">当前节点还没有真实 output.json。</p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function ReadableOutputResult({ content }: { content: ArtifactContent }) {
  const parsed = parseArtifactPayload(content.content);
  if (!parsed.ok) {
    return (
      <article className="readable-output-result">
        <section className="readable-output-section">
          <h4>文本结果</h4>
          <StructuredValueView value={content.content} />
        </section>
      </article>
    );
  }
  return (
    <article className="readable-output-result">
      <ReadableOutputPayload value={parsed.value} />
      <details className="readable-output-raw">
        <summary>查看原始 JSON</summary>
        <CodeBlock title={content.path} content={content.content} variant={content.type} />
      </details>
    </article>
  );
}

function ReadableOutputPayload({ value }: { value: unknown }) {
  if (!isOutputRecord(value)) {
    return (
      <section className="readable-output-section">
        <h4>结果</h4>
        <StructuredValueView value={value} />
      </section>
    );
  }

  const priorityKeys = [
    'summary',
    'report_markdown',
    'markdown',
    'analysis',
    'conclusion',
    'recommendation',
    'recommendations',
    'findings',
    'next_actions',
    'result',
    'output',
    'outputs',
  ];
  const status = scalarText(value.status);
  const renderedKeys = new Set<string>();
  const priorityEntries = priorityKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key) && !isEmptyOutputValue(value[key]))
    .map((key) => {
      renderedKeys.add(key);
      return [key, value[key]] as const;
    });
  const remainingEntries = Object.entries(value).filter(
    ([key, item]) => key !== 'status' && !renderedKeys.has(key) && !isEmptyOutputValue(item),
  );

  if (status) {
    renderedKeys.add('status');
  }

  return (
    <>
      {status ? (
        <div className="summary-meta-row">
          <span>状态：{status}</span>
        </div>
      ) : null}
      {priorityEntries.length || remainingEntries.length ? (
        <>
          {priorityEntries.map(([key, item]) => (
            <section key={key} className="readable-output-section">
              <h4>{outputFieldLabel(key)}</h4>
              <StructuredValueView value={item} />
            </section>
          ))}
          {remainingEntries.map(([key, item]) => (
            <section key={key} className="readable-output-section secondary">
              <h4>{outputFieldLabel(key)}</h4>
              <StructuredValueView value={item} />
            </section>
          ))}
        </>
      ) : (
        <section className="readable-output-section">
          <h4>结果</h4>
          <StructuredValueView value={value} />
        </section>
      )}
    </>
  );
}

function parseArtifactPayload(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false };
  }
}

function evidenceActionByLabel(
  actions: SelectedDetailsEvidenceAction[],
  label: string,
): SelectedDetailsEvidenceAction | undefined {
  return actions.find((action) => action.label === label);
}

function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function outputFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    summary: '摘要',
    report_markdown: '报告',
    markdown: '正文',
    analysis: '分析',
    conclusion: '结论',
    recommendation: '建议',
    recommendations: '建议',
    findings: '发现',
    next_actions: '下一步',
    result: '结果',
    output: '输出',
    outputs: '命名输出',
  };
  return labels[key] || key.replace(/_/gu, ' ');
}

function isEmptyOutputValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isOutputRecord(value) && Object.keys(value).length === 0;
}

function isOutputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
