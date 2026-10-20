/**
 * Roles and permission model.
 *
 * The permission matrix is the single source of truth shared by:
 *  - the API server (authorisation middleware),
 *  - the Electron main process (IPC channel guarding),
 *  - the renderer (menu/button visibility).
 *
 * The server ALWAYS re-checks permissions; the renderer checks are cosmetic.
 */

export const ROLES = [
  'OWNER',
  'MANAGER',
  'PHARMACIST',
  'CASHIER',
  'INVENTORY_CLERK',
  'ACCOUNTANT',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // catalogue
  'products:read',
  'products:write',
  'products:delete',
  // inventory
  'inventory:read',
  'inventory:adjust',
  'batches:read',
  // suppliers & purchasing
  'suppliers:read',
  'suppliers:write',
  'purchases:read',
  'purchases:write',
  'purchases:delete',
  // sales
  'sales:read',
  'sales:create',
  'sales:refund',
  'sales:discount',
  // money & reporting
  'cost:view',
  'reports:operational',
  'reports:financial',
  'expenses:read',
  'expenses:write',
  'expenses:delete',
  // register & cash drawer / shifts
  'register:operate',
  'cashdrawer:open',
  'cashdrawer:read',
  // administration
  'users:manage',
  'settings:manage',
  'audit:read',
  'backup:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * Role -> granted permissions.
 * `OWNER` implicitly holds every permission (see {@link hasPermission}).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter(
    (p) => !['users:manage', 'settings:manage', 'backup:manage'].includes(p),
  ),
  PHARMACIST: [
    'products:read',
    'products:write',
    'inventory:read',
    'inventory:adjust',
    'batches:read',
    'suppliers:read',
    'purchases:read',
    'sales:read',
    'sales:create',
    'sales:refund',
    'sales:discount',
    'cost:view',
    'reports:operational',
    'register:operate',
    'cashdrawer:open',
    'cashdrawer:read',
  ],
  CASHIER: [
    'products:read',
    'inventory:read',
    'batches:read',
    'sales:read',
    'sales:create',
    'register:operate',
    'cashdrawer:open',
    'cashdrawer:read',
  ],
  INVENTORY_CLERK: [
    'products:read',
    'products:write',
    'inventory:read',
    'inventory:adjust',
    'batches:read',
    'suppliers:read',
    'suppliers:write',
    'purchases:read',
    'purchases:write',
    'cost:view',
    'reports:operational',
  ],
  ACCOUNTANT: [
    'products:read',
    'inventory:read',
    'batches:read',
    'suppliers:read',
    'purchases:read',
    'sales:read',
    'cost:view',
    'reports:operational',
    'reports:financial',
    'expenses:read',
    'expenses:write',
    'expenses:delete',
    'audit:read',
  ],
};

/** True when `role` is granted `permission`. OWNER holds every permission. */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === 'OWNER') return true;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** True when `role` is granted every permission in `permissions`. */
export function hasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/** Effective permission list for a role (expanded for OWNER). */
export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export const ROLE_LABELS_AR: Record<Role, string> = {
  OWNER: 'مالك',
  MANAGER: 'مدير',
  PHARMACIST: 'صيدلي',
  CASHIER: 'كاشير',
  INVENTORY_CLERK: 'أمين مخزن',
  ACCOUNTANT: 'محاسب',
};

export const ROLE_LABELS_EN: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  PHARMACIST: 'Pharmacist',
  CASHIER: 'Cashier',
  INVENTORY_CLERK: 'Inventory Clerk',
  ACCOUNTANT: 'Accountant',
};

/** Module -> base permissions mapping for the permissions matrix UI. */
export const MODULE_PERMISSIONS: Record<string, string[]> = {
  dashboard: ['dashboard:view'],
  pos: ['pos:access', 'pos:create_sale', 'pos:apply_discount', 'pos:void_sale', 'pos:refund'],
  products: ['products:read', 'products:write', 'products:delete'],
  inventory: ['inventory:read', 'inventory:adjust', 'batches:read', 'inventory:count'],
  suppliers: ['suppliers:read', 'suppliers:write'],
  purchases: ['purchases:read', 'purchases:write', 'purchases:delete', 'purchases:approve'],
  categories: ['categories:read', 'categories:write'],
  customers: ['customers:read', 'customers:write'],
  debts: ['debts:view', 'debts:collect_payment'],
  sales: ['sales:read', 'sales:create', 'sales:cancel', 'sales:discount'],
  invoices: ['invoices:view', 'invoices:print'],
  returns: ['returns:create', 'returns:approve'],
  reports: ['reports:view', 'reports:operational', 'reports:financial'],
  expenses: ['expenses:read', 'expenses:write', 'expenses:delete', 'expenses:approve'],
  shifts: ['shifts:open', 'shifts:close'],
  audit: ['audit:read'],
  settings: ['settings:manage'],
};
