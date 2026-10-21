"""TEST SHIM ONLY: serves the real AnomalyDetector over HTTP using the standard library, mirroring POST /predict of the
FastAPI app. Used to run end-to-end tests in environments where FastAPI cannot be installed. Not used in production."""
import json, pathlib, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from app.anomaly_detector import AnomalyDetector

det = AnomalyDetector(ROOT / "models" / "isolation_forest.joblib")
FIELDS = ["temperature", "humidity", "pressure", "wind_speed", "wind_direction", "rainfall", "solar_radiation"]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self._send(200, {"status": "ok" if det.loaded else "degraded", "model_loaded": det.loaded})
    def do_POST(self):
        if self.path != "/predict": return self._send(404, {"detail": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self._send(200, det.predict(body["sensor_id"], {f: body.get(f) for f in FIELDS}, body.get("timestamp")))
        except (KeyError, ValueError, json.JSONDecodeError) as e: self._send(422, {"detail": str(e)})
        except Exception as e: self._send(503, {"detail": type(e).__name__})

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8000), H).serve_forever()
