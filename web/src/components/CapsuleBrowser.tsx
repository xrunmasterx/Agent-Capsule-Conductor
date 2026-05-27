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

type WizardStep = 'type' | 'basic' | 'behavior' | 'ports' | 'artifacts' | 'preview';

type FieldEntry = {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
};

type ArtifactEntry = {
  name: string;
  path: string;
  type: string;
  required?: boolean;
};

const wizardSteps: Array<{ key: WizardStep; label: string }> = [
  { key: 'type', label: '类型' },
  { key: 'basic', label: '基本信息' },
  { key: 'behavior', label: '行为' },
  { key: 'ports', label: '输入输出' },
  { key: 'artifacts', label: '产物' },
  { key: 'preview', label: '预览' },
];

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
  const [wizardStep, setWizardStep] = useState<WizardStep>('type');
  const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
  const [newCapsuleId, setNewCapsuleId] = useState('demo-research.codex');
  const [newCapsuleName, setNewCapsuleName] = useState('Demo 调研 Capsule');
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

  async function createCapsule(validateAfterCreate = true) {
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
      onSelect(result.capsule_id);
      onChanged?.();
      if (validateAfterCreate) {
        const validation = await api.validateCapsule(result.capsule_id);
        setMessage(`已创建并校验 ${result.capsule_id}: ${validation.status}`);
      } else {
        setMessage(`已创建 ${result.capsule_id}`);
      }
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

  function updateInputFields(fields: FieldEntry[]) {
    setInputFieldsText(JSON.stringify(fields, null, 2));
  }

  function updateOutputFields(fields: FieldEntry[]) {
    setOutputFieldsText(JSON.stringify(fields, null, 2));
  }

  function updateArtifacts(artifacts: ArtifactEntry[]) {
    setArtifactsText(JSON.stringify(artifacts, null, 2));
  }

  const inputFields = parseFieldList(inputFieldsText);
  const outputFields = parseFieldList(outputFieldsText);
  const artifactEntries = parseArtifactList(artifactsText);

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
            <div className="wizard-steps" role="tablist" aria-label="创建 Capsule 步骤">
              {wizardSteps.map((step) => (
                <button
                  key={step.key}
                  type="button"
                  className={wizardStep === step.key ? 'active' : ''}
                  onClick={() => setWizardStep(step.key)}
                >
                  {step.label}
                </button>
              ))}
            </div>

            {wizardStep === 'type' ? (
              <>
                <label>
                  Capsule 类型
                  <select value={runtime} onChange={(event) => updateRuntime(event.target.value)}>
                    <option value="codex_cli">Agent Session Capsule / codex_cli</option>
                    <option value="generic_cli">Tool Capsule / generic_cli</option>
                    <option value="claude_sdk">Agent Session Capsule / claude_sdk</option>
                  </select>
                </label>
                <label>
                  工作区模式
                  <select
                    value={workspaceMode}
                    onChange={(event) => setWorkspaceMode(event.target.value)}
                  >
                    <option value="existing_dir">继承当前环境 / existing_dir</option>
                    <option value="git_worktree_readonly">只读 worktree / git_worktree_readonly</option>
                    <option value="git_worktree_write">可写 worktree / git_worktree_write</option>
                  </select>
                </label>
                <label>
                  沙箱
                  <select value={sandbox} onChange={(event) => setSandbox(event.target.value)}>
                    <option value="read-only">只读 / read-only</option>
                    <option value="workspace-write">工作区可写 / workspace-write</option>
                    <option value="danger-full-access">危险权限 / danger-full-access</option>
                  </select>
                </label>
              </>
            ) : null}

            {wizardStep === 'basic' ? (
              <>
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
                  描述
                  <textarea
                    className="compact-textarea"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </>
            ) : null}

            {wizardStep === 'behavior' ? (
              <label>
                Prompt / Command
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
            ) : null}

            {wizardStep === 'ports' ? (
              <div className="wizard-panel">
                <FieldEditor title="输入" fields={inputFields} onChange={updateInputFields} />
                <FieldEditor title="输出" fields={outputFields} onChange={updateOutputFields} />
              </div>
            ) : null}

            {wizardStep === 'artifacts' ? (
              <ArtifactEditor artifacts={artifactEntries} onChange={updateArtifacts} />
            ) : null}

            {wizardStep === 'preview' ? (
              <div className="preview-box">
                <h4>创建预览</h4>
                <dl className="definition-grid compact">
                  <dt>Capsule</dt>
                  <dd>{newCapsuleName || newCapsuleId}</dd>
                  <dt>id</dt>
                  <dd>{newCapsuleId}</dd>
                  <dt>运行时</dt>
                  <dd>{runtime}</dd>
                  <dt>输入</dt>
                  <dd>{inputFields.map((field) => field.name).join(', ') || '无'}</dd>
                  <dt>输出</dt>
                  <dd>{outputFields.map((field) => field.name).join(', ') || '无'}</dd>
                  <dt>产物</dt>
                  <dd>{artifactEntries.map((artifact) => artifact.path).join(', ') || '无'}</dd>
                </dl>
              </div>
            ) : null}

            <details className="advanced-section">
              <summary>高级设置</summary>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={network}
                    onChange={(event) => setNetwork(event.target.checked)}
                  />
                  允许网络
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={writeFiles}
                    onChange={(event) => setWriteFiles(event.target.checked)}
                  />
                  允许写文件
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={allowDangerous}
                    onChange={(event) => setAllowDangerous(event.target.checked)}
                  />
                  允许危险权限
                </label>
              </div>
              <label>
                超时秒数
                <input
                  type="number"
                  min={1}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(Number(event.target.value) || 1)}
                />
              </label>
              <label>
                输入字段原始数据
                <textarea
                  className="compact-textarea"
                  value={inputFieldsText}
                  onChange={(event) => setInputFieldsText(event.target.value)}
                />
              </label>
              <label>
                输出字段原始数据
                <textarea
                  className="compact-textarea"
                  value={outputFieldsText}
                  onChange={(event) => setOutputFieldsText(event.target.value)}
                />
              </label>
              <label>
                产物原始数据
                <textarea
                  className="compact-textarea"
                  value={artifactsText}
                  onChange={(event) => setArtifactsText(event.target.value)}
                />
              </label>
            </details>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(event) => setOverwriteExisting(event.target.checked)}
              />
              覆盖同名 Capsule
            </label>
            <button type="button" className="primary-action" onClick={() => createCapsule(true)}>
              <WandSparkles aria-hidden="true" size={16} />
              创建并校验
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
              <dl className="definition-grid compact">
                <dt>沙箱</dt>
                <dd>{String(detail.permissions?.sandbox || 'read-only')}</dd>
                <dt>网络</dt>
                <dd>{detail.permissions?.network ? '允许' : '关闭'}</dd>
                <dt>写文件</dt>
                <dd>{detail.permissions?.write_files ? '允许' : '关闭'}</dd>
              </dl>
            </section>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setShowAdvancedEditor((value) => !value)}
            >
              {showAdvancedEditor ? '隐藏原始文件' : '高级设置 / 原始文件'}
            </button>
            {showAdvancedEditor ? (
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
            ) : null}
          </div>
        ) : (
          <div className="empty-state">选择一个 Capsule Template。</div>
        )}
      </div>
    </section>
  );
}

