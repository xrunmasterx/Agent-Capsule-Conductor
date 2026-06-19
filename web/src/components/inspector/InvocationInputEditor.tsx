import { useEffect, useState } from 'react';

import {
  mergeInvocationInput,
  promptFromInvocationInput,
  staticInputFromInvocationInput,
} from '../../workbench/model/selectionModel';

type InvocationInputEditorProps = {
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
};

export function InvocationInputEditor({ input, onChange }: InvocationInputEditorProps) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(staticInputFromInvocationInput(input), null, 2));
  const [error, setError] = useState('');
  const [lastSavedInput, setLastSavedInput] = useState(input);

  useEffect(() => {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(input), null, 2));
    setLastSavedInput(input);
    setError('');
  }, [input]);

  function updatePrompt(value: string) {
    onChange(mergeInvocationInput(input, value, staticInputFromInvocationInput(input)));
  }

  function updateJson(value: string) {
    setJsonText(value);
    const parsed = parseObjectJson(value);
    if (parsed.ok) {
      setError('');
      onChange(mergeInvocationInput(input, promptFromInvocationInput(input), parsed.value));
      return;
    }
    setError(parsed.message);
  }

  function clearPrompt() {
    updatePrompt('');
  }

  function resetInput() {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(lastSavedInput), null, 2));
    setError('');
    onChange(lastSavedInput);
  }

  function formatJson() {
    const parsed = parseObjectJson(jsonText);
    if (parsed.ok) {
      setJsonText(JSON.stringify(parsed.value, null, 2));
      setError('');
      return;
    }
    setError(parsed.message);
  }

  return (
    <section className="invocation-input-editor" aria-label="Invocation 配置">
      <label>
        User Prompt
        <textarea
          aria-label="User Prompt"
          rows={5}
          value={promptFromInvocationInput(input)}
          onChange={(event) => updatePrompt(event.target.value)}
          placeholder="本节点实例的任务说明"
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={clearPrompt}>
          清空 User Prompt
        </button>
        <button type="button" className="secondary-action compact-action" onClick={resetInput}>
          重置为当前值
        </button>
      </div>
      <label>
        Static Input JSON
        <textarea
          aria-label="Static Input JSON"
          rows={7}
          value={jsonText}
          onChange={(event) => updateJson(event.target.value)}
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={formatJson}>
          格式化 JSON
        </button>
      </div>
      {error ? <p className="notice compact-notice">{error}</p> : null}
    </section>
  );
}

type JsonObjectParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

function parseObjectJson(value: string): JsonObjectParseResult {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, message: 'JSON 必须是对象；当前修改不会提交。' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
