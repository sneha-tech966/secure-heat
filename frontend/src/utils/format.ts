export const fmtTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—');
export const fmtHour = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
}
export const fmtNum = (n: number | null | undefined, d = 1): string => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toLocaleString());
export const fmtScore = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : n.toFixed(4));
export const pct = (n: number | null | undefined, d = 1): string => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(d)}%`);
export const humanize = (s: string): string => s.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export const toIso = (local: string): string => (local ? new Date(local).toISOString() : '');
