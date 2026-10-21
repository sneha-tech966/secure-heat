import unittest, pathlib, sys, tempfile
import numpy as np, pandas as pd
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from app.anomaly_detector import AnomalyDetector, ModelNotLoaded
from app.model import score_df
from app.preprocessing import build_features
from app.rules import FIELDS

MODEL = ROOT / "models" / "isolation_forest.joblib"
TS = "2026-02-20 14:00:00"   # afternoon, inside the dataset's date range


class DetectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.det = AnomalyDetector(MODEL)
        cls.test = pd.read_csv(ROOT / "data" / "test.csv", parse_dates=["timestamp"])

    def _normal_window(self):
        """3 normal history rows + the next normal row from the held-out data (WS-001)."""
        d = self.test[(self.test.sensor_id == "WS-001")].reset_index(drop=True)
        for i in range(5, len(d) - 5):
            w = d.iloc[i - 3:i + 1]
            if (w.is_anomaly == 0).all():
                return [dict(r) for _, r in w.iloc[:3].iterrows()], dict(w.iloc[3])
        self.fail("no clean window")

    def test_model_loads(self):
        self.assertTrue(self.det.loaded); self.assertIsNone(self.det.error)

    def test_missing_model_file_is_handled_gracefully(self):
        d = AnomalyDetector(pathlib.Path(tempfile.gettempdir()) / "nope.joblib")
        self.assertFalse(d.loaded); self.assertIn("not found", d.error)
        with self.assertRaises(ModelNotLoaded):
            d.predict("WS-001", {f: 1.0 for f in FIELDS})

    def test_corrupt_model_file_is_handled_gracefully(self):
        p = pathlib.Path(tempfile.mkdtemp()) / "bad.joblib"; p.write_bytes(b"not a model")
        self.assertFalse(AnomalyDetector(p).loaded)

    def test_normal_reading_predicts_normal(self):
        h, cur = self._normal_window()
        out = self.det.predict("WS-001", {f: cur[f] for f in FIELDS}, cur["timestamp"], history=h)
        self.assertEqual(out["prediction"], "NORMAL"); self.assertEqual(out["rules_triggered"], [])
        self.assertFalse(out["hard_rule_violation"])

    def test_temperature_spike_is_anomaly_with_explanation(self):
        h, cur = self._normal_window(); rd = {f: cur[f] for f in FIELDS}; rd["temperature"] += 20
        out = self.det.predict("WS-001", rd, cur["timestamp"], history=h)
        self.assertEqual(out["prediction"], "ANOMALY"); self.assertIn("temperature", out["explanation"])
        self.assertIn("TEMPERATURE_SUDDEN_CHANGE", out["rules_triggered"])
        self.assertFalse(out["hard_rule_violation"])      # spike is possible physically -> not "impossible"

    def test_impossible_humidity_flags_hard_violation(self):
        h, cur = self._normal_window(); rd = {f: cur[f] for f in FIELDS}; rd["humidity"] = 150
        out = self.det.predict("WS-001", rd, cur["timestamp"], history=h)
        self.assertTrue(out["hard_rule_violation"]); self.assertIn("HUMIDITY_OUT_OF_RANGE", out["rules_triggered"])

    def test_unusual_but_possible_storm_is_not_a_hard_violation(self):
        """Scenario 6: severe-but-real weather may be statistically unusual, yet carries no integrity evidence."""
        h, cur = self._normal_window()
        storm = dict(temperature=cur["temperature"] - 4, humidity=96, pressure=cur["pressure"] - 6,
                     wind_speed=16, wind_direction=250, rainfall=8, solar_radiation=60)
        out = self.det.predict("WS-001", storm, cur["timestamp"], history=h)
        self.assertFalse(out["hard_rule_violation"])
        self.assertEqual(out["prediction"] in ("NORMAL", "ANOMALY"), True)
        if out["prediction"] == "ANOMALY":                 # if the model does flag it, it must say it is not proof of tampering
            self.assertIn("not by itself evidence of tampering", out["explanation"])

    def test_invalid_input_rejected(self):
        for bad in ({f: 1.0 for f in FIELDS if f != "humidity"},
                    {**{f: 1.0 for f in FIELDS}, "temperature": float("nan")},
                    {**{f: 1.0 for f in FIELDS}, "pressure": "abc"},
                    {**{f: 1.0 for f in FIELDS}, "wind_speed": None}):
            with self.assertRaises(ValueError):
                self.det.predict("WS-001", bad)

    def test_single_reading_path_matches_batch_scoring(self):
        """Feature path used by the API must equal the batch path used in training/evaluation."""
        d = self.test[self.test.sensor_id == "WS-002"].reset_index(drop=True).iloc[:60]
        batch_raw, _ = score_df(self.det.bundle, d)
        diffs = []
        for i in range(10, 40):
            h = [dict(r) for _, r in d.iloc[i - 3:i].iterrows()]; cur = d.iloc[i]
            out = self.det.predict("WS-002", {f: cur[f] for f in FIELDS}, cur["timestamp"], history=h)
            diffs.append(abs(out["raw_score"] - batch_raw[i]))
        self.assertLess(max(diffs), 1e-3)

    def test_clean_false_positive_rate_is_low(self):
        """On unseen clean data the flag rate should stay near the calibrated ~1% (allow generous slack)."""
        d = self.test[self.test.is_anomaly == 0]; X = build_features(self.test, self.det.bundle["baselines"], self.det.bundle["features"])
        raw = -self.det.bundle["model"].score_samples(X.loc[d.index].values)
        self.assertLess((raw >= self.det.bundle["flag_raw"]).mean(), 0.05)

    def test_state_isolated_per_sensor_and_updates(self):
        det = AnomalyDetector(MODEL); h, cur = self._normal_window(); rd = {f: cur[f] for f in FIELDS}
        det.predict("WS-001", rd, cur["timestamp"]); det.predict("WS-001", rd, cur["timestamp"])
        out = det.predict("WS-001", rd, cur["timestamp"])
        self.assertIn("REPEATED_IDENTICAL_READINGS", out["rules_triggered"])       # third identical reading
        self.assertNotIn("REPEATED_IDENTICAL_READINGS", det.predict("WS-003", rd, cur["timestamp"])["rules_triggered"])


