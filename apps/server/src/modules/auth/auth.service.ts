import type { AuthSession, AuthUser, Permission } from '@pharmacy/shared';
import { permissionsForRole, type Role } from '@pharmacy/shared';
import { env } from '../../env.js';
import { prisma } from '../../prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, UnauthenticatedError, ValidationError } from '../../lib/errors.js';
import { getDummyHash, hashPassword, verifyPassword } from '../../lib/password.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens.js';

export interface LoginContext {
  ip?: string;
  userAgent?: string;
  terminalId?: string;
}

interface UserRecord {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role as Role,
    isActive: user.isActive,
  };
}

async function createSessionFor(user: UserRecord, context: LoginContext): Promise<AuthSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      terminalId: context.terminalId ?? null,
    },
  });

  const { token, expiresIn } = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role as Role,
    sid: session.id,
  });

  return {
    user: toAuthUser(user),
    accessToken: token,
    refreshToken,
    accessTokenExpiresIn: expiresIn,
    permissions: permissionsForRole(user.role as Role) as Permission[],
  };
}

/**
 * Authenticates a user with Argon2id.
 *
 * Throttling: after `MAX_LOGIN_ATTEMPTS` consecutive failures the account is
 * locked for `LOGIN_LOCK_MINUTES`. Unknown usernames still perform a dummy
 * verification so response time does not reveal whether the account exists.
 */
export async function login(
  input: { username: string; password: string; terminalId?: string },
  context: LoginContext = {},
): Promise<AuthSession> {
  const username = input.username.trim().toLowerCase();
  const user = (await prisma.user.findUnique({ where: { username } })) as UserRecord | null;

  if (!user) {
    await verifyPassword(input.password, await getDummyHash());
    throw new UnauthenticatedError('اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new UnauthenticatedError(
      `الحساب مقفل مؤقتًا بسبب محاولات دخول خاطئة. أعد المحاولة بعد ${minutes} دقيقة`,
    );
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= env.MAX_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) : null,
      },
    });
    await recordAudit({
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      after: { attempts, locked: shouldLock },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      terminalId: context.terminalId ?? input.terminalId ?? null,
    });
    throw new UnauthenticatedError(
      shouldLock
        ? `تم قفل الحساب مؤقتًا لمدة ${env.LOGIN_LOCK_MINUTES} دقيقة بسبب تكرار المحاولات الخاطئة`
        : 'اسم المستخدم أو كلمة المرور غير صحيحة',
    );
  }

  if (!user.isActive) {
    throw new UnauthenticatedError('الحساب غير مُفعّل، تواصل مع مدير النظام');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const session = await createSessionFor(user, { ...context, terminalId: input.terminalId ?? context.terminalId });

  await recordAudit({
    action: 'auth.login.success',
    entityType: 'User',
    entityId: user.id,
    userId: user.id,
    after: { role: user.role },
  });

  return session;
}

/** Exchanges a valid refresh token for a new session (rotation on every use). */
export async function refresh(
  refreshToken: string,
  context: LoginContext = {},
): Promise<AuthSession> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('جلسة غير صالحة، يرجى إعادة تسجيل الدخول');
  }
  if (!session.user.isActive) {
    throw new UnauthenticatedError('الحساب غير مُفعّل');
  }

  // Rotate: revoke the old session, issue a brand new one.
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const user = session.user as unknown as UserRecord;
  const next = await createSessionFor(user, {
    ip: context.ip ?? session.ip ?? undefined,
    userAgent: context.userAgent ?? session.userAgent ?? undefined,
    terminalId: context.terminalId ?? session.terminalId ?? undefined,
  });

  await recordAudit({
    action: 'auth.refresh',
    entityType: 'Session',
    entityId: session.id,
    userId: user.id,
  });

  return next;
}

/** Revokes a single session (this terminal). */
export async function logout(sessionId: string, userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    action: 'auth.logout',
    entityType: 'Session',
    entityId: sessionId,
    userId,
  });
}

