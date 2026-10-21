import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { User } from '../types/api';

interface AuthState { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(() => { const h = () => setUser(null); window.addEventListener('auth:expired', h); return () => window.removeEventListener('auth:expired', h); }, []);
  const login = useCallback(async (email: string, password: string) => { setUser((await api.login(email, password)).user); }, []);
  const logout = useCallback(async () => { try { await api.logout(); } finally { setUser(null); } }, []);
  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthState { const c = useContext(Ctx); if (!c) throw new Error('useAuth must be used inside <AuthProvider>'); return c; }
