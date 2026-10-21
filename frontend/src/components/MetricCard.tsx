import type { ReactNode } from 'react';
import type { Tone } from './Badges';

const ACCENT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', info: 'text-cyan-soft', muted: 'text-slate-300', purple: 'text-violet-300' };

export function MetricCard({ label, value, hint, icon, tone = 'info', loading }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: Tone; loading?: boolean }) {
  return (
    <div className="card p-4" data-testid="metric-card">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        {icon && <span className={`${ACCENT[tone]} opacity-80`} aria-hidden>{icon}</span>}
      </div>
      {loading ? <div className="mt-2 h-8 w-24 animate-pulse rounded bg-navy-600" aria-label="loading" /> : <p className={`mt-2 text-2xl font-semibold tabular-nums ${ACCENT[tone]}`}>{value}</p>}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
