export interface Forecast { method: string; points: { step: number; value: number; lower: number; upper: number }[]; slopePerStep: number; basedOn: number }

/** Deliberately simple baseline (damped linear trend via least squares on the latest <=24 hourly means).
 *  It exists to show why input integrity matters, NOT to be a competitive weather model. */
export function baselineForecast(hourly: number[], horizon: number, damping = 0.9): Forecast {
  const ys = hourly.filter(Number.isFinite).slice(-24); const n = ys.length;
  const empty: Forecast = { method: 'damped-linear-trend', points: [], slopePerStep: 0, basedOn: n };
  if (n < 4 || horizon <= 0) return empty;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0; ys.forEach((y, i) => { sxx += (i - mx) ** 2; sxy += (i - mx) * (y - my); });
  const slope = sxy / sxx, intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (intercept + slope * i)); const sigma = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2));
  let level = intercept + slope * (n - 1), step = slope; const points = [];
  for (let h = 1; h <= horizon; h++) {
    step *= damping; level += step; const band = 1.96 * sigma * Math.sqrt(1 + h / n);
    points.push({ step: h, value: +level.toFixed(2), lower: +(level - band).toFixed(2), upper: +(level + band).toFixed(2) });
  }
  return { method: 'damped-linear-trend', points, slopePerStep: +slope.toFixed(4), basedOn: n };
}
