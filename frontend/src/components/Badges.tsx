import type { ReactNode } from 'react';
import { humanize } from '../utils/format';

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'muted' | 'purple';
const TONES: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok ring-ok/30', warn: 'bg-warn/15 text-warn ring-warn/30', crit: 'bg-crit/15 text-crit ring-crit/30',
  info: 'bg-electric/15 text-cyan-soft ring-electric/30', muted: 'bg-slate-500/15 text-slate-300 ring-slate-500/30', purple: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
};
export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

/** Single mapping for every status vocabulary in the app (decisions, processing, sensor and incident states). */
export const STATUS_TONE: Record<string, Tone> = {
  ACCEPT: 'ok', FORWARDED: 'ok', ACTIVE: 'ok', RESOLVED: 'ok', NORMAL: 'ok',
  FLAG: 'warn', AUTHENTICATED: 'info', INVESTIGATING: 'info', SUSPICIOUS: 'warn', PENDING: 'muted', INACTIVE: 'muted', OPEN: 'warn', UNKNOWN: 'muted',
  QUARANTINE: 'crit', QUARANTINED: 'crit', REJECT: 'crit', REJECTED: 'crit', BLOCKED: 'crit', ANOMALY: 'warn',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'muted'}>{humanize(status)}</Badge>;
}

export const SEVERITY_TONE: Record<string, Tone> = { LOW: 'info', MEDIUM: 'warn', HIGH: 'crit', CRITICAL: 'purple' };
export function SeverityBadge({ severity }: { severity: string }) {
  const critical = severity === 'CRITICAL';
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${critical ? 'bg-crit text-white ring-crit' : TONES[SEVERITY_TONE[severity] ?? 'muted']}`}>{humanize(severity)}</span>;
}
