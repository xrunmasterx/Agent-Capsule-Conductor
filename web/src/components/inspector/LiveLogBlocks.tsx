import type { NodeLiveLogs } from '../../types/workbench';
import { CodeBlock } from '../CodeBlock';

export function LiveLogBlocks({ liveLogs }: { liveLogs?: NodeLiveLogs }) {
  if (!liveLogs || (!liveLogs.stdout && !liveLogs.stderr)) {
    return null;
  }
  return (
    <>
      {liveLogs.stdout ? <CodeBlock title="Live stdout" content={liveLogs.stdout} variant="log" /> : null}
      {liveLogs.stderr ? <CodeBlock title="Live stderr" content={liveLogs.stderr} variant="log" /> : null}
    </>
  );
}
