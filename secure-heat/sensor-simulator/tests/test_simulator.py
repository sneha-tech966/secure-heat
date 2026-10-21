import json, sys, tempfile, threading, unittest, hashlib, random
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import simulator as S, scenarios as sc


class Capture(BaseHTTPRequestHandler):
    seen = []
    def log_message(self, *a): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        Capture.seen.append((raw, dict(self.headers)))
        b = json.dumps({"status": "FORWARDED", "decision": "ACCEPT"}).encode()
        self.send_response(201); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)


def make_sim(tmp, ids=("WS-001", "WS-002")):
    creds = {i: {"apiKey": f"sh_key_{i}", "secret": (i[-1] * 64)} for i in ids}
    cp = Path(tmp) / "creds.json"; cp.write_text(json.dumps(creds))
    srv = HTTPServer(("127.0.0.1", 0), Capture); threading.Thread(target=srv.serve_forever, daemon=True).start()
    Capture.seen.clear()
    return S.Simulator(cp, f"http://127.0.0.1:{srv.server_port}", 1, state_path=Path(tmp) / "st.json", verbose=False), srv


class SigningTests(unittest.TestCase):
    def test_matches_backend_reference_vector(self):
        """Same vector as backend/tests/crypto.test.ts: Python and Node must agree byte-for-byte."""
        body = b'{"sensorId":"WS-001","timestamp":"2026-10-16T10:00:00Z","sequenceNumber":42,"temperature":21.5}'
        self.assertEqual(hashlib.sha256(body).hexdigest(), "47e2c9ffa751b0370a854bc836f2a6895a954e40e2947a7821f885e499d2d69a")
        self.assertEqual(S.sign("ab" * 32, "WS-001", "2026-10-16T10:00:00Z", 42, body), "d3619991337a5f818d5122240b7bafa96a23eb1f2734a60643358a72928ed202")


class ScenarioTests(unittest.TestCase):
    base = {"temperature": 22.0, "humidity": 60.0, "pressure": 1012.0, "windSpeed": 4.0, "windDirection": 180, "rainfall": 0.0, "solarRadiation": 300}
    def test_each_manipulation_changes_the_intended_field(self):
        rng = random.Random(1)
        self.assertGreater(sc.mutate("temperature_spoof", self.base, {}, rng)["temperature"], 35)
        self.assertGreater(sc.mutate("wind_spike", self.base, {}, rng)["windSpeed"], 30)
        h = {sc.mutate("humidity_manipulation", self.base, {}, rng)["humidity"] for _ in range(40)}
        self.assertTrue(any(v > 100 for v in h) and any(v < 15 or 90 < v <= 100 for v in h))
        self.assertEqual(sc.mutate("normal", self.base, {}, rng), self.base)

    def test_drift_grows_every_tick_and_resets(self):
        st, rng = {}, random.Random(1)
        temps = [sc.mutate("sensor_drift", self.base, st, rng)["temperature"] for _ in range(5)]
        self.assertEqual(temps, sorted(temps)); self.assertGreater(temps[-1] - temps[0], 1.0)
        sc.reset_state(st); self.assertAlmostEqual(sc.mutate("sensor_drift", self.base, st, rng)["temperature"], 22.35, 2)

    def test_mutation_does_not_modify_input(self):
        before = dict(self.base); sc.mutate("temperature_spoof", self.base, {}, random.Random(2)); self.assertEqual(before, self.base)


