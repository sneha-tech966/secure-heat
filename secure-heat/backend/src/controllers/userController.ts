import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { audit } from '../services/audit.js';
import { HttpError, isUniqueViolation } from '../utils/errors.js';
import { createUserSchema, updateUserSchema } from '../validators/schemas.js';
import { BCRYPT_COST } from './authController.js';

const SAFE = { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true } as const;

export function userController(db: PrismaClient) {
  const adminCount = () => db.user.count({ where: { role: 'ADMIN' } });
  return {
    async list(_req: Request, res: Response) { res.json({ users: await db.user.findMany({ select: SAFE, orderBy: { createdAt: 'asc' } }) }); },

    async create(req: Request, res: Response) {
      const b = createUserSchema.parse(req.body);
      try {
        const user = await db.user.create({ select: SAFE, data: { name: b.name, email: b.email.toLowerCase(), role: b.role, passwordHash: await bcrypt.hash(b.password, BCRYPT_COST) } });
        await audit(db, req, { action: 'USER_CREATED', targetType: 'User', targetId: user.id, details: { email: user.email, role: user.role } });
        res.status(201).json({ user });
      } catch (e) {
        if (isUniqueViolation(e)) throw new HttpError(409, 'a user with this email already exists', 'EMAIL_TAKEN');
        throw e;
      }
    },

    async update(req: Request, res: Response) {
      const id = String(req.params.id); const b = updateUserSchema.parse(req.body);
      const existing = await db.user.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'user not found', 'NOT_FOUND');
      if (b.role && b.role !== 'ADMIN' && existing.role === 'ADMIN' && (await adminCount()) <= 1) throw new HttpError(409, 'cannot demote the last administrator', 'LAST_ADMIN');
      const user = await db.user.update({ where: { id }, select: SAFE,
        data: { name: b.name, role: b.role, passwordHash: b.password ? await bcrypt.hash(b.password, BCRYPT_COST) : undefined } });
      await audit(db, req, { action: 'USER_UPDATED', targetType: 'User', targetId: id, details: { changed: Object.keys(b).map((k) => (k === 'password' ? 'password' : k)), newRole: b.role ?? null } });
      res.json({ user });
    },

    async remove(req: Request, res: Response) {
      const id = String(req.params.id);
      if (id === req.user?.id) throw new HttpError(409, 'you cannot delete your own account', 'SELF_DELETE');
      const existing = await db.user.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'user not found', 'NOT_FOUND');
      if (existing.role === 'ADMIN' && (await adminCount()) <= 1) throw new HttpError(409, 'cannot delete the last administrator', 'LAST_ADMIN');
      await db.user.delete({ where: { id } });
      await audit(db, req, { action: 'USER_DELETED', targetType: 'User', targetId: id, details: { email: existing.email } });
      res.status(204).end();
    },
  };
}
