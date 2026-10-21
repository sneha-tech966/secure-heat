import type { EventStatus, RuleDetail } from '../types.js';

export type EventAction = 'investigate' | 'resolve';
/** Incident lifecycle: OPEN -> INVESTIGATING -> RESOLVED (resolve may also be applied directly to OPEN). RESOLVED is terminal. */
export function nextEventStatus(current: EventStatus, action: EventAction): EventStatus | null {
  if (action === 'investigate') return current === 'OPEN' ? 'INVESTIGATING' : null;
  return current === 'RESOLVED' ? null : 'RESOLVED';
}

export type ReviewGuard = { ok: true } | { ok: false; status: number; code: string; message: string };
/** Safety rules for releasing/rejecting quarantined telemetry. Approval never overrides physical impossibility. */
export function reviewGuard(t: { processingStatus: string; rulesTriggered: RuleDetail[] }, sensorStatus: string, action: 'approve' | 'reject'): ReviewGuard {
  if (t.processingStatus !== 'QUARANTINED') return { ok: false, status: 409, code: 'NOT_PENDING', message: 'record is not awaiting review (already reviewed or not quarantined)' };
  if (action === 'approve') {
    if (t.rulesTriggered.some((r) => r.hard)) return { ok: false, status: 409, code: 'IMPOSSIBLE_VALUE', message: 'readings that violate physical limits cannot be approved for forwarding; reject them instead' };
    if (sensorStatus === 'BLOCKED') return { ok: false, status: 409, code: 'SENSOR_BLOCKED', message: 'readings from a blocked sensor cannot be approved' };
  }
  return { ok: true };
}
