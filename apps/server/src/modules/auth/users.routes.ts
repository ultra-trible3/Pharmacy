import { Router } from 'express';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  userQuerySchema,
  userRoleSchema,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { recordAudit } from '../../lib/audit.js';
import * as authService from './auth.service.js';

export const usersRouter = Router();

/** All user management routes require authentication + users:manage permission. */
usersRouter.use(authenticate);
usersRouter.use(authorize('users:manage'));

/** List users with pagination, search, and filters. */
usersRouter.get(
  '/',
  validate({ query: userQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, pageSize, search, role, isActive, sortBy, sortOrder } = req.query as unknown as {
      page: number;
      pageSize: number;
      search?: string;
      role?: string;
      isActive?: boolean;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    };

    const result = await authService.listUsers({
      page,
      pageSize,
      search,
      role: role as any,
      isActive,
      sortBy,
      sortOrder,
    });

    res.status(200).json({
      items: result.items,
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    });
  }),
);

/** Get a single user by ID. */
usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await authService.getUserById(req.params.id!);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المستخدم غير موجود' } });
    }
    res.status(200).json(user);
  }),
);

/** Create a new user. */
usersRouter.post(
  '/',
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const user = await authService.createUser({
      ...req.body,
      role: req.body.role,
    });
    await recordAudit({
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      userId: req.user!.id,
      after: { username: user.username, fullName: user.fullName, role: user.role },
    });
    res.status(201).json(user);
  }),
);

/** Update user details (fullName, email, role, isActive). */
usersRouter.patch(
  '/:id',
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const updated = await authService.updateUser(req.params.id!, req.body, req.user!.id);
    res.status(200).json(updated);
  }),
);

/** Reset user password (admin action). */
usersRouter.post(
  '/:id/reset-password',
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.resetUserPassword(req.params.id!, req.body, req.user!.id);
    res.status(204).send();
  }),
);

/** Deactivate user (soft delete). */
usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await authService.deactivateUser(req.params.id!, req.user!.id);
    res.status(204).send();
  }),
);