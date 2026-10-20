import { Router } from 'express';
import { z } from 'zod';
import {
  buildPaginated,
  customerCreateSchema,
  customerQuerySchema,
  customerUpdateSchema,
  idSchema,
  type CustomerCreateInput,
  type CustomerQuery,
  type CustomerUpdateInput,
} from '@pharmacy/shared';
import type { Customer } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';

export const customersRouter = Router();
customersRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  creditLimit: string;
  currentBalance: string;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
}

export function toCustomerDto(row: Customer): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    creditLimit: row.creditLimit.toFixed(2),
    currentBalance: row.currentBalance.toFixed(2),
    loyaltyPoints: row.loyaltyPoints,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

customersRouter.get(
  '/',
  authorize('sales:read'),
  validate({ query: customerQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CustomerQuery;
    const where = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
    ]);

    res.status(200).json(buildPaginated(rows.map(toCustomerDto), total, query.page, query.pageSize));
  }),
);

customersRouter.get(
  '/:id',
  authorize('sales:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const row = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('العميل غير موجود');
    res.status(200).json(toCustomerDto(row));
  }),
);

customersRouter.post(
  '/',
  authorize('sales:create'),
  rateLimit({ name: 'customers:create', windowMs: 60_000, max: 60 }),
  validate({ body: customerCreateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as CustomerCreateInput;

    if (input.phone) {
      const clash = await prisma.customer.findUnique({ where: { phone: input.phone } });
      if (clash) throw new ConflictError(`رقم الهاتف مسجل بالفعل للعميل: ${clash.name}`);
    }

    const created = await prisma.customer.create({
      data: {
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        loyaltyPoints: input.loyaltyPoints ?? 0,
        creditLimit: input.creditLimit ?? '0.00',
        currentBalance: input.currentBalance ?? '0.00',
      },
    });
    await recordAudit(
      {
        action: 'customer.created',
        entityType: 'Customer',
        entityId: created.id,
        after: { name: created.name, phone: created.phone, loyaltyPoints: created.loyaltyPoints },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(201).json(toCustomerDto(created));
  }),
);

customersRouter.patch(
  '/:id',
  authorize('sales:create'),
  validate({ params: idParams, body: customerUpdateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as CustomerUpdateInput;
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('العميل غير موجود');

    if (input.phone && input.phone !== existing.phone) {
      const clash = await prisma.customer.findUnique({ where: { phone: input.phone } });
      if (clash) throw new ConflictError(`رقم الهاتف مسجل بالفعل للعميل: ${clash.name}`);
    }

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.loyaltyPoints !== undefined ? { loyaltyPoints: input.loyaltyPoints } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        ...(input.currentBalance !== undefined ? { currentBalance: input.currentBalance } : {}),
      },
    });
    await recordAudit(
      {
        action: 'customer.updated',
        entityType: 'Customer',
        entityId: updated.id,
        before: { name: existing.name, phone: existing.phone, loyaltyPoints: existing.loyaltyPoints },
        after: { name: updated.name, phone: updated.phone, loyaltyPoints: updated.loyaltyPoints },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(200).json(toCustomerDto(updated));
  }),
);

customersRouter.delete(
  '/:id',
  authorize('sales:create'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('العميل غير موجود');

    const saleCount = await prisma.sale.count({ where: { customerId: req.params.id } });
    if (saleCount > 0) {
      throw new ConflictError(`لا يمكن حذف العميل لأن لديه ${saleCount} فاتورة مسجلة`);
    }

    await prisma.customer.delete({ where: { id: req.params.id } });
    await recordAudit(
      {
        action: 'customer.deleted',
        entityType: 'Customer',
        entityId: req.params.id,
        before: { name: existing.name, phone: existing.phone },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(200).json({ ok: true });
  }),
);
