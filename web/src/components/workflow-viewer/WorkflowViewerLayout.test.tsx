import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

import { WorkflowViewerLayout, type WorkflowViewerLayoutProps } from './WorkflowViewerLayout';

vi.mock('../workbench', () => ({
  TopBar: ({ title, onToggleAssistant }: { title: string; onToggleAssistant: () => void }) => (
    <button type="button" onClick={onToggleAssistant}>
      {title}
    </button>
  ),
  WorkbenchShell: ({
    durableTasksReady,
    children,
  }: {
    durableTasksReady: boolean;
    children: ReactNode;
  }) => <section data-testid="shell" data-ready={String(durableTasksReady)}>{children}</section>,
}));

vi.mock('./WorkflowViewerMainStage', () => ({
  WorkflowViewerMainStage: () => <div data-testid="main-stage" />,
}));

vi.mock('./WorkflowViewerRightPanel', () => ({
  WorkflowViewerRightPanel: ({ onCollapseRightPanel }: { onCollapseRightPanel: () => void }) => (
    <button type="button" onClick={onCollapseRightPanel}>
      right-panel
    </button>
  ),
}));

vi.mock('./WorkflowViewerNodeDetailOverlay', () => ({
  WorkflowViewerNodeDetailOverlay: ({ open }: { open: boolean }) => (
    <div data-testid="node-detail" data-open={String(open)} />
  ),
}));

vi.mock('./WorkflowViewerDock', () => ({
  WorkflowViewerDock: () => <div data-testid="dock" />,
}));

function props(overrides: Partial<WorkflowViewerLayoutProps> = {}): WorkflowViewerLayoutProps {
  return {
    durableTasksReady: true,
    rightPanelVisible: true,
    onCanvasPointerDownCapture: vi.fn(),
    onCanvasClickCapture: vi.fn(),
    topBarProps: {
      title: 'Canvas',
      subtitle: 'Subtitle',
      isRunning: false,
      onNew: vi.fn(),
      onLoadDemo: vi.fn(),
      onSave: vi.fn(),
      onValidate: vi.fn(),
      onRun: vi.fn(),
      onAutoLayout: vi.fn(),
      assistantOpen: false,
      onToggleAssistant: vi.fn(),
      detailsOpen: false,
      onToggleDetails: vi.fn(),
    },
    mainStageProps: {} as WorkflowViewerLayoutProps['mainStageProps'],
    rightPanelProps: {
      onCollapseRightPanel: vi.fn(),
    } as unknown as WorkflowViewerLayoutProps['rightPanelProps'],
    nodeDetailOverlayProps: {
      open: true,
    } as WorkflowViewerLayoutProps['nodeDetailOverlayProps'],
    dockProps: {} as WorkflowViewerLayoutProps['dockProps'],
    ...overrides,
  };
}

describe('WorkflowViewerLayout', () => {
  test('renders shell regions and applies right-panel layout class', () => {
    render(<WorkflowViewerLayout {...props()} />);

    expect(screen.getByTestId('shell')).toHaveAttribute('data-ready', 'true');
    expect(screen.getByText('Canvas')).toBeInTheDocument();
    expect(screen.getByTestId('main-stage')).toBeInTheDocument();
    expect(screen.getByText('right-panel')).toBeInTheDocument();
    expect(screen.getByTestId('node-detail')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('dock')).toBeInTheDocument();
    expect(document.querySelector('.workspace-canvas-layout')).toHaveClass('inspector-open');
  });

  test('forwards topbar and right panel actions', () => {
    const onToggleAssistant = vi.fn();
    const onCollapseRightPanel = vi.fn();
    const baseProps = props();
    const layoutProps = props({
      topBarProps: {
        ...baseProps.topBarProps,
        onToggleAssistant,
      },
      rightPanelProps: {
        ...baseProps.rightPanelProps,
        onCollapseRightPanel,
      },
    });

    render(<WorkflowViewerLayout {...layoutProps} />);

    fireEvent.click(screen.getByText('Canvas'));
    fireEvent.click(screen.getByText('right-panel'));

    expect(onToggleAssistant).toHaveBeenCalledTimes(1);
    expect(onCollapseRightPanel).toHaveBeenCalledTimes(1);
  });
});
