import type { ReactNode } from 'react';
import type { Sensor } from '../types/api';
import { fmtInt, timeAgo } from '../utils/format';
import { StatusBadge } from './Badges';

export function SensorCard({ sensor, actions, onOpen }: { sensor: Sensor; actions?: ReactNode; onOpen?: () => void }) {
  return (
    <article className="card flex flex-col p-4" data-testid="sensor-card">
      <div className="flex items-start justify-between gap-2">
        <div><button className="text-left font-mono text-sm font-semibold text-cyan-soft hover:underline" onClick={onOpen}>{sensor.sensorId}</button><p className="text-sm text-slate-200">{sensor.name}</p><p className="text-xs text-slate-500">{sensor.location}</p></div>
        <StatusBadge status={sensor.status} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-slate-500">Last seen</dt><dd className="text-slate-200">{timeAgo(sensor.lastSeen)}</dd></div>
        <div><dt className="text-slate-500">Readings</dt><dd className="tabular-nums text-slate-200">{fmtInt(sensor.telemetryCount)}</dd></div>
        <div><dt className="text-slate-500">Anomalies</dt><dd className={`tabular-nums ${sensor.anomalyCount ? 'text-warn' : 'text-slate-200'}`}>{fmtInt(sensor.anomalyCount)}</dd></div></dl>
      {actions && <div className="mt-3 flex flex-wrap gap-2 border-t border-edge pt-3">{actions}</div>}
    </article>
  );
}
