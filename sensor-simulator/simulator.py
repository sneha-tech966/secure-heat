#!/usr/bin/env python3
"""Secure-Heat IoT weather-station simulator.

Every reading is HMAC-signed and POSTed to the REAL ingestion API (/api/telemetry/ingest). The simulator never writes
to the database. Credentials come from the gitignored credentials.json produced by `npm run seed`.

  python simulator.py run   --interval 5 --duration 120 --scenario temperature_spoof --target WS-002
  python simulator.py serve --control-port 5055      # idle; start/stop/scenario via the control API (used by the dashboard)

Control API (127.0.0.1 only unless --control-host is set; X-Control-Token required when SIM_CONTROL_TOKEN is set):
  GET /status   GET /log?limit=100   POST /start   POST /stop   POST /scenario {"scenario","target","ticks","rate"}
"""
from __future__ import annotations
import argparse, collections, hashlib, hmac, json, math, os, random, secrets, sys, threading, time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

import scenarios as sc

HERE = Path(__file__).resolve().parent
# per-station climate, identical to the training dataset's stations (base temp, diurnal amplitude, base pressure)
CLIMATE = {"WS-001": (24, 3, 1012), "WS-002": (21, 4, 1009), "WS-003": (27, 2, 1014), "WS-004": (18, 5, 1005), "WS-005": (25, 3, 1011)}
MAX_SEQ = 2_147_483_647


def canonical(sensor_id: str, timestamp: str, seq: int, raw: bytes) -> str:
    """Must match backend/src/utils/crypto.ts canonicalString()."""
    return "\n".join(["v1", sensor_id, timestamp, str(seq), hashlib.sha256(raw).hexdigest()])


def sign(secret: str, sensor_id: str, timestamp: str, seq: int, raw: bytes) -> str:
    return hmac.new(secret.encode(), canonical(sensor_id, timestamp, seq, raw).encode(), hashlib.sha256).hexdigest()


