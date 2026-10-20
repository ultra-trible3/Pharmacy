import { Router } from 'express';
import { z } from 'zod';
import {
  buildPaginated,
  createSupplierSchema,
  idSchema,
  supplierQuerySchema,
  updateSupplierSchema,
} from '@pharmacy/shared';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';

export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

suppliersRouter.get(
  '/',
  authorize('suppliers:read'),
  validate({ query: supplierQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof supplierQuerySchema>;
    const where: Prisma.SupplierWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q
        ? {
            OR: [
              { nameAr: { contains: query.q, mode: 'insensitive' as const } },
              { nameEn: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: [{ nameAr: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.supplier.count({ where }),
    ]);

    res.status(200).json(
      buildPaginated(
        items.map((item) => ({
          id: item.id,
          code: item.code,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          phone: item.phone,
          email: item.email,
          address: item.address,
          taxNumber: item.taxNumber,
          balance: item.balance.toFixed(2),
          isActive: item.isActive,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        total,
        query.page,
        query.pageSize,
      ),
    );
  }),
);

suppliersRouter.post(
  '/',
  authorize('suppliers:write'),
  validate({ body: createSupplierSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSupplierSchema>;
    const code = input.code.trim().toUpperCase();
    const clash = await prisma.supplier.findUnique({ where: { code } });
    if (clash) throw new ConflictError(`كود المورد مستخدم بالفعل: ${code}`);

    const created = await prisma.supplier.create({
      data: {
        code,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        taxNumber: input.taxNumber ?? null,
        openingBalance: new Prisma.Decimal(input.openingBalance),
        balance: new Prisma.Decimal(input.openingBalance),
        isActive: input.isActive,
      },
    });
    await recordAudit(
      {
        action: 'supplier.created',
        entityType: 'Supplier',
        entityId: created.id,
        after: { code, nameAr: input.nameAr },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(201).json({ ...created, balance: created.balance.toFixed(2) });
  }),
);

suppliersRouter.patch(
  '/:id',
  authorize('suppliers:write'),
  validate({ params: idParams, body: updateSupplierSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSupplierSchema>;
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('المورد غير موجود');

    const updated = await prisma.supplier.update({
      where: { id: req.params.id },
      data: {
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await recordAudit(
      {
        action: 'supplier.updated',
        entityType: 'Supplier',
        entityId: updated.id,
        before: { nameAr: existing.nameAr, isActive: existing.isActive },
        after: { nameAr: updated.nameAr, isActive: updated.isActive },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(200).json({ ...updated, balance: updated.balance.toFixed(2) });
  }),
);

/**
 * Deletes a supplier only when it has never received stock and owes nothing.
 * Any supplier with batches or an outstanding payable balance is deactivated
 * instead, preserving the stock and payables ledger.
 */
suppliersRouter.delete(
  '/:id',
  authorize('suppliers:write'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
        include: { _count: { select: { batches: true } } },
      });
      if (!supplier) throw new NotFoundError('المورد غير موجود');

      const hasHistory = (supplier._count?.batches ?? 0) > 0;
      const hasBalance = !supplier.balance.isZero();

      if (hasHistory || hasBalance) {
        await tx.supplier.update({ where: { id }, data: { isActive: false } });
        await recordAudit(
          {
            action: 'supplier.deactivated',
            entityType: 'Supplier',
            entityId: id,
            before: { isActive: supplier.isActive },
            after: { isActive: false },
            userId: req.user!.id,
          },
          tx,
        );
        return {
          deleted: false,
          deactivated: true,
          reason: 'المورد له حركات أو رصيد مستحق، تم إيقافه بدلًا من الحذف للحفاظ على السجل',
        };
      }

      await tx.supplier.delete({ where: { id } });
      await recordAudit(
        {
          action: 'supplier.deleted',
          entityType: 'Supplier',
          entityId: id,
          before: { code: supplier.code, nameAr: supplier.nameAr },
          userId: req.user!.id,
        },
        tx,
      );
      return { deleted: true, deactivated: false };
    });
    res.status(200).json(result);
  }),
);
