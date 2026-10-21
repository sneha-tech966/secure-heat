import test from 'node:test'; import assert from 'node:assert/strict';
import { decide } from '../src/services/decisionEngine.js';
import type { MlResult, RuleDetail } from '../src/types.js';
import { CONFIG } from './helpers.js';

const ml = (score: number, rules: RuleDetail[] = []): MlResult => ({ anomalyScore: score, prediction: score >= 0.99 ? 'ANOMALY' : 'NORMAL', mlSeverity: 'NONE', rulesTriggered: rules.map((r) => r.rule), ruleDetails: rules, hardRuleViolation: false, explanation: 'x' });
const soft = (category = 'change'): RuleDetail => ({ rule: category === 'repeat' ? 'REPEATED_IDENTICAL_READINGS' : 'TEMPERATURE_SUDDEN_CHANGE', category, severity: 'MEDIUM', hard: false, message: 'm' });
const hard: RuleDetail = { rule: 'HUMIDITY_OUT_OF_RANGE', category: 'range', severity: 'HIGH', hard: true, message: 'h' };
const run = (o: any) => decide({ hardRules: [], ml: null, cfg: CONFIG, ...o });

test('normal -> ACCEPT, no event', () => { const d = run({ ml: ml(0.4) }); assert.equal(d.decision, 'ACCEPT'); assert.equal(d.eventType, null); assert.equal(d.processingStatus, 'AUTHENTICATED'); });
test('moderate anomaly -> FLAG held out of trusted stream, LOW severity, not labelled an attack', () => {
  const d = run({ ml: ml(0.992) }); assert.equal(d.decision, 'FLAG'); assert.equal(d.processingStatus, 'QUARANTINED'); assert.equal(d.severity, 'LOW'); assert.equal(d.eventType, 'ANOMALOUS_TELEMETRY');
});
test('strong anomaly -> QUARANTINE (HIGH); corroborated by a soft rule -> CRITICAL', () => {
  assert.equal(run({ ml: ml(0.9995) }).severity, 'HIGH'); assert.equal(run({ ml: ml(0.9995, [soft()]) }).severity, 'CRITICAL');
  assert.equal(run({ ml: ml(0.9995) }).decision, 'QUARANTINE');
});
test('soft rule alone -> FLAG; repeated readings get their own event type', () => {
  assert.equal(run({ ml: ml(0.2, [soft()]) }).decision, 'FLAG');
  assert.equal(run({ ml: ml(0.2, [soft('repeat')]) }).eventType, 'REPEATED_READINGS');
});
test('hard (impossible) rule wins over a clean ML score; action is configurable', () => {
  assert.equal(run({ hardRules: [hard], ml: ml(0.1) }).decision, 'QUARANTINE');
  assert.equal(run({ hardRules: [hard], cfg: { ...CONFIG, rangeViolationAction: 'reject' } }).decision, 'REJECT');
  assert.equal(run({ hardRules: [hard] }).eventType, 'RULE_VIOLATION');
});
test('ML outage never yields ACCEPT: fail-safe quarantine (default) or reject', () => {
  const q = run({ mlError: 'timeout' }); assert.equal(q.decision, 'QUARANTINE'); assert.equal(q.eventType, 'ML_SERVICE_FAILURE');
  assert.equal(run({ mlError: 'x', cfg: { ...CONFIG, mlFailMode: 'reject' } }).decision, 'REJECT');
});
