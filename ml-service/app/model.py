"""Isolation Forest fit / score helpers shared by scripts and the inference service."""
from __future__ import annotations
import datetime as dt
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from .preprocessing import FEATURE_SETS, build_features, fit_baselines

DEFAULT_CFG = dict(feature_set="agg", max_samples=1024, max_features=1.0, n_estimators=300, seed=42)
FLAG_PCT, QUARANTINE_PCT = 0.99, 0.999       # percentiles of the held-out CLEAN calibration scores
CALIB_FRAC = 0.2                              # last 20% of each sensor's clean training rows -> calibration only


def fit_bundle(train: pd.DataFrame, cfg: dict, dataset_version: str = "unknown") -> dict:
    """Fit baselines + forest on the first 80% of clean data; calibrate thresholds on the held-out last 20%.
    Calibrating on rows the forest never saw avoids optimistic (too low) in-sample scores."""
    cfg = {**DEFAULT_CFG, **cfg}
    tr = train.sort_values(["sensor_id", "timestamp"])
    rank = tr.groupby("sensor_id").cumcount() / tr.groupby("sensor_id")["timestamp"].transform("size")
    fit_idx, cal_idx = tr.index[rank < 1 - CALIB_FRAC], tr.index[rank >= 1 - CALIB_FRAC]
    baselines = fit_baselines(tr.loc[fit_idx])
    cols = FEATURE_SETS[cfg["feature_set"]]
    feats = build_features(tr, baselines, cols)
    model = IsolationForest(n_estimators=cfg["n_estimators"], max_samples=min(cfg["max_samples"], len(fit_idx)),
                            max_features=cfg["max_features"], contamination="auto",
                            random_state=cfg["seed"], n_jobs=-1).fit(feats.loc[fit_idx].values)
    calib = np.sort(-model.score_samples(feats.loc[cal_idx].values))
    return dict(model=model, baselines=baselines, features=cols, config=cfg, calib_scores=calib,
                flag_threshold_raw=float(np.quantile(calib, FLAG_PCT)),
                quarantine_threshold_raw=float(np.quantile(calib, QUARANTINE_PCT)),
                trained_at=dt.datetime.now(dt.timezone.utc).isoformat(), dataset_version=dataset_version,
                fit_rows=len(fit_idx), calibration_rows=len(cal_idx))


def score_df(bundle: dict, df: pd.DataFrame, features: pd.DataFrame | None = None):
    """Returns (raw_score, anomaly_score). anomaly_score = share of clean calibration readings scoring lower
    (a percentile in [0,1], NOT a calibrated probability)."""
    X = features if features is not None else build_features(df, bundle["baselines"], bundle["features"])
    raw = -bundle["model"].score_samples(X.values)
    return raw, np.searchsorted(bundle["calib_scores"], raw, side="right") / len(bundle["calib_scores"])


def event_ids(df: pd.DataFrame) -> pd.Series:
    """Id per contiguous run of the same anomaly type within a sensor (normal rows -> -1)."""
    d = df.sort_values(["sensor_id", "timestamp"])
    key = d["sensor_id"] + "|" + d["anomaly_type"]
    run = (key != key.shift()).cumsum()
    return run.where(d["is_anomaly"] == 1, -1).reindex(df.index)
