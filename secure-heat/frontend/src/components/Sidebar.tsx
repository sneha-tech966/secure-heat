import { Activity, Archive, Brain, LayoutDashboard, Play, Radio, Settings, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { Role } from '../types/api';
import { navFor } from '../utils/permissions';

const ICONS: Record<string, LucideIcon> = { layout: LayoutDashboard, activity: Activity, radio: Radio, shield: ShieldAlert, archive: Archive, brain: Brain, play: Play, settings: Settings };

/** Navigation is filtered by role (UX only; the backend authorizes every request). */
export function Sidebar({ role, open, onNavigate }: { role?: Role; open: boolean; onNavigate: () => void }) {
  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-edge bg-navy-950 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Primary">
      <div className="flex h-14 items-center gap-2 border-b border-edge px-4"><ShieldCheck className="h-6 w-6 text-electric" aria-hidden /><span className="text-base font-semibold tracking-tight text-slate-100">Secure<span className="text-cyan-soft">-Heat</span></span></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navFor(role).map((n) => { const Icon = ICONS[n.icon] ?? LayoutDashboard; return (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate}
            className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'bg-electric/15 text-cyan-soft ring-1 ring-inset ring-electric/30' : 'text-slate-400 hover:bg-navy-700 hover:text-slate-100'}`}>
            <Icon className="h-4 w-4" aria-hidden />{n.label}</NavLink>); })}
      </nav>
      <p className="border-t border-edge p-3 text-[11px] leading-snug text-slate-500">Telemetry and ML results shown here use <span className="text-slate-400">synthetic data</span> for demonstration.</p>
    </aside>
  );
}
