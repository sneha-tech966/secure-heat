import type { Role } from '../types/api';

/** UI-only mirror of the backend permission table. The server enforces everything; this only decides what to SHOW. */
export const ROLES: Record<string, readonly Role[]> = {
  viewAll: ['ADMIN', 'SECURITY_ANALYST', 'VIEWER'],
  analystUp: ['ADMIN', 'SECURITY_ANALYST'],
  adminOnly: ['ADMIN'],
};
export const can = {
  registerSensor: (r?: Role) => r === 'ADMIN', changeSensorStatus: (r?: Role) => r === 'ADMIN', rotateCredentials: (r?: Role) => r === 'ADMIN',
  markSuspicious: (r?: Role) => r === 'ADMIN' || r === 'SECURITY_ANALYST', investigate: (r?: Role) => r === 'ADMIN' || r === 'SECURITY_ANALYST',
  resolve: (r?: Role) => r === 'ADMIN', reviewQuarantine: (r?: Role) => r === 'ADMIN' || r === 'SECURITY_ANALYST', manageModel: (r?: Role) => r === 'ADMIN',
  controlSimulator: (r?: Role) => r === 'ADMIN' || r === 'SECURITY_ANALYST', manageUsers: (r?: Role) => r === 'ADMIN',
};

export interface NavItem { to: string; label: string; icon: string; roles: readonly Role[] }
export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'layout', roles: ROLES.viewAll! },
  { to: '/monitoring', label: 'Live Monitoring', icon: 'activity', roles: ROLES.viewAll! },
  { to: '/sensors', label: 'Sensors', icon: 'radio', roles: ROLES.viewAll! },
  { to: '/events', label: 'Security Events', icon: 'shield', roles: ROLES.viewAll! },
  { to: '/quarantine', label: 'Quarantine', icon: 'archive', roles: ROLES.analystUp! },
  { to: '/analytics', label: 'ML Analytics', icon: 'brain', roles: ROLES.analystUp! },
  { to: '/simulator', label: 'Simulator', icon: 'play', roles: ROLES.analystUp! },
  { to: '/settings', label: 'Settings', icon: 'settings', roles: ROLES.adminOnly! },
];
export const navFor = (role?: Role): NavItem[] => (role ? NAV.filter((n) => n.roles.includes(role)) : []);
export const roleLabel = (r: Role): string => ({ ADMIN: 'Administrator', SECURITY_ANALYST: 'Security Analyst', VIEWER: 'Viewer' })[r];
