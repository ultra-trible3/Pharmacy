import { z } from 'zod';
import { ROLES } from '../permissions.js';

export const loginSchema = z.object({
  username: z.string().trim().min(3, 'اسم المستخدم مطلوب').max(64),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل').max(200),
  /** Optional terminal identifier, recorded in the audit log. */
  terminalId: z.string().trim().max(64).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(200),
    newPassword: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .max(200)
      .regex(/[A-Za-z]/u, 'يجب أن تحتوي على حرف')
      .regex(/\d/u, 'يجب أن تحتوي على رقم'),
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const roleSchema = z.enum(ROLES);
export type RoleInput = z.infer<typeof roleSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresIn: z.number().int().positive(),
  permissions: z.array(z.string()),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