function FieldEditor({
  title,
  fields,
  onChange,
}: {
  title: string;
  fields: FieldEntry[];
  onChange: (fields: FieldEntry[]) => void;
}) {
  function updateField(index: number, patch: Partial<FieldEntry>) {
    onChange(fields.map((field, currentIndex) => (currentIndex === index ? { ...field, ...patch } : field)));
  }

  function addField() {
    onChange([
      ...fields,
      { name: `${title === '输入' ? 'input' : 'output'}_${fields.length + 1}`, type: 'string', required: false },
    ]);
  }

  function removeField(index: number) {
    onChange(fields.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <section className="field-editor" aria-label={`${title}字段`}>
      <header>
        <h4>{title}</h4>
        <button type="button" onClick={addField}>添加字段</button>
      </header>
      {fields.map((field, index) => (
        <article key={`${field.name}-${index}`} className="field-row">
          <input
            aria-label={`${title}字段名`}
            value={field.name}
            onChange={(event) => updateField(index, { name: event.target.value })}
          />
          <select
            aria-label={`${title}字段类型`}
            value={field.type}
            onChange={(event) => updateField(index, { type: event.target.value })}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="integer">integer</option>
            <option value="boolean">boolean</option>
            <option value="object">object</option>
            <option value="array">array</option>
          </select>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              onChange={(event) => updateField(index, { required: event.target.checked })}
            />
            必填
          </label>
          <input
            aria-label={`${title}字段说明`}
            value={field.description || ''}
            onChange={(event) => updateField(index, { description: event.target.value })}
          />
          <button type="button" className="danger-action" onClick={() => removeField(index)}>删除</button>
        </article>
      ))}
      {fields.length === 0 ? <p className="muted">暂无字段。</p> : null}
    </section>
  );
}

function ArtifactEditor({
  artifacts,
  onChange,
}: {
  artifacts: ArtifactEntry[];
  onChange: (artifacts: ArtifactEntry[]) => void;
}) {
  function updateArtifact(index: number, patch: Partial<ArtifactEntry>) {
    onChange(
      artifacts.map((artifact, currentIndex) =>
        currentIndex === index ? { ...artifact, ...patch } : artifact,
      ),
    );
  }

  function addArtifact() {
    onChange([
      ...artifacts,
      { name: `report_${artifacts.length + 1}`, path: 'report.md', type: 'markdown', required: false },
    ]);
  }

  function removeArtifact(index: number) {
    onChange(artifacts.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <section className="field-editor" aria-label="产物字段">
      <header>
        <h4>产物</h4>
        <button type="button" onClick={addArtifact}>添加产物</button>
      </header>
      {artifacts.map((artifact, index) => (
        <article key={`${artifact.path}-${index}`} className="field-row">
          <input
            aria-label="产物名称"
            value={artifact.name}
            onChange={(event) => updateArtifact(index, { name: event.target.value })}
          />
          <input
            aria-label="产物路径"
            value={artifact.path}
            onChange={(event) => updateArtifact(index, { path: event.target.value })}
          />
          <select
            aria-label="产物类型"
            value={artifact.type}
            onChange={(event) => updateArtifact(index, { type: event.target.value })}
          >
            <option value="markdown">markdown</option>
            <option value="json">json</option>
            <option value="log">log</option>
            <option value="patch">patch</option>
            <option value="text">text</option>
          </select>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(artifact.required)}
              onChange={(event) => updateArtifact(index, { required: event.target.checked })}
            />
            必需
          </label>
          <button type="button" className="danger-action" onClick={() => removeArtifact(index)}>删除</button>
        </article>
      ))}
      {artifacts.length === 0 ? <p className="muted">未声明产物，仍会生成基础 output.json。</p> : null}
    </section>
  );
}

function parseFieldList(value: string): FieldEntry[] {
  try {
    const payload = JSON.parse(value) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.filter(isObject).map((field) => ({
      name: String(field.name || ''),
      type: String(field.type || 'string'),
      required: Boolean(field.required),
      description: typeof field.description === 'string' ? field.description : '',
    }));
  } catch {
    return [];
  }
}

function parseArtifactList(value: string): ArtifactEntry[] {
  try {
    const payload = JSON.parse(value) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.filter(isObject).map((artifact) => ({
      name: String(artifact.name || ''),
      path: String(artifact.path || ''),
      type: String(artifact.type || 'markdown'),
      required: Boolean(artifact.required),
    }));
  } catch {
    return [];
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
