import { useState, type FormEvent } from 'react';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { ConfirmModal, Modal } from '../components/Modal';
import { CopyField } from '../components/CopyField';
import { SensorCard } from '../components/SensorCard';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import type { Credentials, Sensor } from '../types/api';
import { fmtTime, humanize, timeAgo } from '../utils/format';
import { can } from '../utils/permissions';

type Action = { kind: 'status'; sensor: Sensor; status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' } | { kind: 'rotate'; sensor: Sensor } | { kind: 'suspicious'; sensor: Sensor };

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (s: Sensor, c: Credentials) => void }) {
  const [v, setV] = useState({ sensorId: '', name: '', location: '', latitude: '', longitude: '' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api.registerSensor({ sensorId: v.sensorId.trim(), name: v.name.trim(), location: v.location.trim(), ...(v.latitude ? { latitude: Number(v.latitude) } : {}), ...(v.longitude ? { longitude: Number(v.longitude) } : {}) }); onDone(r.sensor, r.credentials); }
    catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  const f = (k: keyof typeof v, label: string, extra: object = {}) => (<div><label className="label" htmlFor={`rs-${k}`}>{label}</label><input id={`rs-${k}`} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></div>);
  return (
    <Modal title="Register sensor" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">{f('sensorId', 'Sensor ID', { required: true, placeholder: 'WS-006', pattern: '[A-Za-z0-9_-]{1,64}' })}{f('name', 'Name', { required: true })}{f('location', 'Location', { required: true })}
        <div className="grid grid-cols-2 gap-3">{f('latitude', 'Latitude (optional)', { type: 'number', step: 'any', min: -90, max: 90 })}{f('longitude', 'Longitude (optional)', { type: 'number', step: 'any', min: -180, max: 180 })}</div>
        {err && <p role="alert" className="text-sm text-crit">{err}</p>}
        <p className="text-xs text-slate-500">An API key and signing secret are generated on the server and shown once.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !v.sensorId || !v.name || !v.location}>{busy ? 'Registering…' : 'Register'}</button></div></form>
    </Modal>
  );
}

function CredentialsModal({ sensorId, creds, onClose }: { sensorId: string; creds: Credentials; onClose: () => void }) {
  return (
    <Modal title={`Credentials for ${sensorId}`} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>I've stored them</button>}>
      <p className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Copy these now. They are shown only once and cannot be retrieved later; losing them means rotating credentials.</p>
      <div className="space-y-3"><CopyField label="API key" value={creds.apiKey} /><CopyField label="Signing secret (HMAC)" value={creds.secret} /></div>
    </Modal>
  );
}

function SensorDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useApi(() => api.sensor(id), [id]);
  return (
    <Modal title={`Sensor ${id}`} onClose={onClose} wide>
      {d.loading && !d.data ? <Skeleton className="h-40 w-full" /> : d.error ? <ErrorState message={d.error} onRetry={d.reload} /> : d.data ? (<div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Name', d.data.sensor.name], ['Location', d.data.sensor.location], ['Registered', fmtTime(d.data.sensor.registeredAt)], ['Last seen', timeAgo(d.data.sensor.lastSeen)], ['Readings', d.data.sensor.telemetryCount ?? 0], ['Anomalies', d.data.sensor.anomalyCount ?? 0], ['Open incidents', d.data.sensor.openEvents ?? 0]].map(([k, v]) => (<div key={String(k)}><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-200">{String(v)}</dd></div>))}<div><dt className="text-xs text-slate-500">Status</dt><dd><StatusBadge status={d.data.sensor.status} /></dd></div></dl>
        <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-soft">Recent security events</h3>
          {d.data.recentEvents.length === 0 ? <p className="text-sm text-slate-500">No security events for this sensor.</p> : <ul className="space-y-2">{d.data.recentEvents.map((e) => (<li key={e.id} className="flex items-start gap-2 text-sm"><SeverityBadge severity={e.severity} /><div><p className="text-slate-200">{humanize(e.eventType)} <span className="text-xs text-slate-500">· {fmtTime(e.detectedAt)}</span></p><p className="text-xs text-slate-400">{e.description}</p></div></li>))}</ul>}</div>
      </div>) : null}
    </Modal>
  );
}

