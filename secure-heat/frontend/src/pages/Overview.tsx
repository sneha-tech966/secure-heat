import { AlertTriangle, Ban, Database, Radio, ShieldCheck, Wifi } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { ChartCard } from '../components/ChartCard';
import { MetricCard } from '../components/MetricCard';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/States';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import { axisProps, C, SEVERITY_COLOR, tooltipStyle } from '../utils/chart';
import { fmtHour, fmtInt, fmtTime, humanize, timeAgo } from '../utils/format';
import { buildTrendRows } from '../utils/trends';

const RANGES = [6, 24, 72, 168];

export default function Overview() {
  const [hours, setHours] = useState(24);
  const ov = useApi(() => api.overview(hours), [hours], 30_000);
  const tr = useApi(() => api.trends(hours), [hours], 60_000);
  const o = ov.data; const k = o?.kpis;
  const totals = useMemo(() => (o ? o.telemetryVolume.reduce((a, v) => ({ normal: a.normal + v.normal, anomalous: a.anomalous + v.anomalous }), { normal: 0, anomalous: 0 }) : null), [o]);
  const scoreBins = useMemo(() => (o ? o.scoreDistribution.normal.map((b, i) => ({ label: b.from.toFixed(1), normal: b.count, anomalous: o.scoreDistribution.anomalous[i]?.count ?? 0 })) : []), [o]);
  const trendFor = (key: 'temperature' | 'humidity' | 'pressure') => tr.data ? buildTrendRows(tr.data.trusted.map((p) => ({ t: p.t, v: p[key] })), tr.data.forecast[key].points, key === 'temperature' ? tr.data.naiveAllReadings.map((p) => ({ t: p.t, v: p.temperature })) : []) : [];
  const loading = ov.loading && !o;

  return (
    <div>
      <PageHeader title="Overview" subtitle="Security posture of the IoT weather-station pipeline"
        actions={<div className="flex gap-1 rounded-md border border-edge bg-navy-800 p-1" role="group" aria-label="Time range">{RANGES.map((h) => (<button key={h} onClick={() => setHours(h)} aria-pressed={hours === h} className={`rounded px-2.5 py-1 text-xs ${hours === h ? 'bg-electric text-white' : 'text-slate-400 hover:text-slate-100'}`}>{h < 24 ? `${h}h` : `${h / 24}d`}</button>))}</div>} />
      {ov.error && !o ? <div className="card"><ErrorState message={ov.error} onRetry={ov.reload} /></div> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Total sensors" value={fmtInt(k?.totalSensors)} icon={<Radio className="h-4 w-4" />} loading={loading} />
          <MetricCard label="Active sensors" value={fmtInt(k?.activeSensors)} tone="ok" icon={<Wifi className="h-4 w-4" />} loading={loading} hint={k ? `${k.totalSensors - k.activeSensors} not active` : undefined} />
          <MetricCard label="Telemetry received" value={fmtInt(k?.totalTelemetry)} icon={<Database className="h-4 w-4" />} loading={loading} hint="stored after authentication" />
          <MetricCard label="Trusted readings" value={fmtInt(k?.trustedReadings)} tone="ok" icon={<ShieldCheck className="h-4 w-4" />} loading={loading} hint="forwarded to forecasting" />
          <MetricCard label="Anomalies detected" value={fmtInt(k?.anomaliesDetected)} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} loading={loading} hint="flagged or quarantined" />
          <MetricCard label="Blocked requests" value={fmtInt(k?.blockedRequests)} tone="crit" icon={<Ban className="h-4 w-4" />} loading={loading} hint="auth, signature, replay" />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <ChartCard className="xl:col-span-2" title="Telemetry volume" subtitle="Readings per hour" loading={loading} error={o ? null : ov.error} empty={!!o && o.telemetryVolume.length === 0} onRetry={ov.reload}>
            <ResponsiveContainer width="100%" height={240}><AreaChart data={o?.telemetryVolume.map((v) => ({ ...v, label: fmtHour(v.t) }))}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="label" {...axisProps} /><YAxis {...axisProps} allowDecimals={false} /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="normal" name="Normal" stackId="v" stroke={C.ok} fill={C.ok} fillOpacity={0.25} /><Area type="monotone" dataKey="anomalous" name="Anomalous" stackId="v" stroke={C.crit} fill={C.crit} fillOpacity={0.35} /></AreaChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Normal vs anomalous" subtitle="Share of readings in range" loading={loading} empty={!totals || totals.normal + totals.anomalous === 0}>
            <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={[{ name: 'Normal', value: totals?.normal ?? 0 }, { name: 'Anomalous', value: totals?.anomalous ?? 0 }]} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
              <Cell fill={C.ok} /><Cell fill={C.crit} /></Pie><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Incidents by severity" subtitle="Security events in range" loading={loading} empty={!!o && o.incidentsBySeverity.every((s) => s.count === 0)} emptyHint="No security events in this period.">
            <ResponsiveContainer width="100%" height={240}><BarChart data={o?.incidentsBySeverity.map((s) => ({ ...s, label: humanize(s.severity) }))}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="label" {...axisProps} /><YAxis {...axisProps} allowDecimals={false} /><Tooltip {...tooltipStyle} />
              <Bar dataKey="count" name="Events" radius={[3, 3, 0, 0]}>{o?.incidentsBySeverity.map((s) => <Cell key={s.severity} fill={SEVERITY_COLOR[s.severity]} />)}</Bar></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Sensor activity" subtitle="Readings vs anomalies per sensor" loading={loading} empty={!!o && o.sensorActivity.every((s) => s.readings === 0)}>
            <ResponsiveContainer width="100%" height={240}><BarChart data={o?.sensorActivity}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="sensorId" {...axisProps} /><YAxis {...axisProps} allowDecimals={false} /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="readings" name="Readings" fill={C.electric} radius={[3, 3, 0, 0]} /><Bar dataKey="anomalous" name="Anomalous" fill={C.warn} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Anomaly score distribution" subtitle="Percentile score of readings (higher = more unusual)" loading={loading} empty={!!o && o.scoreDistribution.sampled === 0}>
            <ResponsiveContainer width="100%" height={240}><BarChart data={scoreBins}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="label" {...axisProps} /><YAxis {...axisProps} allowDecimals={false} /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="normal" name="Accepted" stackId="s" fill={C.ok} /><Bar dataKey="anomalous" name="Held / rejected" stackId="s" fill={C.crit} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <section className="card p-4 xl:col-span-1" aria-label="Live security feed"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-100">Live security feed</h2><Link to="/events" className="text-xs text-cyan-soft hover:underline">View all</Link></div>
            {loading ? <Skeleton className="h-40 w-full" /> : !o || o.recentEvents.length === 0 ? <EmptyState title="No security events yet" hint="Events appear here when authentication, replay or anomaly checks trigger." /> : (
              <ul className="divide-y divide-edge/70">{o.recentEvents.map((e) => (<li key={e.id} className="flex items-start gap-2 py-2"><SeverityBadge severity={e.severity} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-200">{humanize(e.eventType)}</p><p className="truncate text-xs text-slate-500"><span className="font-mono">{e.sensorId ?? e.claimedSensorId ?? 'unknown'}</span> · {fmtTime(e.detectedAt)}</p></div><StatusBadge status={e.status} /></li>))}</ul>)}
          </section>
          <section className="card overflow-hidden xl:col-span-2" aria-label="Sensor health"><h2 className="border-b border-edge px-4 py-3 text-sm font-semibold text-slate-100">Sensor health</h2>
            {loading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : !o || o.sensorHealth.length === 0 ? <EmptyState title="No sensors registered" hint="Register a sensor on the Sensors page." /> : (
              <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-navy-700/60 text-xs uppercase tracking-wide text-slate-400"><tr>{['Sensor', 'Location', 'Last activity', 'Status', 'Anomalies'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-edge/70">{o.sensorHealth.map((s) => (<tr key={s.sensorId}><td className="px-3 py-2"><span className="font-mono text-cyan-soft">{s.sensorId}</span> <span className="text-slate-300">{s.name}</span></td><td className="px-3 py-2 text-slate-400">{s.location}</td><td className="px-3 py-2 text-slate-300">{timeAgo(s.lastSeen)}</td><td className="px-3 py-2"><StatusBadge status={s.status} /></td><td className={`px-3 py-2 tabular-nums ${s.anomalies ? 'text-warn' : 'text-slate-300'}`}>{fmtInt(s.anomalies)}</td></tr>))}</tbody></table></div>)}
          </section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <ChartCard className="xl:col-span-2" title="Trusted temperature trend & forecast" subtitle="Hourly mean of FORWARDED readings, with a baseline forecast. The dashed line shows what an unprotected pipeline would have averaged." loading={tr.loading && !tr.data} error={tr.data ? null : tr.error} empty={!!tr.data && tr.data.trusted.length === 0} onRetry={tr.reload}>
            <ResponsiveContainer width="100%" height={260}><ComposedChart data={trendFor('temperature')}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(t) => fmtHour(new Date(t).toISOString())} {...axisProps} /><YAxis {...axisProps} domain={['auto', 'auto']} unit="°" /><Tooltip {...tooltipStyle} labelFormatter={(t) => fmtTime(new Date(Number(t)).toISOString())} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name="Forecast range" stroke="none" fill={C.cyan} fillOpacity={0.15} /><Line dataKey="naive" name="Unprotected (all readings)" stroke={C.crit} strokeDasharray="5 4" dot={false} strokeWidth={1.5} />
              <Line dataKey="trusted" name="Trusted" stroke={C.ok} dot={false} strokeWidth={2} /><Line dataKey="forecast" name="Forecast" stroke={C.cyan} strokeDasharray="2 3" dot={false} strokeWidth={2} /></ComposedChart></ResponsiveContainer>
          </ChartCard>
          <div className="grid gap-4">
            {(['humidity', 'pressure'] as const).map((key) => (
              <ChartCard key={key} title={`Trusted ${key}`} loading={tr.loading && !tr.data} error={tr.data ? null : tr.error} empty={!!tr.data && tr.data.trusted.length === 0} height={110}>
                <ResponsiveContainer width="100%" height={120}><LineChart data={trendFor(key)}><XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" hide /><YAxis {...axisProps} domain={['auto', 'auto']} width={40} /><Tooltip {...tooltipStyle} labelFormatter={(t) => fmtTime(new Date(Number(t)).toISOString())} />
                  <Line dataKey="trusted" name="Trusted" stroke={C.ok} dot={false} strokeWidth={2} /><Line dataKey="forecast" name="Forecast" stroke={C.cyan} strokeDasharray="2 3" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer>
              </ChartCard>))}
            {tr.data && <p className="card p-3 text-xs text-slate-400">Excluded from forecasting in this window: <span className="text-warn">{tr.data.excluded.QUARANTINED ?? 0} quarantined</span> · <span className="text-crit">{tr.data.excluded.REJECTED ?? 0} rejected</span>. {tr.data.note}</p>}
          </div>
        </div>
      </>)}
    </div>
  );
}
