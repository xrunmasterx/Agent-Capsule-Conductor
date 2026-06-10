import { FileJson, ShieldCheck, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { zhCN as t } from '../i18n/zh-CN';
import type { GraphOpsExample, RunSummary, WorkflowSummary } from '../types';
import { CodeBlock } from './CodeBlock';

type Props = {
  runs: RunSummary[];
  workflows: WorkflowSummary[];
  selectedRun?: RunSummary;
};

export function ControlPlanePanel({ runs, workflows, selectedRun }: Props) {
  const isDev = new URLSearchParams(window.location.search).has('dev');
  const [patches, setPatches] = useState<GraphOpsExample[]>([]);
  const [selectedPatch, setSelectedPatch] = useState('');
  const [message, setMessage] = useState('');
  const [resultTitle, setResultTitle] = useState('control_plane.json');
  const [resultContent, setResultContent] = useState('{}');

  useEffect(() => {
    if (!isDev) {
      return;
    }
    let ignore = false;
    api.graphopsExamples().then((payload) => {
      if (ignore) {
        return;
      }
      setPatches(payload.patches);
      setSelectedPatch((current) => current || payload.patches[0]?.path || '');
    });
    return () => {
      ignore = true;
    };
  }, []);

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

  async function validatePatch() {
    if (!selectedPatch) {
      return;
    }
    const result = await api.graphopsValidate(selectedPatch, true);
    setMessage(`已校验 ${selectedPatch}`);
    showJson('graphops.validate.json', result);
  }

  async function dryRunPatch() {
    if (!selectedPatch) {
      return;
    }
    const result = await api.graphopsDryRun(selectedPatch, true);
    setMessage(`已 dry-run ${selectedPatch}`);
    showJson('graphops.dry-run.json', result);
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
            <h3>
              <FileJson aria-hidden="true" size={16} />
              {t.graphOps}
            </h3>
            <label>
              示例 patch
              <select value={selectedPatch} onChange={(event) => setSelectedPatch(event.target.value)}>
                {patches.map((patch) => (
                  <option key={patch.path} value={patch.path}>
                    {patch.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={validatePatch} disabled={!selectedPatch}>
              {t.validate} patch
            </button>
            <button type="button" onClick={dryRunPatch} disabled={!selectedPatch}>
              dry-run patch
            </button>
            <p className="muted">{t.approvalRequired}</p>
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
