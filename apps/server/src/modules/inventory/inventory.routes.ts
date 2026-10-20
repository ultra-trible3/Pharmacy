import { Router } from 'express';
import { z } from 'zod';
import {
  inventoryQuerySchema,
  movementQuerySchema,
  stockAdjustmentSchema,
  stockReceiptSchema,
  stockReceiptItemSchema,
  stockTransferSchema,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as inventoryService from './inventory.service.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

const alertsQuery = z.object({
  warehouseId: z.string().trim().max(64).optional(),
});

inventoryRouter.post(
  "/batches",
  authorize("inventory:adjust"),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof stockReceiptItemSchema> & { warehouseId: string };
    const result = await inventoryService.upsertBatchRaw(body, req.user!.id);
    res.status(201).json(result);
  }),
);

inventoryRouter.patch(
  "/batches/:id",
  authorize("inventory:adjust"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const input = req.body as {
      quantity?: number;
      costPrice?: string;
      salePrice?: string;
      expiryDate?: string;
    };
    const result = await inventoryService.updateBatch(id as string, input, req.user!.id);
    res.status(200).json(result);
  }),
);

inventoryRouter.delete(
  "/batches/:id",
  authorize("inventory:adjust"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await inventoryService.deactivateBatch(id as string, req.user!.id);
    res.status(200).json(result);
  }),
);

inventoryRouter.get(
  '/batches',
  authorize('inventory:read'),
  validate({ query: inventoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.listBatches(
      req.query as never,
      req.user!.role,
    );
    res.status(200).json(result);
  }),
);

inventoryRouter.get(
  '/stock',
  authorize('inventory:read'),
  validate({ query: inventoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.listStockLevels(
      req.query as never,
      req.user!.role,
    );
    res.status(200).json(result);
  }),
);

inventoryRouter.get(
  '/alerts',
  authorize('inventory:read'),
  validate({ query: alertsQuery }),
  asyncHandler(async (req, res) => {
    const { warehouseId } = req.query as z.infer<typeof alertsQuery>;
    const alerts = await inventoryService.getAlerts(req.user!.role, warehouseId);
    res.status(200).json(alerts);
  }),
);

inventoryRouter.get(
  '/movements',
  authorize('inventory:read'),
  validate({ query: movementQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.listMovements(req.query as never);
    res.status(200).json(result);
  }),
);

inventoryRouter.post(
  '/receipts',
  authorize('inventory:adjust'),
  rateLimit({ name: 'inventory:receipts', windowMs: 60_000, max: 120 }),
  validate({ body: stockReceiptSchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.receiveStock(req.body, req.user!.id);
    res.status(201).json(result);
  }),
);

inventoryRouter.post(
  '/adjustments',
  authorize('inventory:adjust'),
  rateLimit({ name: 'inventory:adjustments', windowMs: 60_000, max: 240 }),
  validate({ body: stockAdjustmentSchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.adjustStock(req.body, req.user!.id);
    res.status(201).json(result);
  }),
);

inventoryRouter.post(
  '/transfers',
  authorize('inventory:adjust'),
  rateLimit({ name: 'inventory:transfers', windowMs: 60_000, max: 120 }),
  validate({ body: stockTransferSchema }),
  asyncHandler(async (req, res) => {
    const result = await inventoryService.transferStock(req.body, req.user!.id);
    res.status(201).json(result);
  }),
);
