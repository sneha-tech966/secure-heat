import unittest, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.rules import evaluate_rules

OK = dict(temperature=22.0, humidity=60.0, pressure=1012.0, wind_speed=4.0, wind_direction=180.0, rainfall=0.0, solar_radiation=300.0)
def r(**kw): return {**OK, **kw}
def ids(res): return {x["rule"] for x in res}


class RuleTests(unittest.TestCase):
    def test_normal_reading_triggers_nothing(self):
        self.assertEqual(evaluate_rules(OK, [r(temperature=21.8)]), [])

    def test_humidity_above_100_is_hard_violation(self):
        res = evaluate_rules(r(humidity=150.0), [])
        self.assertEqual(ids(res), {"HUMIDITY_OUT_OF_RANGE"}); self.assertTrue(res[0]["hard"])

    def test_negative_wind_and_extreme_values(self):
        res = evaluate_rules(r(wind_speed=-3.0, pressure=540.0, temperature=85.0), [])
        self.assertEqual(ids(res), {"WIND_SPEED_OUT_OF_RANGE", "PRESSURE_OUT_OF_RANGE", "TEMPERATURE_OUT_OF_RANGE"})

    def test_sudden_change_is_soft(self):
        res = evaluate_rules(r(temperature=40.0), [r(), r(), r()])
        self.assertEqual(ids(res), {"TEMPERATURE_SUDDEN_CHANGE"}); self.assertFalse(res[0]["hard"])

    def test_sudden_change_uses_median_not_last_value(self):
        # one spiked previous reading must not make a normal reading look like a sudden change
        self.assertEqual(evaluate_rules(OK, [r(), r(temperature=45.0), r()]), [])

    def test_repeated_identical_readings(self):
        self.assertIn("REPEATED_IDENTICAL_READINGS", ids(evaluate_rules(OK, [OK, OK])))
        self.assertNotIn("REPEATED_IDENTICAL_READINGS", ids(evaluate_rules(OK, [r(temperature=21.0), OK])))

    def test_no_history_means_no_change_or_repeat_rules(self):
        self.assertEqual(evaluate_rules(OK, []), [])

if __name__ == "__main__":
    unittest.main()
