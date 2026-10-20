import { Router } from 'express';
import { z } from 'zod';
import { buildPaginated, categoryQuerySchema, createCategorySchema, idSchema, updateCategorySchema } from '@pharmacy/shared';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

categoriesRouter.get(
  '/',
  authorize('products:read'),
  validate({ query: categoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof categoryQuerySchema>;
    const where: Prisma.CategoryWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q
        ? {
            OR: [
              { nameAr: { contains: query.q, mode: 'insensitive' as const } },
              { nameEn: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.category.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: [{ nameAr: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.category.count({ where }),
    ]);

    res.status(200).json(
      buildPaginated(
        items.map((item) => ({
          id: item.id,
          code: item.code,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          parentId: item.parentId,
          isActive: item.isActive,
          productCount: item._count.products,
        })),
        total,
        query.page,
        query.pageSize,
      ),
    );
  }),
);

categoriesRouter.post(
  '/',
  authorize('products:write'),
  validate({ body: createCategorySchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createCategorySchema>;
    const code = input.code.trim().toUpperCase();
    const clash = await prisma.category.findUnique({ where: { code } });
    if (clash) throw new ConflictError(`كود التصنيف مستخدم بالفعل: ${code}`);

    const created = await prisma.category.create({
      data: {
        code,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        parentId: input.parentId ?? null,
        isActive: input.isActive,
      },
    });
    await recordAudit(
      {
        action: 'category.created',
        entityType: 'Category',
        entityId: created.id,
        after: { code, nameAr: input.nameAr },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(201).json(created);
  }),
);

categoriesRouter.patch(
  '/:id',
  authorize('products:write'),
  validate({ params: idParams, body: updateCategorySchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateCategorySchema>;
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('التصنيف غير موجود');

    const updated = await prisma.category.update({
      where: { id: req.params.id },
      data: {
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn ?? null } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await recordAudit(
      {
        action: 'category.updated',
        entityType: 'Category',
        entityId: updated.id,
        before: { nameAr: existing.nameAr, isActive: existing.isActive },
        after: { nameAr: updated.nameAr, isActive: updated.isActive },
        userId: req.user!.id,
      },
      prisma,
    );
    res.status(200).json(updated);
  }),
);

categoriesRouter.delete(
  '/:id',
  authorize('products:delete'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!existing) throw new NotFoundError('التصنيف غير موجود');
    if ((existing._count?.products ?? 0) > 0 || (existing._count?.children ?? 0) > 0) {
      const deactivated = await prisma.category.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      res.status(200).json({ deleted: false, deactivated: true, category: deactivated });
      return;
    }
    await prisma.category.delete({ where: { id: req.params.id } });
    await recordAudit(
      { action: 'category.deleted', entityType: 'Category', entityId: req.params.id, userId: req.user!.id },
      prisma,
    );
    res.status(200).json({ deleted: true, deactivated: false });
  }),
);
