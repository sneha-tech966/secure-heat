import { useState, type FormEvent } from 'react';

import { DataTable, Pagination, type Column } from '../components/DataTable';
import { ConfirmModal, Modal } from '../components/Modal';
import { ErrorState, PageHeader, Skeleton } from '../components/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errorMessage } from '../services/api';
import type { AuditEntry, Role, User } from '../types/api';
import { fmtTime, humanize } from '../utils/format';
import { roleLabel } from '../utils/permissions';

const ROLE_LIST: Role[] = ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'];
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (<div className="flex justify-between gap-4 border-b border-edge/50 py-1.5 text-sm last:border-0"><dt className="text-slate-400">{k}</dt><dd className="text-right text-slate-200">{v}</dd></div>);

function Config() {
  const c = useApi(() => api.settings(), []);
  if (c.loading && !c.data) return <Skeleton className="h-64 w-full" />; if (c.error && !c.data) return <div className="card"><ErrorState message={c.error} onRetry={c.reload} /></div>; const s = c.data!;
  return (<div className="space-y-4"><p className="rounded border border-edge bg-navy-800 px-3 py-2 text-sm text-slate-400">{s.note}</p>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4"><h2 className="mb-2 text-sm font-semibold text-slate-100">Telemetry security</h2><dl><KV k="Timestamp window" v={`±${s.security.timestampWindowSeconds}s`} /><KV k="Flag threshold" v={s.security.flagThreshold} /><KV k="Quarantine threshold" v={s.security.quarantineThreshold} /><KV k="ML outage fail-safe" v={humanize(s.security.mlFailMode)} /><KV k="Impossible values" v={humanize(s.security.rangeViolationAction)} /></dl></section>
      <section className="card p-4"><h2 className="mb-2 text-sm font-semibold text-slate-100">Physical limits</h2><dl>{Object.entries(s.security.physicalLimits).map(([k, [lo, hi]]) => <KV key={k} k={humanize(k.replace(/([A-Z])/g, '_$1'))} v={`${lo} – ${hi}`} />)}</dl></section>
      <section className="card p-4"><h2 className="mb-2 text-sm font-semibold text-slate-100">Sessions & rate limits</h2><dl><KV k="Session lifetime" v={`${s.sessions.jwtExpiresSeconds / 60} min`} /><KV k="Secure cookies" v={String(s.sessions.cookieSecure)} /><KV k="Failed logins / 15 min" v={s.rateLimits.loginFailures} /><KV k="Global requests / window" v={s.rateLimits.global} /><KV k="Ingest requests / window" v={s.rateLimits.ingest} /></dl></section>
      <section className="card p-4"><h2 className="mb-2 text-sm font-semibold text-slate-100">Integrations</h2><dl><KV k="ML service" v={s.integrations.mlService} /><KV k="ML service token" v={s.integrations.mlTokenConfigured ? 'configured' : 'not set'} /><KV k="External forecasting" v={s.integrations.externalForecastingConfigured ? 'configured' : 'built-in only'} /><KV k="Simulator" v={s.integrations.simulatorConfigured ? 'configured' : 'not configured'} /></dl></section>
    </div></div>);
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [v, setV] = useState({ name: '', email: '', password: '', role: 'VIEWER' as Role }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(null); try { await api.createUser(v); toast.success('User created'); onDone(); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); } };
  return (<Modal title="Create user" onClose={onClose}><form onSubmit={submit} className="space-y-3">
    <div><label className="label" htmlFor="cu-name">Name</label><input id="cu-name" className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
    <div><label className="label" htmlFor="cu-email">Email</label><input id="cu-email" type="email" className="input" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
    <div><label className="label" htmlFor="cu-pw">Initial password (min 12 characters)</label><input id="cu-pw" type="password" minLength={12} autoComplete="new-password" className="input" required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
    <div><label className="label" htmlFor="cu-role">Role</label><select id="cu-role" className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>{ROLE_LIST.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></div>
    {err && <p role="alert" className="text-sm text-crit">{err}</p>}<div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button></div></form></Modal>);
}

