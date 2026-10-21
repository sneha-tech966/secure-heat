import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { COOKIE_NAME, cookieOptions, signToken } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { HttpError } from '../utils/errors.js';
import { loginSchema } from '../validators/schemas.js';

export const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);   // equalises timing for unknown emails

export function authController(db: PrismaClient, config: AppConfig) {
  return {
    async login(req: Request, res: Response) {
      const { email, password } = loginSchema.parse(req.body);
      const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) {
        await audit(db, req, { action: 'LOGIN_FAILED', targetType: 'User', details: { reason: 'invalid credentials' } }, email.toLowerCase().slice(0, 100));
        throw new HttpError(401, 'invalid email or password', 'INVALID_CREDENTIALS');
      }
      req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      res.cookie(COOKIE_NAME, signToken(config, user), { ...cookieOptions(config), maxAge: config.jwtExpiresSeconds * 1000 });
      await audit(db, req, { action: 'LOGIN', targetType: 'User', targetId: user.id });
      res.json({ user: req.user });
    },
    logout(_req: Request, res: Response) {
      res.clearCookie(COOKIE_NAME, cookieOptions(config)); res.status(204).end();
    },
    me(req: Request, res: Response) { res.json({ user: req.user }); },
    forgotPassword(_req: Request, res: Response) {
      res.status(501).json({ error: 'NOT_CONFIGURED', message: 'Password reset is not enabled. It requires an outbound email service (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM) and a password-reset token table; until then an administrator can reset passwords via PATCH /api/users/:id.' });
    },
  };
}
