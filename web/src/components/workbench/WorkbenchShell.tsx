/**
 * WorkbenchShell - top-level layout container for the ACC Workbench.
 *
 * Provides the outer section element that wraps the top bar, task rail,
 * canvas area, inspector, and evidence dock.
 */

import type { ReactNode } from 'react';

export function WorkbenchShell({ children }: { children: ReactNode }) {
  return (
    <section className="panel workflow-viewer graph-workbench-v2" aria-label="ACC Workbench">
      {children}
    </section>
  );
}
