"""Loads the trained Isolation Forest once at startup and scores single readings.

State: per-sensor deques. `recent` = last raw readings (used by rules); `trusted` = last readings that were
neither model anomalies nor hard-rule violations (used for delta features, so a short attack cannot shift the
baseline it is measured against).
Anti-lockout: if the newest trusted reading is older than TRUSTED_MAX_AGE_MIN (default 60) the delta features fall
back to `recent`. Without this a sensor that had one anomaly would be judged against a stale baseline forever,
flag every later reading, and never re-admit one to `trusted` (observed in replay testing). Long-running
anomalies such as drift are caught by the per-hour deviation features, which do not depend on this history.
"""
from __future__ import annotations
import datetime as dt
import math
import os
import threading
from collections import defaultdict, deque
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .preprocessing import ALL_FEATURES, DEV_COLS, DELTA_COLS, build_features
from .rules import FIELDS, RuleConfig, evaluate_rules

HUMAN = {"temp_dev": "temperature", "hum_dev": "humidity", "pres_dev": "pressure", "wind_dev": "wind speed",
         "solar_dev": "solar radiation"}
HUMAN_D = {"d_temperature": "temperature", "d_humidity": "humidity", "d_pressure": "pressure", "d_wind_speed": "wind speed"}
NOTE = "A statistical anomaly is not by itself evidence of tampering; unusual but real weather can trigger it."


class ModelNotLoaded(RuntimeError):
    pass


class AnomalyDetector:
    def __init__(self, model_path, flag_pct: float = 0.99, quarantine_pct: float = 0.999, history_len: int = 10,
                 trusted_max_age_min: float | None = None):
        self.model_path, self.flag_pct, self.quarantine_pct = Path(model_path), flag_pct, quarantine_pct
        self.trusted_max_age = pd.Timedelta(minutes=trusted_max_age_min if trusted_max_age_min is not None
                                            else float(os.getenv("TRUSTED_MAX_AGE_MIN", 60)))
        self.bundle, self.error = None, None
        self.rule_cfg = RuleConfig()
        self._recent = defaultdict(lambda: deque(maxlen=history_len))
        self._trusted = defaultdict(lambda: deque(maxlen=history_len))
        self._lock = threading.Lock()
        self.load()

    @property
    def loaded(self) -> bool:
        return self.bundle is not None

    def load(self) -> bool:
        try:
            b = joblib.load(self.model_path)
            b["flag_raw"] = float(np.quantile(b["calib_scores"], self.flag_pct))
            b["quarantine_raw"] = float(np.quantile(b["calib_scores"], self.quarantine_pct))
            self.bundle, self.error = b, None
        except FileNotFoundError:
            self.bundle, self.error = None, f"model file not found: {self.model_path}"
        except Exception as e:                       # corrupt / incompatible artifact
            self.bundle, self.error = None, f"model failed to load: {type(e).__name__}"
        return self.loaded

    # ------------------------------------------------------------------
    @staticmethod
    def validate(reading: dict) -> dict:
        clean = {}
        for f in FIELDS:
            if f not in reading or reading[f] is None:
                raise ValueError(f"missing field: {f}")
            try:
                v = float(reading[f])
            except (TypeError, ValueError):
                raise ValueError(f"field {f} must be numeric")
            if not math.isfinite(v):
                raise ValueError(f"field {f} must be finite")
            clean[f] = v
        return clean

    def _features(self, sensor_id, reading, ts, trusted):
        rows, n = [], len(trusted)
        for i, h in enumerate(trusted):
            hts = h.get("timestamp") or (ts - dt.timedelta(minutes=10 * (n - i)))
            rows.append({**{f: h[f] for f in FIELDS}, "sensor_id": sensor_id, "timestamp": hts})
        rows.append({**reading, "sensor_id": sensor_id, "timestamp": ts})
        feats = build_features(pd.DataFrame(rows), self.bundle["baselines"], self.bundle["features"])
        return feats.iloc[-1]

    def predict(self, sensor_id: str, reading: dict, timestamp=None, history: list[dict] | None = None,
                update_state: bool = True) -> dict:
        """history (optional, oldest first) overrides the stored state for both rules and model (tests/replay)."""
        if not self.loaded:
            raise ModelNotLoaded(self.error or "model not loaded")
        reading = self.validate(reading)
        ts = pd.Timestamp(timestamp) if timestamp is not None else pd.Timestamp(dt.datetime.now(dt.timezone.utc))
        with self._lock:
            recent = list(history) if history is not None else list(self._recent[sensor_id])
            trusted = list(history) if history is not None else list(self._trusted[sensor_id])
            if history is None and trusted and ts - pd.Timestamp(trusted[-1]["timestamp"]) > self.trusted_max_age:
                trusted = list(recent)                      # stale trusted baseline -> anti-lockout fallback
        rules = evaluate_rules(reading, recent, self.rule_cfg)
        row = self._features(sensor_id, reading, ts, trusted)
        b = self.bundle
        raw = float(-b["model"].score_samples(row.values.reshape(1, -1))[0])
        score = float(np.searchsorted(b["calib_scores"], raw, side="right") / len(b["calib_scores"]))
        severity = "STRONG" if raw >= b["quarantine_raw"] else "MODERATE" if raw >= b["flag_raw"] else "NONE"
        hard = any(r["hard"] for r in rules)
        if update_state and history is None:
            with self._lock:
                entry = {**reading, "timestamp": ts}
                self._recent[sensor_id].append(entry)
                if severity == "NONE" and not hard:
                    self._trusted[sensor_id].append(entry)
        return dict(anomaly_score=round(score, 4), raw_score=round(raw, 4),
                    prediction="ANOMALY" if severity != "NONE" else "NORMAL", ml_severity=severity,
                    rules_triggered=[r["rule"] for r in rules], rule_details=rules, hard_rule_violation=hard,
                    baseline_known=sensor_id in b["baselines"]["hourly"],
                    explanation=self._explain(row, severity, rules))

    def _explain(self, row, severity, rules) -> str:
        parts = []
        dz = {n: abs(row[n]) / self.bundle["baselines"]["delta_std"][n] for n in DELTA_COLS.values() if n in row.index}
        for n, label in HUMAN.items():
            if n in row.index and abs(row[n]) >= 3:
                parts.append((abs(row[n]), f"{label} deviates {row[n]:+.1f}σ from this sensor's typical value for this hour"))
        for n, z in dz.items():
            if z >= 4:
                parts.append((z, f"abrupt change in {HUMAN_D[n]} ({z:.0f}σ vs recent readings)"))
        parts = [t for _, t in sorted(parts, reverse=True)[:3]]
        if severity == "NONE":
            msg = "Reading is consistent with this sensor's learned normal behaviour"
        elif parts:
            msg = "; ".join(parts)
        else:
            msg = "The combination of readings is jointly unusual for this sensor and time of day"
        if rules:
            msg += ". Rules: " + "; ".join(r["message"] for r in rules)
        return msg + ". " + (NOTE if severity != "NONE" else "")
