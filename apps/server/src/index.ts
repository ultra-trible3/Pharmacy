import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { checkDatabase, disconnectPrisma } from './prisma.js';

async function main(): Promise<void> {
  const db = await checkDatabase();
  if (!db.ok) {
    logger.error(
      { error: db.error },
      'database is unreachable — run `pnpm db:start` and `pnpm db:migrate` before starting the server',
    );
    process.exitCode = 1;
    return;
  }

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        host: env.HOST,
        port: env.PORT,
        environment: env.NODE_ENV,
        databaseLatencyMs: db.latencyMs,
        docs: `http://${env.HOST}:${env.PORT}/api/docs`,
      },
      'pharmacy API listening',
    );
  });

  server.on('error', (error) => {
    logger.error({ err: error }, 'server error');
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error) => {
  logger.error({ err: error }, 'fatal startup error');
  process.exit(1);
});
