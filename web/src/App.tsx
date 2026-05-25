import { Box, Database, FileText, GitBranch, Layers, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { ArtifactViewer } from './components/ArtifactViewer';
import { CapsuleBrowser } from './components/CapsuleBrowser';
import { ControlPlanePanel } from './components/ControlPlanePanel';
import { RunInspector } from './components/RunInspector';
import { RunList } from './components/RunList';
import { WorkflowViewer } from './components/WorkflowViewer';
import { zhCN as t } from './i18n/zh-CN';
import type { CapsuleSummary, RunSummary, ViewKey, WorkflowSummary } from './types';

const navigation = [
  { key: 'runs', label: t.runs, icon: Database },
  { key: 'capsules', label: t.capsuleLibrary, icon: Box },
  { key: 'artifacts', label: t.artifacts, icon: FileText },
  { key: 'workflows', label: t.workflow, icon: GitBranch },
  { key: 'control', label: t.controlPlane, icon: Layers },
] as const;

export function App() {
  const [view, setView] = useState<ViewKey>('runs');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [capsules, setCapsules] = useState<CapsuleSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedCapsuleId, setSelectedCapsuleId] = useState<string>('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [apiState, setApiState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>('');

  const loadInitialData = useCallback(
    async (ignore?: () => boolean) => {
      setApiState('loading');
      try {
        const [runIndex, capsuleIndex, workflowIndex] = await Promise.all([
          api.runs(),
          api.capsules(),
          api.workflows(),
        ]);
        if (ignore?.()) {
          return;
        }
        setRuns(runIndex.runs);
        setCapsules(capsuleIndex.capsules);
        setWorkflows(workflowIndex.workflows);
        setSelectedRunId((current) => current || runIndex.runs[0]?.run_id || '');
        setSelectedCapsuleId((current) => current || capsuleIndex.capsules[0]?.id || '');
        setSelectedWorkflowId((current) => current || workflowIndex.workflows[0]?.workflow_id || '');
        setApiState('ready');
      } catch (requestError) {
        if (!ignore?.()) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
          setApiState('error');
        }
      }
    },
    [],
  );

  useEffect(() => {
    let ignore = false;
    loadInitialData(() => ignore);
    return () => {
      ignore = true;
    };
  }, [loadInitialData]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) || runs[0],
    [runs, selectedRunId],
  );

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Workbench navigation">
        <div className="brand">
          <Workflow aria-hidden="true" size={22} />
          <div>
            <h1>{t.appTitle}</h1>
            <p>{t.appSubtitle}</p>
          </div>
        </div>
        <nav className="nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={view === item.key ? 'nav-button active' : 'nav-button'}
                type="button"
                onClick={() => setView(item.key)}
                title={item.label}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className={`server-state ${apiState}`}>
          <span>{apiState === 'ready' ? t.apiConnected : apiState}</span>
        </div>
      </aside>

      <section className="workspace">
        {apiState === 'error' ? <div className="notice">API error: {error}</div> : null}
        {view === 'runs' ? (
          <div className="split">
            <RunList
              runs={runs}
              selectedRunId={selectedRun?.run_id || ''}
              onSelect={(runId) => setSelectedRunId(runId)}
            />
            <RunInspector runId={selectedRun?.run_id || ''} />
          </div>
        ) : null}
        {view === 'capsules' ? (
          <CapsuleBrowser
            capsules={capsules}
            selectedCapsuleId={selectedCapsuleId}
            onSelect={setSelectedCapsuleId}
            onChanged={() => loadInitialData()}
          />
        ) : null}
        {view === 'artifacts' ? <ArtifactViewer run={selectedRun} /> : null}
        {view === 'workflows' ? (
          <WorkflowViewer
            workflows={workflows}
            capsules={capsules}
            selectedWorkflowId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
            onChanged={() => loadInitialData()}
          />
        ) : null}
        {view === 'control' ? (
          <ControlPlanePanel runs={runs} workflows={workflows} selectedRun={selectedRun} />
        ) : null}
        <div className="read-only-bar">
          <Layers aria-hidden="true" size={16} />
          编辑模式：所有读取和写入都通过 acc-server API。
        </div>
      </section>
    </main>
  );
}
