import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/services/api';
import type { Overview, Sensor, TelemetryRow } from '../src/types/api';
import { asUser, mkUser, renderAt } from './helpers';

vi.mock('recharts', async () => (await import('./helpers')).rechartsStub());
vi.mock('../src/services/api', async (orig) => {
  const real = await orig<typeof import('../src/services/api')>();
  return { ...real, api: Object.fromEntries((Object.keys(real.api) as (keyof typeof real.api)[]).map((n) => [n, vi.fn(() => new Promise(() => {}))])) };
});
const A = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => { Object.values(A).forEach((f) => f.mockReset().mockImplementation(() => new Promise(() => {}))); });

const overview: Overview = { hours: 24, kpis: { totalSensors: 5, activeSensors: 4, totalTelemetry: 1234, trustedReadings: 1100, anomaliesDetected: 40, blockedRequests: 9 }, telemetryVolume: [], incidentsBySeverity: [], sensorActivity: [], scoreDistribution: { normal: [], anomalous: [], sampled: 0 }, recentEvents: [], sensorHealth: [] };
const row = (id: string, o: Partial<TelemetryRow> = {}): TelemetryRow => ({ id, sensorId: 'WS-001', sequenceNumber: 1, timestamp: '2026-10-01T10:00:00Z', temperature: 22, humidity: 60, pressure: 1012, windSpeed: 4, windDirection: 180, rainfall: 0, solarRadiation: 300, anomalyScore: 0.4, anomalyStatus: 'NORMAL', decision: 'ACCEPT', processingStatus: 'FORWARDED', ...o });
const sensor = (id: string, status: Sensor['status'] = 'ACTIVE'): Sensor => ({ id, sensorId: id, name: `Station ${id}`, location: 'Roof', latitude: null, longitude: null, status, lastSeen: null, registeredAt: '2026-01-01T00:00:00Z', telemetryCount: 10, anomalyCount: 1 });