function Users() {
  const { user: me } = useAuth(); const toast = useToast(); const u = useApi(() => api.users(), []); const [create, setCreate] = useState(false); const [del, setDel] = useState<User | null>(null); const [busy, setBusy] = useState(false);
  const setRole = async (x: User, role: Role) => { try { await api.updateUser(x.id, { role }); toast.success(`${x.name} is now ${roleLabel(role)}`); u.reload(); } catch (e) { toast.error(errorMessage(e)); u.reload(); } };
  const cols: Column<User>[] = [
    { key: 'n', header: 'Name', render: (r) => <span className="text-slate-200">{r.name}{r.id === me?.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</span> }, { key: 'e', header: 'Email', render: (r) => r.email },
    { key: 'r', header: 'Role', render: (r) => <select aria-label={`Role for ${r.name}`} className="input w-44 py-1" value={r.role} onChange={(e) => void setRole(r, e.target.value as Role)}>{ROLE_LIST.map((x) => <option key={x} value={x}>{roleLabel(x)}</option>)}</select> },
    { key: 'c', header: 'Created', render: (r) => fmtTime(r.createdAt) }, { key: 'a', header: '', render: (r) => r.id === me?.id ? null : <button className="btn-ghost px-2 py-1 text-xs text-crit" onClick={() => setDel(r)}>Delete</button> },
  ];
  return (<div><div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setCreate(true)}>Create user</button></div>
    <DataTable columns={cols} rows={u.data?.users ?? []} rowKey={(r) => r.id} loading={u.loading} error={u.data ? null : u.error} onRetry={u.reload} />
    {create && <CreateUser onClose={() => setCreate(false)} onDone={() => { setCreate(false); u.reload(); }} />}
    {del && <ConfirmModal title={`Delete ${del.name}?`} danger busy={busy} confirmLabel="Delete user" message="The account is removed immediately and its sessions stop working." onClose={() => setDel(null)} onConfirm={() => { setBusy(true); api.deleteUser(del.id).then(() => { toast.success('User deleted'); setDel(null); u.reload(); }).catch((e) => toast.error(errorMessage(e))).finally(() => setBusy(false)); }} />}</div>);
}

function Audit() {
  const [page, setPage] = useState(1); const a = useApi(() => api.audit({ page, pageSize: 25 }), [page]);
  const cols: Column<AuditEntry>[] = [{ key: 't', header: 'Time', render: (r) => fmtTime(r.createdAt) }, { key: 'a', header: 'Actor', render: (r) => r.actorLabel }, { key: 'x', header: 'Action', render: (r) => <span className="font-mono text-xs text-cyan-soft">{r.action}</span> },
    { key: 'g', header: 'Target', render: (r) => <span className="text-slate-400">{r.targetType}{r.targetId ? ` · ${r.targetId.slice(-8)}` : ''}</span> }, { key: 'd', header: 'Details', className: 'max-w-sm truncate text-slate-500', render: (r) => <span title={JSON.stringify(r.details)}>{r.details ? JSON.stringify(r.details) : ''}</span> }];
  return (<div><DataTable columns={cols} rows={a.data?.items ?? []} rowKey={(r) => r.id} loading={a.loading} error={a.data ? null : a.error} onRetry={a.reload} emptyTitle="No audit entries" />{a.data && <Pagination page={page} pageSize={25} total={a.data.total} onPage={setPage} />}</div>);
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'config' | 'users' | 'audit'>('config');
  return (<div><PageHeader title="Settings" subtitle="Administration: configuration, users and audit trail" />
    <div className="mb-4 flex gap-1 border-b border-edge" role="tablist">{([['config', 'Configuration'], ['users', 'Users'], ['audit', 'Audit log']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-electric text-cyan-soft' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{l}</button>)}</div>
    {tab === 'config' ? <Config /> : tab === 'users' ? <Users /> : <Audit />}</div>);
}
