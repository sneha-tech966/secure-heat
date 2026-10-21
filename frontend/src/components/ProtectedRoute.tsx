import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types/api';
import { Skeleton } from './States';

export function Forbidden() {
  return (<div role="alert" className="card mx-auto mt-16 max-w-md p-8 text-center"><h1 className="text-lg font-semibold text-slate-100">Access restricted</h1><p className="mt-1 text-sm text-slate-400">Your role doesn't have permission to view this page.</p></div>);
}

/** UX guard only: unauthenticated users go to /login; wrong-role users see "Access restricted". The API enforces the same rules. */
export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: readonly Role[] }) {
  const { user, loading } = useAuth(); const loc = useLocation();
  if (loading) return <div className="p-8"><Skeleton className="h-6 w-48" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Forbidden />;
  return <>{children}</>;
}
