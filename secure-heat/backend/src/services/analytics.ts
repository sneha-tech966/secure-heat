/** Fixed-width histogram over [min, max]; the top edge is inclusive. Non-finite values are ignored. */
export function histogram(values: number[], bins = 10, min = 0, max = 1): { from: number; to: number; count: number }[] {
  const out = Array.from({ length: bins }, (_, i) => ({ from: +(min + ((max - min) * i) / bins).toFixed(4), to: +(min + ((max - min) * (i + 1)) / bins).toFixed(4), count: 0 }));
  for (const v of values) { if (!Number.isFinite(v) || v < min || v > max) continue; out[Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins))]!.count++; }
  return out;
}

export const MODEL_LIMITATIONS = [
  'Trained and evaluated on SYNTHETIC data; real-world performance is unknown and will differ.',
  'Isolation Forest is unsupervised: the score says "unusual for this sensor/hour", not "malicious". Real storms can score high.',
  'The anomaly score is a percentile of clean calibration scores, not a calibrated probability.',
  'Slow sensor drift can pass for several readings before the deviation grows large enough to be flagged.',
  'Repeated-reading and impossible-value detection are rule-based by design (a constant feature cannot be split by a forest).',
  'Per-hour baselines are learned for the 5 demo sensors; new sensors fall back to a generic baseline until retrained.',
  'Permutation importance is a global, approximate measure: correlated features share credit and it says nothing about individual predictions.',
];
