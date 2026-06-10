export function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes} m ${remainingSeconds} s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} h ${remainingMinutes} m`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) {
    return 'n/a';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return exponent === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[exponent]}`;
}

export function formatTimestamp(iso?: string | null): string {
  if (!iso) {
    return 'n/a';
  }
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) {
      return 'n/a';
    }
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs >= 0 && diffMs < 60_000) {
      return '刚刚';
    }
    if (diffMs >= 60_000 && diffMs < 3_600_000) {
      return `${Math.floor(diffMs / 60_000)}分钟前`;
    }
    if (diffMs >= 3_600_000 && diffMs < 86_400_000) {
      return `${Math.floor(diffMs / 3_600_000)}小时前`;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return 'n/a';
  }
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
