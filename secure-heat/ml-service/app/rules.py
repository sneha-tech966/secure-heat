"""Rule-based security checks. Pure Python (no ML, no pydantic) so it is independently testable.

Rule categories
  range   physically impossible / outside configured sensor limits  -> hard violation (integrity evidence)
  change  abrupt change vs the median of the sensor's recent readings -> soft (could be a real front/gust)
  repeat  N+ consecutive identical full readings                      -> soft/medium (stuck sensor or replayed values)
Duplicate sequence numbers / replay are checked by the backend (atomic DB constraint), not here.
"""
from __future__ import annotations
import os
import statistics
from dataclasses import dataclass, field

FIELDS = ["temperature", "humidity", "pressure", "wind_speed", "wind_direction", "rainfall", "solar_radiation"]


def _f(name: str, default: float) -> float:
    return float(os.getenv(name, default))


@dataclass
class RuleConfig:
    limits: dict = field(default_factory=lambda: {
        "temperature": (_f("LIMIT_TEMP_MIN", -60), _f("LIMIT_TEMP_MAX", 60)),
        "humidity": (0.0, 100.0),
        "pressure": (_f("LIMIT_PRESSURE_MIN", 870), _f("LIMIT_PRESSURE_MAX", 1085)),
        "wind_speed": (0.0, _f("LIMIT_WIND_MAX", 75)),
        "wind_direction": (0.0, 360.0),
        "rainfall": (0.0, _f("LIMIT_RAIN_MAX", 100)),
        "solar_radiation": (0.0, _f("LIMIT_SOLAR_MAX", 1500)),
    })
    # max plausible change vs median of recent readings (tuned for ~10 minute reporting interval)
    max_change: dict = field(default_factory=lambda: {
        "temperature": _f("CHANGE_TEMP", 8), "humidity": _f("CHANGE_HUMIDITY", 35),
        "pressure": _f("CHANGE_PRESSURE", 8), "wind_speed": _f("CHANGE_WIND", 20)})
    repeat_limit: int = int(os.getenv("REPEAT_LIMIT", 3))      # identical consecutive readings incl. current


def _rule(rule, category, severity, hard, message):
    return dict(rule=rule, category=category, severity=severity, hard=hard, message=message)


def evaluate_rules(reading: dict, recent: list[dict], cfg: RuleConfig | None = None) -> list[dict]:
    """reading: dict with FIELDS; recent: previous readings of the same sensor, oldest first."""
    cfg = cfg or RuleConfig(); out = []
    for f in FIELDS:
        lo, hi = cfg.limits[f]; v = reading[f]
        if v < lo or v > hi:
            out.append(_rule(f"{f.upper()}_OUT_OF_RANGE", "range", "HIGH", True,
                             f"{f}={v} is outside the allowed range [{lo:g}, {hi:g}]"))
    last = recent[-3:]
    if last:
        for f, limit in cfg.max_change.items():
            med = statistics.median(r[f] for r in last); d = reading[f] - med
            if abs(d) > limit:
                out.append(_rule(f"{f.upper()}_SUDDEN_CHANGE", "change", "MEDIUM", False,
                                 f"{f} changed by {d:+.1f} vs recent median {med:.1f} (limit ±{limit:g})"))
    key = tuple(reading[f] for f in FIELDS); run = 1
    for r in reversed(recent):
        if tuple(r[f] for f in FIELDS) == key: run += 1
        else: break
    if run >= cfg.repeat_limit:
        out.append(_rule("REPEATED_IDENTICAL_READINGS", "repeat", "MEDIUM", False,
                         f"{run} consecutive identical readings (limit {cfg.repeat_limit - 1})"))
    return out
