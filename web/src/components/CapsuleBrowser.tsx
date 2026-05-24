import { Play, Save, ShieldCheck, TestTube, WandSparkles } from 'lucide-react';
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
  'prompt_template.md',
  'input_schema.json',
  'output_schema.json',
  'artifact_manifest.yaml',
  'examples/input.json',
];

export function CapsuleBrowser({ capsules, selectedCapsuleId, onSelect, onChanged }: Props) {
  const [detail, setDetail] = useState<CapsuleDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState(editableFiles[0]);
  const [fileContent, setFileContent] = useState('');
  const [message, setMessage] = useState('');
  const [newCapsuleId, setNewCapsuleId] = useState('demo-note.generic');

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
    setMessage('');
    const result = await api.scaffoldCapsule({
      id: newCapsuleId,
      runtime: 'generic_cli',
      template: 'simple',
      force: true,
    });
    setMessage(`已创建 ${result.capsule_id}`);
    onSelect(result.capsule_id);
    onChanged?.();
  }

  async function saveFile() {
    if (!selectedCapsuleId) {
      return;
    }
    await api.saveCapsuleFile(selectedCapsuleId, selectedFile, fileContent);
    setMessage(`已保存 ${selectedFile}`);
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
    const inputText = selectedFile === 'examples/input.json' ? fileContent : '{}';
    const input = JSON.parse(inputText || '{}') as Record<string, unknown>;
    const result = await api.testCapsule(selectedCapsuleId, {
      input,
      run_dir: `runs/ui_capsule_test_${selectedCapsuleId.replaceAll('.', '_')}`,
    });
    setMessage(`测试 ${selectedCapsuleId}: ${result.status}`);
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
          <section className="inline-form" aria-label="创建 Capsule">
            <h3>创建 Capsule</h3>
            <input
              aria-label="新 Capsule id"
              value={newCapsuleId}
              onChange={(event) => setNewCapsuleId(event.target.value)}
            />
            <button type="button" className="primary-action" onClick={createCapsule}>
              <WandSparkles aria-hidden="true" size={16} />
              创建
            </button>
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
              <dd>{detail.prompt_template}</dd>
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
