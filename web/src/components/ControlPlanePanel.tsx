import { ShieldCheck, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';

import { api } from '../api';
import { zhCN as t } from '../i18n/zh-CN';
import type { RunSummary, WorkflowSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  runs: RunSummary[];
  workflows: WorkflowSummary[];
  selectedRun?: RunSummary;
};

export function ControlPlanePanel({ runs, workflows, selectedRun }: Props) {
  const isDev = new URLSearchParams(window.location.search).has('dev');
  const [message, setMessage] = useState('');
  const [resultTitle, setResultTitle] = useState('control_plane.json');
  const [resultContent, setResultContent] = useState('{}');

  const selectedWorkflow = workflows[0];
  const currentRun = selectedRun || runs[0];
  const artifactPath = useMemo(() => {
    const firstNode = currentRun?.nodes[0];
    return firstNode?.output_path || currentRun?.output_path || '';
  }, [currentRun]);

  function showJson(title: string, value: unknown) {
    setResultTitle(title);
    setResultContent(JSON.stringify(value, null, 2));
  }

  async function runSelectedWorkflow() {
    if (!selectedWorkflow) {
      return;
    }
    const runDir = `runs/ui_control_${selectedWorkflow.file_id}`;
    const result = await api.runWorkflow(selectedWorkflow.workflow_id, runDir);
    setMessage(`已运行 ${selectedWorkflow.workflow_id}`);
    showJson(`${selectedWorkflow.workflow_id}.run.json`, result);
  }

  async function inspectSelectedRun() {
    if (!currentRun) {
      return;
    }
    const result = await api.run(currentRun.run_id);
    setMessage(`已读取 ${currentRun.run_id}`);
    showJson(`${currentRun.run_id}.json`, result);
  }

  async function readSelectedArtifact() {
    if (!artifactPath) {
      return;
    }
    const result = await api.artifact(artifactPath);
    setMessage(`已读取 ${artifactPath}`);
    showJson(result.name, result);
  }


  if (!isDev) {
    return null;
  }

  return (
    <section className="panel control-plane-panel" aria-label="控制平面">
      <header className="panel-header">
        <div>
          <h2>{t.controlPlane}</h2>
          <p>把现有 CLI 与 server 能力收成可点击、可检查的浏览器入口。</p>
        </div>
        <ShieldCheck aria-hidden="true" size={20} />
      </header>
      <div className="split compact">
        <section className="detail-surface control-actions" aria-label="控制平面操作">
          <div className="control-group">
            <h3>
              <Workflow aria-hidden="true" size={16} />
              工作流与运行
            </h3>
            <button type="button" onClick={runSelectedWorkflow} disabled={!selectedWorkflow}>
              运行示例工作流
            </button>
            <button type="button" onClick={inspectSelectedRun} disabled={!currentRun}>
              检查当前运行
            </button>
            <button type="button" onClick={readSelectedArtifact} disabled={!artifactPath}>
              读取当前产物
            </button>
          </div>
          <div className="control-group">
            <h3>{t.graphOps}</h3>
            <p className="muted">
              Legacy patch validate / dry-run routes have retired. Use GraphOps proposal APIs from the decision inbox or authoring flow.
            </p>
          </div>
          {message ? <div className="notice neutral">{message}</div> : null}
        </section>
        <div className="detail-surface">
          <CodeBlock title={resultTitle} content={resultContent} variant="json" />
        </div>
      </div>
    </section>
  );
}
