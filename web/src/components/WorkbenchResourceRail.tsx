import { Boxes, FileText, GitBranch, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { CallableSummary, WorkflowSummary } from '../types';
import {
  fileSourcePaletteItem,
  newWorkflowPaletteItem,
  paletteItemFromCallable,
  paletteItemFromWorkflow,
  setPaletteDragData,
} from './workflow-viewer/palette';

export function WorkbenchResourceRail({
  callables,
  workflows,
  resourceErrors,
}: {
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  resourceErrors?: {
    callables?: string;
    workflows?: string;
  };
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const visibleCallables = useMemo(
    () =>
      callables
        .filter((callable) => callable.id !== 'file-source.local')
        .filter((callable) => {
          if (!normalizedSearch) {
            return true;
          }
          return `${callable.id} ${callable.name || ''} ${callable.kind}`.toLowerCase().includes(normalizedSearch);
        })
        .slice(0, 40),
    [callables, normalizedSearch],
  );
  const visibleWorkflows = useMemo(
    () =>
      workflows
        .filter((workflow) => {
          if (!normalizedSearch) {
            return true;
          }
          return `${workflow.workflow_id} ${workflow.name || ''} ${workflow.path || ''}`.toLowerCase().includes(normalizedSearch);
        })
        .slice(0, 30),
    [normalizedSearch, workflows],
  );

  return (
    <section className="workbench-resource-rail" aria-label="Workbench 资源栏">
      <header className="resource-rail-header">
        <span>CALLABLE ASSETS</span>
        <strong>资源</strong>
      </header>
      <label className="resource-rail-search">
        <Search aria-hidden="true" size={14} />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="过滤资源"
          aria-label="过滤 Workbench 资源"
        />
      </label>
      <div className="resource-rail-scroll">
        {resourceErrors?.workflows ? (
          <div className="notice compact-notice">Workflow 模板加载失败：{resourceErrors.workflows}</div>
        ) : null}
        {resourceErrors?.callables ? (
          <div className="notice compact-notice">Callable 模板加载失败：{resourceErrors.callables}</div>
        ) : null}
        <button
          type="button"
          className="resource-rail-item resource-kind-workflow"
          draggable
          onDragStart={(event) => setPaletteDragData(event, newWorkflowPaletteItem())}
        >
          <GitBranch aria-hidden="true" size={14} />
          <span>
            <strong>New Workflow</strong>
            <small>inline container</small>
          </span>
        </button>
        {visibleWorkflows.map((workflow) => {
          const item = paletteItemFromWorkflow(workflow);
          return (
            <button
              type="button"
              key={workflow.path || workflow.file_id || workflow.workflow_id}
              className="resource-rail-item resource-kind-workflow"
              draggable
              onDragStart={(event) => setPaletteDragData(event, item)}
            >
              <GitBranch aria-hidden="true" size={14} />
              <span>
                <strong>{workflow.name || workflow.workflow_id}</strong>
                <small>{workflow.workflow_id}</small>
              </span>
            </button>
          );
        })}
        <div className="resource-rail-divider">Agent / Tool</div>
        {visibleCallables.map((callable) => {
          const item = paletteItemFromCallable(callable);
          return (
            <button
              type="button"
              key={callable.id}
              className={`resource-rail-item resource-kind-${item.kind}`}
              draggable
              onDragStart={(event) => setPaletteDragData(event, item)}
            >
              <Boxes aria-hidden="true" size={14} />
              <span>
                <strong>{callable.name || callable.id}</strong>
                <small>{callable.id}</small>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="resource-rail-item resource-kind-file-source"
          draggable
          onDragStart={(event) => setPaletteDragData(event, fileSourcePaletteItem())}
        >
          <FileText aria-hidden="true" size={14} />
          <span>
            <strong>File Source</strong>
            <small>file-source.local</small>
          </span>
        </button>
      </div>
    </section>
  );
}
