import { LogOut, Menu } from 'lucide-react';
import type { User } from '../types/api';
import { roleLabel } from '../utils/permissions';

export function Topbar({ user, onMenu, onLogout }: { user: User; onMenu: () => void; onLogout: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-edge bg-navy-900/90 px-4 backdrop-blur">
      <button className="btn-ghost px-2 lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="hidden text-xs text-slate-500 lg:block">IoT telemetry integrity monitoring</div>
      <div className="flex items-center gap-3">
        <div className="text-right leading-tight"><p className="text-sm text-slate-200">{user.name}</p><p className="text-[11px] text-cyan-soft">{roleLabel(user.role)}</p></div>
        <button className="btn-ghost px-2" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