export default function Sensors() {
  const { user } = useAuth(); const toast = useToast(); const role = user?.role;
  const s = useApi(() => api.sensors(), [], 15_000);
  const [reg, setReg] = useState(false); const [creds, setCreds] = useState<{ sensorId: string; c: Credentials } | null>(null); const [act, setAct] = useState<Action | null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); setAct(null); s.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const confirm = (reason: string) => {
    if (!act) return;
    if (act.kind === 'status') return void run(() => api.setSensorStatus(act.sensor.sensorId, act.status, reason || undefined), `${act.sensor.sensorId} is now ${act.status.toLowerCase()}`);
    if (act.kind === 'suspicious') return void run(() => api.markSuspicious(act.sensor.sensorId, reason), `${act.sensor.sensorId} marked for investigation`);
    setBusy(true); api.rotateCredentials(act.sensor.sensorId).then((r) => { setCreds({ sensorId: act.sensor.sensorId, c: r.credentials }); setAct(null); s.reload(); }).catch((e) => toast.error(errorMessage(e))).finally(() => setBusy(false));
  };

  const actions = (x: Sensor) => (<>
    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDetail(x.sensorId)}>Details</button>
    {can.changeSensorStatus(role) && (x.status === 'ACTIVE' || x.status === 'SUSPICIOUS') && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAct({ kind: 'status', sensor: x, status: 'INACTIVE' })}>Deactivate</button>}
    {can.changeSensorStatus(role) && (x.status === 'INACTIVE' || x.status === 'BLOCKED' || x.status === 'SUSPICIOUS') && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAct({ kind: 'status', sensor: x, status: 'ACTIVE' })}>Activate</button>}
    {can.changeSensorStatus(role) && x.status !== 'BLOCKED' && <button className="btn-danger px-2 py-1 text-xs" onClick={() => setAct({ kind: 'status', sensor: x, status: 'BLOCKED' })}>Block</button>}
    {can.rotateCredentials(role) && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAct({ kind: 'rotate', sensor: x })}>Rotate credentials</button>}
    {can.markSuspicious(role) && (x.status === 'ACTIVE') && <button className="btn-ghost px-2 py-1 text-xs text-warn" onClick={() => setAct({ kind: 'suspicious', sensor: x })}>Mark suspicious</button>}
  </>);

  return (
    <div>
      <PageHeader title="Sensors" subtitle="Registered weather stations and their credentials status" actions={can.registerSensor(role) ? <button className="btn-primary" onClick={() => setReg(true)}>Register sensor</button> : undefined} />
      {s.loading && !s.data ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full" />)}</div>
        : s.error && !s.data ? <div className="card"><ErrorState message={s.error} onRetry={s.reload} /></div>
        : s.data && s.data.sensors.length === 0 ? <div className="card"><EmptyState title="No sensors registered" hint={can.registerSensor(role) ? 'Register your first sensor to start receiving telemetry.' : 'An administrator needs to register sensors.'} /></div>
        : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{s.data?.sensors.map((x) => <SensorCard key={x.id} sensor={x} onOpen={() => setDetail(x.sensorId)} actions={actions(x)} />)}</div>}
      {reg && <RegisterModal onClose={() => setReg(false)} onDone={(sensor, c) => { setReg(false); setCreds({ sensorId: sensor.sensorId, c }); s.reload(); toast.success(`Sensor ${sensor.sensorId} registered`); }} />}
      {creds && <CredentialsModal sensorId={creds.sensorId} creds={creds.c} onClose={() => setCreds(null)} />}
      {detail && <SensorDetailModal id={detail} onClose={() => setDetail(null)} />}
      {act?.kind === 'status' && <ConfirmModal title={`${act.status === 'BLOCKED' ? 'Block' : act.status === 'ACTIVE' ? 'Activate' : 'Deactivate'} ${act.sensor.sensorId}?`} danger={act.status === 'BLOCKED'} busy={busy} reasonLabel="Reason (recorded in the audit log)" confirmLabel={humanize(act.status === 'ACTIVE' ? 'activate' : act.status === 'BLOCKED' ? 'block' : 'deactivate')} onClose={() => setAct(null)} onConfirm={confirm}
        message={act.status === 'BLOCKED' ? 'A blocked sensor can no longer send telemetry, and attempts are logged as security events.' : act.status === 'INACTIVE' ? 'An inactive sensor will be rejected until it is reactivated.' : 'The sensor will be allowed to transmit again.'} />}
      {act?.kind === 'rotate' && <ConfirmModal title={`Rotate credentials for ${act.sensor.sensorId}?`} danger busy={busy} confirmLabel="Rotate" onClose={() => setAct(null)} onConfirm={confirm} message="The current API key and secret stop working immediately. The device must be updated with the new credentials, which are shown once." />}
      {act?.kind === 'suspicious' && <ConfirmModal title={`Mark ${act.sensor.sensorId} as suspicious?`} busy={busy} reasonLabel="Why is this sensor suspicious?" confirmLabel="Mark suspicious" onClose={() => setAct(null)} onConfirm={confirm} message="An incident is opened and all new readings from this sensor are held for review instead of being trusted automatically." />}
    </div>
  );
}
