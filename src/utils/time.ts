/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期。 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '未知';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '未知';

  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatDateTime(iso);
}

/** 具体时间：M月D日 HH:mm（跨年带年份）。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const pad = (n: number) => String(n).padStart(2, '0');
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const base = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return sameYear ? base : `${date.getFullYear()}年${base}`;
}

/** 文件大小：B / KB / MB / GB。 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
