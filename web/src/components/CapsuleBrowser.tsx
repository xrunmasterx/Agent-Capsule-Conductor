import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { CapsuleDetail, CapsuleSummary } from '../types';

type Props = {
  capsules: CapsuleSummary[];
  selectedCapsuleId: string;
  onSelect: (capsuleId: string) => void;
};

export function CapsuleBrowser({ capsules, selectedCapsuleId, onSelect }: Props) {
  const [detail, setDetail] = useState<CapsuleDetail | null>(null);

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

  return (
    <section className="panel capsule-browser" aria-label="Capsule Browser">
      <header className="panel-header">
        <div>
          <h2>Capsule Browser</h2>
          <p>{capsules.length} Capsule Templates</p>
        </div>
      </header>
      <div className="split compact">
        <div className="list-stack">
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
            <h3>{detail.name}</h3>
            <p>{detail.description}</p>
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
          </div>
        ) : (
          <div className="empty-state">Select a Capsule Template.</div>
        )}
      </div>
    </section>
  );
}