describe('Overview dashboard', () => {
  it('shows loading placeholders, then real KPI values from the API', async () => {
    asUser(A, mkUser('VIEWER')); let resolve!: (v: Overview) => void; A.overview.mockImplementation(() => new Promise((r) => { resolve = r; })); A.trends.mockImplementation(() => new Promise(() => {}));
    renderAt('/'); expect((await screen.findAllByLabelText('loading')).length).toBeGreaterThan(0);
    resolve(overview); expect(await screen.findByText('1,234')).toBeInTheDocument(); expect(screen.getByText('1,100')).toBeInTheDocument(); expect(screen.queryAllByLabelText('loading')).toHaveLength(0);
  });
  it('shows an error state with a working retry', async () => {
    asUser(A, mkUser('VIEWER')); A.overview.mockRejectedValueOnce({ response: { status: 500, data: { message: 'database unavailable' } } }).mockResolvedValue(overview);
    renderAt('/'); expect(await screen.findByText('database unavailable')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' })); expect(await screen.findByText('1,234')).toBeInTheDocument();
  });
  it('renders empty states instead of blank charts when there is no data', async () => {
    asUser(A, mkUser('VIEWER')); A.overview.mockResolvedValue(overview); renderAt('/');
    expect((await screen.findAllByTestId('empty-state')).length).toBeGreaterThan(0);
  });
});

describe('Sensors: role-based visibility', () => {
  const open = async (role: 'ADMIN' | 'SECURITY_ANALYST' | 'VIEWER') => { asUser(A, mkUser(role)); A.sensors.mockResolvedValue({ sensors: [sensor('WS-001'), sensor('WS-002', 'BLOCKED')] }); renderAt('/sensors'); await screen.findAllByTestId('sensor-card'); };
  it('viewer is read-only', async () => {
    await open('VIEWER'); expect(screen.queryByRole('button', { name: 'Register sensor' })).not.toBeInTheDocument();
    for (const b of ['Block', 'Rotate credentials', 'Mark suspicious', 'Activate', 'Deactivate']) expect(screen.queryByRole('button', { name: b })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Details' }).length).toBe(2);
  });
  it('analyst can mark suspicious but cannot block, rotate or register', async () => {
    await open('SECURITY_ANALYST'); expect(screen.getByRole('button', { name: 'Mark suspicious' })).toBeInTheDocument();
    for (const b of ['Block', 'Rotate credentials', 'Register sensor']) expect(screen.queryByRole('button', { name: b })).not.toBeInTheDocument();
  });
  it('admin gets management actions and a confirmation (with reason) before blocking', async () => {
    await open('ADMIN'); expect(screen.getByRole('button', { name: 'Register sensor' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Block' })[0]!);
    const dlg = await screen.findByRole('dialog', { name: /Block WS-001/ });
    expect(within(dlg).getByRole('button', { name: 'Block' })).toBeDisabled();                      // confirm stays disabled until a reason is given
    await userEvent.setup().type(within(dlg).getByLabelText(/Reason/), 'spoofed temperatures'); expect(within(dlg).getByRole('button', { name: 'Block' })).toBeEnabled();
  });
});

describe('Live monitoring: filtering', () => {
  const open = async () => { asUser(A, mkUser('VIEWER')); A.sensors.mockResolvedValue({ sensors: [sensor('WS-001'), sensor('WS-002')] }); A.telemetry.mockResolvedValue({ items: [row('t1'), row('t2', { sensorId: 'WS-002', decision: 'FLAG', processingStatus: 'QUARANTINED' })], total: 2, page: 1, pageSize: 25 }); renderAt('/monitoring'); await screen.findByText('WS-002'); };
  it('renders the required columns and coloured decision badges', async () => {
    await open(); for (const h of ['Timestamp', 'Sensor ID', 'Anomaly score', 'Security decision']) expect(screen.getByRole('columnheader', { name: new RegExp(h, 'i') })).toBeInTheDocument();
    expect(screen.getAllByText('Quarantined')[0]).toHaveClass('text-crit');
  });
  it('sends the selected decision and sensor filters to the API and resets to page 1', async () => {
    await open(); const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Decision'), 'FLAG'); await waitFor(() => expect(A.telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'FLAG', page: 1 })));
    await u.selectOptions(screen.getByLabelText('Sensor'), 'WS-002'); await waitFor(() => expect(A.telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'FLAG', sensorId: 'WS-002' })));
  });
  it('debounces sensor-id search and sorts when a column header is clicked', async () => {
    await open(); fireEvent.change(screen.getByLabelText('Search sensor'), { target: { value: 'WS-002' } });
    await waitFor(() => expect(A.telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'WS-002' })), { timeout: 2000 });
    await userEvent.setup().click(screen.getByRole('button', { name: /Temp/ })); await waitFor(() => expect(A.telemetry).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'temperature', order: 'desc' })));
  });
  it('shows a filter-specific empty state and a clear-filters button', async () => {
    await open(); A.telemetry.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    await userEvent.setup().selectOptions(screen.getByLabelText('Decision'), 'REJECT'); expect(await screen.findByText('No readings match these filters')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
  it('opens the detail panel with the full pipeline when a row is clicked', async () => {
    await open(); A.telemetryDetail.mockResolvedValue({ telemetry: { ...row('t1'), receivedAt: '2026-10-01T10:00:01Z', sensor: { sensorId: 'WS-001', name: 'Station WS-001', location: 'Roof', status: 'ACTIVE' }, events: [] }, pipeline: { authentication: { apiKeyVerified: true, signatureValid: true }, rules: [], ml: { anomalyScore: 0.4, anomalyStatus: 'NORMAL', explanation: 'consistent with normal behaviour' }, decision: 'ACCEPT', processingStatus: 'FORWARDED', review: null } });
    await userEvent.setup().click(screen.getByText('WS-001')); expect(await screen.findByTestId('telemetry-detail')).toBeInTheDocument(); expect(screen.getByText('consistent with normal behaviour')).toBeInTheDocument();
  });
});
