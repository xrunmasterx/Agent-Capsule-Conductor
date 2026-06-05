import { AlertTriangle, GitPullRequest, Inbox, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import type { DecisionInbox, DecisionInboxItem } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  onViewRun?: (runId: string) => void;
};

export function DecisionInboxPanel({ onViewRun }: Props) {
  const [inbox, setInbox] = useState<DecisionInbox | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let ignore = false;
    api
      .decisions()
      .then((payload) => {
        if (ignore) {
          return;
        }
        setInbox(payload);
        setSelectedId((current) => current || payload.items[0]?.id || '');
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const selected = useMemo(
    () => inbox?.items.find((item) => item.id === selectedId) || inbox?.items[0],
    [inbox, selectedId],
  );

  async function runSafeAction(item: DecisionInboxItem, actionKind: string) {
    setActionResult(null);
    if (actionKind === 'view_run' && item.run?.run_id) {
      onViewRun?.(item.run.run_id);
      return;
    }
    if (!item.graphops?.patch_path) {
      return;
    }
    const result =
      actionKind === 'validate_patch'
        ? await api.graphopsValidate(item.graphops.patch_path, true)
        : await api.graphopsDryRun(item.graphops.patch_path, true);
    setActionResult(result);
  }

  return (
    <section className="panel decision-inbox" aria-label="决策收件箱">
      <header className="panel-header">
        <div>
          <h2>决策收件箱</h2>
          <p>聚合失败、人工确认和 GraphOps 提案；v1 只读，不执行破坏性 apply。</p>
        </div>
        <Inbox aria-hidden="true" size={20} />
      </header>
      {error ? <div className="notice">Decision Inbox 错误: {error}</div> : null}
      {inbox ? (
        <div className="decision-layout">
          <aside className="decision-list" aria-label="决策事项列表">
            <div className="metric-strip compact">
              <div>
                <span>Open</span>
                <strong>{inbox.counts.open}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{inbox.counts.failed_runs + inbox.counts.failed_nodes}</strong>
              </div>
              <div>
                <span>GraphOps</span>
                <strong>{inbox.counts.graphops_proposals}</strong>
              </div>
            </div>
            {inbox.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selected?.id === item.id ? 'decision-item selected' : 'decision-item'}
                onClick={() => {
                  setSelectedId(item.id);
                  setActionResult(null);
                }}
              >
                {decisionIcon(item)}
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                </span>
                <em className={`severity ${item.severity}`}>{item.severity}</em>
              </button>
            ))}
            {inbox.items.length === 0 ? <p className="empty-state">暂无需要处理的决策事项。</p> : null}
          </aside>
          {selected ? (
            <DecisionDetail
              item={selected}
              actionResult={actionResult}
              onAction={(kind) => void runSafeAction(selected, kind)}
            />
          ) : null}
        </div>
      ) : (
        <div className="empty-state">正在加载决策事项...</div>
      )}
    </section>
  );
}

function DecisionDetail({
  item,
  actionResult,
  onAction,
}: {
  item: DecisionInboxItem;
  actionResult: Record<string, unknown> | null;
  onAction: (kind: string) => void;
}) {
  return (
    <article className="decision-detail">
      <header>
        <div>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
        </div>
        <span className={`pill ${item.severity === 'high' ? 'failed' : 'running'}`}>{item.kind}</span>
      </header>
      <dl className="definition-grid compact">
        <dt>状态</dt>
        <dd>{item.status}</dd>
        <dt>运行</dt>
        <dd>{item.run?.run_id || 'n/a'}</dd>
        <dt>节点</dt>
        <dd>{item.node?.node_id || 'n/a'}</dd>
        <dt>GraphOps</dt>
        <dd>
          {item.graphops
            ? `${item.graphops.patch_id} / ${item.graphops.operation_count} ops`
            : 'n/a'}
        </dd>
      </dl>
      <section className="decision-actions">
        {item.actions.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={action.destructive}
            onClick={() => onAction(action.kind)}
          >
            {action.label}
          </button>
        ))}
      </section>
      <section className="artifact-list">
        <h3>证据</h3>
        {item.evidence.map((evidence) => (
          <article className="artifact-row" key={`${evidence.kind}:${evidence.path || evidence.url}`}>
            <span>{evidence.label}</span>
            <small>{evidence.path || evidence.url}</small>
          </article>
        ))}
      </section>
      {item.graphops?.dry_run_only ? (
        <>
        <div className="notice neutral">
          GraphOps 当前仅支持 proposal / validate / dry-run；real apply 未实现，本页面不会直接应用补丁。
        </div>
        <div className="notice neutral" hidden>
          GraphOps real apply 仍然需要 validate / dry-run / human approval，本页面不会直接应用补丁。
        </div>
        </>
      ) : null}
      {actionResult ? (
        <CodeBlock title="action-result.json" content={JSON.stringify(actionResult, null, 2)} variant="json" />
      ) : null}
    </article>
  );
}

function decisionIcon(item: DecisionInboxItem) {
  if (item.kind === 'graphops_proposal') {
    return <GitPullRequest aria-hidden="true" size={16} />;
  }
  if (item.kind === 'manual_review') {
    return <ShieldCheck aria-hidden="true" size={16} />;
  }
  return <AlertTriangle aria-hidden="true" size={16} />;
}
