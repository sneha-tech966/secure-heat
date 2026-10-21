"""Generate a SYNTHETIC weather-station dataset (NOT real meteorological data).

5 stations x 30 days x 10-minute interval. Time-ordered split: 0-50% clean train, 50-70% validation, 70-100% test;
val and test contain labelled injected anomalies (one event per 120-row slot).
Usage: python scripts/generate_dataset.py [--seed 42]
"""
import argparse, json, pathlib
import numpy as np, pandas as pd

SENSORS = {"WS-001": (24, 3, 1012), "WS-002": (21, 4, 1009), "WS-003": (27, 2, 1014),
           "WS-004": (18, 5, 1005), "WS-005": (25, 3, 1011)}
DAYS, STEP_MIN = 30, 10
ATYPES = ["temp_spike", "humidity_inconsistent", "out_of_range", "pressure_jump",
          "repeated_readings", "wind_spike", "sensor_drift", "multi_variable"]
COLS7 = ["temperature", "humidity", "pressure", "wind_speed", "wind_direction", "rainfall", "solar_radiation"]


def ar1(n, phi, sigma, rng):
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + rng.normal(0, sigma)
    return x


def gen_sensor(sid, base_t, amp, base_p, rng):
    n = DAYS * 24 * 60 // STEP_MIN
    ts = pd.date_range("2026-01-01", periods=n, freq=f"{STEP_MIN}min")
    hr = ts.hour.values + ts.minute.values / 60
    day = np.sin((hr - 9) / 24 * 2 * np.pi)
    temp = base_t + amp * 2 * day + ar1(n, 0.98, 0.15, rng)
    hum = np.clip(65 - 3.0 * (temp - base_t) + ar1(n, 0.97, 0.8, rng), 15, 99)
    pres = base_p + 1.2 * np.sin(hr / 12 * 2 * np.pi) + ar1(n, 0.995, 0.12, rng)
    wind = np.clip(4 + 2.5 * np.maximum(day, 0) + ar1(n, 0.95, 0.6, rng), 0, None)
    wdir = (180 + np.cumsum(rng.normal(0, 4, n))) % 360
    cloud = np.clip(0.75 + ar1(n, 0.99, 0.04, rng), 0.15, 1)
    solar = np.clip(900 * np.sin((hr - 6) / 12 * np.pi), 0, None) * (hr > 6) * (hr < 18) * cloud
    rain = np.zeros(n)
    for s in rng.choice(n, size=18, replace=False):
        L = int(rng.integers(3, 18)); e = min(s + L, n)
        rain[s:e] = np.abs(rng.normal(1.5, 0.8, e - s))
        hum[s:e] = np.clip(hum[s:e] + 12, 0, 99); solar[s:e] *= 0.3
    df = pd.DataFrame(dict(sensor_id=sid, timestamp=ts, temperature=temp.round(2), humidity=hum.round(1),
                           pressure=pres.round(2), wind_speed=wind.round(2), wind_direction=wdir.round(0),
                           rainfall=rain.round(2), solar_radiation=solar.round(0)))
    df["is_anomaly"], df["anomaly_type"] = 0, "normal"
    return df


def inject(df, rng, lo, hi, offset):
    """Place one labelled event per 120-row slot inside rows [lo*n, hi*n); event types rotate from a random offset."""
    n = len(df); a, b, k = int(n * lo), int(n * hi), offset
    for s0 in range(a, b - 120, 120):
        p = s0 + int(rng.integers(0, 16)); t = ATYPES[k % len(ATYPES)]; k += 1
        def lab(x, y): df.loc[df.index[x:y], ["is_anomaly", "anomaly_type"]] = [1, t]
        if t == "temp_spike":
            L = int(rng.integers(1, 4)); df.loc[df.index[p:p+L], "temperature"] += rng.uniform(14, 24); lab(p, p+L)
        elif t == "humidity_inconsistent":
            L = int(rng.integers(2, 6)); df.loc[df.index[p:p+L], "humidity"] = rng.choice([8, 98]) + rng.normal(0, 1); lab(p, p+L)
        elif t == "out_of_range":
            col, val = [("temperature", 85), ("humidity", 150), ("pressure", 540), ("wind_speed", -12)][int(rng.integers(0, 4))]
            df.loc[df.index[p], col] = val; lab(p, p+1)
        elif t == "pressure_jump":
            L = int(rng.integers(2, 5)); df.loc[df.index[p:p+L], "pressure"] += rng.choice([-1, 1]) * rng.uniform(22, 35); lab(p, p+L)
        elif t == "repeated_readings":
            L = int(rng.integers(8, 14)); df.loc[df.index[p:p+L], COLS7] = df.loc[df.index[p], COLS7].values; lab(p+1, p+L)
        elif t == "wind_spike":
            L = int(rng.integers(1, 4)); df.loc[df.index[p:p+L], "wind_speed"] += rng.uniform(28, 45); lab(p, p+L)
        elif t == "sensor_drift":
            L = int(rng.integers(60, 100)); ramp = np.linspace(0, rng.uniform(9, 14), L); sl = df.index[p:p+L]
            df.loc[sl, "temperature"] += ramp; df.loc[sl, "humidity"] -= ramp * 2.5
            lab(p + L // 2, p + L)          # only the clearly-drifted second half is labelled anomalous
        elif t == "multi_variable":
            L = int(rng.integers(2, 5)); sl = df.index[p:p+L]
            df.loc[sl, "temperature"] -= 12; df.loc[sl, "solar_radiation"] += 650
            df.loc[sl, "pressure"] -= 14; df.loc[sl, "wind_speed"] += 15; lab(p, p+L)
    df["humidity"] = df["humidity"].round(1)
    return df


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int, default=42); a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    tr, va, te = [], [], []
    for s, v in SENSORS.items():
        df = gen_sensor(s, *v, rng); off = int(rng.integers(0, 8))
        df = inject(df, rng, 0.5, 0.7, off); df = inject(df, rng, 0.7, 1.0, off + 3)
        n = len(df); tr.append(df.iloc[:int(.5 * n)]); va.append(df.iloc[int(.5 * n):int(.7 * n)]); te.append(df.iloc[int(.7 * n):])
    tr, va, te = [pd.concat(x, ignore_index=True) for x in (tr, va, te)]
    out = pathlib.Path(__file__).resolve().parents[1] / "data"; out.mkdir(exist_ok=True)
    for name, d in [("train", tr), ("val", va), ("test", te)]:
        d.to_csv(out / f"{name}.csv", index=False)
    counts = lambda d: d.anomaly_type.value_counts().to_dict()
    meta = dict(synthetic=True, note="Synthetic data, NOT real meteorological observations.", seed=a.seed,
                version=f"synthetic-v2-seed{a.seed}",
                splits=dict(train=dict(rows=len(tr), anomalies=int(tr.is_anomaly.sum()), purpose="clean; fit + calibrate"),
                            val=dict(rows=len(va), anomalies=int(va.is_anomaly.sum()), by_type=counts(va), purpose="model selection only"),
                            test=dict(rows=len(te), anomalies=int(te.is_anomaly.sum()), by_type=counts(te), purpose="final report only")))
    (out / "dataset_meta.json").write_text(json.dumps(meta, indent=2)); print(json.dumps(meta, indent=2))
