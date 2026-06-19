import { useRef } from 'react';

import { useAssistantStore } from '../stores/assistantStore';
import { useRunStore } from '../stores/runStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { WorkbenchTaskStorePayload } from '../types/workbench';

export function useWorkbenchStoreInitialization(initialTaskStore: WorkbenchTaskStorePayload): void {
  const initializedRef = useRef(false);
  if (initializedRef.current) {
    return;
  }
  useAssistantStore.setState(useAssistantStore.getInitialState(), true);
  useRunStore.setState(useRunStore.getInitialState(), true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.getState().hydrateTasks(initialTaskStore.tasks, initialTaskStore.activeTaskId);
  initializedRef.current = true;
}
