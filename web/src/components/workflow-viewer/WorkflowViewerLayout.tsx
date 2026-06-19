import type { ComponentProps } from 'react';

import {
  TopBar as TopBarComponent,
  WorkbenchShell,
} from '../workbench';
import { WorkflowViewerDock } from './WorkflowViewerDock';
import { WorkflowViewerMainStage } from './WorkflowViewerMainStage';
import { WorkflowViewerNodeDetailOverlay } from './WorkflowViewerNodeDetailOverlay';
import { WorkflowViewerRightPanel } from './WorkflowViewerRightPanel';

export type WorkflowViewerLayoutProps = {
  durableTasksReady: boolean;
  rightPanelVisible: boolean;
  onCanvasPointerDownCapture: ComponentProps<'div'>['onPointerDownCapture'];
  onCanvasClickCapture: ComponentProps<'div'>['onClickCapture'];
  topBarProps: ComponentProps<typeof TopBarComponent>;
  mainStageProps: ComponentProps<typeof WorkflowViewerMainStage>;
  rightPanelProps: ComponentProps<typeof WorkflowViewerRightPanel>;
  nodeDetailOverlayProps: ComponentProps<typeof WorkflowViewerNodeDetailOverlay>;
  dockProps: ComponentProps<typeof WorkflowViewerDock>;
};

export function WorkflowViewerLayout({
  durableTasksReady,
  rightPanelVisible,
  onCanvasPointerDownCapture,
  onCanvasClickCapture,
  topBarProps,
  mainStageProps,
  rightPanelProps,
  nodeDetailOverlayProps,
  dockProps,
}: WorkflowViewerLayoutProps) {
  return (
    <WorkbenchShell durableTasksReady={durableTasksReady}>
      <TopBarComponent {...topBarProps} />
      <div
        className={['workspace-canvas-layout', rightPanelVisible ? 'inspector-open' : '']
          .filter(Boolean)
          .join(' ')}
        onPointerDownCapture={onCanvasPointerDownCapture}
        onClickCapture={onCanvasClickCapture}
      >
        <WorkflowViewerMainStage {...mainStageProps} />
        <WorkflowViewerRightPanel {...rightPanelProps} />
        <WorkflowViewerNodeDetailOverlay {...nodeDetailOverlayProps} />
      </div>
      <WorkflowViewerDock {...dockProps} />
    </WorkbenchShell>
  );
}
