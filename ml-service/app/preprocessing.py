"""Feature engineering shared by training, evaluation and the inference service.

All features are residual-style, i.e. "how unusual is this reading for THIS sensor right now":
  *_dev      z-deviation from the sensor's own per-hour-of-day baseline (temp, humidity, pressure, wind, solar)
  d_*        change vs the MEDIAN of the sensor's previous 3 readings (robust: one spike does not poison the next row)
  max_dev    max |*_dev|                 -> concentrates single-variable extremes that a 14-D forest would dilute
  max_delta_z max |d_*| / training std   -> same for abrupt changes
Raw values are kept as an optional feature group. Repeated-reading detection is NOT a model feature: it is constant
(0) in clean training data, which Isolation Forest cannot split on, so repeats are handled by the rule engine
(see repeat_runs()).
"""
from __future__ import annotations
import numpy as np
import pandas as pd

RAW = ["temperature", "humidity", "pressure", "wind_speed", "rainfall", "solar_radiation"]
DEV_COLS = {"temperature": "temp_dev", "humidity": "hum_dev", "pressure": "pres_dev",
            "wind_speed": "wind_dev", "solar_radiation": "solar_dev"}
DELTA_COLS = {"temperature": "d_temperature", "humidity": "d_humidity",
              "pressure": "d_pressure", "wind_speed": "d_wind_speed"}
DEV = list(DEV_COLS.values()); DELTA = list(DELTA_COLS.values()); AGG = ["max_dev", "max_delta_z"]
ALL_FEATURES = RAW + DELTA + DEV + AGG
FEATURE_SETS = {
    "base": RAW + DELTA + DEV,
    "agg": RAW + DELTA + DEV + AGG,
    "compact": DEV + DELTA + AGG,
}
MIN_STD = {"temperature": 0.5, "humidity": 2.0, "pressure": 0.5, "wind_speed": 0.8, "solar_radiation": 40.0}
MIN_DELTA_STD = {"temperature": 0.1, "humidity": 0.5, "pressure": 0.1, "wind_speed": 0.3}
ROBUST_WINDOW = 3


def _raw_deltas(d: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=d.index)
    for c, name in DELTA_COLS.items():
        med = d.groupby("sensor_id")[c].transform(lambda s: s.shift(1).rolling(ROBUST_WINDOW, min_periods=1).median())
        out[name] = (d[c] - med).fillna(0.0)
    return out


def fit_baselines(df: pd.DataFrame) -> dict:
    """Per-sensor/per-hour mean+std and global delta std, from CLEAN data only."""
    d = df.sort_values(["sensor_id", "timestamp"]).copy()
    d["hour"] = pd.to_datetime(d["timestamp"]).dt.hour
    hourly: dict = {}
    for sid, g in d.groupby("sensor_id"):
        hourly[sid] = {int(h): {c: (float(gh[c].mean()), float(max(gh[c].std(ddof=0), MIN_STD[c]))) for c in DEV_COLS}
                       for h, gh in g.groupby("hour")}
    dl = _raw_deltas(d)
    delta_std = {n: float(max(dl[n].std(ddof=0), MIN_DELTA_STD[c])) for c, n in DELTA_COLS.items()}
    return {"hourly": hourly, "delta_std": delta_std}


def _lookup(baselines, sid, hour):
    sensor = baselines["hourly"].get(sid) or next(iter(baselines["hourly"].values()))
    return sensor.get(int(hour)) or next(iter(sensor.values()))


def build_features(df: pd.DataFrame, baselines: dict, columns: list[str] | None = None) -> pd.DataFrame:
    """df needs sensor_id, timestamp + raw columns (time-ordered per sensor). Returns features aligned to df.index."""
    d = df.sort_values(["sensor_id", "timestamp"]).copy()
    hours = pd.to_datetime(d["timestamp"]).dt.hour.values
    sids = d["sensor_id"].values
    for c, name in DEV_COLS.items():
        d[name] = [(v - _lookup(baselines, s, h)[c][0]) / _lookup(baselines, s, h)[c][1]
                   for s, h, v in zip(sids, hours, d[c].values)]
    d[DELTA] = _raw_deltas(d)[DELTA]
    d["max_dev"] = d[DEV].abs().max(axis=1)
    d["max_delta_z"] = pd.concat([d[n].abs() / baselines["delta_std"][n] for n in DELTA], axis=1).max(axis=1)
    return d.reindex(df.index)[columns or ALL_FEATURES]


def repeat_runs(df: pd.DataFrame) -> pd.Series:
    """Consecutive identical full-reading count per sensor (0 for a fresh reading). Used by the rule engine."""
    d = df.sort_values(["sensor_id", "timestamp"])
    cols = [c for c in RAW + ["wind_direction"] if c in d.columns]
    same = (d[cols].diff().abs().sum(axis=1) == 0) & (d["sensor_id"] == d["sensor_id"].shift())
    return same.groupby((~same).cumsum()).cumsum().astype(float).reindex(df.index)
