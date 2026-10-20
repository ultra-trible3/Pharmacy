import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../prisma.js';
import { logger } from '../logger.js';

/** A Prisma client or an interactive-transaction client. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  userId?: string | null;
  /** Explicit request metadata; falls back to `req` when provided. */
  ip?: string | null;
  userAgent?: string | null;
  terminalId?: string | null;
  req?: Request;
}

/**
 * Appends an immutable audit record. When a transaction client is supplied the
 * audit row is committed atomically with the business change it describes.
 *
 * Audit failures never mask the original operation: when writing outside a
 * transaction they are logged and swallowed; inside a transaction they surface
 * so that a partial change is rolled back.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: PrismaLike = prisma,
): Promise<void> {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: toJson(entry.before),
    after: toJson(entry.after),
    userId: entry.userId ?? entry.req?.user?.id ?? null,
    ip: entry.ip ?? entry.req?.ip ?? null,
    userAgent: entry.userAgent ?? entry.req?.header('user-agent') ?? null,
    terminalId: entry.terminalId ?? entry.req?.header('x-terminal-id') ?? null,
  };

  try {
    await client.auditLog.create({ data });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'failed to write audit log');
    throw error;
  }
}

/** Best-effort audit write that never throws (for non-critical trails). */
export async function recordAuditSafe(entry: AuditEntry, client: PrismaLike = prisma): Promise<void> {
  try {
    await recordAudit(entry, client);
  } catch {
    // already logged
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
