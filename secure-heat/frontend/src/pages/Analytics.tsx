import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '../components/ChartCard';
import { ConfirmModal } from '../components/Modal';
import { MetricCard } from '../components/MetricCard';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import type { Confusion } from '../types/api';
import { axisProps, C, tooltipStyle } from '../utils/chart';
import { fmtInt, fmtTime, humanize, pct } from '../utils/format';
import { can } from '../utils/permissions';

function ConfusionMatrix({ c }: { c: Confusion }) {
  const cell = (label: string, v: number, good: boolean) => (<div className={`rounded-md border p-3 text-center ${good ? 'border-ok/30 bg-ok/10' : 'border-crit/30 bg-crit/10'}`}><p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p><p className={`text-xl font-semibold tabular-nums ${good ? 'text-ok' : 'text-crit'}`}>{fmtInt(v)}</p></div>);
  return (<div role="table" aria-label="Confusion matrix"><div className="mb-1 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-center text-[11px] text-slate-500"><span /><span>Predicted normal</span><span>Predicted anomaly</span></div>
    <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2"><span className="text-[11px] text-slate-500 [writing-mode:vertical-rl] rotate-180">Actually normal</span>{cell('True negative', c.tn, true)}{cell('False positive', c.fp, false)}<span className="text-[11px] text-slate-500 [writing-mode:vertical-rl] rotate-180">Actually anomalous</span>{cell('False negative', c.fn, false)}{cell('True positive', c.tp, true)}</div></div>);
}

export default function Analytics() {
  const { user } = useAuth(); const toast = useToast(); const a = useApi(() => api.model(), []);
  const [op, setOp] = useState<'flag' | 'quarantine'>('flag'); const [confirm, setConfirm] = useState<null | 'train'>(null); const [busy, setBusy] = useState(false);
  const m = a.data?.metrics; const point = m?.operatingPoints?.[op];
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success(msg); setConfirm(null); a.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const importance = m?.featureImportance ? Object.entries(m.featureImportance).map(([k, v]) => ({ feature: k, value: +v.toFixed(4) })).sort((x, y) => y.value - x.value).slice(0, 12) : [];
  const dist = a.data ? a.data.distribution.normal.map((b, i) => ({ label: b.from.toFixed(1), normal: b.count, anomalous: a.data!.distribution.anomalous[i]?.count ?? 0 })) : [];
  const types = m?.byType ? Object.entries(m.byType) : [];

  return (
    <div>
      <PageHeader title="ML Analytics" subtitle="Isolation Forest performance on a held-out SYNTHETIC test set" actions={can.manageModel(user?.role) ? (<><button className="btn-ghost" disabled={busy} onClick={() => void run(() => api.refreshModel(), 'Metrics refreshed from the ML service')}>Refresh metrics</button><button className="btn-danger" onClick={() => setConfirm('train')}>Retrain model</button></>) : undefined} />
      {a.loading && !a.data ? <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div> : a.error && !a.data ? <div className="card"><ErrorState message={a.error} onRetry={a.reload} /></div> : a.data && (<>
        {!m ? <div className="card"><EmptyState title="No model metrics yet" hint={a.data.message} /></div> : (<>
          <p className="mb-3 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">All metrics come from synthetic data ({m.datasetVersion}); they show the pipeline works, not how it would perform on real stations.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <MetricCard label="Model" value={<span className="text-base">{m.modelName}</span>} hint={`Trained ${fmtTime(m.trainedAt)}`} />
            <MetricCard label="Precision" value={pct(point?.precision ?? m.precision)} tone="info" hint={op === 'flag' ? 'flag threshold' : 'quarantine threshold'} />
            <MetricCard label="Recall" value={pct(point?.recall ?? m.recall)} tone="info" /><MetricCard label="F1-score" value={pct(point?.f1 ?? m.f1Score)} tone="ok" />
            <MetricCard label="ROC-AUC" value={m.rocAuc === null ? '—' : m.rocAuc.toFixed(3)} hint="threshold-independent" /><MetricCard label="Dataset" value={m.datasetSize ? fmtInt(m.datasetSize.fit + m.datasetSize.calibration + m.datasetSize.test) : '—'} hint={m.datasetSize ? `${fmtInt(m.datasetSize.test)} test · ${fmtInt(m.datasetSize.testAnomalies)} anomalous` : undefined} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <section className="card p-4" aria-label="Confusion matrix"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-100">Confusion matrix</h2>
              <div className="flex gap-1 rounded-md border border-edge p-0.5" role="group" aria-label="Operating point">{(['flag', 'quarantine'] as const).map((k) => <button key={k} aria-pressed={op === k} onClick={() => setOp(k)} className={`rounded px-2 py-0.5 text-xs ${op === k ? 'bg-electric text-white' : 'text-slate-400'}`}>{humanize(k)}</button>)}</div></div>
              {point ? <ConfusionMatrix c={point.confusion} /> : <EmptyState title="Not available" />}<p className="mt-3 text-xs text-slate-500">Threshold = {op === 'flag' ? a.data.info.thresholds.flag : a.data.info.thresholds.quarantine} {a.data.info.thresholds.meaning}.</p></section>
            <ChartCard title="Feature importance" subtitle="Permutation importance (drop in average precision)" empty={importance.length === 0} className="xl:col-span-2" height={300}>
              <ResponsiveContainer width="100%" height={300}><BarChart data={importance} layout="vertical" margin={{ left: 30 }}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} /><XAxis type="number" {...axisProps} /><YAxis type="category" dataKey="feature" width={110} {...axisProps} /><Tooltip {...tooltipStyle} /><Bar dataKey="value" name="Importance" fill={C.cyan} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer>
              <p className="mt-1 text-xs text-slate-500">{a.data.info.featureImportanceMethod}. Limitation: correlated features share credit, and it explains the model globally, not any single decision.</p>
            </ChartCard>
            <ChartCard title="Normal vs anomalous telemetry" subtitle="Anomaly score of stored readings (last 7 days)" empty={a.data.distribution.sampled === 0} className="xl:col-span-2" height={240}>
              <ResponsiveContainer width="100%" height={240}><BarChart data={dist}><CartesianGrid stroke={C.grid} strokeDasharray="3 3" /><XAxis dataKey="label" {...axisProps} /><YAxis {...axisProps} allowDecimals={false} /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="normal" name="Accepted" fill={C.ok} /><Bar dataKey="anomalous" name="Held / rejected" fill={C.crit} /></BarChart></ResponsiveContainer>
            </ChartCard>
            <section className="card p-4" aria-label="Detection by anomaly type"><h2 className="mb-2 text-sm font-semibold text-slate-100">Detection by anomaly type</h2><p className="mb-2 text-xs text-slate-500">Events caught at the flag threshold (ML only).</p>
              {types.length === 0 ? <EmptyState title="Not available" /> : <ul className="space-y-1.5 text-sm">{types.map(([t, v]) => (<li key={t} className="flex items-center justify-between gap-2"><span className="text-slate-300">{humanize(t)}</span><span className={`tabular-nums ${v.events_detected === v.events ? 'text-ok' : 'text-warn'}`}>{v.events_detected}/{v.events}</span></li>))}</ul>}</section>
          </div>
        </>)}
        <section className="card mt-4 p-4" aria-label="Model information"><h2 className="mb-3 text-sm font-semibold text-slate-100">Model information</h2>
          <dl className="grid gap-4 text-sm md:grid-cols-2"><div><dt className="text-xs text-slate-500">Algorithm</dt><dd className="text-slate-200">{a.data.info.algorithm}</dd></div><div><dt className="text-xs text-slate-500">Training dataset</dt><dd className="text-slate-200">{a.data.info.trainingData}</dd></div>
            <div><dt className="text-xs text-slate-500">Detection thresholds</dt><dd className="text-slate-200">Flag ≥ {a.data.info.thresholds.flag} · Quarantine ≥ {a.data.info.thresholds.quarantine} ({a.data.info.thresholds.meaning})</dd></div>
            <div><dt className="text-xs text-slate-500">Features</dt><dd className="font-mono text-xs text-slate-300">{a.data.info.features.length ? a.data.info.features.join(', ') : '—'}</dd></div></dl>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-warn">Known limitations</h3><ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">{a.data.info.limitations.map((l) => <li key={l}>{l}</li>)}</ul></section>
      </>)}
      {confirm === 'train' && <ConfirmModal title="Retrain the model?" danger busy={busy} confirmLabel="Retrain" onClose={() => setConfirm(null)} onConfirm={() => void run(async () => { const r = await api.trainModel(); toast.info(r.note); }, 'Model retrained and reloaded')} message="The ML service retrains on the clean synthetic training set and reloads. Metrics on this page are not updated until the evaluation script is run and metrics are refreshed." />}
    </div>
  );
}
