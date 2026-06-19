import type { Dispatch, SetStateAction } from 'react';

import type {
  CallableSummary,
  RuntimeConfig,
  WorkflowBindingView,
  WorkflowRunResult,
  WorkflowSummary,
} from '../../types';
import type {
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { WorkspaceCanvas } from '../canvas/WorkspaceCanvas';
import { ExecutionDock } from '../execution';
import { TaskOverviewPage, TaskWorkspaceSwitcher } from '../workbench';

export type WorkflowViewerMainStageProps = {
  taskWorkspaceView: TaskWorkspaceView;
  onTaskWorkspaceViewChange: (view: TaskWorkspaceView) => void;
  tasks: WorkbenchTask[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
  canvas: WorkspaceCanvasModel;
  layoutSyncVersion: number;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  workflowRun: WorkflowRunResult | null;
  focusedWorkflowId: string | null;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  workflowBindings: Record<string, WorkflowBindingView>;
  onFocusedWorkflow: (workflowId: string | null) => void;
  onCanvasChange: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  onSelectCanvasObject: (selection: CanvasSelection) => void;
  onOpenNodeDetails: (selection: CanvasSelection) => void;
  onDeleteSelection: (selection?: CanvasSelection) => void;
  onConnectionMode: (mode: ConnectionMode) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onNotice: (message: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
  isRunning: boolean;
  runtimeConfig: RuntimeConfig | null;
  canRunWorkflow: boolean;
  canRunNode: boolean;
  onRunTask: () => void;
  onRunWorkflow: () => void;
  onRunNode: () => void;
};

export function WorkflowViewerMainStage({
  taskWorkspaceView,
  onTaskWorkspaceViewChange,
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  canvas,
  layoutSyncVersion,
  selection,
  connectionMode,
  edgeViewMode,
  workflowRun,
  focusedWorkflowId,
  callables,
  workflows,
  workflowBindings,
  onFocusedWorkflow,
  onCanvasChange,
  onSelectCanvasObject,
  onOpenNodeDetails,
  onDeleteSelection,
  onConnectionMode,
  onEdgeViewMode,
  onNotice,
  onConfigureWorkflow,
  isRunning,
  runtimeConfig,
  canRunWorkflow,
  canRunNode,
  onRunTask,
  onRunWorkflow,
  onRunNode,
}: WorkflowViewerMainStageProps) {
  return (
    <>
      <TaskWorkspaceSwitcher value={taskWorkspaceView} onChange={onTaskWorkspaceViewChange} />
      {taskWorkspaceView === 'overview' ? (
        <TaskOverviewPage
          tasks={tasks}
          activeTaskId={activeTaskId}
          onSelectTask={onSelectTask}
          onOpenBlueprint={() => onTaskWorkspaceViewChange('blueprint')}
          onNewTask={onNewTask}
          onDeleteTask={onDeleteTask}
        />
      ) : (
        <>
          <WorkspaceCanvas
            canvas={canvas}
            layoutSyncVersion={layoutSyncVersion}
            selection={selection}
            connectionMode={connectionMode}
            workflowRun={workflowRun}
            focusedWorkflowId={focusedWorkflowId}
            callables={callables}
            workflows={workflows}
            bindings={workflowBindings}
            onFocusedWorkflow={onFocusedWorkflow}
            onCanvasChange={onCanvasChange}
            onSelect={onSelectCanvasObject}
            onOpenNodeDetails={onOpenNodeDetails}
            onDeleteSelection={onDeleteSelection}
            edgeViewMode={edgeViewMode}
            onConnectionMode={onConnectionMode}
            onEdgeViewMode={onEdgeViewMode}
            onBlankCanvas={() => undefined}
            onNotice={onNotice}
            onConfigureWorkflow={onConfigureWorkflow}
          />
          <ExecutionDock
            isRunning={isRunning}
            runtimeConfig={runtimeConfig}
            canRunWorkflow={canRunWorkflow}
            canRunNode={canRunNode}
            onRunTask={onRunTask}
            onRunWorkflow={onRunWorkflow}
            onRunNode={onRunNode}
          />
        </>
      )}
    </>
  );
}
