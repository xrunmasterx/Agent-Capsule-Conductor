import {
  selectRun,
  selectRunLiveEventsForRun,
  selectRunLogsForRun,
  selectRunOverlay,
  useRunStore,
  type NodeLiveLogs,
  type RunProjection,
} from '../stores/runStore';
import type { RuntimeConfig, WorkbenchLiveEvent } from '../types';

export type RunStoreActions = {
  updateRun: (runId: string, updater: (current: RunProjection) => RunProjection) => void;
  upsertRun: (run: RunProjection) => void;
  patchRun: (runId: string, patch: Partial<RunProjection>) => void;
  removeRun: (runId: string) => void;
  setRunLogs: (runId: string, nodeKey: string, updater: (prev: NodeLiveLogs) => NodeLiveLogs) => void;
  appendLiveEvents: (runId: string, events: WorkbenchLiveEvent[], limit?: number) => void;
  setRuntimeConfig: (config: RuntimeConfig | null) => void;
};

export function useRunStoreActions(): RunStoreActions {
  const updateRun = useRunStore((state) => state.updateRun);
  const upsertRun = useRunStore((state) => state.upsertRun);
  const patchRun = useRunStore((state) => state.patchRun);
  const removeRun = useRunStore((state) => state.removeRun);
  const setRunLogs = useRunStore((state) => state.setRunLogs);
  const appendLiveEvents = useRunStore((state) => state.appendLiveEvents);
  const setRuntimeConfig = useRunStore((state) => state.setRuntimeConfig);

  return {
    updateRun,
    upsertRun,
    patchRun,
    removeRun,
    setRunLogs,
    appendLiveEvents,
    setRuntimeConfig,
  };
}

export function useRuntimeConfig(): RuntimeConfig | null {
  return useRunStore((state) => state.runtimeConfig);
}

export function useRunProjection(runId: string | null): RunProjection | undefined {
  return useRunStore((state) => selectRun(state, runId));
}

export function useRunOverlay(runId: string | null): RunProjection['overlay'] | null {
  return useRunStore((state) => selectRunOverlay(state, runId));
}

export function useRunLogsForRun(runId: string | null): Readonly<Record<string, NodeLiveLogs>> {
  return useRunStore((state) => selectRunLogsForRun(state, runId));
}

export function useNodeLiveLogs(runId: string | null, nodeKey: string | null): NodeLiveLogs | undefined {
  return useRunStore((state) => {
    if (!runId || !nodeKey) {
      return undefined;
    }
    return state.runLogsById[runId]?.[nodeKey];
  });
}

export function useRunLiveEvents(
  runId: string | null,
  filter?: (event: WorkbenchLiveEvent) => boolean,
): readonly WorkbenchLiveEvent[] {
  return useRunStore((state) => {
    const events = selectRunLiveEventsForRun(state, runId);
    return filter ? events.filter(filter) : events;
  });
}
