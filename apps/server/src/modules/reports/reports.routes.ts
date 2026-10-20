import { Router } from 'express';
import { salesReportQuerySchema } from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as reportsService from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get(
  '/sales',
  authorize('sales:read'),
  validate({ query: salesReportQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await reportsService.getSalesReport(req.query as never, req.user!.role);
    res.status(200).json(result);
  }),
);

reportsRouter.get(
  '/inventory',
  authorize('inventory:read'),
  asyncHandler(async (req, res) => {
    const result = await reportsService.getInventoryReport(req.user!.role);
    res.status(200).json(result);
  }),
);
