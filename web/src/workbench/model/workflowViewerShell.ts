import type { ArtifactContent } from '../../types';
import { MAX_LOG_PREVIEW_LINES } from '../constants';
import type { CanvasSelection, SelectedEntityDetailsModel } from '../../types/workbench';

export function isNodeDetailModel(model: SelectedEntityDetailsModel): boolean {
  return model.kind === 'node' || model.kind === 'internal-node' || model.kind === 'workflow';
}

export function selectionKey(selection: CanvasSelection): string {
  if (selection.type === 'task_canvas') {
    return `task:${selection.taskId}`;
  }
  if (selection.type === 'workflow') {
    return `${selection.type}:${selection.id}`;
  }
  if (selection.type === 'internal') {
    return `internal:${selection.workflowId}:${selection.nodeId}`;
  }
  if (selection.type === 'edge') {
    return `edge:${selection.scopeWorkflowId || 'root'}:${selection.id}`;
  }
  if (selection.type === 'port') {
    return `port:${selection.workflowId}:${selection.direction}:${selection.portId}`;
  }
  return 'unknown';
}

export function isJsdomRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.navigator?.userAgent?.toLowerCase().includes('jsdom')
  );
}

export function inspectorDrawerTitle(selection: CanvasSelection): string {
  if (selection.type === 'port') {
    return '端口设置';
  }
  if (selection.type === 'edge') {
    return '连接设置';
  }
  if (selection.type === 'workflow' || selection.type === 'internal') {
    return '节点设置';
  }
  return '任务设置';
}

export function textArtifact(name: string, content: string, type: ArtifactContent['type']): ArtifactContent {
  return { name, path: name, content, type, size_bytes: content.length };
}

export function artifactNameFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).pop() || path;
}

export function truncateLargeLog(content: ArtifactContent): ArtifactContent {
  if (content.type !== 'log') {
    return content;
  }
  const lines = content.content.split(/\r?\n/u);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return content;
  }
  const nextContent = [
    `日志较大，仅显示最后 ${MAX_LOG_PREVIEW_LINES} 行。`,
    '',
    ...lines.slice(-MAX_LOG_PREVIEW_LINES),
  ].join('\n');
  return { ...content, content: nextContent };
}
