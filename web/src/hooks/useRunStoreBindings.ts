import { useRunStore, type NodeLiveLogs, type RunProjection } from '../stores/runStore';
import type { RuntimeConfig, WorkbenchLiveEvent } from '../types';

export type RunStoreBindings = {
  runsById: Record<string, RunProjection>;
  setRunsById: (
    updater: Record<string, RunProjection> | ((current: Record<string, RunProjection>) => Record<string, RunProjection>),
  ) => void;
  runLogsById: Record<string, Record<string, NodeLiveLogs>>;
  setRunLogsById: (
    updater:
      | Record<string, Record<string, NodeLiveLogs>>
      | ((current: Record<string, Record<string, NodeLiveLogs>>) => Record<string, Record<string, NodeLiveLogs>>),
  ) => void;
  runLiveEventsById: Record<string, WorkbenchLiveEvent[]>;
  setRunLiveEventsById: (
    updater:
      | Record<string, WorkbenchLiveEvent[]>
      | ((current: Record<string, WorkbenchLiveEvent[]>) => Record<string, WorkbenchLiveEvent[]>),
  ) => void;
  runtimeConfig: RuntimeConfig | null;
  setRuntimeConfig: (config: RuntimeConfig | null) => void;
};

export function useRunStoreBindings(): RunStoreBindings {
  const runsById = useRunStore((state) => state.runsById);
  const setRunsById = useRunStore((state) => state.setRunsById);
  const runLogsById = useRunStore((state) => state.runLogsById);
  const setRunLogsById = useRunStore((state) => state.setRunLogsById);
  const runLiveEventsById = useRunStore((state) => state.liveEventsByRunId);
  const setRunLiveEventsById = useRunStore((state) => state.setLiveEventsByRunId);
  const runtimeConfig = useRunStore((state) => state.runtimeConfig);
  const setRuntimeConfig = useRunStore((state) => state.setRuntimeConfig);

  return {
    runsById,
    setRunsById,
    runLogsById,
    setRunLogsById,
    runLiveEventsById,
    setRunLiveEventsById,
    runtimeConfig,
    setRuntimeConfig,
  };
}
