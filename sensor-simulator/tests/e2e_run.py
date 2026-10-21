"""End-to-end scenario run: Python simulator -> real TS ingestion pipeline -> real ML model.
Assumes the harness (:4000) and ML shim (:8000) are running and share the credentials file given as argv[1]."""
import json, sys, time, urllib.request
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import simulator as S

BASE = "http://127.0.0.1:4000"
state = lambda: json.load(urllib.request.urlopen(BASE + "/__state"))
creds = Path(sys.argv[1]); sim = S.Simulator(creds, BASE, 1, state_path=Path("/tmp/e2e_state.json"), verbose=False)
fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"   [{detail}]" if detail and not cond else "")); (None if cond else fails.append(name))
def phase(name, target, ticks, scenario):
    s0 = state(); n0, e0 = len(s0["telemetry"]), len(s0["events"])
    sim.set_scenario(scenario, target); [sim.tick() or time.sleep(0.05) for _ in range(ticks)]
    s1 = state(); return s1["telemetry"][n0:], s1["events"][e0:], sim.log

# warm-up: normal operation, 25 ticks x 5 sensors
tel, ev, _ = phase("normal", None, 25, "normal")
dec = Counter(t["decision"] for t in tel)
print("normal phase decisions:", dict(dec), "| events:", dict(Counter(e["type"] for e in ev)))
check("normal operation is mostly ACCEPT (>=90%)", dec["ACCEPT"] / len(tel) >= 0.9, str(dict(dec)))

tel, ev, _ = phase("temp spoof", "WS-002", 6, "temperature_spoof")
t2 = [t for t in tel if t["sensorId"] == "WS-002"]; others = [t for t in tel if t["sensorId"] != "WS-002"]
print("temperature_spoof WS-002:", dict(Counter(t["decision"] for t in t2)), "| others:", dict(Counter(t["decision"] for t in others)))
check("spoofed temperatures are never ACCEPTed", all(t["decision"] != "ACCEPT" for t in t2))
check("spoof is flagged/quarantined and raises security events", len(ev) >= 1 and any(e["type"] in ("ANOMALOUS_TELEMETRY", "RULE_VIOLATION") for e in ev))

tel, ev, _ = phase("humidity", "WS-003", 8, "humidity_manipulation")
t3 = [t for t in tel if t["sensorId"] == "WS-003"]
print("humidity_manipulation WS-003:", dict(Counter(t["decision"] for t in t3)), "| events:", dict(Counter(e["type"] for e in ev)))
check("manipulated humidity is never ACCEPTed", all(t["decision"] != "ACCEPT" for t in t3))

tel, ev, _ = phase("wind", "WS-004", 5, "wind_spike")
t4 = [t for t in tel if t["sensorId"] == "WS-004"]
print("wind_spike WS-004:", dict(Counter(t["decision"] for t in t4)))
check("wind spikes are never ACCEPTed", all(t["decision"] != "ACCEPT" for t in t4))

sim.set_scenario("normal"); [sim.tick() for _ in range(3)]          # make sure each sensor has a captured request to replay
n_before = len(state()["telemetry"])
tel, ev, log = phase("replay", "WS-001", 4, "replay_attack")
replays = [e for e in ev if e["type"] == "REPLAY_ATTACK" and e["sensorId"] == "WS-001"]
print("replay_attack WS-001: http", dict(Counter(x["http"] for x in list(log)[-20:] if x["scenario"] == "replay_attack")), "| replay events:", len(replays))
check("replayed requests raise REPLAY_ATTACK (409) and nothing new is stored for the replayed sensor",
      len(replays) >= 3 and not [t for t in tel if t["sensorId"] == "WS-001"])

tel, ev, log = phase("forged", "WS-005", 4, "forged_signature")
bad = [e for e in ev if e["type"] == "INVALID_SIGNATURE" and e["sensorId"] == "WS-005"]
check("forged signatures raise INVALID_SIGNATURE and store nothing for that sensor", len(bad) == 4 and not [t for t in tel if t["sensorId"] == "WS-005"])

sim.set_scenario("normal"); sim.tick()
tel, ev, _ = phase("drift", "WS-001", 25, "sensor_drift")
d1 = [t["decision"] for t in tel if t["sensorId"] == "WS-001"]
print("sensor_drift WS-001 decisions over time:", "".join({"ACCEPT": "." , "FLAG": "f", "QUARANTINE": "Q", "REJECT": "R"}[x] for x in d1))
check("drift is eventually caught (>=1 non-ACCEPT in the last 10 readings)", any(x != "ACCEPT" for x in d1[-10:]))

final = state(); status = {t["id"]: t for t in final["telemetry"]}
check("forecasting hand-off received ONLY accepted telemetry", all(status[i]["decision"] == "ACCEPT" and status[i]["status"] == "FORWARDED" for i in final["forwarded"]), "")
check("no quarantined/flagged/rejected telemetry was ever forwarded", not any(t["id"] in set(final["forwarded"]) for t in final["telemetry"] if t["decision"] != "ACCEPT"))
check("responses to sensors never contained anomaly scores", not any("anomaly" in json.dumps(x).lower() for x in sim.log))
print(f"\ntotals: {len(final['telemetry'])} stored, {len(final['forwarded'])} forwarded, {len(final['events'])} events:", dict(Counter(e['type'] for e in final['events'])))
print("RESULT:", "ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
