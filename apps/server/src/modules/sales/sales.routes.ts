import { Router } from 'express';
import { z } from 'zod';
import {
  bestSellerQuerySchema,
  idSchema,
  recentSalesQuerySchema,
  saleCreateSchema,
  saleQuerySchema,
  saleSuspendSchema,
  saleVoidSchema,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as salesService from './sales.service.js';

export const salesRouter = Router();
salesRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

// NOTE: literal paths (`/suspended`, `/best-sellers`, `/recent`) are declared
// before `/:id` so they are never captured as an id.

salesRouter.get(
  '/',
  authorize('sales:read'),
  validate({ query: saleQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await salesService.listSales(
      req.query as never,
      req.user!.role,
    );
    res.status(200).json(result);
  }),
);

salesRouter.get(
  '/suspended',
  authorize('sales:read'),
  asyncHandler(async (_req, res) => {
    const result = await salesService.listSuspendedSales(_req.user!.role);
    res.status(200).json(result);
  }),
);

salesRouter.get(
  '/best-sellers',
  authorize('sales:read'),
  validate({ query: bestSellerQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await salesService.getBestSellers(
      req.query as never,
      req.user!.role,
    );
    res.status(200).json(result);
  }),
);

salesRouter.get(
  '/recent',
  authorize('sales:read'),
  validate({ query: recentSalesQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await salesService.getRecentSales(
      req.query as never,
      req.user!.role,
    );
    res.status(200).json(result);
  }),
);

salesRouter.get(
  '/:id',
  authorize('sales:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const sale = await salesService.getSaleDto(req.params.id!, req.user!.role);
    res.status(200).json(sale);
  }),
);

salesRouter.post(
  '/',
  authorize('sales:create'),
  rateLimit({ name: 'sales:create', windowMs: 60_000, max: 240 }),
  validate({ body: saleCreateSchema }),
  asyncHandler(async (req, res) => {
    const sale = await salesService.createSale(req.body, req.user!, {
      status: 'COMPLETED',
    });
    res.status(201).json(sale);
  }),
);

salesRouter.post(
  '/suspend',
  authorize('sales:create'),
  rateLimit({ name: 'sales:suspend', windowMs: 60_000, max: 120 }),
  validate({ body: saleSuspendSchema }),
  asyncHandler(async (req, res) => {
    const sale = await salesService.createSale(req.body, req.user!, {
      status: 'SUSPENDED',
    });
    res.status(201).json(sale);
  }),
);

salesRouter.post(
  '/:id/resume',
  authorize('sales:create'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const sale = await salesService.resumeSale(req.params.id!, req.user!.role);
    res.status(200).json(sale);
  }),
);

salesRouter.post(
  '/:id/void',
  authorize('sales:refund'),
  validate({ params: idParams, body: saleVoidSchema }),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as { reason: string };
    const sale = await salesService.voidSale(req.params.id!, reason, req.user!);
    res.status(200).json(sale);
  }),
);