/** Revokes every active session for a user (e.g. after a password change). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  keepSessionId?: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthenticatedError();

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw new ValidationError('كلمة المرور الحالية غير صحيحة');

  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new ConflictError('كلمة المرور الجديدة مطابقة للحالية');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
    },
  });

  await revokeAllSessions(userId, keepSessionId);
  await recordAudit({
    action: 'auth.password.changed',
    entityType: 'User',
    entityId: userId,
    userId,
  });
}

export async function getSessionUser(userId: string): Promise<{
  user: AuthUser;
  permissions: Permission[];
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new UnauthenticatedError();
  return {
    user: toAuthUser(user as unknown as UserRecord),
    permissions: permissionsForRole(user.role as Role) as Permission[],
  };
}

/** Utility used by the seed script and future user-management endpoints. */
export async function createUser(input: {
  username: string;
  fullName: string;
  password: string;
  role: Role;
  email?: string;
}): Promise<AuthUser> {
  const username = input.username.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new ConflictError(`اسم المستخدم مستخدم بالفعل: ${username}`);

  const user = await prisma.user.create({
    data: {
      username,
      fullName: input.fullName,
      email: input.email ?? null,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
  return toAuthUser(user as unknown as UserRecord);
}

/** List users with pagination and filters (requires users:manage). */
export async function listUsers(params: {
  page: number;
  pageSize: number;
  search?: string;
  role?: Role;
  isActive?: boolean;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}): Promise<{ items: AuthUser[]; total: number }> {
  const where: Record<string, unknown> = {};

  if (params.search) {
    where.OR = [
      { username: { contains: params.search, mode: 'insensitive' } },
      { fullName: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.role) where.role = params.role;
  if (params.isActive !== undefined) where.isActive = params.isActive;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortOrder },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map(toAuthUser),
    total,
  };
}

/** Get a single user by ID (requires users:manage). */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return toAuthUser(user as unknown as UserRecord);
}

/** Update user fields (requires users:manage). */
export async function updateUser(
  userId: string,
  input: { fullName?: string; email?: string | null; role?: Role; isActive?: boolean },
  actorId: string,
): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ValidationError('المستخدم غير موجود');

  // Prevent self-demotion/removal of last OWNER
  if (existing.role === 'OWNER' && existing.id === actorId) {
    if (input.role && input.role !== 'OWNER') {
      throw new ValidationError('لا يمكنك تعديل دورك الخاص من OWNER');
    }
    if (input.isActive === false) {
      throw new ValidationError('لا يمكنك تعطيل حسابك الخاص كـ OWNER');
    }
  }

  // Check if this would leave zero active OWNERs
  if (existing.role === 'OWNER' && (input.isActive === false || (input.role && input.role !== 'OWNER'))) {
    const activeOwners = await prisma.user.count({
      where: { role: 'OWNER', isActive: true, id: { not: userId } },
    });
    if (activeOwners === 0) {
      throw new ValidationError('يجب أن يبقى مستخدم OWNER واحد نشط على الأقل');
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined && { fullName: input.fullName }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });

  await recordAudit({
    action: 'user.updated',
    entityType: 'User',
    entityId: userId,
    userId: actorId,
    before: {
      fullName: existing.fullName,
      email: existing.email,
      role: existing.role,
      isActive: existing.isActive,
    },
    after: {
      fullName: updated.fullName,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    },
  });

  return toAuthUser(updated as unknown as UserRecord);
}

/** Reset user password (requires users:manage). */
export async function resetUserPassword(
  userId: string,
  input: { newPassword: string; mustChangePassword: boolean },
  actorId: string,
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ValidationError('المستخدم غير موجود');

  // Prevent self-password-reset bypass
  if (existing.id === actorId) {
    throw new ValidationError('استخدم "تغيير كلمة المرور" لتعديل كلمة مرورك الخاصة');
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: input.mustChangePassword,
    },
  });

  // Revoke all sessions to force re-login
  await revokeAllSessions(userId);

  await recordAudit({
    action: 'user.password.reset',
    entityType: 'User',
    entityId: userId,
    userId: actorId,
    after: { mustChangePassword: input.mustChangePassword },
  });
}

/** Deactivate user (soft delete - requires users:manage). */
export async function deactivateUser(userId: string, actorId: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ValidationError('المستخدم غير موجود');

  // Prevent self-deactivation
  if (existing.id === actorId) {
    throw new ValidationError('لا يمكنك تعطيل حسابك الخاص');
  }

  // Check if this would leave zero active OWNERs
  if (existing.role === 'OWNER') {
    const activeOwners = await prisma.user.count({
      where: { role: 'OWNER', isActive: true, id: { not: userId } },
    });
    if (activeOwners === 0) {
      throw new ValidationError('يجب أن يبقى مستخدم OWNER واحد نشط على الأقل');
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });

  // Revoke all sessions
  await revokeAllSessions(userId);

  await recordAudit({
    action: 'user.deactivated',
    entityType: 'User',
    entityId: userId,
    userId: actorId,
    before: { isActive: true, role: existing.role },
    after: { isActive: false, role: existing.role },
  });
}
