import axios, { AxiosError } from 'axios';
import type * as T from '../types/api';

/** Same-origin (Vite proxy / reverse proxy) so the httpOnly SameSite=Strict session cookie is sent. The custom header is the CSRF guard. */
export const http = axios.create({ baseURL: '/api', withCredentials: true, timeout: 20_000, headers: { 'X-Requested-With': 'SecureHeat' } });

http.interceptors.response.use((r) => r, (err: AxiosError) => {
  const url = String(err.config?.url ?? '');
  if (err.response?.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
  return Promise.reject(err);
});

export function errorMessage(e: unknown): string {
  const d = (e as AxiosError<{ message?: string; issues?: { path: string; message: string }[] }>)?.response?.data;
  if (d?.issues?.length) return d.issues.map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`).join('; ');
  if (d?.message) return d.message;
  if ((e as AxiosError)?.code === 'ECONNABORTED') return 'The request timed out';
  if ((e as AxiosError)?.request && !(e as AxiosError).response) return 'Cannot reach the server';
  return e instanceof Error ? e.message : 'Something went wrong';
}
export const statusOf = (e: unknown): number | undefined => (e as AxiosError)?.response?.status;

export const clean = <P extends Record<string, unknown>>(p: P) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null));
const get = async <R>(url: string, params?: Record<string, unknown>) => (await http.get<R>(url, { params: params ? clean(params) : undefined })).data;
const post = async <R>(url: string, body: unknown = {}) => (await http.post<R>(url, body)).data;

export const api = {
  login: (email: string, password: string) => post<{ user: T.User }>('/auth/login', { email, password }),
  logout: () => post<void>('/auth/logout'),
  me: () => get<{ user: T.User }>('/auth/me'),
  forgotPassword: (email: string) => post<{ message: string }>('/auth/forgot-password', { email }),

  overview: (hours: number) => get<T.Overview>('/stats/overview', { hours }),
  trends: (hours: number, sensorId?: string) => get<T.Trends>('/forecast/trends', { hours, sensorId, horizon: 6 }),

  telemetry: (p: Record<string, unknown>) => get<T.Paged<T.TelemetryRow>>('/telemetry', p),
  telemetryDetail: (id: string) => get<T.TelemetryDetail>(`/telemetry/${id}`),

  sensors: () => get<{ sensors: T.Sensor[] }>('/sensors'),
  sensor: (id: string) => get<{ sensor: T.Sensor; recentEvents: Pick<T.SecurityEvent, 'id' | 'eventType' | 'severity' | 'status' | 'detectedAt' | 'description'>[] }>(`/sensors/${id}`),
  registerSensor: (b: { sensorId: string; name: string; location: string; latitude?: number; longitude?: number }) => post<{ sensor: T.Sensor; credentials: T.Credentials; notice: string }>('/sensors', b),
  setSensorStatus: async (id: string, status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED', reason?: string) => (await http.patch<{ sensor: T.Sensor }>(`/sensors/${id}/status`, { status, reason })).data,
  rotateCredentials: (id: string) => post<{ sensor: T.Sensor; credentials: T.Credentials; notice: string }>(`/sensors/${id}/rotate-credentials`),
  markSuspicious: (id: string, reason: string) => post<{ sensor: T.Sensor }>(`/sensors/${id}/mark-suspicious`, { reason }),

  events: (p: Record<string, unknown>) => get<T.Paged<T.SecurityEvent>>('/events', p),
  event: (id: string) => get<T.EventDetail>(`/events/${id}`),
  investigate: (id: string) => post(`/events/${id}/investigate`),
  addNote: (id: string, note: string) => post(`/events/${id}/notes`, { note }),
  resolve: (id: string, resolutionNotes: string) => post(`/events/${id}/resolve`, { resolutionNotes }),

  quarantine: (p: Record<string, unknown>) => get<T.Paged<T.QuarantineRow>>('/quarantine', p),
  approve: (id: string, notes: string) => post(`/quarantine/${id}/approve`, { notes }),
  rejectRecord: (id: string, notes: string) => post(`/quarantine/${id}/reject`, { notes }),

  model: () => get<T.ModelAnalytics>('/analytics/model'),
  refreshModel: () => post('/analytics/model/refresh'),
  trainModel: () => post<{ note: string }>('/analytics/model/train'),

  simStatus: () => get<T.SimStatus>('/simulator/status'),
  simLog: (limit = 60) => get<{ entries: T.SimLogEntry[] }>('/simulator/log', { limit }),
  simStart: () => post<T.SimStatus>('/simulator/start'),
  simStop: () => post<T.SimStatus>('/simulator/stop'),
  simScenario: (b: { scenario: string; target?: string; ticks: number; rate: number }) => post<T.SimStatus>('/simulator/scenario', b),

  users: () => get<{ users: T.User[] }>('/users'),
  createUser: (b: { name: string; email: string; password: string; role: T.Role }) => post<{ user: T.User }>('/users', b),
  updateUser: async (id: string, b: { role?: T.Role; name?: string; password?: string }) => (await http.patch<{ user: T.User }>(`/users/${id}`, b)).data,
  deleteUser: async (id: string) => { await http.delete(`/users/${id}`); },
  settings: () => get<T.SettingsView>('/settings'),
  audit: (p: Record<string, unknown>) => get<T.Paged<T.AuditEntry>>('/audit', p),
};
