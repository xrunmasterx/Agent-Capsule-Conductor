import {
  WorkflowViewerController,
  type WorkflowViewerControllerProps,
} from './workflow-viewer/WorkflowViewerController';

type Props = WorkflowViewerControllerProps;

export function WorkflowViewer(props: Props) {
  return <WorkflowViewerController {...props} />;
}