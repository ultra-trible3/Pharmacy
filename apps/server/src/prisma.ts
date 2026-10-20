import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

/**
 * Single Prisma client instance for the process.
 * `transactionOptions` sets conservative timeouts for the atomic checkout
 * transactions added in later phases.
 */
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
  transactionOptions: {
    maxWait: 10_000,
    timeout: 20_000,
  },
});

prisma.$on('error', (event) => logger.error({ prisma: true }, event.message));
prisma.$on('warn', (event) => logger.warn({ prisma: true }, event.message));

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/** True when the database answers a trivial query. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