class StatefulReplayTests(unittest.TestCase):
    """Regression tests for the observed lock-out bug: after an anomaly the sensor must recover."""
    @classmethod
    def setUpClass(cls):
        cls.test = pd.read_csv(ROOT / "data" / "test.csv", parse_dates=["timestamp"])

    def _replay(self, mutate, n=40):
        d = self.test[(self.test.sensor_id == "WS-004")].reset_index(drop=True)
        i0 = next(i for i in range(0, len(d) - n) if (d.iloc[i:i + n].is_anomaly == 0).all())
        w = d.iloc[i0:i0 + n].copy().reset_index(drop=True); mutate(w)
        det = AnomalyDetector(MODEL)
        return [det.predict("WS-004", {f: r[f] for f in FIELDS}, r.timestamp)["prediction"] for _, r in w.iterrows()]

    def test_recovers_after_short_spike(self):
        def m(w): w.loc[15:17, "temperature"] += 20
        out = self._replay(m)
        self.assertEqual(out[15], "ANOMALY")
        self.assertLessEqual(out[20:].count("ANOMALY"), 2)

    def test_recovers_after_long_sensor_drift(self):
        def m(w): w.loc[10:29, "temperature"] += np.linspace(0, 14, 20)
        out = self._replay(m)
        self.assertGreater(out[20:30].count("ANOMALY"), 0)                 # drift is noticed
        self.assertLessEqual(out[34:].count("ANOMALY"), 2)                 # and no permanent lock-out afterwards


if __name__ == "__main__":
    unittest.main()
