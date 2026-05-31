import { useEffect, useState } from 'react';

import { api } from '../api';
import type { InteractionRequest } from '../types';

type Props = {
  runId: string;
};

const kindLabels: Record<InteractionRequest['kind'], string> = {
  approval: '审批',
  ask: '追问',
  confirm: '确认',
  suggest: '建议',
};

export function InteractionPanel({ runId }: Props) {
  const [items, setItems] = useState<InteractionRequest[]>([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!runId) {
      return;
    }
    let ignore = false;
    api
      .runInteractions(runId)
      .then((result) => {
        if (!ignore) {
          setItems(result.interactions.filter((item) => item.status === 'pending'));
        }
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      });
    return () => {
      ignore = true;
    };
  }, [runId]);

  async function submitAnswer(interaction: InteractionRequest, answer: Record<string, unknown>) {
    setBusyId(interaction.interaction_id);
    setError('');
    try {
      await api.answerInteraction(runId, interaction.interaction_id, answer);
      setItems((current) => current.filter((item) => item.interaction_id !== interaction.interaction_id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusyId('');
    }
  }

  if (!runId) {
    return null;
  }

  return (
    <section className="interaction-panel" aria-label="待处理交互">
      <header className="panel-header">
        <h3>待处理</h3>
        <p>{items.length ? `${items.length} 项待回复` : '暂无待处理交互'}</p>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="interaction-cards">
        {items.map((interaction) => (
          <article key={interaction.interaction_id} className="interaction-card">
            <div className="interaction-card-head">
              <strong>{kindLabels[interaction.kind]}</strong>
              <span>{interaction.node_id || '运行级'}</span>
            </div>
            <p>{interaction.prompt}</p>
            {interaction.kind === 'approval' ? (
              <div className="interaction-actions">
                <button
                  type="button"
                  disabled={busyId === interaction.interaction_id}
                  onClick={() => submitAnswer(interaction, { decision: 'approve' })}
                >
                  通过
                </button>
                <button
                  type="button"
                  disabled={busyId === interaction.interaction_id}
                  onClick={() => submitAnswer(interaction, { decision: 'reject' })}
                >
                  拒绝
                </button>
              </div>
            ) : null}
            {interaction.kind === 'confirm' ? (
              <div className="interaction-actions">
                <button
                  type="button"
                  disabled={busyId === interaction.interaction_id}
                  onClick={() => submitAnswer(interaction, { confirmed: true })}
                >
                  确认
                </button>
                <button
                  type="button"
                  disabled={busyId === interaction.interaction_id}
                  onClick={() => submitAnswer(interaction, { confirmed: false })}
                >
                  取消
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
