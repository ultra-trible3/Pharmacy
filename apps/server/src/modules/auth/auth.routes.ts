import { Router } from 'express';
import { changePasswordSchema, loginSchema, refreshSchema } from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  name: 'auth:login',
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'محاولات تسجيل دخول كثيرة جدًا. حاول مرة أخرى بعد قليل',
});

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const session = await authService.login(req.body, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
      terminalId: req.header('x-terminal-id') ?? undefined,
    });
    res.status(200).json(session);
  }),
);

authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const session = await authService.refresh(req.body.refreshToken, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
      terminalId: req.header('x-terminal-id') ?? undefined,
    });
    res.status(200).json(session);
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout(req.user!.sessionId, req.user!.id);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await authService.getSessionUser(req.user!.id);
    res.status(200).json(result);
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.changePassword(req.user!.id, req.body, req.user!.sessionId);
    res.status(204).send();
  }),
);
