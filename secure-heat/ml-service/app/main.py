"""Secure-Heat ML microservice. Model is trained offline and loaded ONCE at startup (never per request)."""
from __future__ import annotations
import hmac
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException

from .anomaly_detector import AnomalyDetector, ModelNotLoaded
from .model import fit_bundle
from .schemas import HealthResponse, PredictRequest, PredictResponse, TrainResponse

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT / "models" / "isolation_forest.joblib"))
METRICS_PATH = Path(os.getenv("METRICS_PATH", ROOT / "models" / "metrics.json"))
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
INTERNAL_TOKEN = os.getenv("ML_INTERNAL_TOKEN", "")          # shared secret with the backend; empty = auth disabled (dev only)
_train_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.detector = AnomalyDetector(MODEL_PATH, float(os.getenv("FLAG_THRESHOLD", 0.99)),
                                         float(os.getenv("QUARANTINE_THRESHOLD", 0.999)))
    yield


app = FastAPI(title="Secure-Heat ML Service", version="1.0.0", lifespan=lifespan)


def require_internal(x_internal_token: str | None = Header(default=None)):
    if INTERNAL_TOKEN and not hmac.compare_digest(x_internal_token or "", INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.get("/health", response_model=HealthResponse)
def health():
    d: AnomalyDetector = app.state.detector
    if not d.loaded:
        return HealthResponse(status="degraded", model_loaded=False, detail=d.error)
    return HealthResponse(status="ok", model_loaded=True, dataset_version=d.bundle["dataset_version"],
                          trained_at=d.bundle["trained_at"])


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(require_internal)])
def predict(req: PredictRequest):
    d: AnomalyDetector = app.state.detector
    body = req.model_dump(exclude={"sensor_id", "timestamp"})
    try:
        return d.predict(req.sensor_id, body, req.timestamp)
    except ModelNotLoaded:
        raise HTTPException(status_code=503, detail="model_not_loaded")      # backend applies its fail-safe policy
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/train", response_model=TrainResponse, dependencies=[Depends(require_internal)])
def train():
    """Retrain from data/train.csv (offline-style job; blocks until done). One training at a time."""
    train_csv = DATA_DIR / "train.csv"
    if not train_csv.exists():
        raise HTTPException(status_code=409, detail="training data missing; run scripts/generate_dataset.py")
    if not _train_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="training already in progress")
    try:
        df = pd.read_csv(train_csv, parse_dates=["timestamp"])
        if df["is_anomaly"].sum() != 0:
            raise HTTPException(status_code=422, detail="training data must be anomaly-free")
        meta = json.loads((DATA_DIR / "dataset_meta.json").read_text()) if (DATA_DIR / "dataset_meta.json").exists() else {}
        cfg_path = MODEL_PATH.parent / "best_config.json"
        b = fit_bundle(df, json.loads(cfg_path.read_text()) if cfg_path.exists() else {}, meta.get("version", "unknown"))
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(b, MODEL_PATH)
        app.state.detector.load()
        return TrainResponse(status="trained", dataset_version=b["dataset_version"], trained_at=b["trained_at"],
                             fit_rows=b["fit_rows"], calibration_rows=b["calibration_rows"])
    finally:
        _train_lock.release()


@app.get("/metrics")
def metrics():
    """Evaluation metrics written by scripts/evaluate_model.py (held-out synthetic test split)."""
    if not METRICS_PATH.exists():
        raise HTTPException(status_code=404, detail="metrics not available; run scripts/evaluate_model.py")
    return json.loads(METRICS_PATH.read_text())
