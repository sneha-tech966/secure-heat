import { z } from 'zod';

const roleEnum = z.enum(['ADMIN', 'SECURITY_ANALYST', 'VIEWER']);
const password = z.string().min(12, 'password must be at least 12 characters').max(128);

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict();
export const createUserSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email().max(254), password, role: roleEnum }).strict();
export const updateUserSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), role: roleEnum.optional(), password: password.optional() }).strict()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

export const registerSensorSchema = z.object({
  sensorId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'sensorId may contain letters, digits, - and _ (max 64)'),
  name: z.string().trim().min(1).max(100), location: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
}).strict();
export const sensorStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']), reason: z.string().trim().max(500).optional() }).strict();
export const markSuspiciousSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
