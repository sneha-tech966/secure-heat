import { useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/States';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import { fmtNum } from '../utils/format';
import { humanize } from '../utils/format';

export default function Simulator() {
  const toast = useToast(); const st = useApi(() => api.simStatus(), [], 2000); const log = useApi(() => api.simLog(60), [], 2000);
  const [scenario, setScenario] = useState('normal'); const [target, setTarget] = useState(''); const [ticks, setTicks] = useState(10); const [rate, setRate] = useState(1); const [busy, setBusy] = useState(false);
  const s = st.data; const attack = scenario !== 'normal';
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success(msg); st.reload(); log.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const down = st.error && !s;

  return (
    <div>
      <PageHeader title="Simulator" subtitle="Five signed weather stations that use the real ingestion API. Inject attacks to watch the defences react."
        actions={s && (<><span className={`rounded px-2 py-1 text-xs ${s.running ? 'bg-ok/15 text-ok' : 'bg-slate-500/15 text-slate-300'}`} role="status">{s.running ? 'Running' : 'Stopped'}</span>
          {s.running ? <button className="btn-danger" disabled={busy} onClick={() => void run(() => api.simStop(), 'Simulation stopped')}>Stop</button> : <button className="btn-primary" disabled={busy} onClick={() => void run(() => api.simStart(), 'Simulation started')}>Start</button>}</>)} />
      {st.loading && !s ? <Skeleton className="h-40 w-full" /> : down ? <div className="card"><ErrorState message={st.error!} onRetry={st.reload} /></div> : s && (<>
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card p-4 lg:col-span-1" aria-label="Scenario controls"><h2 className="mb-3 text-sm font-semibold text-slate-100">Scenario</h2>
            <div className="space-y-3">
              <div><label className="label" htmlFor="sim-sc">Scenario</label><select id="sim-sc" className="input" value={scenario} onChange={(e) => setScenario(e.target.value)}>{Object.keys(s.scenarios).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select><p className="mt-1 text-xs text-slate-500">{s.scenarios[scenario]}</p></div>
              <div><label className="label" htmlFor="sim-tg">Target sensor</label><select id="sim-tg" className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">All sensors</option>{s.sensors.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="label" htmlFor="sim-ticks">Duration (ticks)</label><input id="sim-ticks" type="number" min={0} max={1000} className="input" value={ticks} onChange={(e) => setTicks(Number(e.target.value))} /></div><div><label className="label" htmlFor="sim-rate">Attack rate</label><input id="sim-rate" type="number" min={0.1} max={1} step={0.1} className="input" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div></div>
              <p className="text-xs text-slate-500">0 ticks = until changed. One tick = one reading per sensor every {s.interval}s.</p>
              <button className={attack ? 'btn-danger w-full' : 'btn-primary w-full'} disabled={busy || ticks < 0 || rate <= 0 || rate > 1} onClick={() => void run(() => api.simScenario({ scenario, target: target || undefined, ticks, rate }), attack ? `Injecting ${humanize(scenario)}` : 'Back to normal operation')}>{attack ? 'Inject scenario' : 'Apply normal operation'}</button>
              <div className="rounded border border-edge bg-navy-900 p-2 text-xs text-slate-400">Active: <span className="text-slate-200">{humanize(s.scenario)}</span>{s.target ? ` → ${s.target}` : ''}{s.ticksLeft ? ` · ${s.ticksLeft} ticks left` : ''}</div>
            </div></section>
          <section className="card p-4 lg:col-span-2" aria-label="Outcome counters"><h2 className="mb-3 text-sm font-semibold text-slate-100">Outcomes so far</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['ACCEPT', 'ok'], ['FLAG', 'warn'], ['QUARANTINE', 'crit'], ['REJECT', 'crit']].map(([k, tone]) => (<div key={k} className="rounded-md border border-edge bg-navy-900/60 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">{humanize(k!)}</p><p className={`text-2xl font-semibold tabular-nums ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-crit'}`}>{s.stats[k!] ?? 0}</p></div>))}</div>
            <p className="mt-3 text-xs text-slate-500">HTTP responses: {Object.entries(s.stats).filter(([k]) => k.startsWith('http_')).map(([k, v]) => `${k.slice(5)}×${v}`).join(' · ') || 'none yet'}</p></section>
        </div>
        <section className="card mt-4 overflow-hidden" aria-label="Live telemetry"><h2 className="border-b border-edge px-4 py-3 text-sm font-semibold text-slate-100">Generated telemetry (live)</h2>
          {!log.data || log.data.entries.length === 0 ? <EmptyState title="No telemetry sent yet" hint="Press Start to begin sending signed readings." /> : (
            <div className="max-h-[420px] overflow-auto"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-navy-700 uppercase tracking-wide text-slate-400"><tr>{['Time', 'Sensor', 'Seq', 'Scenario', 'Temp', 'Hum', 'Wind', 'HTTP', 'Decision'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-edge/60 font-mono">{[...log.data.entries].reverse().map((e, i) => (<tr key={`${e.time}-${e.sensorId}-${i}`}><td className="px-3 py-1.5 text-slate-400">{e.time.slice(11, 19)}</td><td className="px-3 py-1.5 text-cyan-soft">{e.sensorId}</td><td className="px-3 py-1.5 text-slate-500">{e.sequence}</td><td className={`px-3 py-1.5 ${e.scenario === 'normal' ? 'text-slate-400' : 'text-warn'}`}>{e.scenario}</td>
                <td className="px-3 py-1.5">{fmtNum(e.reading.temperature)}</td><td className="px-3 py-1.5">{fmtNum(e.reading.humidity)}</td><td className="px-3 py-1.5">{fmtNum(e.reading.windSpeed)}</td><td className={`px-3 py-1.5 ${e.http && e.http < 300 ? 'text-ok' : 'text-crit'}`}>{e.http ?? '—'}</td><td className="px-3 py-1.5">{e.decision ? <StatusBadge status={e.decision} /> : <span className="text-slate-500">{e.code ?? e.status ?? '—'}</span>}</td></tr>))}</tbody></table></div>)}
        </section></>)}
    </div>
  );
}
