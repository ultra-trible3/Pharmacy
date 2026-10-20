import { Router } from 'express';
import { z } from 'zod';
import {
  createWarehouseSchema,
  idSchema,
  updateWarehouseSchema,
  warehouseQuerySchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
  type WarehouseQuery,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { createWarehouse, listWarehouses, updateWarehouse } from './warehouses.service.js';

export const warehousesRouter = Router();
warehousesRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

/**
 * Kept as a plain array for backward compatibility with every warehouse
 * dropdown in the app. Statistics are additive (`stats`) and opt-in.
 */
warehousesRouter.get(
  '/',
  authorize('inventory:read'),
  validate({ query: warehouseQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as WarehouseQuery;
    const warehouses = await listWarehouses(query, req.user!.role);
    res.status(200).json(warehouses);
  }),
);

warehousesRouter.post(
  '/',
  authorize('inventory:adjust'),
  validate({ body: createWarehouseSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as CreateWarehouseInput;
    const created = await createWarehouse(input, req.user!.id);
    res.status(201).json(created);
  }),
);

warehousesRouter.patch(
  '/:id',
  authorize('inventory:adjust'),
  validate({ params: idParams, body: updateWarehouseSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as UpdateWarehouseInput;
    const updated = await updateWarehouse(req.params.id as string, input, req.user!.id);
    res.status(200).json(updated);
  }),
);
