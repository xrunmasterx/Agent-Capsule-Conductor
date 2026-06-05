import {
  Bot,
  Check,
  ChevronDown,
  Library,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { AgentClassDraft, CallableDetail, CallableSummary } from '../types';

type Props = {
  callables: CallableSummary[];
  loadError?: string;
  selectedCallableId: string;
  onSelect: (callableId: string) => void;
  onChanged?: () => void;
};

type AgentProvider = 'codex' | 'claude' | 'hermes' | 'cursor' | 'gemini' | 'generic_cli';

type AgentOption = {
  value: AgentProvider;
  label: string;
  runtime: string;
  accent: string;
  models: string[];
};

const AGENT_OPTIONS: AgentOption[] = [
  {
    value: 'codex',
    label: 'Codex',
    runtime: 'codex_cli',
    accent: '#0f766e',
    models: ['默认模型', '高能力模型', '快速模型'],
  },
  {
    value: 'claude',
    label: 'Claude',
    runtime: 'claude_sdk',
    accent: '#c15f2c',
    models: ['默认模型', '高能力模型', '长上下文模型'],
  },
  {
    value: 'hermes',
    label: 'Hermes',
    runtime: 'generic_cli',
    accent: '#6d5dfc',
    models: ['默认模型', '代码审阅模型', '快速模型'],
  },
  {
    value: 'cursor',
    label: 'Cursor',
    runtime: 'generic_cli',
    accent: '#111827',
    models: ['默认模型', '代码实现模型', '快速模型'],
  },
  {
    value: 'gemini',
    label: 'Gemini',
    runtime: 'generic_cli',
    accent: '#2563eb',
    models: ['默认模型', '多模态模型', '快速模型'],
  },
  {
    value: 'generic_cli',
    label: '自定义 CLI',
    runtime: 'generic_cli',
    accent: '#64748b',
    models: ['默认模型', '本地配置模型'],
  },
];

const THINKING_LEVELS = [
  { value: 'low', label: '轻量' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '深入' },
  { value: 'max', label: '极限' },
];

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
    const payload = normalizeDraftForSave(draft, detail?.id || '');
    try {
      const result = detail
        ? await api.updateAgentCallable(detail.id, payload)
        : await api.createAgentCallable(payload);
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
    <section className="panel callable-browser" aria-label="智能体工具资源库">
      <div className="callable-hero">
        <div>
          <span className="resource-eyebrow">
            <Library aria-hidden="true" size={15} />
            本地资源
          </span>
          <h2>智能体工具资源库</h2>
          <p>{callables.length} 个可复用智能体与工具</p>
        </div>
        <button
          type="button"
          className="resource-primary-action"
          onClick={() => {
            setDetail(null);
            setDraft(emptyAgentDraft());
            setEditing(true);
          }}
        >
          <Plus aria-hidden="true" size={17} />
          新建智能体
        </button>
      </div>
      {loadError ? <div className="notice">资源加载失败：{loadError}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <div className="resource-library-layout">
        <aside className="resource-list-panel">
          {callables.map((item) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className={selectedCallableId === item.id ? 'resource-list-item selected' : 'resource-list-item'}
              onClick={() => onSelect(item.id)}
            >
              <span className="resource-list-icon">
                {item.kind === 'agent_class' ? <Bot aria-hidden="true" size={18} /> : <Sparkles aria-hidden="true" size={18} />}
              </span>
              <span>
                <strong>{displayTitle(item)}</strong>
                <small>{item.description || item.id}</small>
              </span>
              <em>{resourceKindLabel(item.kind)}</em>
            </button>
          ))}
          {callables.length === 0 && !loadError ? (
            <div className="resource-empty-state">
              <Bot aria-hidden="true" size={22} />
              <strong>还没有智能体资源</strong>
              <span>创建一个智能体后，它会出现在这里。</span>
            </div>
          ) : null}
        </aside>
        <section className="resource-detail-panel" aria-label="资源详情">
          {detail ? (
            <CallableDetailView detail={detail} onEdit={() => setEditing(true)} />
          ) : (
            <div className="resource-detail-empty">
              <Bot aria-hidden="true" size={28} />
              <h3>选择一个资源</h3>
              <p>查看智能体的默认提示词、模型偏好和固定 skills。</p>
            </div>
          )}
        </section>
      </div>
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
      ) : null}
    </section>
  );
}

