import { useEffect } from 'react';

import { shortPath } from '../../format';
import type { ArtifactContent } from '../../types';
import type { SelectedDetailsEvidenceAction, SelectedEntityDetailsModel } from '../../types/workbench';
import { StructuredValueView } from './StructuredValueView';

type SelectionInputPaneProps = {
  model: SelectedEntityDetailsModel;
  artifactCacheByPath: Record<string, ArtifactContent>;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
};

export function SelectionInputPane({
  model,
  artifactCacheByPath,
  onEnsureArtifactContent,
}: SelectionInputPaneProps) {
  const inputAction = evidenceActionByLabel(model.evidenceActions, 'input.json');
  const inputPath = inputAction?.path || '';
  const inputArtifact = inputPath ? artifactCacheByPath[inputPath] || null : null;

  useEffect(() => {
    void onEnsureArtifactContent(inputPath);
  }, [inputPath, onEnsureArtifactContent]);

  return (
    <section className="selection-input-pane" aria-label="输入">
      <header className="selection-pane-header">
        <div>
          <span>输入</span>
          <h3>{model.nodeRun ? shortPath(model.nodeRun.run_dir) : '尚未运行'}</h3>
        </div>
        <small title={inputPath || undefined}>{inputPath ? shortPath(inputPath) : '没有可用证据'}</small>
      </header>
      <section className="selection-open-artifact inline" aria-label="输入内容">
        {inputArtifact ? (
          <SelectionInputArtifact content={inputArtifact} />
        ) : (
          <div className="selection-log-output artifact-empty">
            <p className="empty-state">当前节点还没有真实 input.json。</p>
          </div>
        )}
      </section>
    </section>
  );
}

function SelectionInputArtifact({ content }: { content: ArtifactContent }) {
  const blocks = inputBlocksFromArtifact(content);
  if (blocks.length === 0) {
    return (
      <div className="selection-input-breakdown empty">
        <p className="empty-state">Current node has no displayable input content.</p>
      </div>
    );
  }
  return (
    <div className="selection-input-breakdown" aria-label="Input sources">
      {blocks.map((block) => (
        <article key={block.id} className="selection-input-source-card">
          <header>
            <span>{block.badge}</span>
            <strong>{block.title}</strong>
          </header>
          <StructuredValueView value={block.value} />
        </article>
      ))}
    </div>
  );
}

type InputSourceBlock = {
  id: string;
  badge: string;
  title: string;
  value: unknown;
};

function inputBlocksFromArtifact(content: ArtifactContent): InputSourceBlock[] {
  let payload: unknown;
  try {
    payload = JSON.parse(content.content) as unknown;
  } catch {
    return [
      {
        id: content.path,
        badge: 'text',
        title: content.name || 'input',
        value: content.content,
      },
    ];
  }
  if (!isInputRecord(payload)) {
    return [{ id: 'input', badge: 'value', title: 'input', value: payload }];
  }
  const blocks: InputSourceBlock[] = [];
  for (const [portId, value] of Object.entries(payload)) {
    if (isEmptyInputValue(value)) {
      continue;
    }
    if (portId === 'main' && isControlMainAggregate(value)) {
      const order = Array.isArray(value.order) ? value.order.map(String) : Object.keys(value.sources);
      for (const sourceId of order) {
        if (!Object.prototype.hasOwnProperty.call(value.sources, sourceId)) {
          continue;
        }
        blocks.push({
          id: `main:${sourceId}`,
          badge: 'main',
          title: sourceId,
          value: value.sources[sourceId],
        });
      }
      continue;
    }
    blocks.push({
      id: portId,
      badge: portId,
      title: portId === 'main' ? 'main 输入' : `${portId} 输入`,
      value,
    });
  }
  return blocks;
}

function evidenceActionByLabel(
  actions: SelectedDetailsEvidenceAction[],
  label: string,
): SelectedDetailsEvidenceAction | undefined {
  return actions.find((action) => action.label === label);
}

function isControlMainAggregate(
  value: unknown,
): value is { kind?: unknown; order?: unknown; sources: Record<string, unknown> } {
  return (
    isInputRecord(value) &&
    value.kind === 'control_main_aggregate' &&
    isInputRecord(value.sources)
  );
}

function isEmptyInputValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isInputRecord(value) && Object.keys(value).length === 0;
}

function isInputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
