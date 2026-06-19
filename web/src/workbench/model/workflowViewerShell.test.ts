import { describe, expect, test } from 'vitest';

import type { SelectedEntityDetailsModel } from '../../types/workbench';
import {
  artifactNameFromPath,
  inspectorDrawerTitle,
  isNodeDetailModel,
  selectionKey,
  textArtifact,
  truncateLargeLog,
} from './workflowViewerShell';

describe('workflowViewerShell', () => {
  test('creates stable selection keys and inspector titles', () => {
    expect(selectionKey({ type: 'task_canvas', taskId: 'task_1' })).toBe('task:task_1');
    expect(selectionKey({ type: 'workflow', id: 'flow' })).toBe('workflow:flow');
    expect(selectionKey({ type: 'internal', workflowId: 'flow', nodeId: 'agent' })).toBe('internal:flow:agent');
    expect(selectionKey({ type: 'edge', scopeWorkflowId: null, id: 'edge_1' })).toBe('edge:root:edge_1');
    expect(selectionKey({ type: 'port', workflowId: 'flow', direction: 'input', portId: 'target' })).toBe(
      'port:flow:input:target',
    );

    expect(inspectorDrawerTitle({ type: 'task_canvas', taskId: 'task_1' })).toBe('任务设置');
    expect(inspectorDrawerTitle({ type: 'workflow', id: 'flow' })).toBe('节点设置');
    expect(inspectorDrawerTitle({ type: 'edge', scopeWorkflowId: null, id: 'edge_1' })).toBe('连接设置');
    expect(inspectorDrawerTitle({ type: 'port', workflowId: 'flow', direction: 'output', portId: 'main' })).toBe(
      '端口设置',
    );
  });

  test('detects node detail models', () => {
    const base: SelectedEntityDetailsModel = {
      key: 'canvas',
      kind: 'canvas',
      title: 'Canvas',
      status: 'not_run',
      log: { stdout: '', stderr: '', excerpt: '' },
      properties: [],
      evidenceActions: [],
      events: [],
    };

    expect(isNodeDetailModel(base)).toBe(false);
    expect(isNodeDetailModel({ ...base, kind: 'node' })).toBe(true);
    expect(isNodeDetailModel({ ...base, kind: 'workflow' })).toBe(true);
    expect(isNodeDetailModel({ ...base, kind: 'internal-node' })).toBe(true);
  });

  test('creates text artifacts and names artifacts from paths', () => {
    expect(textArtifact('run-error.log', 'failed', 'log')).toEqual({
      name: 'run-error.log',
      path: 'run-error.log',
      content: 'failed',
      type: 'log',
      size_bytes: 6,
    });
    expect(artifactNameFromPath('C:\\runs\\run_1\\output.json')).toBe('output.json');
    expect(artifactNameFromPath('/tmp/stdout.log')).toBe('stdout.log');
  });

  test('truncates very large log artifacts without touching other artifacts', () => {
    const content = Array.from({ length: 520 }, (_, index) => `line ${index}`).join('\n');
    const truncated = truncateLargeLog(textArtifact('stdout.log', content, 'log'));

    expect(truncated.content).toContain('日志较大，仅显示最后');
    expect(truncated.content).toContain('line 519');
    expect(truncated.content).not.toContain('line 0');
    expect(truncateLargeLog(textArtifact('output.json', content, 'json')).content).toBe(content);
  });
});
