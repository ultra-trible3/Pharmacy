import { Router } from 'express';
import { z } from 'zod';
import {
  buildPaginated,
  createExpenseSchema,
  expenseQuerySchema,
  idSchema,
  updateExpenseSchema,
} from '@pharmacy/shared';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';
import { findOpenShift, findOpenShiftForWarehouse } from '../cashdrawer/cashdrawer.service.js';

export const expensesRouter = Router();
expensesRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

function startOfLocalDay(dateOnly: string): Date {
  const parts = dateOnly.split('-').map(Number);
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

expensesRouter.get(
  '/',
  authorize('expenses:read'),
  validate({ query: expenseQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof expenseQuerySchema>;
    const where: Prisma.ExpenseWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            paidAt: {
              ...(query.dateFrom ? { gte: startOfLocalDay(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: startOfLocalDay(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { reference: { contains: query.q, mode: 'insensitive' as const } },
              { descriptionAr: { contains: query.q, mode: 'insensitive' as const } },
              { descriptionEn: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total, totalAggregate, thisMonthAggregate] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { paidBy: { select: { fullName: true } }, warehouse: { select: { nameAr: true } } },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({
        where: { ...where, isActive: true },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: {
          ...where,
          isActive: true,
          paidAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            lte: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const summary = {
      totalAmount: (totalAggregate._sum.amount ?? new Prisma.Decimal(0)).toString(),
      totalCount: totalAggregate._count,
      thisMonthAmount: (thisMonthAggregate._sum.amount ?? new Prisma.Decimal(0)).toString(),
      thisMonthCount: thisMonthAggregate._count,
    };

    res.status(200).json({
      ...buildPaginated(
        items.map((item) => ({
          id: item.id,
          reference: item.reference,
          category: item.category,
          categoryLabelAr: item.category,
          categoryLabelEn: item.category,
          descriptionAr: item.descriptionAr,
          descriptionEn: item.descriptionEn,
          amount: item.amount.toString(),
          paidAt: item.paidAt.toISOString(),
          paidBy: item.paidBy.fullName,
          warehouseId: item.warehouseId,
          warehouseNameAr: item.warehouse?.nameAr ?? null,
          notes: item.notes,
          isActive: item.isActive,
          createdAt: item.createdAt.toISOString(),
        })),
        total,
        query.page,
        query.pageSize,
      ),
      summary,
    });
  }),
);

expensesRouter.post(
  '/',
  authorize('expenses:write'),
  validate({ body: createExpenseSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createExpenseSchema>;
    const reference = `EXP-${startOfLocalDay(input.paidAt)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')}-${Date.now().toString(36).toUpperCase().slice(0, 6)}`;

    // Link the expense to the till that paid it, when the cashier has an open
    // shift for the selected warehouse (or any open shift if none was chosen).
    const shift = input.warehouseId
      ? await findOpenShiftForWarehouse(prisma, req.user!.id, input.warehouseId)
      : await findOpenShift(prisma, req.user!.id);

    const created = await prisma.expense.create({
      data: {
        reference,
        category: input.category,
        descriptionAr: input.descriptionAr,
        descriptionEn: input.descriptionEn ?? null,
        amount: new Prisma.Decimal(input.amount),
        paidAt: startOfLocalDay(input.paidAt),
        paidById: req.user!.id,
        warehouseId: input.warehouseId ?? null,
        shiftId: shift?.id ?? null,
        notes: input.notes ?? null,
        isActive: true,
      },
      include: { paidBy: { select: { fullName: true } } },
    });

    await recordAudit(
      {
        action: 'expense.created',
        entityType: 'Expense',
        entityId: created.id,
        after: { reference, category: input.category, amount: input.amount, paidAt: input.paidAt },
        userId: req.user!.id,
      },
      prisma,
    );

    res.status(201).json({
      id: created.id,
      reference: created.reference,
      category: created.category,
      descriptionAr: created.descriptionAr,
      descriptionEn: created.descriptionEn,
      amount: created.amount.toString(),
      paidAt: created.paidAt.toISOString(),
      paidBy: created.paidBy.fullName,
      warehouseId: created.warehouseId,
      warehouseNameAr: null,
      notes: created.notes,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    });
  }),
);

expensesRouter.patch(
  '/:id',
  authorize('expenses:write'),
  validate({ params: idParams, body: updateExpenseSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateExpenseSchema>;
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('المصروف غير موجود');

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.descriptionAr !== undefined ? { descriptionAr: input.descriptionAr } : {}),
        ...(input.descriptionEn !== undefined ? { descriptionEn: input.descriptionEn ?? null } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.paidAt !== undefined ? { paidAt: startOfLocalDay(input.paidAt) } : {}),
        ...(input.warehouseId !== undefined ? { warehouseId: input.warehouseId ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { paidBy: { select: { fullName: true } }, warehouse: { select: { nameAr: true } } },
    });

    await recordAudit(
      {
        action: 'expense.updated',
        entityType: 'Expense',
        entityId: updated.id,
        before: {
          category: existing.category,
          amount: existing.amount.toString(),
          isActive: existing.isActive,
        },
        after: {
          category: updated.category,
          amount: updated.amount.toString(),
          isActive: updated.isActive,
        },
        userId: req.user!.id,
      },
      prisma,
    );

    res.status(200).json({
      id: updated.id,
      reference: updated.reference,
      category: updated.category,
      categoryLabelAr: updated.category,
      categoryLabelEn: updated.category,
      descriptionAr: updated.descriptionAr,
      descriptionEn: updated.descriptionEn,
      amount: updated.amount.toString(),
      paidAt: updated.paidAt.toISOString(),
      paidBy: updated.paidBy.fullName,
      warehouseId: updated.warehouseId,
      warehouseNameAr: updated.warehouse?.nameAr ?? null,
      notes: updated.notes,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    });
  }),
);

expensesRouter.delete(
  '/:id',
  authorize('expenses:delete'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('المصروف غير موجود');

    await prisma.expense.delete({ where: { id: req.params.id } });

    await recordAudit(
      {
        action: 'expense.deleted',
        entityType: 'Expense',
        entityId: req.params.id,
        before: { reference: existing.reference, category: existing.category, amount: existing.amount.toString() },
        after: null,
        userId: req.user!.id,
      },
      prisma,
    );

    res.status(200).json({ id: req.params.id, deleted: true });
  }),
);
