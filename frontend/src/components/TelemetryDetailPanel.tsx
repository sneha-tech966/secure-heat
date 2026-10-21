import type { TelemetryDetail } from '../types/api';
import { fmtNum, fmtScore, fmtTime } from '../utils/format';
import { Badge, SeverityBadge, StatusBadge } from './Badges';

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (<div className="flex justify-between gap-4 border-b border-edge/50 py-1.5 text-sm last:border-0"><dt className="text-slate-400">{k}</dt><dd className="text-right text-slate-200">{v}</dd></div>);
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (<section className="rounded-md border border-edge bg-navy-900/60 p-3"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-soft">{title}</h3>{children}</section>);

/** Full pipeline view of one reading: payload → authentication → rules → ML → explanation → final decision. */
export function TelemetryDetailPanel({ detail }: { detail: TelemetryDetail }) {
  const t = detail.telemetry; const p = detail.pipeline;
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="telemetry-detail">
      <Section title="Payload"><dl>
        <Row k="Sensor" v={<span className="font-mono">{t.sensor.sensorId} · {t.sensor.name}</span>} /><Row k="Reading time" v={fmtTime(t.timestamp)} /><Row k="Sequence" v={t.sequenceNumber} />
        <Row k="Temperature" v={`${fmtNum(t.temperature)} °C`} /><Row k="Humidity" v={`${fmtNum(t.humidity)} %`} /><Row k="Pressure" v={`${fmtNum(t.pressure, 2)} hPa`} />
        <Row k="Wind" v={`${fmtNum(t.windSpeed)} m/s @ ${fmtNum(t.windDirection, 0)}°`} /><Row k="Rainfall" v={`${fmtNum(t.rainfall, 2)} mm`} /><Row k="Solar radiation" v={`${fmtNum(t.solarRadiation, 0)} W/m²`} /></dl></Section>
      <div className="space-y-3">
        <Section title="Authentication"><dl><Row k="API key" v={p.authentication.apiKeyVerified ? <Badge tone="ok">Verified</Badge> : <Badge tone="crit">Failed</Badge>} />
          <Row k="HMAC signature" v={p.authentication.signatureValid ? <Badge tone="ok">Valid</Badge> : <Badge tone="crit">Invalid</Badge>} /></dl></Section>
        <Section title="Rule-based checks">{p.rules.length === 0 ? <p className="text-sm text-slate-400">No rules triggered.</p> : <ul className="space-y-1.5">{p.rules.map((r) => (<li key={r.rule} className="text-sm"><Badge tone={r.hard ? 'crit' : 'warn'}>{r.hard ? 'Hard' : 'Soft'}</Badge> <span className="font-mono text-xs text-slate-300">{r.rule}</span><p className="text-xs text-slate-400">{r.message}</p></li>))}</ul>}</Section>
      </div>
      <Section title="ML prediction"><dl><Row k="Anomaly score" v={<span className="font-mono">{fmtScore(p.ml.anomalyScore)}</span>} /><Row k="Prediction" v={<StatusBadge status={p.ml.anomalyStatus} />} /></dl>
        <p className="mt-2 text-xs text-slate-500">Score = percentile among clean calibration readings (not a probability).</p></Section>
      <Section title="Explanation & decision"><p className="text-sm text-slate-300">{p.ml.explanation ?? 'No ML explanation (ML was not consulted for this reading).'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-slate-400">Final decision</span><StatusBadge status={p.decision} /><StatusBadge status={p.processingStatus} /></div>
        {p.review && <p className="mt-2 text-xs text-slate-400">Reviewed {fmtTime(p.review.at)}{p.review.by ? ` by ${p.review.by.name}` : ''}{p.review.notes ? `: “${p.review.notes}”` : ''}</p>}</Section>
      {t.events.length > 0 && <div className="md:col-span-2"><Section title="Related security events"><ul className="space-y-1.5">{t.events.map((e) => (<li key={e.id} className="flex items-center gap-2 text-sm"><SeverityBadge severity={e.severity} /><span className="text-slate-300">{e.description}</span></li>))}</ul></Section></div>}
    </div>
  );
}
