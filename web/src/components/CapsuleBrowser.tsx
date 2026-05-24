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
    setMessage(`Created ${result.capsule_id}`);
    onSelect(result.capsule_id);
    onChanged?.();
  }

  async function saveFile() {
    if (!selectedCapsuleId) {
      return;
    }
    await api.saveCapsuleFile(selectedCapsuleId, selectedFile, fileContent);
    setMessage(`Saved ${selectedFile}`);
  }

  async function validateCapsule() {
    if (!selectedCapsuleId) {
      return;
    }
    const result = await api.validateCapsule(selectedCapsuleId);
    setMessage(`Validate ${selectedCapsuleId}: ${result.status}`);
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
    setMessage(`Test ${selectedCapsuleId}: ${result.status}`);
  }

  return (
    <section className="panel capsule-browser" aria-label="Capsule Browser">
      <header className="panel-header">
        <div>
          <h2>Capsule Library</h2>
          <p>{capsules.length} Capsule Templates</p>
        </div>
      </header>
      <div className="split compact">
        <div className="list-stack">
          <section className="inline-form" aria-label="Create Capsule">
            <h3>Create Capsule</h3>
            <input
              aria-label="New capsule id"
              value={newCapsuleId}
              onChange={(event) => setNewCapsuleId(event.target.value)}
            />
            <button type="button" className="primary-action" onClick={createCapsule}>
              <WandSparkles aria-hidden="true" size={16} />
              Create
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
            <h3>Capsule Editor</h3>
            <h3>{detail.name}</h3>
            <p>{detail.description}</p>
            {message ? <div className="notice neutral">{message}</div> : null}
            <div className="metric-strip">
              <div>
                <span>Runtime</span>
                <strong>{detail.runtime}</strong>
              </div>
              <div>
                <span>Workspace</span>
                <strong>{detail.workspace}</strong>
              </div>
              <div>
                <span>Version</span>
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
              <dt>Artifacts</dt>
              <dd>{detail.artifact_manifest}</dd>
            </dl>
            <section className="permission-box">
              <h4>
                <ShieldCheck aria-hidden="true" size={16} />
                Permissions
              </h4>
              <pre>{JSON.stringify(detail.permissions, null, 2)}</pre>
            </section>
            <section className="editor-panel" aria-label="Capsule Editor">
              <div className="editor-toolbar">
                <label>
                  File
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
                  Save
                </button>
                <button type="button" onClick={validateCapsule}>
                  <TestTube aria-hidden="true" size={16} />
                  Validate
                </button>
                <button type="button" onClick={testCapsule}>
                  <Play aria-hidden="true" size={16} />
                  Test
                </button>
              </div>
              <textarea
                aria-label="Capsule file editor"
                value={fileContent}
                onChange={(event) => setFileContent(event.target.value)}
              />
            </section>
          </div>
        ) : (
          <div className="empty-state">Select a Capsule Template.</div>
        )}
      </div>
    </section>
  );
}
