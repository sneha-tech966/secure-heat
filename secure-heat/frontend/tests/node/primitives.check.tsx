/** Runnable WITHOUT npm install of the app's dependencies: renders the dependency-free UI primitives to static HTML and
 *  checks pure logic. Run: `tsx --test tests/node/primitives.check.tsx` (needs react + react-dom resolvable). Not part of `npm test`. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { Badge, SeverityBadge, StatusBadge, STATUS_TONE } from '../../src/components/Badges';
import { DataTable, Pagination, type Column } from '../../src/components/DataTable';
import { MetricCard } from '../../src/components/MetricCard';
import { EmptyState, ErrorState, PageHeader } from '../../src/components/States';
import { EventTimeline } from '../../src/components/EventTimeline';
import { SensorCard } from '../../src/components/SensorCard';
import { TelemetryDetailPanel } from '../../src/components/TelemetryDetailPanel';
import { fmtNum, fmtScore, humanize, pct, timeAgo } from '../../src/utils/format';
import { NAV, can, navFor } from '../../src/utils/permissions';
import { buildTrendRows } from '../../src/utils/trends';
import type { Sensor, TelemetryDetail } from '../../src/types/api';

test('status vocabulary: trusted = green, held = amber, blocked/quarantined = red', () => {
  for (const s of ['ACCEPT', 'FORWARDED', 'ACTIVE', 'RESOLVED']) assert.equal(STATUS_TONE[s], 'ok');
  for (const s of ['FLAG', 'SUSPICIOUS', 'OPEN']) assert.equal(STATUS_TONE[s], 'warn');
  for (const s of ['QUARANTINE', 'QUARANTINED', 'REJECT', 'REJECTED', 'BLOCKED']) assert.equal(STATUS_TONE[s], 'crit');
  assert.match(html(<StatusBadge status="QUARANTINED" />), /text-crit/); assert.match(html(<StatusBadge status="FORWARDED" />), /text-ok/);
  assert.match(html(<StatusBadge status="SOMETHING_NEW" />), /Something New/);       // unknown values degrade gracefully
});
test('severity badges: CRITICAL is visually distinct from HIGH', () => {
  assert.match(html(<SeverityBadge severity="CRITICAL" />), /bg-crit text-white/); assert.doesNotMatch(html(<SeverityBadge severity="HIGH" />), /bg-crit text-white/);
  assert.match(html(<Badge tone="info">x</Badge>), /bg-electric/);
});
test('MetricCard shows value, or a loading skeleton instead of a fake number', () => {
  const v = html(<MetricCard label="Trusted readings" value="1,234" />); assert.match(v, /1,234/); assert.match(v, /Trusted readings/);
  const l = html(<MetricCard label="Trusted readings" value="1,234" loading />); assert.doesNotMatch(l, /1,234/); assert.match(l, /aria-label="loading"/);
});
interface R { id: string; name: string }
const cols: Column<R>[] = [{ key: 'n', header: 'Name', sortKey: 'name', render: (r) => r.name }];
test('DataTable: rows, loading skeleton, empty state, error state, sort indicator', () => {
  assert.match(html(<DataTable columns={cols} rows={[{ id: '1', name: 'WS-001' }]} rowKey={(r) => r.id} />), /WS-001/);
  const loading = html(<DataTable columns={cols} rows={[]} rowKey={(r: R) => r.id} loading />); assert.match(loading, /animate-pulse/); assert.doesNotMatch(loading, /data-testid="empty-state"/);
  assert.match(html(<DataTable columns={cols} rows={[]} rowKey={(r: R) => r.id} emptyTitle="No readings" />), /No readings/);
  const err = html(<DataTable columns={cols} rows={[]} rowKey={(r: R) => r.id} error="Cannot reach the server" onRetry={() => {}} />); assert.match(err, /role="alert"/); assert.match(err, /Retry/);
  assert.match(html(<DataTable columns={cols} rows={[]} rowKey={(r: R) => r.id} sort={{ key: 'name', order: 'asc' }} onSort={() => {}} />), /aria-sort="ascending"/);
});
test('Pagination reports ranges and disables edges', () => {
  const p = html(<Pagination page={1} pageSize={25} total={60} onPage={() => {}} />); assert.match(p, /1–25 of 60/); assert.match(p, /Page 1 \/ 3/); assert.match(p, /disabled=""[^>]*>Previous/);
  assert.match(html(<Pagination page={1} pageSize={25} total={0} onPage={() => {}} />), /0–0 of 0/);
});
test('Empty / error / header primitives render accessibly', () => {
  assert.match(html(<EmptyState title="Nothing" hint="Start the simulator" />), /Start the simulator/); assert.match(html(<ErrorState message="boom" />), /boom/);
  assert.match(html(<PageHeader title="Quarantine" subtitle="held back" />), /<h1[^>]*>Quarantine/);
});
test('role-based navigation: viewer sees read-only pages only; analyst gains review tools; admin sees settings', () => {
  const labels = (r: any) => navFor(r).map((n) => n.label);
  assert.deepEqual(labels('VIEWER'), ['Overview', 'Live Monitoring', 'Sensors', 'Security Events']);
  assert.deepEqual(labels('SECURITY_ANALYST'), ['Overview', 'Live Monitoring', 'Sensors', 'Security Events', 'Quarantine', 'ML Analytics', 'Simulator']);
  assert.equal(labels('ADMIN').length, NAV.length); assert.ok(labels('ADMIN').includes('Settings')); assert.deepEqual(labels(undefined), []);
});
test('UI permission helpers mirror the backend matrix', () => {
  assert.ok(can.registerSensor('ADMIN') && !can.registerSensor('SECURITY_ANALYST') && !can.registerSensor('VIEWER'));
  assert.ok(can.reviewQuarantine('SECURITY_ANALYST') && !can.reviewQuarantine('VIEWER')); assert.ok(can.resolve('ADMIN') && !can.resolve('SECURITY_ANALYST'));
  assert.ok(can.markSuspicious('SECURITY_ANALYST') && !can.markSuspicious('VIEWER')); assert.ok(!can.manageUsers(undefined));
});
test('SensorCard shows status, counts, and never any credential field', () => {
  const s: Sensor = { id: 'x', sensorId: 'WS-001', name: 'Roof', location: 'North', latitude: null, longitude: null, status: 'SUSPICIOUS', lastSeen: null, registeredAt: '2026-01-01T00:00:00Z', telemetryCount: 1500, anomalyCount: 12 };
  const out = html(<SensorCard sensor={s} actions={<button>Block</button>} />); assert.match(out, /WS-001/); assert.match(out, /Suspicious/); assert.match(out, /1,500/); assert.match(out, /never/); assert.match(out, /Block/);
  assert.doesNotMatch(out, /apiKey|secret|hash/i);
});
test('EventTimeline renders notes in order, and an empty state', () => {
  assert.match(html(<EventTimeline entries={[]} />), /No investigation activity/);
  const out = html(<EventTimeline entries={[{ id: '1', actorLabel: 'a@x.io', action: 'EVENT_NOTE', details: { note: 'Checked neighbour sensor' }, createdAt: '2026-10-01T10:00:00Z' }, { id: '2', actorLabel: 'b@x.io', action: 'EVENT_RESOLVED', details: { notes: 'False alarm' }, createdAt: '2026-10-01T11:00:00Z' }]} />);
  assert.ok(out.indexOf('Checked neighbour sensor') < out.indexOf('False alarm')); assert.match(out, /Note/); assert.match(out, /Resolved/);
});
test('TelemetryDetailPanel shows payload, authentication, rules, ML score + explanation and final decision', () => {
  const d: TelemetryDetail = { telemetry: { id: 't1', sensorId: 'WS-002', sequenceNumber: 7, timestamp: '2026-10-01T10:00:00Z', receivedAt: '2026-10-01T10:00:01Z', temperature: 41.2, humidity: 150, pressure: 1010, windSpeed: 3, windDirection: 90, rainfall: 0, solarRadiation: 200, anomalyScore: null, anomalyStatus: 'UNKNOWN', decision: 'QUARANTINE', processingStatus: 'QUARANTINED',
    sensor: { sensorId: 'WS-002', name: 'Library', location: 'x', status: 'ACTIVE' }, events: [{ id: 'e1', eventType: 'RULE_VIOLATION', severity: 'HIGH', status: 'OPEN', description: 'humidity=150 outside range', detectedAt: '2026-10-01T10:00:01Z' }] },
    pipeline: { authentication: { apiKeyVerified: true, signatureValid: true }, rules: [{ rule: 'HUMIDITY_OUT_OF_RANGE', category: 'range', severity: 'HIGH', hard: true, message: 'humidity=150 is outside [0,100]' }], ml: { anomalyScore: null, anomalyStatus: 'UNKNOWN', explanation: null }, decision: 'QUARANTINE', processingStatus: 'QUARANTINED', review: null } };
  const out = html(<TelemetryDetailPanel detail={d} />);
  for (const needle of ['WS-002', '41.2', 'Verified', 'Valid', 'HUMIDITY_OUT_OF_RANGE', 'Hard', 'n/a', 'ML was not consulted', 'Quarantine', 'Related security events', 'not a probability']) assert.ok(out.includes(needle), `missing: ${needle}`);
});
test('trend rows merge trusted, unprotected and forecast series on one time axis', () => {
  const t0 = '2026-10-01T10:00:00.000Z', t1 = '2026-10-01T11:00:00.000Z';
  const rows = buildTrendRows([{ t: t0, v: 20 }, { t: t1, v: 21 }], [{ step: 1, value: 21.5, lower: 20.5, upper: 22.5 }, { step: 2, value: 22, lower: 20, upper: 24 }], [{ t: t0, v: 20 }, { t: t1, v: 35 }]);
  assert.equal(rows.length, 4); assert.deepEqual(rows.map((r) => r.t), [...rows.map((r) => r.t)].sort((a, b) => a - b));
  assert.equal(rows[1]!.naive, 35); assert.equal(rows[1]!.trusted, 21); assert.equal(rows[1]!.forecast, 21);          // forecast line joins the data
  assert.equal(rows[3]!.t - rows[1]!.t, 2 * 3_600_000); assert.deepEqual(rows[3]!.band, [20, 24]); assert.equal(rows[3]!.trusted, undefined);
  assert.deepEqual(buildTrendRows([], [{ step: 1, value: 1, lower: 0, upper: 2 }]), []); assert.equal(buildTrendRows([{ t: t0, v: null }], []).length, 0);
});
test('formatters handle null/NaN without printing "NaN" or "null"', () => {
  assert.equal(fmtNum(null), '—'); assert.equal(fmtNum(NaN), '—'); assert.equal(fmtNum(21.456, 1), '21.5'); assert.equal(fmtScore(null), 'n/a'); assert.equal(fmtScore(0.99456), '0.9946');
  assert.equal(pct(0.6543), '65.4%'); assert.equal(pct(null), '—'); assert.equal(humanize('REPLAY_ATTACK'), 'Replay Attack');
  const now = Date.parse('2026-10-01T12:00:00Z'); assert.equal(timeAgo('2026-10-01T11:59:30Z', now), '30s ago'); assert.equal(timeAgo('2026-10-01T10:00:00Z', now), '2h ago'); assert.equal(timeAgo(null, now), 'never');
});
