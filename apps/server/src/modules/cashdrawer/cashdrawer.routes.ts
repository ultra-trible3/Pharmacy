import { Router } from 'express';
import { z } from 'zod';
import {
  buildPaginated,
  cashDrawerQuerySchema,
  cashMovementSchema,
  closeShiftSchema,
  idSchema,
  openShiftSchema,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as cashdrawerService from './cashdrawer.service.js';

export const cashdrawerRouter = Router();
cashdrawerRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

/** GET /cashdrawer — list shifts / cash drawers with filters and summary. */
cashdrawerRouter.get(
  '/',
  authorize('cashdrawer:read'),
  validate({ query: cashDrawerQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof cashDrawerQuerySchema>;
    const result = await cashdrawerService.listShifts(query);
    res.status(200).json({
      ...buildPaginated(result.items, result.total, query.page, query.pageSize),
      summary: result.summary,
    });
  }),
);

/** POST /cashdrawer/open — open a new shift. */
cashdrawerRouter.post(
  '/open',
  authorize('cashdrawer:open'),
  validate({ body: openShiftSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as unknown as z.infer<typeof openShiftSchema>;
    const terminalId = req.header('x-terminal-id') ?? null;
    const created = await cashdrawerService.openShift(input, req.user!, terminalId);
    res.status(201).json(created);
  }),
);

/** GET /cashdrawer/:id — shift details and reconciliation snapshot. */
cashdrawerRouter.get(
  '/:id',
  authorize('cashdrawer:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const detail = await cashdrawerService.getShiftDetail(req.params.id!);
    res.status(200).json(detail);
  }),
);

/** PATCH /cashdrawer/:id/close — close a shift and freeze its reconciliation. */
cashdrawerRouter.patch(
  '/:id/close',
  authorize('cashdrawer:open'),
  validate({ params: idParams, body: closeShiftSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof closeShiftSchema>;
    const closed = await cashdrawerService.closeShift(req.params.id!, input, req.user!);
    res.status(200).json(closed);
  }),
);

/** POST /cashdrawer/:id/movements — paid-in / paid-out cash adjustment. */
cashdrawerRouter.post(
  '/:id/movements',
  authorize('cashdrawer:open'),
  validate({ params: idParams, body: cashMovementSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof cashMovementSchema>;
    const movement = await cashdrawerService.addCashMovement(req.params.id!, input, req.user!);
    res.status(201).json(movement);
  }),
);