def utc_iso(t: float | None = None) -> str:
    return datetime.fromtimestamp(t if t is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Station:
    def __init__(self, sensor_id: str, api_key: str, secret: str, seed: int):
        self.id, self.api_key, self.secret = sensor_id, api_key, secret
        base_t, amp, base_p = CLIMATE.get(sensor_id, (22, 3, 1010))
        self.base_t, self.amp, self.base_p = base_t, amp, base_p
        self.rng = random.Random(seed)
        self.noise = {"t": 0.0, "h": 0.0, "p": 0.0, "w": 0.0, "dir": self.rng.uniform(0, 360)}
        self.scratch: dict = {}
        self.seq = 0
        self.last_sent: tuple[bytes, dict] | None = None

    def reading(self, now: float) -> dict:
        d = datetime.fromtimestamp(now, timezone.utc); hr = d.hour + d.minute / 60 + d.second / 3600
        day = math.sin((hr - 9) / 24 * 2 * math.pi); n = self.noise; g = self.rng.gauss
        n["t"] = 0.9 * n["t"] + g(0, 0.12); n["h"] = 0.9 * n["h"] + g(0, 0.5); n["p"] = 0.95 * n["p"] + g(0, 0.08); n["w"] = 0.85 * n["w"] + g(0, 0.4)
        n["dir"] = (n["dir"] + g(0, 3)) % 360
        t = self.base_t + self.amp * 2 * day + n["t"]
        solar = max(0.0, 900 * math.sin((hr - 6) / 12 * math.pi)) * (0.7 + 0.15 * self.rng.random()) if 6 < hr < 18 else 0.0
        return {
            "temperature": round(t, 2), "humidity": round(min(99.0, max(15.0, 65 - 3 * (t - self.base_t) + n["h"])), 1),
            "pressure": round(self.base_p + 1.2 * math.sin(hr / 12 * 2 * math.pi) + n["p"], 2),
            "windSpeed": round(max(0.0, 4 + 2.5 * max(day, 0) + n["w"]), 2), "windDirection": round(n["dir"]),
            "rainfall": round(self.rng.random() * 1.5, 2) if self.rng.random() < 0.02 else 0.0, "solarRadiation": round(solar),
        }


class Simulator:
    def __init__(self, creds_path: Path, backend_url: str, interval: float, sensors: list[str] | None = None, timeout: float = 5.0,
                 state_path: Path | None = None, seed: int = 7, session=None, verbose: bool = True):
        creds = json.loads(Path(creds_path).read_text())
        ids = sensors or sorted(creds)
        missing = [s for s in ids if s not in creds]
        if missing: raise SystemExit(f"no credentials for {missing}; run `npm run seed` in backend/")
        self.url = backend_url.rstrip("/") + "/api/telemetry/ingest"
        self.interval, self.timeout, self.verbose = interval, timeout, verbose
        self.http = session or requests.Session()
        self.state_path = Path(state_path) if state_path else HERE / ".sim_state.json"
        saved = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        self.stations = {s: Station(s, creds[s]["apiKey"], creds[s]["secret"], seed + i) for i, s in enumerate(ids)}
        for s in self.stations.values():   # sequence numbers must never repeat across restarts: seconds-since-epoch fits INT until 2038
            s.seq = max(int(saved.get(s.id, 0)), int(time.time()))
        self.lock = threading.Lock(); self.stop_evt = threading.Event(); self.thread: threading.Thread | None = None
        self.scenario, self.target, self.ticks_left, self.rate = "normal", None, 0, 1.0
        self.log: collections.deque = collections.deque(maxlen=1000)
        self.stats: collections.Counter = collections.Counter(); self.rng = random.Random(seed)

    # ---- control ----
    @property
    def running(self) -> bool: return bool(self.thread and self.thread.is_alive())

    def start(self):
        with self.lock:
            if self.running: return
            self.stop_evt.clear(); self.thread = threading.Thread(target=self._loop, daemon=True); self.thread.start()

    def stop(self):
        self.stop_evt.set()
        if self.thread: self.thread.join(timeout=self.interval + self.timeout + 2)

    def set_scenario(self, name: str, target: str | None = None, ticks: int = 0, rate: float = 1.0):
        if name not in sc.SCENARIOS: raise ValueError(f"unknown scenario: {name}")
        if target and target not in self.stations: raise ValueError(f"unknown sensor: {target}")
        if not 0 < rate <= 1: raise ValueError("rate must be in (0, 1]")
        with self.lock:
            self.scenario, self.target, self.ticks_left, self.rate = name, target, max(0, int(ticks)), float(rate)
            for s in self.stations.values(): sc.reset_state(s.scratch)

    def status(self) -> dict:
        with self.lock:
            return {"running": self.running, "scenario": self.scenario, "target": self.target, "ticksLeft": self.ticks_left, "rate": self.rate,
                    "sensors": sorted(self.stations), "stats": dict(self.stats), "interval": self.interval, "scenarios": sc.SCENARIOS}

    # ---- sending ----
    def _post(self, st: Station, raw: bytes, headers: dict, label: str, shown: dict) -> dict:
        entry = {"time": utc_iso(), "sensorId": st.id, "sequence": shown.get("sequenceNumber"), "scenario": label, "reading": {k: shown.get(k) for k in sc_fields()}}
        try:
            r = self.http.post(self.url, data=raw, headers=headers, timeout=self.timeout)
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            entry.update(http=r.status_code, decision=body.get("decision"), status=body.get("status"), code=body.get("code"))
        except requests.RequestException as e:
            entry.update(http=None, decision=None, status="NETWORK_ERROR", code=type(e).__name__)
        with self.lock:
            self.log.append(entry); self.stats[f"http_{entry['http']}"] += 1; self.stats[f"label_{label}"] += 1
            if entry.get("decision"): self.stats[entry["decision"]] += 1
        if self.verbose:
            r_ = entry["reading"]
            print(f"{entry['time'][11:19]} {st.id} seq={entry['sequence']} {label:<21} T={r_['temperature']} H={r_['humidity']} W={r_['windSpeed']} -> "
                  f"{entry['http']} {entry.get('decision') or entry.get('code') or ''}", flush=True)
        return entry

    def _build(self, st: Station, reading: dict, signing_secret: str | None = None) -> tuple[bytes, dict, dict]:
        st.seq += 1; ts = utc_iso()
        body = {"sensorId": st.id, "timestamp": ts, "sequenceNumber": st.seq, **reading}
        raw = json.dumps(body, separators=(",", ":")).encode()          # the exact bytes sent are the exact bytes signed
        headers = {"Content-Type": "application/json", "X-API-Key": st.api_key, "X-Signature": sign(signing_secret or st.secret, st.id, ts, st.seq, raw)}
        return raw, headers, body

    def tick(self):
        now = time.time()
        with self.lock: name, target, rate = self.scenario, self.target, self.rate
        for st in self.stations.values():
            active = name != "normal" and (target is None or target == st.id) and self.rng.random() < rate
            reading = st.reading(now)
            if active and name in sc.TRANSPORT:
                if name == "replay_attack" and st.last_sent:
                    raw, headers = st.last_sent; shown = json.loads(raw)       # verbatim re-send of a captured request
                    self._post(st, raw, headers, name, shown); continue
                if name == "forged_signature":
                    raw, headers, body = self._build(st, reading, signing_secret=secrets.token_hex(32))
                    self._post(st, raw, headers, name, body); continue
            label = "normal"
            if active and name not in sc.TRANSPORT:
                reading = sc.mutate(name, reading, st.scratch, self.rng); label = name
            raw, headers, body = self._build(st, reading)
            st.last_sent = (raw, headers)
            self._post(st, raw, headers, label, body)
        self._save_state()
        with self.lock:
            if self.ticks_left > 0:
                self.ticks_left -= 1
                if self.ticks_left == 0:                                      # auto-revert to normal when an attack window ends
                    self.scenario, self.target = "normal", None
                    for s in self.stations.values(): sc.reset_state(s.scratch)

    def _save_state(self):
        try: self.state_path.write_text(json.dumps({s.id: s.seq for s in self.stations.values()}))
        except OSError: pass

    def _loop(self):
        while not self.stop_evt.is_set():
            t0 = time.time(); self.tick()
            self.stop_evt.wait(max(0.0, self.interval - (time.time() - t0)))


def sc_fields(): return ("temperature", "humidity", "pressure", "windSpeed", "windDirection", "rainfall", "solarRadiation")


def serve_control(sim: Simulator, host: str, port: int, token: str | None):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
        def _auth(self) -> bool:
            if token and not hmac.compare_digest(self.headers.get("X-Control-Token", ""), token): self._send(401, {"error": "invalid control token"}); return False
            return True
        def do_GET(self):
            if not self._auth(): return
            u = urlparse(self.path)
            if u.path == "/status": return self._send(200, sim.status())
            if u.path == "/log":
                n = min(int(parse_qs(u.query).get("limit", ["100"])[0]), 1000)
                with sim.lock: return self._send(200, {"entries": list(sim.log)[-n:]})
            self._send(404, {"error": "not found"})
        def do_POST(self):
            if not self._auth(): return
            try:
                n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}") if n < 4096 else {}
                if self.path == "/start": sim.start()
                elif self.path == "/stop": sim.stop()
                elif self.path == "/scenario": sim.set_scenario(str(body.get("scenario", "normal")), body.get("target"), int(body.get("ticks", 0)), float(body.get("rate", 1.0)))
                else: return self._send(404, {"error": "not found"})
                self._send(200, sim.status())
            except (ValueError, json.JSONDecodeError) as e: self._send(400, {"error": str(e)})
    srv = ThreadingHTTPServer((host, port), H); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["run", "serve"])
    ap.add_argument("--backend", default=os.getenv("BACKEND_URL", "http://localhost:4000"))
    ap.add_argument("--credentials", default=os.getenv("SENSOR_CREDENTIALS_PATH", str(HERE / "credentials.json")))
    ap.add_argument("--interval", type=float, default=5.0); ap.add_argument("--duration", type=float, default=0, help="seconds (0 = until Ctrl-C)")
    ap.add_argument("--sensors", nargs="*"); ap.add_argument("--scenario", default="normal", choices=sorted(sc.SCENARIOS))
    ap.add_argument("--target"); ap.add_argument("--ticks", type=int, default=0, help="attack window length in ticks (0 = until stopped)")
    ap.add_argument("--rate", type=float, default=1.0, help="probability a targeted reading is manipulated")
    ap.add_argument("--control-host", default="127.0.0.1"); ap.add_argument("--control-port", type=int, default=0)
    a = ap.parse_args(argv)
    sim = Simulator(Path(a.credentials), a.backend, a.interval, a.sensors)
    sim.set_scenario(a.scenario, a.target, a.ticks, a.rate)
    token = os.getenv("SIM_CONTROL_TOKEN") or None
    if a.control_port:
        if a.control_host != "127.0.0.1" and not token: raise SystemExit("SIM_CONTROL_TOKEN is required when the control API is exposed beyond loopback")
        serve_control(sim, a.control_host, a.control_port, token); print(f"control API on {a.control_host}:{a.control_port}", flush=True)
    if a.mode == "run": sim.start()
    try:
        t0 = time.time()
        while a.mode == "serve" or (a.duration == 0 or time.time() - t0 < a.duration):
            time.sleep(0.2)
    except KeyboardInterrupt: pass
    finally: sim.stop()
    print("stats:", dict(sim.stats))


if __name__ == "__main__":
    main()
