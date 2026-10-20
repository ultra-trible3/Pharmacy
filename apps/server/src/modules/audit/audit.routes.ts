import { Router } from 'express';
import { z } from 'zod';
import { buildPaginated, paginationSchema } from '@pharmacy/shared';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';

export const auditRouter = Router();
auditRouter.use(authenticate);

const auditQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(80).optional(),
  userId: z.string().trim().max(64).optional(),
});

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  terminalId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; username: string } | null;
}

/**
 * Read-only audit trail (newest first). The log itself is append-only and
 * written by `recordAudit` on every privileged mutation.
 */
auditRouter.get(
  '/',
  authorize('audit:read'),
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof auditQuerySchema>;
    const contains = (value: string) =>
      ({ contains: value, mode: 'insensitive' as const });

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: contains(query.action) } : {}),
      ...(query.entityType ? { entityType: contains(query.entityType) } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.q
        ? {
            OR: [
              { action: contains(query.q) },
              { entityType: contains(query.q) },
              { entityId: contains(query.q) },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.status(200).json(
      buildPaginated<AuditEntryDto>(
        rows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          before: row.before ?? null,
          after: row.after ?? null,
          userId: row.userId,
          ip: row.ip,
          userAgent: row.userAgent,
          terminalId: row.terminalId,
          createdAt: row.createdAt.toISOString(),
          user: row.user,
        })),
        total,
        query.page,
        query.pageSize,
      ),
    );
  }),
);