class SimulatorTests(unittest.TestCase):
    def test_requests_are_signed_over_exact_bytes_and_sequences_increase(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d); sim.tick(); sim.tick(); srv.shutdown()
            self.assertEqual(len(Capture.seen), 4)
            for raw, h in Capture.seen:
                b = json.loads(raw); hdr = {k.lower(): v for k, v in h.items()}
                self.assertEqual(hdr["x-api-key"], f"sh_key_{b['sensorId']}")
                self.assertEqual(hdr["x-signature"], S.sign(b["sensorId"][-1] * 64, b["sensorId"], b["timestamp"], b["sequenceNumber"], raw))
                self.assertNotIn("anomalyScore", b); self.assertNotIn("signature", b)
            seqs = [json.loads(r)["sequenceNumber"] for r, _ in Capture.seen if json.loads(r)["sensorId"] == "WS-001"]
            self.assertEqual(seqs[1], seqs[0] + 1)

    def test_replay_resends_identical_bytes_and_signature(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d, ("WS-001",)); sim.tick()
            sim.set_scenario("replay_attack", "WS-001"); sim.tick(); srv.shutdown()
            (r1, h1), (r2, h2) = Capture.seen
            self.assertEqual(r1, r2); self.assertEqual(h1["X-Signature"], h2["X-Signature"])

    def test_forged_signature_uses_wrong_secret(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d, ("WS-001",)); sim.set_scenario("forged_signature", "WS-001"); sim.tick(); srv.shutdown()
            raw, h = Capture.seen[0]; b = json.loads(raw)
            self.assertNotEqual(h["X-Signature"], S.sign("1" * 64, b["sensorId"], b["timestamp"], b["sequenceNumber"], raw))

    def test_only_target_is_attacked_and_window_auto_reverts(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d); sim.set_scenario("temperature_spoof", "WS-002", ticks=1); sim.tick(); first = list(Capture.seen); sim.tick(); srv.shutdown()
            t = {json.loads(r)["sensorId"]: json.loads(r)["temperature"] for r, _ in first}
            self.assertGreater(t["WS-002"] - t["WS-001"], 8); self.assertEqual(sim.status()["scenario"], "normal")
            t2 = {json.loads(r)["sensorId"]: json.loads(r)["temperature"] for r, _ in Capture.seen[2:]}
            self.assertLess(abs(t2["WS-002"] - t2["WS-001"]), 8)

    def test_sequence_never_goes_backwards_across_restarts(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d, ("WS-001",)); sim.stations["WS-001"].seq += 5000; sim.tick(); last = sim.stations["WS-001"].seq; srv.shutdown()
            sim2, srv2 = make_sim(d, ("WS-001",)); self.assertGreaterEqual(sim2.stations["WS-001"].seq, last); srv2.shutdown()

    def test_unreachable_backend_is_logged_not_fatal(self):
        with tempfile.TemporaryDirectory() as d:
            cp = Path(d) / "c.json"; cp.write_text(json.dumps({"WS-001": {"apiKey": "k", "secret": "s"}}))
            sim = S.Simulator(cp, "http://127.0.0.1:1", 1, state_path=Path(d) / "s.json", timeout=0.5, verbose=False); sim.tick()
            self.assertEqual(sim.log[-1]["status"], "NETWORK_ERROR")

    def test_validation_of_control_inputs(self):
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d); srv.shutdown()
            for args in (("nope",), ("temperature_spoof", "WS-999"), ("temperature_spoof", "WS-001", 0, 0), ("temperature_spoof", "WS-001", 0, 1.5)):
                with self.assertRaises(ValueError): sim.set_scenario(*args)

    def test_control_api_requires_token(self):
        import urllib.request, urllib.error
        with tempfile.TemporaryDirectory() as d:
            sim, srv = make_sim(d); ctl = S.serve_control(sim, "127.0.0.1", 0, "tok"); u = f"http://127.0.0.1:{ctl.server_port}"
            try:
                with self.assertRaises(urllib.error.HTTPError) as c: urllib.request.urlopen(u + "/status")
                self.assertEqual(c.exception.code, 401)
                r = urllib.request.urlopen(urllib.request.Request(u + "/status", headers={"X-Control-Token": "tok"})); self.assertFalse(json.load(r)["running"])
                req = urllib.request.Request(u + "/scenario", data=b'{"scenario":"wind_spike","target":"WS-001","ticks":3}', headers={"X-Control-Token": "tok"}, method="POST")
                self.assertEqual(json.load(urllib.request.urlopen(req))["scenario"], "wind_spike")
            finally: ctl.shutdown(); srv.shutdown()

if __name__ == "__main__":
    unittest.main()
