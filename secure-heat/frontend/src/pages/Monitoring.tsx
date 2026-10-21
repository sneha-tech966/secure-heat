import { useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { DataTable, Pagination, type Column, type Sort } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { ErrorState, PageHeader, Skeleton } from '../components/States';
import { TelemetryDetailPanel } from '../components/TelemetryDetailPanel';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { api } from '../services/api';
import type { TelemetryRow } from '../types/api';
import { fmtNum, fmtScore, fmtTime, toIso } from '../utils/format';

const PAGE_SIZE = 25;
interface Filters { sensorId: string; q: string; decision: string; processingStatus: string; from: string; to: string }
const EMPTY: Filters = { sensorId: '', q: '', decision: '', processingStatus: '', from: '', to: '' };

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useApi(() => api.telemetryDetail(id), [id]);
  return (<Modal title="Telemetry record" wide onClose={onClose}>{d.loading && !d.data ? <Skeleton className="h-64 w-full" /> : d.error ? <ErrorState message={d.error} onRetry={d.reload} /> : d.data ? <TelemetryDetailPanel detail={d.data} /> : null}</Modal>);
}

export default function Monitoring() {
  const [f, setF] = useState<Filters>(EMPTY); const [sort, setSort] = useState<Sort>({ key: 'timestamp', order: 'desc' }); const [page, setPage] = useState(1);
  const [auto, setAuto] = useState(true); const [open, setOpen] = useState<string | null>(null);
  const q = useDebounce(f.q, 350); const sensors = useApi(() => api.sensors(), []);
  const params = { page, pageSize: PAGE_SIZE, sortBy: sort.key, order: sort.order, sensorId: f.sensorId, q, decision: f.decision, processingStatus: f.processingStatus, from: toIso(f.from), to: toIso(f.to) };
  const t = useApi(() => api.telemetry(params), [JSON.stringify(params)], auto ? 5000 : 0);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };
  const onSort = (key: string) => { setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' })); setPage(1); };

  const cols: Column<TelemetryRow>[] = [
    { key: 'ts', header: 'Timestamp', sortKey: 'timestamp', render: (r) => <span className="text-slate-300">{fmtTime(r.timestamp)}</span> },
    { key: 'sensor', header: 'Sensor ID', sortKey: 'sensorId', render: (r) => <span className="font-mono text-cyan-soft">{r.sensorId}</span> },
    { key: 'temp', header: 'Temp °C', sortKey: 'temperature', className: 'tabular-nums', render: (r) => fmtNum(r.temperature) },
    { key: 'hum', header: 'Humidity %', sortKey: 'humidity', className: 'tabular-nums', render: (r) => fmtNum(r.humidity) },
    { key: 'pres', header: 'Pressure hPa', sortKey: 'pressure', className: 'tabular-nums', render: (r) => fmtNum(r.pressure, 2) },
    { key: 'wind', header: 'Wind m/s', sortKey: 'windSpeed', className: 'tabular-nums', render: (r) => fmtNum(r.windSpeed) },
    { key: 'score', header: 'Anomaly score', sortKey: 'anomalyScore', className: 'font-mono tabular-nums', render: (r) => fmtScore(r.anomalyScore) },
    { key: 'dec', header: 'Security decision', sortKey: 'decision', render: (r) => <span className="flex gap-1"><StatusBadge status={r.decision} /><StatusBadge status={r.processingStatus} /></span> },
  ];
  const active = Object.values(f).some(Boolean);

  return (
    <div>
      <PageHeader title="Live Monitoring" subtitle="Incoming telemetry and the security decision for each reading"
        actions={<label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 accent-electric" />Auto-refresh (5s)</label>} />
      <form className="card mb-3 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
        <div><label className="label" htmlFor="f-search">Search sensor</label><input id="f-search" className="input" placeholder="e.g. WS-00" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-sensor">Sensor</label><select id="f-sensor" className="input" value={f.sensorId} onChange={(e) => set('sensorId', e.target.value)}><option value="">All sensors</option>{sensors.data?.sensors.map((s) => <option key={s.sensorId} value={s.sensorId}>{s.sensorId}</option>)}</select></div>
        <div><label className="label" htmlFor="f-dec">Decision</label><select id="f-dec" className="input" value={f.decision} onChange={(e) => set('decision', e.target.value)}><option value="">All</option>{['ACCEPT', 'FLAG', 'QUARANTINE', 'REJECT'].map((d) => <option key={d}>{d}</option>)}</select></div>
        <div><label className="label" htmlFor="f-status">Status</label><select id="f-status" className="input" value={f.processingStatus} onChange={(e) => set('processingStatus', e.target.value)}><option value="">All</option>{['FORWARDED', 'AUTHENTICATED', 'QUARANTINED', 'REJECTED'].map((d) => <option key={d}>{d}</option>)}</select></div>
        <div><label className="label" htmlFor="f-from">From</label><input id="f-from" type="datetime-local" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-to">To</label><input id="f-to" type="datetime-local" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
        {active && <div className="sm:col-span-2 lg:col-span-6"><button type="button" className="btn-ghost" onClick={() => { setF(EMPTY); setPage(1); }}>Clear filters</button></div>}
      </form>
      <DataTable columns={cols} rows={t.data?.items ?? []} rowKey={(r) => r.id} sort={sort} onSort={onSort} loading={t.loading} error={t.data ? null : t.error} onRetry={t.reload} onRowClick={(r) => setOpen(r.id)}
        emptyTitle={active ? 'No readings match these filters' : 'No telemetry yet'} emptyHint={active ? 'Try clearing a filter or widening the date range.' : 'Start the simulator to generate signed readings.'} />
      {t.data && <Pagination page={page} pageSize={PAGE_SIZE} total={t.data.total} onPage={setPage} />}
      {open && <DetailModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
