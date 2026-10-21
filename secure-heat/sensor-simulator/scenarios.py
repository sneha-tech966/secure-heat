"""Attack / fault scenarios for the simulator.

Value-manipulation scenarios change the reading BEFORE it is signed (a compromised or spoofing sensor holding valid
credentials). Transport scenarios (replay_attack, forged_signature) are applied by the simulator when sending.
Everything goes through the real ingestion API; nothing here touches the database.
"""
from __future__ import annotations
import random

SCENARIOS = {
    "normal": "Healthy stations, realistic weather",
    "temperature_spoof": "Target sensor reports temperatures 14-22 C too high",
    "humidity_manipulation": "Target sensor reports humidity inconsistent with its surroundings (or impossible, >100)",
    "replay_attack": "Attacker re-sends a captured request verbatim (same sequence number and signature)",
    "wind_spike": "Target sensor reports sudden wind-speed spikes (+28-45 m/s)",
    "sensor_drift": "Target sensor slowly drifts: temperature creeps up, humidity creeps down, every reading",
    "forged_signature": "Attacker without the secret sends readings with a made-up signature",
}
TRANSPORT = {"replay_attack", "forged_signature"}


def mutate(name: str, reading: dict, state: dict, rng: random.Random) -> dict:
    """Return a manipulated copy of `reading`. `state` is per-sensor scratch space (e.g. drift counter)."""
    r = dict(reading)
    if name == "temperature_spoof":
        r["temperature"] = round(r["temperature"] + rng.uniform(14, 22), 2)
    elif name == "humidity_manipulation":
        v = rng.choice([8.0, 98.0, 150.0])                # 150 is physically impossible; 8/98 are possible but inconsistent
        r["humidity"] = v if v == 150.0 else round(v + rng.uniform(-1, 1), 1)
    elif name == "wind_spike":
        r["windSpeed"] = round(r["windSpeed"] + rng.uniform(28, 45), 2)
    elif name == "sensor_drift":
        state["drift_ticks"] = state.get("drift_ticks", 0) + 1
        k = state["drift_ticks"]
        r["temperature"] = round(r["temperature"] + 0.35 * k, 2)
        r["humidity"] = round(max(0.0, r["humidity"] - 0.9 * k), 1)
    return r


def reset_state(state: dict) -> None:
    state.pop("drift_ticks", None)
