import type { Role } from '../types.js';
declare global {
  namespace Express {
    interface Request { user?: { id: string; name: string; email: string; role: Role }; rawBody?: Buffer }
  }
}
export {};
