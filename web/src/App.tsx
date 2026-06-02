import { Boxes, Database, FileText, Inbox, Layers, ListChecks, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { ArtifactViewer } from './components/ArtifactViewer';
import { CallableBrowser } from './components/CallableBrowser';
import { ControlPlanePanel } from './components/ControlPlanePanel';
import { DecisionInboxPanel } from './components/DecisionInboxPanel';
import { RunMonitorPage } from './components/RunMonitorPage';
import { WorkflowViewer } from './components/WorkflowViewer';
import { zhCN as t } from './i18n/zh-CN';
import type { CallableSummary, RunSummary, ViewKey, WorkflowSummary } from './types';

type ResourceStatus = 'loading' | 'ready' | 'error';
type ServerState = ResourceStatus | 'degraded';

type ResourceState<T> = {
  status: ResourceStatus;
  data: T;
  error: string;
};

const navigation = [
  { key: 'tasks', label: '任务', icon: ListChecks },
  { key: 'resources', label: '资源', icon: Boxes },
  { key: 'runs', label: t.runs, icon: Database },
  { key: 'artifacts', label: t.artifacts, icon: FileText },
  { key: 'decisions', label: '决策', icon: Inbox },
  { key: 'control', label: t.controlPlane, icon: Layers },
] as const;

export function App() {
  const [view, setView] = useState<ViewKey>('tasks');
  const [runsResource, setRunsResource] = useState<ResourceState<RunSummary[]>>({
    status: 'loading',
    data: [],
    error: '',
  });
  const [callablesResource, setCallablesResource] = useState<ResourceState<CallableSummary[]>>({
    status: 'loading',
    data: [],
    error: '',
  });
  const [workflowsResource, setWorkflowsResource] = useState<ResourceState<WorkflowSummary[]>>({
    status: 'loading',
    data: [],
    error: '',
  });
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedCallableId, setSelectedCallableId] = useState<string>('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');

  const runs = runsResource.data;
  const callables = callablesResource.data;
  const workflows = workflowsResource.data;

  const refreshRuns = useCallback(async (ignore?: () => boolean) => {
    setRunsResource((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const runIndex = await api.runs();
      if (ignore?.()) {
        return;
      }
      setRunsResource({ status: 'ready', data: runIndex.runs, error: '' });
      setSelectedRunId((current) => selectExistingOrFirst(current, runIndex.runs, (run) => run.run_id));
    } catch (requestError) {
      if (!ignore?.()) {
        setRunsResource((current) => ({
          ...current,
          status: 'error',
          error: requestErrorMessage(requestError),
        }));
      }
    }
  }, []);

  const refreshCallables = useCallback(async (ignore?: () => boolean) => {
    setCallablesResource((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const callableIndex = await api.callables();
      if (ignore?.()) {
        return;
      }
      setCallablesResource({ status: 'ready', data: callableIndex.callables, error: '' });
      setSelectedCallableId((current) =>
        selectExistingOrFirst(current, callableIndex.callables, (callable) => callable.id),
      );
    } catch (requestError) {
      if (!ignore?.()) {
        setCallablesResource((current) => ({
          ...current,
          status: 'error',
          error: requestErrorMessage(requestError),
        }));
      }
    }
  }, []);

  const refreshWorkflows = useCallback(async (ignore?: () => boolean) => {
    setWorkflowsResource((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const workflowIndex = await api.workflows();
      if (ignore?.()) {
        return;
      }
      setWorkflowsResource({ status: 'ready', data: workflowIndex.workflows, error: '' });
      setSelectedWorkflowId((current) =>
        selectExistingOrFirst(current, workflowIndex.workflows, (workflow) => workflow.workflow_id),
      );
    } catch (requestError) {
      if (!ignore?.()) {
        setWorkflowsResource((current) => ({
          ...current,
          status: 'error',
          error: requestErrorMessage(requestError),
        }));
      }
    }
  }, []);

  const refreshResources = useCallback(
    (ignore?: () => boolean) => {
      void refreshRuns(ignore);
      void refreshCallables(ignore);
      void refreshWorkflows(ignore);
    },
    [refreshCallables, refreshRuns, refreshWorkflows],
  );

  useEffect(() => {
    let ignore = false;
    refreshResources(() => ignore);
    return () => {
      ignore = true;
    };
  }, [refreshResources]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.run_id === selectedRunId) || runs[0],
    [runs, selectedRunId],
  );
  const apiState = resourceServerState([runsResource, callablesResource, workflowsResource]);
  const resourceErrors = [
    runsResource.error ? `运行记录：${runsResource.error}` : '',
    callablesResource.error ? `Callable：${callablesResource.error}` : '',
    workflowsResource.error ? `Workflow：${workflowsResource.error}` : '',
  ].filter(Boolean);

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
          <span>{serverStateLabel(apiState)}</span>
        </div>
      </aside>

      <section className="workspace">
        {resourceErrors.length > 0 ? (
          <div className="notice">API 资源加载异常：{resourceErrors.join('；')}</div>
        ) : null}
        {view === 'runs' ? (
          <RunMonitorPage
            runs={runs}
            loadError={runsResource.error}
            selectedRunId={selectedRun?.run_id || ''}
            onSelectRun={(runId) => setSelectedRunId(runId)}
          />
        ) : null}
        {view === 'resources' ? (
          <CallableBrowser
            callables={callables}
            loadError={callablesResource.error}
            selectedCallableId={selectedCallableId}
            onSelect={setSelectedCallableId}
            onChanged={() => refreshResources()}
          />
        ) : null}
        {view === 'artifacts' ? <ArtifactViewer run={selectedRun} /> : null}
        {view === 'tasks' ? (
          <WorkflowViewer
            workflows={workflows}
            callables={callables}
            resourceErrors={{
              callables: callablesResource.error,
              workflows: workflowsResource.error,
            }}
            selectedWorkflowId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
            onChanged={() => refreshResources()}
          />
        ) : null}
        {view === 'decisions' ? (
          <DecisionInboxPanel
            onViewRun={(runId) => {
              setSelectedRunId(runId);
              setView('runs');
            }}
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

function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectExistingOrFirst<T>(current: string, items: T[], getId: (item: T) => string): string {
  if (current && items.some((item) => getId(item) === current)) {
    return current;
  }
  return items[0] ? getId(items[0]) : '';
}

function resourceServerState(resources: ResourceState<unknown>[]): ServerState {
  const hasError = resources.some((resource) => resource.status === 'error');
  const hasReady = resources.some((resource) => resource.status === 'ready');
  if (!hasError) {
    return resources.every((resource) => resource.status === 'ready') ? 'ready' : 'loading';
  }
  return hasReady ? 'degraded' : 'error';
}

function serverStateLabel(state: ServerState): string {
  if (state === 'ready') {
    return t.apiConnected;
  }
  if (state === 'degraded') {
    return 'API 部分可用';
  }
  if (state === 'error') {
    return 'API error';
  }
  return 'loading';
}
