import { Play, Save, ShieldCheck, TestTube, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { CapsuleDetail, CapsuleSummary } from '../types';

type Props = {
  capsules: CapsuleSummary[];
  selectedCapsuleId: string;
  onSelect: (capsuleId: string) => void;
  onChanged?: () => void;
};

const editableFiles = [
  'capsule.yaml',
  'prompt_template.md',
  'input_schema.json',
  'output_schema.json',
  'artifact_manifest.yaml',
  'examples/input.json',
];

const defaultInputFields = JSON.stringify(
  [{ name: 'topic', type: 'string', required: true, description: '任务主题' }],
  null,
  2,
);
const defaultOutputFields = JSON.stringify(
  [
    { name: 'summary', type: 'string', required: true, description: '一句话结论' },
    { name: 'report', type: 'string', required: true, description: '结构化报告正文' },
  ],
  null,
  2,
);
const defaultArtifacts = JSON.stringify([], null, 2);

type RuntimeDefaults = {
  sandbox: string;
  network: boolean;
  writeFiles: boolean;
};

function defaultsForRuntime(runtime: string): RuntimeDefaults {
  if (runtime === 'generic_cli') {
    return {
      sandbox: 'workspace-write',
      network: false,
      writeFiles: true,
    };
  }
  if (runtime === 'codex_cli') {
    return {
      sandbox: 'read-only',
      network: true,
      writeFiles: false,
    };
  }
  return {
    sandbox: 'read-only',
    network: false,
    writeFiles: false,
  };
}

export function CapsuleBrowser({ capsules, selectedCapsuleId, onSelect, onChanged }: Props) {
  const runtimeDefaults = defaultsForRuntime('codex_cli');
  const [detail, setDetail] = useState<CapsuleDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState(editableFiles[0]);
  const [fileContent, setFileContent] = useState('');
  const [message, setMessage] = useState('');
  const [newCapsuleId, setNewCapsuleId] = useState('demo-research.codex');
  const [newCapsuleName, setNewCapsuleName] = useState('Demo Research Capsule');
  const [description, setDescription] = useState('通过 Codex CLI 执行一个结构化调研任务。');
  const [runtime, setRuntime] = useState('codex_cli');
  const [workspaceMode, setWorkspaceMode] = useState('existing_dir');
  const [sandbox, setSandbox] = useState(runtimeDefaults.sandbox);
  const [network, setNetwork] = useState(runtimeDefaults.network);
  const [writeFiles, setWriteFiles] = useState(runtimeDefaults.writeFiles);
  const [timeoutSeconds, setTimeoutSeconds] = useState(600);
  const [allowDangerous, setAllowDangerous] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [inputFieldsText, setInputFieldsText] = useState(defaultInputFields);
  const [outputFieldsText, setOutputFieldsText] = useState(defaultOutputFields);
  const [artifactsText, setArtifactsText] = useState(defaultArtifacts);
  const [prompt, setPrompt] = useState(
    [
      '你是一个可复用的 Capsule Template。请严格按照输入任务执行。',
      '',
      '输入主题：{{ topic }}',
      '',
      '方法论：',
      '1. 先明确事实边界和时间边界。',
      '2. 区分事实、推断和不确定性。',
      '3. 输出必须满足 output_schema.json。',
    ].join('\n'),
  );

  useEffect(() => {
    if (!selectedCapsuleId) {
      return;
    }
    let ignore = false;
    api.capsule(selectedCapsuleId).then((capsule) => {
      if (!ignore) {
        setDetail(capsule);
      }
    });
    return () => {
      ignore = true;
    };
  }, [selectedCapsuleId]);

  useEffect(() => {
    if (!selectedCapsuleId || !selectedFile) {
      return;
    }
    let ignore = false;
    api
      .capsuleFile(selectedCapsuleId, selectedFile)
      .then((file) => {
        if (!ignore) {
          setFileContent(file.content);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setFileContent('');
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedCapsuleId, selectedFile]);

  async function createCapsule() {
    try {
      setMessage('');
      const blueprint = {
        id: newCapsuleId,
        name: newCapsuleName || newCapsuleId,
        runtime,
        workspace_mode: workspaceMode,
        description,
        input_fields: JSON.parse(inputFieldsText || '[]'),
        output_fields: JSON.parse(outputFieldsText || '[]'),
        artifacts: JSON.parse(artifactsText || '[]'),
        permissions: {
          sandbox,
          network,
          write_files: writeFiles,
          timeout_seconds: timeoutSeconds,
          allow_dangerous: allowDangerous,
        },
        prompt,
      };
      const result = await api.scaffoldCapsule({ blueprint, force: overwriteExisting });
      setMessage(`已创建 ${result.capsule_id}`);
      onSelect(result.capsule_id);
      onChanged?.();
    } catch (error) {
      setMessage(`创建失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function updateRuntime(nextRuntime: string) {
    const defaults = defaultsForRuntime(nextRuntime);
    setRuntime(nextRuntime);
    setSandbox(defaults.sandbox);
    setNetwork(defaults.network);
    setWriteFiles(defaults.writeFiles);
  }

  async function deleteSelectedCapsule() {
    if (!selectedCapsuleId) {
      return;
    }
    const confirmed = window.confirm(
      `删除 ${selectedCapsuleId}？如果它仍被 workflow 引用，后端会拒绝删除。`,
    );
    if (!confirmed) {
      return;
    }
    try {
      const result = await api.deleteCapsule(selectedCapsuleId);
      setMessage(`已删除 ${result.capsule_id}`);
      setDetail(null);
      onSelect(capsules.find((capsule) => capsule.id !== selectedCapsuleId)?.id || '');
      onChanged?.();
    } catch (error) {
      setMessage(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function saveFile() {
    if (!selectedCapsuleId) {
      return;
    }
    try {
      await api.saveCapsuleFile(selectedCapsuleId, selectedFile, fileContent);
      setMessage(`已保存 ${selectedFile}`);
      onChanged?.();
    } catch (error) {
      setMessage(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function validateCapsule() {
    if (!selectedCapsuleId) {
      return;
    }
    const result = await api.validateCapsule(selectedCapsuleId);
    setMessage(`校验 ${selectedCapsuleId}: ${result.status}`);
  }

  async function testCapsule() {
    if (!selectedCapsuleId) {
      return;
    }
    try {
      const inputText =
        selectedFile === 'examples/input.json'
          ? fileContent
          : (
              await api.capsuleFile(selectedCapsuleId, 'examples/input.json').catch(() => ({
                content: '{}',
              }))
            ).content;
      const input = JSON.parse(inputText || '{}') as Record<string, unknown>;
      const result = await api.testCapsule(selectedCapsuleId, {
        input,
        run_dir: `runs/ui_capsule_test_${selectedCapsuleId.replaceAll('.', '_')}`,
      });
      setMessage(`测试 ${selectedCapsuleId}: ${result.status}`);
      onChanged?.();
    } catch (error) {
      setMessage(`测试失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <section className="panel capsule-browser" aria-label="节点库">
      <header className="panel-header">
        <div>
          <h2>节点库</h2>
          <p>{capsules.length} 个 Capsule Template</p>
        </div>
      </header>
      <div className="split compact">
        <div className="list-stack">
          <section className="inline-form capsule-create-form" aria-label="创建 Capsule">
            <h3>创建 Capsule</h3>
            {message ? <div className="notice neutral sticky-notice">{message}</div> : null}
            <input
              aria-label="新 Capsule id"
              value={newCapsuleId}
              onChange={(event) => setNewCapsuleId(event.target.value)}
            />
            <input
              aria-label="新 Capsule 名称"
              value={newCapsuleName}
              onChange={(event) => setNewCapsuleName(event.target.value)}
            />
            <label>
              Runtime
              <select value={runtime} onChange={(event) => updateRuntime(event.target.value)}>
                <option value="codex_cli">codex_cli</option>
                <option value="generic_cli">generic_cli</option>
                <option value="claude_sdk">claude_sdk</option>
              </select>
            </label>
            <label>
              Workspace
              <select
                value={workspaceMode}
                onChange={(event) => setWorkspaceMode(event.target.value)}
              >
                <option value="existing_dir">existing_dir</option>
                <option value="git_worktree_readonly">git_worktree_readonly</option>
                <option value="git_worktree_write">git_worktree_write</option>
              </select>
            </label>
            <label>
              Sandbox
              <select value={sandbox} onChange={(event) => setSandbox(event.target.value)}>
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
                <option value="danger-full-access">danger-full-access</option>
              </select>
            </label>
            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={network}
                  onChange={(event) => setNetwork(event.target.checked)}
                />
                Network
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={writeFiles}
                  onChange={(event) => setWriteFiles(event.target.checked)}
                />
                Write files
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowDangerous}
                  onChange={(event) => setAllowDangerous(event.target.checked)}
                />
                Dangerous
              </label>
            </div>
            <label>
              Timeout seconds
              <input
                type="number"
                min={1}
                value={timeoutSeconds}
                onChange={(event) => setTimeoutSeconds(Number(event.target.value) || 1)}
              />
            </label>
            <label>
              描述
              <textarea
                className="compact-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Input fields JSON
              <textarea
                className="compact-textarea"
                value={inputFieldsText}
                onChange={(event) => setInputFieldsText(event.target.value)}
              />
            </label>
            <label>
              Output fields JSON
              <textarea
                className="compact-textarea"
                value={outputFieldsText}
                onChange={(event) => setOutputFieldsText(event.target.value)}
              />
            </label>
            <label>
              Artifacts JSON
              <textarea
                className="compact-textarea"
                value={artifactsText}
                onChange={(event) => setArtifactsText(event.target.value)}
              />
            </label>
            <label>
              Prompt
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(event) => setOverwriteExisting(event.target.checked)}
              />
              覆盖同名 Capsule
            </label>
            <button type="button" className="primary-action" onClick={createCapsule}>
              <WandSparkles aria-hidden="true" size={16} />
              创建
            </button>
            {message ? <div className="notice neutral">{message}</div> : null}
          </section>
          {capsules.map((capsule) => (
            <button
              key={capsule.id}
              type="button"
              className={selectedCapsuleId === capsule.id ? 'list-item selected' : 'list-item'}
              onClick={() => onSelect(capsule.id)}
            >
              <strong>{capsule.name}</strong>
              <span>{capsule.id}</span>
              <small>{capsule.runtime}</small>
            </button>
          ))}
        </div>
        {detail ? (
          <div className="detail-surface">
            <h3>Capsule 编辑器</h3>
            <h3>{detail.name}</h3>
            <p>{detail.description}</p>
            {message ? <div className="notice neutral">{message}</div> : null}
            <div className="metric-strip">
              <div>
                <span>运行时</span>
                <strong>{detail.runtime}</strong>
              </div>
              <div>
                <span>工作区</span>
                <strong>{detail.workspace}</strong>
              </div>
              <div>
                <span>版本</span>
                <strong>{detail.version}</strong>
              </div>
            </div>
            <dl className="definition-grid">
              <dt>Prompt</dt>
              <dd>{detail.prompt_template || 'n/a'}</dd>
              <dt>Input schema</dt>
              <dd>{detail.input_schema}</dd>
              <dt>Output schema</dt>
              <dd>{detail.output_schema}</dd>
              <dt>产物</dt>
              <dd>{detail.artifact_manifest}</dd>
            </dl>
            <section className="permission-box">
              <h4>
                <ShieldCheck aria-hidden="true" size={16} />
                权限
              </h4>
              <pre>{JSON.stringify(detail.permissions, null, 2)}</pre>
            </section>
            <section className="editor-panel" aria-label="Capsule 编辑器">
              <div className="editor-toolbar">
                <label>
                  文件
                  <select
                    aria-label="Capsule file"
                    value={selectedFile}
                    onChange={(event) => setSelectedFile(event.target.value)}
                  >
                    {editableFiles.map((file) => (
                      <option key={file} value={file}>
                        {file}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={saveFile}>
                  <Save aria-hidden="true" size={16} />
                  保存
                </button>
                <button type="button" onClick={validateCapsule}>
                  <TestTube aria-hidden="true" size={16} />
                  校验
                </button>
                <button type="button" onClick={testCapsule}>
                  <Play aria-hidden="true" size={16} />
                  测试
                </button>
                <button type="button" className="danger-action" onClick={deleteSelectedCapsule}>
                  <Trash2 aria-hidden="true" size={16} />
                  删除
                </button>
              </div>
              <textarea
                aria-label="Capsule 文件编辑器"
                value={fileContent}
                onChange={(event) => setFileContent(event.target.value)}
              />
            </section>
          </div>
        ) : (
          <div className="empty-state">选择一个 Capsule Template。</div>
        )}
      </div>
    </section>
  );
}
