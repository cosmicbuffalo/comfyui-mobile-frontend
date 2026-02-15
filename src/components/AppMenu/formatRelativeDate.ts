export function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp * 1000);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const mm = String(date.getMonth() + 1);
  const dd = String(date.getDate());
  const yy = String(date.getFullYear()).slice(-2);
  const dateStr = `${mm}/${dd}/${yy}`;

  if (diffDays === 0) return `${dateStr} (Today)`;
  if (diffDays === 1) return `${dateStr} (Yesterday)`;
  return `${dateStr} (${diffDays} days ago)`;
}