function CallableDetailView({ detail, onEdit }: { detail: CallableDetail; onEdit: () => void }) {
  const metadata = detail.metadata || {};
  const provider = providerFromDraft({
    id: detail.id,
    runtime: detail.runtime || detail.runner,
    metadata,
  });
  const option = agentOption(provider);
  const skills = skillsFromMetadata(metadata);

  return (
    <div className="resource-detail-content">
      <header className="resource-detail-header">
        <span className="resource-detail-avatar" style={{ '--resource-accent': option.accent } as CSSProperties}>
          {detail.kind === 'agent_class' ? <Bot aria-hidden="true" size={24} /> : <Sparkles aria-hidden="true" size={24} />}
        </span>
        <div>
          <span className="resource-kind-pill">{resourceKindLabel(detail.kind)}</span>
          <h3>{displayTitle(detail)}</h3>
          <p>{detail.description || String(metadata.description || '') || '未填写描述'}</p>
        </div>
      </header>
      {detail.kind === 'agent_class' ? (
        <button type="button" className="resource-secondary-action" onClick={onEdit}>
          编辑智能体
        </button>
      ) : null}
      <div className="resource-config-grid">
        <div>
          <span>使用的 Agent</span>
          <strong>{option.label}</strong>
        </div>
        <div>
          <span>模型</span>
          <strong>{String(metadata.model || '默认模型')}</strong>
        </div>
        <div>
          <span>思考强度</span>
          <strong>{thinkingLabel(String(metadata.reasoning_effort || 'medium'))}</strong>
        </div>
      </div>
      <section className="resource-readonly-section">
        <h4>系统提示词</h4>
        <p>{detail.default_prompt || '未填写系统提示词'}</p>
      </section>
      <section className="resource-readonly-section">
        <h4>固定 Skills</h4>
        {skills.length > 0 ? (
          <div className="skill-chip-row">
            {skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        ) : (
          <p>未固定 skills</p>
        )}
      </section>
    </div>
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
  const [skillInput, setSkillInput] = useState('');

  useEffect(() => {
    setSkillInput('');
  }, [draft.id]);

  function update<K extends keyof AgentClassDraft>(key: K, value: AgentClassDraft[K]) {
    onDraft({ ...draft, [key]: value });
  }

  function updateMetadata(key: string, value: unknown) {
    onDraft({ ...draft, metadata: { ...(draft.metadata || {}), [key]: value } });
  }

  function setProvider(provider: AgentProvider) {
    const option = agentOption(provider);
    const nextMetadata = {
      ...(draft.metadata || {}),
      agent_provider: provider,
      model: option.models[0],
    };
    onDraft({ ...draft, runtime: option.runtime, metadata: nextMetadata });
  }

  function addSkill() {
    const skill = skillInput.trim();
    if (!skill) {
      return;
    }
    const current = skillsFromMetadata(draft.metadata);
    if (!current.includes(skill)) {
      updateMetadata('skills', [...current, skill]);
    }
    setSkillInput('');
  }

  function removeSkill(skill: string) {
    updateMetadata(
      'skills',
      skillsFromMetadata(draft.metadata).filter((item) => item !== skill),
    );
  }

  const provider = providerFromDraft(draft);
  const option = agentOption(provider);
  const skills = skillsFromMetadata(draft.metadata);
  const canSave = Boolean((draft.name || '').trim());

  return (
    <div className="agent-editor-backdrop" role="presentation">
      <section className="agent-editor-dialog" aria-label={selectedId ? '编辑智能体' : '创建智能体'}>
        <header className="agent-editor-header">
          <div>
            <h3>{selectedId ? '编辑智能体' : '创建智能体'}</h3>
            <p>为工作区创建一个新的 AI 智能体。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onCancel}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="agent-editor-body">
          <div className="agent-editor-mark">
            <Bot aria-hidden="true" size={30} />
          </div>
          <div className="agent-editor-fields">
            <label className="agent-form-field">
              <span>名称</span>
              <input
                value={draft.name || ''}
                onChange={(event) => update('name', event.target.value)}
                placeholder="例如：深度研究智能体"
              />
            </label>
            <label className="agent-form-field">
              <span>描述</span>
              <input
                value={draft.description || ''}
                onChange={(event) => update('description', event.target.value)}
                placeholder="这个智能体做什么？"
                maxLength={255}
              />
            </label>
            <label className="agent-form-field select-field">
              <span>Agent</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as AgentProvider)}>
                {AGENT_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" size={18} />
            </label>
            <div className="agent-form-grid">
              <label className="agent-form-field select-field">
                <span>模型</span>
                <select
                  value={String((draft.metadata || {}).model || option.models[0])}
                  onChange={(event) => updateMetadata('model', event.target.value)}
                >
                  {option.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={18} />
              </label>
              <label className="agent-form-field select-field">
                <span>思考强度</span>
                <select
                  value={String((draft.metadata || {}).reasoning_effort || 'medium')}
                  onChange={(event) => updateMetadata('reasoning_effort', event.target.value)}
                >
                  {THINKING_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={18} />
              </label>
            </div>
            <label className="agent-form-field">
              <span>系统提示词</span>
              <textarea
                rows={8}
                value={draft.default_prompt || ''}
                onChange={(event) => update('default_prompt', event.target.value)}
                placeholder="写下这个智能体默认遵守的方法、边界和输出风格。"
              />
            </label>
            <div className="agent-form-field">
              <span>Skills</span>
              <div className="skill-input-row">
                <input
                  value={skillInput}
                  onChange={(event) => setSkillInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addSkill();
                    }
                  }}
                  placeholder="输入 skill 名称"
                />
                <button type="button" onClick={addSkill}>
                  添加
                </button>
              </div>
              {skills.length > 0 ? (
                <div className="skill-chip-row editable">
                  {skills.map((skill) => (
                    <button key={skill} type="button" onClick={() => removeSkill(skill)}>
                      <Tag aria-hidden="true" size={13} />
                      {skill}
                      <X aria-hidden="true" size={13} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="agent-editor-footer">
          {onDelete ? (
            <button type="button" className="agent-delete-action" onClick={() => void onDelete()}>
              <Trash2 aria-hidden="true" size={16} />
              删除
            </button>
          ) : (
            <span />
          )}
          <div>
            <button type="button" className="agent-ghost-action" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="agent-create-action" disabled={!canSave} onClick={() => void onSave()}>
              <Check aria-hidden="true" size={16} />
              {selectedId ? '保存' : '创建'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function emptyAgentDraft(): AgentClassDraft {
  const option = agentOption('codex');
  return {
    id: '',
    version: '0.1.0',
    runtime: option.runtime,
    default_prompt: '',
    input_ports: { main: { type: 'artifact', required: false } },
    output_ports: { main: { type: 'artifact', required: true } },
    artifact_contract: {},
    metadata: {
      agent_provider: option.value,
      model: option.models[0],
      reasoning_effort: 'medium',
      skills: [],
    },
  };
}

function draftFromDetail(detail: CallableDetail): AgentClassDraft {
  const metadata = {
    ...(detail.metadata || {}),
    agent_provider: providerFromDraft({
      id: detail.id,
      runtime: detail.runtime,
      metadata: detail.metadata,
    }),
    model: String((detail.metadata || {}).model || '默认模型'),
    reasoning_effort: String((detail.metadata || {}).reasoning_effort || 'medium'),
    skills: skillsFromMetadata(detail.metadata),
  };

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
    metadata,
  };
}

function normalizeDraftForSave(draft: AgentClassDraft, selectedId: string): AgentClassDraft {
  const provider = providerFromDraft(draft);
  const option = agentOption(provider);
  const name = (draft.name || '').trim();
  const metadata = {
    ...(draft.metadata || {}),
    agent_provider: provider,
    model: String((draft.metadata || {}).model || option.models[0]),
    reasoning_effort: String((draft.metadata || {}).reasoning_effort || 'medium'),
    skills: skillsFromMetadata(draft.metadata),
  };

  return {
    ...draft,
    id: selectedId || draft.id || `${slugify(name || 'untitled-agent')}.${provider}`,
    name,
    runtime: option.runtime,
    metadata,
    input_ports: draft.input_ports || { main: { type: 'artifact', required: false } },
    output_ports: draft.output_ports || { main: { type: 'artifact', required: true } },
    artifact_contract: draft.artifact_contract || {},
  };
}

function providerFromDraft(draft: Pick<AgentClassDraft, 'id' | 'runtime' | 'metadata'>): AgentProvider {
  const metadataProvider = draft.metadata?.agent_provider;
  if (isAgentProvider(metadataProvider)) {
    return metadataProvider;
  }
  if (draft.runtime === 'claude_sdk') {
    return 'claude';
  }
  if (draft.runtime === 'codex_cli') {
    return 'codex';
  }
  if (draft.id?.includes('.hermes')) {
    return 'hermes';
  }
  return 'generic_cli';
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && AGENT_OPTIONS.some((option) => option.value === value);
}

function agentOption(provider: AgentProvider): AgentOption {
  return AGENT_OPTIONS.find((option) => option.value === provider) || AGENT_OPTIONS[0];
}

function skillsFromMetadata(metadata?: Record<string, unknown>): string[] {
  const skills = metadata?.skills;
  if (!Array.isArray(skills)) {
    return [];
  }
  return skills.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function displayTitle(
  item: Pick<CallableSummary, 'id' | 'name'> & { metadata?: Record<string, unknown> },
): string {
  const metadataName = item.metadata?.name;
  return item.name || (typeof metadataName === 'string' ? metadataName : '') || item.id;
}

function resourceKindLabel(kind: string): string {
  if (kind === 'agent_class') {
    return '智能体';
  }
  if (kind === 'tool_class') {
    return '工具';
  }
  return '资源';
}

function thinkingLabel(value: string): string {
  return THINKING_LEVELS.find((level) => level.value === value)?.label || '标准';
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled-agent';
}
