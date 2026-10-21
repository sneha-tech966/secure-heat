"""Evaluate the saved model ONCE on the held-out synthetic TEST split; writes models/metrics.json."""
import json, pathlib, sys
import joblib, numpy as np, pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_fscore_support, roc_auc_score

ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from app.model import event_ids, score_df
from app.preprocessing import build_features


def main():
    b = joblib.load(ROOT / "models" / "isolation_forest.joblib")
    test = pd.read_csv(ROOT / "data" / "test.csv", parse_dates=["timestamp"]); y = test["is_anomaly"].values
    X = build_features(test, b["baselines"], b["features"]); raw, pct = score_df(b, test, X)
    out = dict(model="IsolationForest", config=b["config"], features=b["features"], trained_at=b["trained_at"],
               dataset_version=b["dataset_version"], synthetic_data=True, fit_rows=b["fit_rows"],
               calibration_rows=b["calibration_rows"], test_rows=len(test), test_anomaly_rows=int(y.sum()),
               roc_auc=float(roc_auc_score(y, raw)), average_precision=float(average_precision_score(y, raw)), operating_points={})
    for name, thr in [("flag", b["flag_threshold_raw"]), ("quarantine", b["quarantine_threshold_raw"])]:
        pred = (raw >= thr).astype(int)
        p, r, f, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
        out["operating_points"][name] = dict(threshold_raw=thr, precision=float(p), recall=float(r), f1=float(f),
                                             confusion=dict(tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp)))
    pred = raw >= b["flag_threshold_raw"]; ev = event_ids(test).values; types = test["anomaly_type"].values
    out["by_type"] = {}
    for t in sorted(set(types) - {"normal"}):
        m = types == t; ids = np.unique(ev[m])
        out["by_type"][t] = dict(rows=int(m.sum()), rows_detected=int(pred[m].sum()), events=len(ids),
                                 events_detected=int(sum(pred[ev == i].any() for i in ids)))
    rng = np.random.default_rng(0); base = out["average_precision"]; imp = {}
    for f in b["features"]:                       # permutation importance: AP drop when one feature is shuffled
        drops = []
        for _ in range(5):
            Xp = X.copy(); Xp[f] = rng.permutation(Xp[f].values); drops.append(base - average_precision_score(y, score_df(b, test, Xp)[0]))
        imp[f] = float(np.mean(drops))
    out["permutation_importance"] = dict(sorted(imp.items(), key=lambda kv: -kv[1]))
    (ROOT / "models" / "metrics.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k not in ("permutation_importance", "features")}, indent=1))
    print("importance:", {k: round(v, 3) for k, v in out["permutation_importance"].items()})


if __name__ == "__main__":
    main()
