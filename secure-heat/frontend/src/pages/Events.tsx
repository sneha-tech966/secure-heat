import { useState } from 'react';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { DataTable, Pagination, type Column, type Sort } from '../components/DataTable';
import { EventTimeline } from '../components/EventTimeline';
import { ConfirmModal, Modal } from '../components/Modal';
import { ErrorState, PageHeader, Skeleton } from '../components/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import { EVENT_TYPES, type SecurityEvent } from '../types/api';
import { fmtNum, fmtScore, fmtTime, humanize, toIso } from '../utils/format';
import { can } from '../utils/permissions';

const PAGE_SIZE = 20;
const EMPTY = { severity: '', eventType: '', sensorId: '', status: '', from: '', to: '' };

function EventModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth(); const toast = useToast(); const d = useApi(() => api.event(id), [id]);
  const [mode, setMode] = useState<null | 'resolve' | 'note'>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const done = (msg: string) => { toast.success(msg); setMode(null); setNote(''); d.reload(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); done(msg); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const e = d.data?.event;
  return (
    <Modal title="Security event" wide onClose={onClose}>
      {d.loading && !e ? <Skeleton className="h-48 w-full" /> : d.error && !e ? <ErrorState message={d.error} onRetry={d.reload} /> : e ? (<div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={e.severity} /><StatusBadge status={e.status} /><span className="text-sm font-medium text-slate-100">{humanize(e.eventType)}</span><span className="font-mono text-xs text-slate-500">#{e.id.slice(-8)}</span></div>
        <p className="text-sm text-slate-300">{e.description}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Sensor', e.sensor?.sensorId ?? e.sensorId ?? (e.claimedSensorId ? `${e.claimedSensorId} (unregistered)` : '—')], ['Detected', fmtTime(e.detectedAt)], ['Source IP', e.sourceIP ?? '—'], ['Investigator', e.investigatedBy?.name ?? '—']].map(([k, v]) => (<div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="break-all text-slate-200">{v}</dd></div>))}</dl>
        {e.telemetry && <div className="rounded-md border border-edge bg-navy-900/60 p-3 text-sm"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-soft">Related telemetry</h3>
          <p className="text-slate-300">{fmtTime(e.telemetry.timestamp)} · T {fmtNum(e.telemetry.temperature)}°C · H {fmtNum(e.telemetry.humidity)}% · P {fmtNum(e.telemetry.pressure, 1)} hPa · W {fmtNum(e.telemetry.windSpeed)} m/s · score {fmtScore(e.telemetry.anomalyScore)} <StatusBadge status={e.telemetry.decision} /></p>{e.telemetry.explanation && <p className="mt-1 text-xs text-slate-400">{e.telemetry.explanation}</p>}</div>}
        {e.resolutionNotes && <div className="rounded-md border border-ok/30 bg-ok/10 p-3 text-sm text-slate-200"><span className="text-xs font-semibold uppercase text-ok">Resolution</span><p className="mt-1">{e.resolutionNotes}</p></div>}
        <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-soft">Investigation timeline</h3><EventTimeline entries={d.data?.auditTrail ?? []} /></div>
        {(can.investigate(user?.role) || can.resolve(user?.role)) && e.status !== 'RESOLVED' && (
          <div className="flex flex-wrap gap-2 border-t border-edge pt-3">
            {can.investigate(user?.role) && e.status === 'OPEN' && <button className="btn-primary" disabled={busy} onClick={() => void run(() => api.investigate(e.id), 'Marked as investigating')}>Start investigating</button>}
            {can.investigate(user?.role) && <button className="btn-ghost" onClick={() => setMode('note')}>Add note</button>}
            {can.resolve(user?.role) && <button className="btn-ghost text-ok" onClick={() => setMode('resolve')}>Resolve…</button>}
          </div>)}
        {mode === 'note' && <div><label className="label" htmlFor="ev-note">Investigation note</label><textarea id="ev-note" className="input min-h-[70px]" value={note} onChange={(x) => setNote(x.target.value)} maxLength={2000} /><div className="mt-2 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setMode(null)}>Cancel</button><button className="btn-primary" disabled={!note.trim() || busy} onClick={() => void run(() => api.addNote(e.id, note.trim()), 'Note added')}>Save note</button></div></div>}
        {mode === 'resolve' && <ConfirmModal title="Resolve incident" busy={busy} reasonLabel="Resolution notes (required)" confirmLabel="Resolve" message="Resolved incidents are closed and cannot be reopened." onClose={() => setMode(null)} onConfirm={(r) => void run(() => api.resolve(e.id, r), 'Incident resolved')} />}
      </div>) : null}
    </Modal>
  );
}

export default function Events() {
  const [f, setF] = useState(EMPTY); const [sort, setSort] = useState<Sort>({ key: 'detectedAt', order: 'desc' }); const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(null);
  const sensors = useApi(() => api.sensors(), []);
  const params = { page, pageSize: PAGE_SIZE, sortBy: sort.key, order: sort.order, ...f, from: toIso(f.from), to: toIso(f.to) };
  const ev = useApi(() => api.events(params), [JSON.stringify(params)], 10_000);
  const set = (k: keyof typeof EMPTY, v: string) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };
  const cols: Column<SecurityEvent>[] = [
    { key: 'id', header: 'ID', render: (r) => <span className="font-mono text-xs text-slate-500">{r.id.slice(-8)}</span> },
    { key: 'sev', header: 'Severity', sortKey: 'severity', render: (r) => <SeverityBadge severity={r.severity} /> },
    { key: 'type', header: 'Type', sortKey: 'eventType', render: (r) => humanize(r.eventType) },
    { key: 'sensor', header: 'Sensor', render: (r) => <span className="font-mono text-cyan-soft">{r.sensorId ?? r.claimedSensorId ?? '—'}</span> },
    { key: 'desc', header: 'Description', className: 'max-w-md truncate text-slate-400', render: (r) => <span title={r.description}>{r.description}</span> },
    { key: 'at', header: 'Detected', sortKey: 'detectedAt', render: (r) => fmtTime(r.detectedAt) },
    { key: 'st', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge status={r.status} /> },
  ];
  const sel = (k: keyof typeof EMPTY, label: string, opts: string[], fmt: (s: string) => string = humanize) => (<div><label className="label" htmlFor={`e-${k}`}>{label}</label><select id={`e-${k}`} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)}><option value="">All</option>{opts.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}</select></div>);
  return (
    <div>
      <PageHeader title="Security Events" subtitle="Incidents raised by authentication, replay, rule and ML checks" />
      <form className="card mb-3 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
        {sel('severity', 'Severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])}{sel('eventType', 'Event type', [...EVENT_TYPES])}{sel('sensorId', 'Sensor', sensors.data?.sensors.map((s) => s.sensorId) ?? [], (s) => s)}{sel('status', 'Status', ['OPEN', 'INVESTIGATING', 'RESOLVED'])}
        <div><label className="label" htmlFor="e-from">From</label><input id="e-from" type="datetime-local" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} /></div>
        <div><label className="label" htmlFor="e-to">To</label><input id="e-to" type="datetime-local" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
      </form>
      <DataTable columns={cols} rows={ev.data?.items ?? []} rowKey={(r) => r.id} sort={sort} onSort={(key) => { setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' })); setPage(1); }} loading={ev.loading} error={ev.data ? null : ev.error} onRetry={ev.reload} onRowClick={(r) => setOpen(r.id)} emptyTitle="No security events match" emptyHint="Events are created when authentication, replay, validation or anomaly checks trigger." />
      {ev.data && <Pagination page={page} pageSize={PAGE_SIZE} total={ev.data.total} onPage={setPage} />}
      {open && <EventModal id={open} onClose={() => setOpen(null)} onChanged={ev.reload} />}
    </div>
  );
}
