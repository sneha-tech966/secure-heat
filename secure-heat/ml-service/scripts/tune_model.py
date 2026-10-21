"""Model selection on the VALIDATION split only (the test split is never touched here).
Grid over feature set x max_samples x max_features, 2 seeds each. Selection metric: mean average precision."""
import itertools, json, pathlib, sys
import numpy as np, pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score, precision_recall_fscore_support

ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from app.model import fit_bundle, score_df
from app.preprocessing import FEATURE_SETS

def main():
    train = pd.read_csv(ROOT / "data" / "train.csv", parse_dates=["timestamp"])
    val = pd.read_csv(ROOT / "data" / "val.csv", parse_dates=["timestamp"]); y = val["is_anomaly"].values
    rows = []
    for fs, ms, mf in itertools.product(FEATURE_SETS, [256, 1024, 4096, 8640], [1.0, 0.6]):
        res = []
        for seed in (1, 2):
            b = fit_bundle(train, dict(feature_set=fs, max_samples=ms, max_features=mf, seed=seed))
            raw, _ = score_df(b, val); pred = raw >= b["flag_threshold_raw"]
            p, r, f, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
            res.append((average_precision_score(y, raw), roc_auc_score(y, raw), p, r, f))
        m = np.mean(res, axis=0)
        rows.append(dict(feature_set=fs, max_samples=ms, max_features=mf, val_ap=m[0], val_auc=m[1],
                         val_precision=m[2], val_recall=m[3], val_f1=m[4]))
        print(rows[-1])
    rows.sort(key=lambda r: -r["val_ap"])
    (ROOT / "models").mkdir(exist_ok=True)
    (ROOT / "models" / "tuning_log.json").write_text(json.dumps(rows, indent=2))
    best = {k: rows[0][k] for k in ("feature_set", "max_samples", "max_features")}
    (ROOT / "models" / "best_config.json").write_text(json.dumps(best, indent=2))
    print("\nBEST (by validation AP):", rows[0])

if __name__ == "__main__":
    main()
