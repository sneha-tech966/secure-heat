import type { Role } from '../types.js';

/** Single source of truth for the RBAC matrix. Routes call requireRole(...PERMISSIONS.x). */
export const PERMISSIONS = {
  viewDashboard: ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'],
  viewSensors: ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'],
  viewTelemetry: ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'],
  viewEvents: ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'],
  viewMlAnalytics: ['ADMIN', 'SECURITY_ANALYST'],
  manageUsers: ['ADMIN'],
  registerSensor: ['ADMIN'],
  changeSensorStatus: ['ADMIN'],
  rotateCredentials: ['ADMIN'],
  markSensorSuspicious: ['ADMIN', 'SECURITY_ANALYST'],
  investigateEvent: ['ADMIN', 'SECURITY_ANALYST'],
  resolveEvent: ['ADMIN'],            // spec lists incident resolution under ADMIN only; analysts investigate + annotate
  reviewQuarantine: ['ADMIN', 'SECURITY_ANALYST'],
  manageModel: ['ADMIN'],
  manageSettings: ['ADMIN'],
  controlSimulator: ['ADMIN', 'SECURITY_ANALYST'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const can = (role: Role, perm: Permission): boolean => (PERMISSIONS[perm] as readonly Role[]).includes(role);
