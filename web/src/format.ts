export function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

export function shortPath(path?: string | null): string {
  if (!path) {
    return 'n/a';
  }
  const normalized = path.replaceAll('\\', '/');
  const marker = '/runs/';
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function statusTone(status: string): 'good' | 'bad' | 'warn' {
  if (status === 'success' || status === 'ok') {
    return 'good';
  }
  if (status.includes('error') || status === 'failed' || status === 'invalid') {
    return 'bad';
  }
  return 'warn';
}

