import { useState } from 'react';
import { Badge, StatusBadge } from '../components/Badges';
import { ConfirmModal } from '../components/Modal';
import { Pagination } from '../components/DataTable';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/States';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import type { QuarantineRow } from '../types/api';
import { fmtNum, fmtScore, fmtTime } from '../utils/format';

const TABS = [['pending', 'Pending review'], ['approved', 'Approved'], ['rejected', 'Rejected']] as const;
type Tab = (typeof TABS)[number][0];
const PAGE_SIZE = 10;

export default function Quarantine() {
  const toast = useToast(); const [tab, setTab] = useState<Tab>('pending'); const [page, setPage] = useState(1);
  const [act, setAct] = useState<{ row: QuarantineRow; kind: 'approve' | 'reject' } | null>(null); const [busy, setBusy] = useState(false);
  const q = useApi(() => api.quarantine({ state: tab, page, pageSize: PAGE_SIZE }), [tab, page], 10_000);
  const confirm = async (notes: string) => {
    if (!act) return; setBusy(true);
    try { await (act.kind === 'approve' ? api.approve(act.row.id, notes) : api.rejectRecord(act.row.id, notes)); toast.success(act.kind === 'approve' ? 'Approved and forwarded to forecasting' : 'Rejected permanently'); setAct(null); q.reload(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title="Quarantine" subtitle="Suspicious readings held back from forecasting. Nothing is released without an explicit, logged decision." />
      <div className="mb-3 flex gap-1 border-b border-edge" role="tablist">{TABS.map(([k, label]) => (<button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-electric text-cyan-soft' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}{tab === k && q.data ? ` (${q.data.total})` : ''}</button>))}</div>
      {q.loading && !q.data ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
        : q.error && !q.data ? <div className="card"><ErrorState message={q.error} onRetry={q.reload} /></div>
        : q.data && q.data.items.length === 0 ? <div className="card"><EmptyState title={tab === 'pending' ? 'Nothing awaiting review' : `No ${tab} records`} hint={tab === 'pending' ? 'Quarantined and flagged readings appear here for analyst review.' : undefined} /></div>
        : (<div className="space-y-3">{q.data?.items.map((r) => { const hard = r.rulesTriggered.some((x) => x.hard); return (
          <article key={r.id} className="card p-4" data-testid="quarantine-row">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm"><span className="font-mono font-semibold text-cyan-soft">{r.sensorId}</span> <span className="text-slate-500">· {fmtTime(r.timestamp)}</span></p>
                <p className="mt-1 text-sm text-slate-300">T {fmtNum(r.temperature)}°C · H {fmtNum(r.humidity)}% · P {fmtNum(r.pressure, 1)} hPa · Wind {fmtNum(r.windSpeed)} m/s · Solar {fmtNum(r.solarRadiation, 0)} W/m²</p></div>
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.decision} /><Badge tone="muted">Score {fmtScore(r.anomalyScore)}</Badge></div>
            </div>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Quarantine reason</dt><dd className="text-slate-200">{r.quarantineReason}</dd></div>
              <div><dt className="text-xs text-slate-500">Triggered rules</dt><dd>{r.rulesTriggered.length ? <ul className="space-y-1">{r.rulesTriggered.map((x) => <li key={x.rule}><Badge tone={x.hard ? 'crit' : 'warn'}>{x.hard ? 'Hard' : 'Soft'}</Badge> <span className="font-mono text-xs text-slate-300">{x.rule}</span></li>)}</ul> : <span className="text-slate-500">None</span>}</dd></div>
              <div><dt className="text-xs text-slate-500">ML explanation</dt><dd className="text-slate-300">{r.explanation ?? 'ML was not consulted for this reading.'}</dd></div>
            </dl>
            {tab === 'pending' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge pt-3">
                <button className="btn-primary" disabled={hard} title={hard ? 'Physically impossible readings can only be rejected' : undefined} onClick={() => setAct({ row: r, kind: 'approve' })}>Approve for forwarding</button>
                <button className="btn-danger" onClick={() => setAct({ row: r, kind: 'reject' })}>Reject permanently</button>
                {hard && <span className="text-xs text-slate-500">Impossible value: approval is disabled.</span>}
              </div>) : r.reviewedAt && <p className="mt-3 border-t border-edge pt-3 text-xs text-slate-400">Reviewed {fmtTime(r.reviewedAt)}{r.reviewedBy ? ` by ${r.reviewedBy.name}` : ''}{r.reviewNotes ? ` — “${r.reviewNotes}”` : ''}</p>}
          </article>); })}</div>)}
      {q.data && q.data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
      {act && <ConfirmModal title={act.kind === 'approve' ? 'Approve for forwarding?' : 'Reject permanently?'} danger={act.kind === 'reject'} busy={busy} reasonLabel="Reason (required, recorded in the audit log)" confirmLabel={act.kind === 'approve' ? 'Approve & forward' : 'Reject'} onClose={() => setAct(null)} onConfirm={(n) => void confirm(n)}
        message={act.kind === 'approve' ? `This releases the ${act.row.sensorId} reading to the forecasting system as trusted data. Only do this if you have verified it (e.g. against neighbouring sensors).` : 'The reading is permanently excluded from forecasting. This cannot be undone.'} />}
    </div>
  );
}
