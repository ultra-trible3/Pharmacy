import { z } from 'zod';
import { ROLES } from '../permissions.js';
import { paginationSchema, idSchema } from './common.js';

/** Valid roles for user management. */
export const userRoleSchema = z.enum(ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Core user fields returned by API. */
export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  email: z.string().email().nullable(),
  role: userRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type User = z.infer<typeof userSchema>;

/** Paginated user list response. */
export const userListResponseSchema = paginationSchema.extend({
  items: z.array(userSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

/** Create user input (admin only). */
export const createUserSchema = z
  .object({
    username: z.string().trim().min(3, 'اسم المستخدم مطلوب').max(64).toLowerCase(),
    fullName: z.string().trim().min(2, 'الاسم الكامل مطلوب').max(128),
    email: z.string().trim().email('بريد إلكتروني غير صالح').max(255).optional().or(z.literal('')),
    role: userRoleSchema,
    password: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .max(200)
      .regex(/[A-Za-z]/u, 'يجب أن تحتوي على حرف')
      .regex(/\d/u, 'يجب أن تحتوي على رقم'),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Update user input (admin only). */
export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(128).optional(),
    email: z.string().trim().email().max(255).optional().or(z.literal('')).nullable(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'يجب توفير حقل واحد على الأقل للتحديث');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Reset password input (admin only). */
export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .max(200)
      .regex(/[A-Za-z]/u, 'يجب أن تحتوي على حرف')
      .regex(/\d/u, 'يجب أن تحتوي على رقم'),
    /** Force user to change password on next login. */
    mustChangePassword: z.boolean().default(true),
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Query parameters for user list with filters. */
export const userQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(128).optional(),
  role: userRoleSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  sortBy: z.enum(['username', 'fullName', 'role', 'isActive', 'lastLoginAt', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type UserQuery = z.infer<typeof userQuerySchema>;

/** User summary for audit logs and references. */
export const userSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
});
export type UserSummary = z.infer<typeof userSummarySchema>;