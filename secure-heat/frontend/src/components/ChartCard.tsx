import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from './States';

/** Wraps every chart with consistent loading / error / empty handling so no chart ever shows fake or blank data. */
export function ChartCard({ title, subtitle, loading, error, empty, emptyHint, onRetry, action, height = 240, children, className = '' }:
  { title: string; subtitle?: string; loading?: boolean; error?: string | null; empty?: boolean; emptyHint?: string; onRetry?: () => void; action?: ReactNode; height?: number; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`} aria-label={title}>
      <header className="mb-3 flex items-start justify-between gap-2"><div><h2 className="text-sm font-semibold text-slate-100">{title}</h2>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>{action}</header>
      <div style={{ minHeight: height }}>
        {loading ? <Skeleton className="h-[220px] w-full" /> : error ? <ErrorState message={error} onRetry={onRetry} /> : empty ? <EmptyState title="No data in this period" hint={emptyHint ?? 'Start the simulator or widen the time range.'} /> : children}
      </div>
    </section>
  );
}
