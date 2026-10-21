import type { AuditEntry } from '../types/api';
import { fmtTime, humanize } from '../utils/format';

const detail = (d: AuditEntry['details']): string => {
  if (!d) return ''; const note = (d.note ?? d.notes) as string | undefined; if (note) return note;
  return Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
};
/** Chronological audit trail of an incident (status changes, notes, resolution). */
export function EventTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-slate-500">No investigation activity yet.</p>;
  return (
    <ol className="relative ml-2 border-l border-edge">
      {entries.map((e) => (
        <li key={e.id} className="mb-4 ml-4"><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-electric" aria-hidden />
          <p className="text-xs text-slate-500">{fmtTime(e.createdAt)} · {e.actorLabel}</p><p className="text-sm font-medium text-slate-200">{humanize(e.action.replace(/^EVENT_/, ''))}</p>
          {detail(e.details) && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-400">{detail(e.details)}</p>}
        </li>))}
    </ol>
  );
}
