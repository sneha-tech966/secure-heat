import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ErrorBoundary } from '../components/States';
import { Topbar } from '../components/Topbar';
import { useAuth } from '../context/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth(); const [open, setOpen] = useState(false); const nav = useNavigate();
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <Sidebar role={user.role} open={open} onNavigate={() => setOpen(false)} />
      {open && <div className="fixed inset-0 z-30 bg-navy-950/70 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="lg:pl-60">
        <Topbar user={user} onMenu={() => setOpen(true)} onLogout={() => { void logout().then(() => nav('/login')); }} />
        <main className="mx-auto max-w-[1500px] p-4 md:p-6"><ErrorBoundary><Outlet /></ErrorBoundary></main>
      </div>
    </div>
  );
}
