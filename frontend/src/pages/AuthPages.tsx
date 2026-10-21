import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../services/api';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2"><ShieldCheck className="h-8 w-8 text-electric" aria-hidden /><span className="text-2xl font-semibold text-slate-100">Secure<span className="text-cyan-soft">-Heat</span></span></div>
        <div className="card p-6"><h1 className="mb-4 text-lg font-semibold text-slate-100">{title}</h1>{children}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password); nav(from, { replace: true }); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="rounded border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-center text-xs text-slate-500"><Link to="/forgot-password" className="hover:text-cyan-soft">Forgot password?</Link> · Accounts are created by an administrator.</p>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); try { setMsg((await api.forgotPassword(email)).message); } catch (err) { setMsg(errorMessage(err)); } };
  return (
    <Shell title="Reset password">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-400">Self-service reset needs an outbound email service. Until it is configured, ask an administrator to reset your password.</p>
        <div><label className="label" htmlFor="fp-email">Email</label><input id="fp-email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {msg && <p role="status" className="rounded border border-edge bg-navy-900 px-3 py-2 text-sm text-slate-300">{msg}</p>}
        <button type="submit" className="btn-primary w-full">Request reset</button>
        <p className="text-center text-xs"><Link to="/login" className="text-slate-400 hover:text-cyan-soft">Back to sign in</Link></p>
      </form>
    </Shell>
  );
}
