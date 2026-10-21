import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void }
const Ctx = createContext<ToastApi | null>(null);
const COLORS: Record<Kind, string> = { success: 'border-ok/50 text-ok', error: 'border-crit/50 text-crit', info: 'border-electric/50 text-cyan-soft' };
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId++; setToasts((t) => [...t.slice(-3), { id, kind, text }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (<div key={t.id} className={`pointer-events-auto rounded-md border bg-navy-700 px-3 py-2 text-sm shadow-lg ${COLORS[t.kind]}`}>{t.text}</div>))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast(): ToastApi { const c = useContext(Ctx); if (!c) throw new Error('useToast must be used inside <ToastProvider>'); return c; }
