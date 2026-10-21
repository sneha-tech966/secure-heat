"""Train the final Isolation Forest (offline) and save the joblib bundle the API loads at startup.
Uses models/best_config.json (from tune_model.py) if present, else DEFAULT_CFG."""
import json, pathlib, sys
import joblib, pandas as pd
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from app.model import fit_bundle

def main():
    train = pd.read_csv(ROOT / "data" / "train.csv", parse_dates=["timestamp"])
    assert train["is_anomaly"].sum() == 0, "training split must be anomaly-free"
    cfgp = ROOT / "models" / "best_config.json"
    cfg = json.loads(cfgp.read_text()) if cfgp.exists() else {}
    b = fit_bundle(train, cfg, json.loads((ROOT / "data" / "dataset_meta.json").read_text())["version"])
    (ROOT / "models").mkdir(exist_ok=True)
    joblib.dump(b, ROOT / "models" / "isolation_forest.joblib")
    print(f"config={b['config']} fit_rows={b['fit_rows']} calibration_rows={b['calibration_rows']} "
          f"flag_raw>={b['flag_threshold_raw']:.4f} quarantine_raw>={b['quarantine_threshold_raw']:.4f}")

if __name__ == "__main__":
    main()
