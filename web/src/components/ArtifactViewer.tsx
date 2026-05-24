import { FileCode2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api';
import type { ArtifactContent, ArtifactLink, RunSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  run?: RunSummary;
};

export function ArtifactViewer({ run }: Props) {
  const firstNode = run?.nodes[0];
  const [artifacts, setArtifacts] = useState<ArtifactLink[]>([]);
  const [content, setContent] = useState<ArtifactContent | null>(null);

  useEffect(() => {
    if (!run?.run_id || !firstNode?.node_id) {
      setArtifacts([]);
      return;
    }
    let ignore = false;
    api.nodeArtifacts(run.run_id, firstNode.node_id).then((result) => {
      if (!ignore) {
        setArtifacts(result.artifacts);
      }
    });
    return () => {
      ignore = true;
    };
  }, [run?.run_id, firstNode?.node_id]);

  async function readArtifact(path: string) {
    setContent(await api.artifact(path));
  }

  return (
    <section className="panel artifact-viewer" aria-label="产物查看器">
      <header className="panel-header">
        <div>
          <h2>产物查看器</h2>
          <p>{run ? `${run.run_id} / ${firstNode?.node_id || '无节点'}` : '未选择运行'}</p>
        </div>
        <FileCode2 aria-hidden="true" size={20} />
      </header>
      <div className="artifact-layout">
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <button
              key={artifact.path}
              type="button"
              className="artifact-row"
              onClick={() => readArtifact(artifact.path)}
            >
              <span>{artifact.name}</span>
              <small>{artifact.path}</small>
            </button>
          ))}
          {artifacts.length === 0 ? <div className="empty-state">暂无可用产物。</div> : null}
        </div>
        {content ? (
          <CodeBlock title={content.name} content={content.content} variant={content.type} />
        ) : (
          <div className="empty-state">选择一个产物查看 markdown、JSON、文本、日志或 patch。</div>
        )}
      </div>
    </section>
  );
}
