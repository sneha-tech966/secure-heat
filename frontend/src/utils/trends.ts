import type { ForecastPoint } from '../types/api';

export interface TrendRow { t: number; trusted?: number; naive?: number; forecast?: number; band?: [number, number] }

/** Merges trusted hourly means, the naive "all readings" series and the forecast into one time-keyed array for charting.
 *  Forecast timestamps continue hourly from the last trusted point. */
export function buildTrendRows(trusted: { t: string; v: number | null }[], forecast: ForecastPoint[], naive: { t: string; v: number | null }[] = []): TrendRow[] {
  const rows = new Map<number, TrendRow>(); const at = (t: number) => { let r = rows.get(t); if (!r) { r = { t }; rows.set(t, r); } return r; };
  for (const p of trusted) if (p.v !== null) at(new Date(p.t).getTime()).trusted = p.v;
  for (const p of naive) if (p.v !== null) at(new Date(p.t).getTime()).naive = p.v;
  const last = trusted.length ? new Date(trusted[trusted.length - 1]!.t).getTime() : null;
  if (last !== null && trusted.length) {
    const lastV = trusted[trusted.length - 1]!.v; if (lastV !== null) { const r = at(last); r.forecast = lastV; r.band = [lastV, lastV]; } // connect the forecast line to the data
    for (const f of forecast) { const r = at(last + f.step * 3_600_000); r.forecast = f.value; r.band = [f.lower, f.upper]; }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}
