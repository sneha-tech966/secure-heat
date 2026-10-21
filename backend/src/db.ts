import { PrismaClient } from '@prisma/client';
export const createPrisma = () => new PrismaClient({ log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'] });
export type Db = PrismaClient;
