import demoCanvas from './workspaceDemoCanvas.data.json';
import type { WorkspaceCanvasModel } from '../../types/workbench';

export function workspaceDemoCanvas(): WorkspaceCanvasModel {
  return structuredClone(demoCanvas) as WorkspaceCanvasModel;
}
