export const C = { ok: '#10b981', crit: '#f43f5e', warn: '#f59e0b', electric: '#2e8bff', cyan: '#22d3ee', violet: '#a78bfa', grid: '#22324f', text: '#94a3b8', muted: '#64748b' };
export const SEVERITY_COLOR: Record<string, string> = { LOW: C.electric, MEDIUM: C.warn, HIGH: C.crit, CRITICAL: C.violet };
export const tooltipStyle = { contentStyle: { background: '#0f1a2e', border: '1px solid #22324f', borderRadius: 6, fontSize: 12 }, labelStyle: { color: '#cbd5e1' }, itemStyle: { color: '#e2e8f0' } } as const;
export const axisProps = { stroke: C.muted, tick: { fill: C.text, fontSize: 11 }, tickLine: false } as const;
