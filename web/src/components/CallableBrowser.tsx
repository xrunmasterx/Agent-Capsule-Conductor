import { Boxes, FileText, Info, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { AgentClassDraft, CallableDetail, CallableSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  callables: CallableSummary[];
  loadError?: string;
  selectedCallableId: string;
  onSelect: (callableId: string) => void;
  onChanged?: () => void;
};

export function CallableBrowser({
  callables,
  loadError = '',
  selectedCallableId,
  onSelect,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<CallableDetail | null>(null);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgentClassDraft>(() => emptyAgentDraft());

  useEffect(() => {
    if (!selectedCallableId) {
      setDetail(null);
      return;
    }
    let ignore = false;
    setMessage('');
    api
      .callable(selectedCallableId)
      .then((payload) => {
        if (!ignore) {
          setDetail(payload.callable);
          setDraft(draftFromDetail(payload.callable));
          setEditing(false);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setDetail(null);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedCallableId]);

  async function saveDraft() {
    setMessage('');
    try {
      const result = detail
        ? await api.updateAgentCallable(detail.id, { ...draft, id: detail.id })
        : await api.createAgentCallable(draft);
      setDetail(result.callable);
      setDraft(draftFromDetail(result.callable));
      setEditing(false);
      onSelect(result.callable.id);
      onChanged?.();
      setMessage(`已保存 ${result.callable.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteDraft() {
    if (!detail || detail.kind !== 'agent_class') {
      return;
    }
    setMessage('');
    try {
      await api.deleteAgentCallable(detail.id);
      setDetail(null);
      setDraft(emptyAgentDraft());
      setEditing(false);
      onChanged?.();
      setMessage(`已删除 ${detail.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="panel callable-browser" aria-label="Callable 资源库">
      <div className="panel-header">
        <div>
          <h2>Callable 资源库</h2>
          <p>{callables.length} 个 AgentClassTemplate / ToolClassTemplate</p>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            setDetail(null);
            setDraft(emptyAgentDraft());
            setEditing(true);
          }}
        >
          新建 AgentClassTemplate
        </button>
      </div>
      {loadError ? <div className="notice">Callable 模板加载失败：{loadError}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <div className="split-view">
        <aside className="list-panel">
          {callables.map((item) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className={selectedCallableId === item.id ? 'list-item selected' : 'list-item'}
              onClick={() => onSelect(item.id)}
            >
              <strong>{item.id}</strong>
              <span>{item.kind}</span>
              <small>{item.backend}</small>
            </button>
          ))}
          {callables.length === 0 && !loadError ? (
            <div className="empty-state">没有发现 Callable 模板。</div>
          ) : null}
        </aside>
        <section className="editor-panel" aria-label="Callable 详情">
          {editing ? (
            <AgentClassEditor
              draft={draft}
              selectedId={detail?.id || ''}
              onDraft={setDraft}
              onSave={saveDraft}
              onCancel={() => {
                setEditing(false);
                if (detail) {
                  setDraft(draftFromDetail(detail));
                }
              }}
              onDelete={detail?.kind === 'agent_class' ? deleteDraft : undefined}
            />
          ) : detail ? (
            <CallableDetailView detail={detail} onEdit={() => setEditing(true)} />
          ) : (
            <div className="empty-state">选择一个 Callable 模板，或新建 AgentClassTemplate。</div>
          )}
        </section>
      </div>
    </section>
  );
}

function CallableDetailView({ detail, onEdit }: { detail: CallableDetail; onEdit: () => void }) {
  return (
    <>
      <div className="detail-grid">
        <div>
          <Info aria-hidden="true" size={16} />
          <span>ID</span>
          <strong>{detail.id}</strong>
        </div>
        <div>
          <Workflow aria-hidden="true" size={16} />
          <span>Kind</span>
          <strong>{detail.kind}</strong>
        </div>
        <div>
          <Boxes aria-hidden="true" size={16} />
          <span>Backend</span>
          <strong>{detail.backend}</strong>
        </div>
        <div>
          <FileText aria-hidden="true" size={16} />
          <span>Source</span>
          <strong>{detail.source_path || detail.source_id}</strong>
        </div>
      </div>
      {detail.kind === 'agent_class' ? (
        <button type="button" className="secondary-action" onClick={onEdit}>
          编辑 AgentClassTemplate
        </button>
      ) : null}
      {detail.default_prompt ? (
        <>
          <h3>Default Prompt</h3>
          <CodeBlock title="Default Prompt" content={detail.default_prompt} variant="text" />
        </>
      ) : null}
      <h3>输入端口</h3>
      <CodeBlock title="输入端口" content={JSON.stringify(detail.input_ports, null, 2)} variant="json" />
      <h3>输出端口</h3>
      <CodeBlock title="输出端口" content={JSON.stringify(detail.output_ports, null, 2)} variant="json" />
      <h3>Artifact Contract</h3>
      <CodeBlock
        title="Artifact Contract"
        content={JSON.stringify(detail.artifact_contract, null, 2)}
        variant="json"
      />
      <h3>Metadata</h3>
      <CodeBlock title="Metadata" content={JSON.stringify(detail.metadata, null, 2)} variant="json" />
    </>
  );
}

function AgentClassEditor({
  draft,
  selectedId,
  onDraft,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: AgentClassDraft;
  selectedId: string;
  onDraft: (draft: AgentClassDraft) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [portsText, setPortsText] = useState(() => portsEditorText(draft));

  useEffect(() => {
    setPortsText(portsEditorText(draft));
  }, [draft.id]);

  function update<K extends keyof AgentClassDraft>(key: K, value: AgentClassDraft[K]) {
    onDraft({ ...draft, [key]: value });
  }

  function applyPortsText(value: string) {
    setPortsText(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        onDraft({
          ...draft,
          input_ports: (parsed as { input_ports?: Record<string, unknown> }).input_ports || draft.input_ports,
          output_ports: (parsed as { output_ports?: Record<string, unknown> }).output_ports || draft.output_ports,
        });
      }
    } catch {
      // Keep the invalid text visible; the last valid parsed ports remain in draft.
    }
  }

  return (
    <section className="inspector-stack callable-editor-form">
      <label>
        ID
        <input
          value={draft.id}
          disabled={Boolean(selectedId)}
          onChange={(event) => update('id', event.target.value)}
          placeholder="stock-market-research.codex"
        />
      </label>
      <label>
        Display Name
        <input value={draft.name || ''} onChange={(event) => update('name', event.target.value)} />
      </label>
      <label>
        Runtime
        <select value={draft.runtime || 'codex_cli'} onChange={(event) => update('runtime', event.target.value)}>
          <option value="codex_cli">codex_cli</option>
          <option value="generic_cli">generic_cli</option>
        </select>
      </label>
      <label>
        Description
        <input value={draft.description || ''} onChange={(event) => update('description', event.target.value)} />
      </label>
      <label>
        System Methodology / Default Prompt
        <textarea
          rows={10}
          value={draft.default_prompt || ''}
          onChange={(event) => update('default_prompt', event.target.value)}
          placeholder="固定方法论、边界和输出格式"
        />
      </label>
      <label>
        Ports JSON
        <textarea rows={8} value={portsText} onChange={(event) => applyPortsText(event.target.value)} />
      </label>
      <div className="toolbar-actions">
        <button type="button" className="primary-action" onClick={() => void onSave()}>
          保存
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        {onDelete ? (
          <button type="button" className="danger-action" onClick={() => void onDelete()}>
            删除
          </button>
        ) : null}
      </div>
    </section>
  );
}

function emptyAgentDraft(): AgentClassDraft {
  return {
    id: '',
    version: '0.1.0',
    runtime: 'codex_cli',
    default_prompt: '',
    input_ports: { main: { type: 'artifact', required: false } },
    output_ports: { main: { type: 'artifact', required: true } },
    artifact_contract: {},
  };
}

function draftFromDetail(detail: CallableDetail): AgentClassDraft {
  return {
    id: detail.id,
    version: detail.version,
    runtime: detail.runtime || 'codex_cli',
    name: detail.name,
    description: detail.description,
    default_prompt: detail.default_prompt || '',
    input_ports: detail.input_ports,
    output_ports: detail.output_ports,
    artifact_contract: Array.isArray(detail.artifact_contract) ? {} : detail.artifact_contract,
    metadata: detail.metadata,
  };
}

function portsEditorText(draft: AgentClassDraft): string {
  return JSON.stringify(
    {
      input_ports: draft.input_ports || { main: { type: 'artifact', required: false } },
      output_ports: draft.output_ports || { main: { type: 'artifact', required: true } },
    },
    null,
    2,
  );
}
