import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api';

export interface ApiState<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Fetches on mount / when deps change, optionally polls. Ignores out-of-order responses and keeps the previous data while refreshing. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[], pollMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const seq = useRef(0); const fnRef = useRef(fn); fnRef.current = fn;
  const run = useCallback(async () => {
    const id = ++seq.current;
    try { const r = await fnRef.current(); if (id === seq.current) { setData(r); setError(null); } }
    catch (e) { if (id === seq.current) setError(errorMessage(e)); }
    finally { if (id === seq.current) setLoading(false); }
  }, []);
  useEffect(() => { setLoading(true); void run(); }, [run, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pollMs) return; const t = setInterval(() => void run(), pollMs); return () => clearInterval(t); }, [pollMs, run]);
  useEffect(() => () => { seq.current = Number.MAX_SAFE_INTEGER; }, []);
  return { data, error, loading, reload: () => void run() };
}
