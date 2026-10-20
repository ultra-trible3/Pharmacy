import { PERMISSIONS, type Permission, type Role } from '@pharmacy/shared';
import type { TranslationKey } from '../i18n/dictionaries';

/** A permission group (module) with the permissions that belong to it. */
export interface PermissionGroup {
  module: string;
  permissions: Permission[];
}

/**
 * Permission modules in the order they appear in {@link PERMISSIONS},
 * each with the permissions that belong to it.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const groups = new Map<string, Permission[]>();

  PERMISSIONS.forEach((permission) => {
    const module = permission.split(':')[0] ?? permission;
    const list = groups.get(module) ?? [];
    list.push(permission);
    groups.set(module, list);
  });

  return [...groups.entries()].map(([module, permissions]) => ({ module, permissions }));
})();

/** Module labels; unknown modules fall back to their raw code. */
export const MODULE_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  products: 'nav.products',
  inventory: 'nav.inventory',
  batches: 'roles.module.batches',
  suppliers: 'nav.suppliers',
  purchases: 'nav.purchases',
  sales: 'nav.sales',
  cost: 'nav.cost',
  reports: 'nav.reports',
  expenses: 'nav.expenses',
  register: 'nav.register',
  cashdrawer: 'nav.cashdrawer',
  users: 'nav.users',
  settings: 'nav.settings',
  audit: 'nav.audit',
  backup: 'nav.backup',
};

/** Action labels (permission suffix); unknown actions fall back to the raw suffix. */
export const ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  read: 'roles.action.read',
  write: 'roles.action.write',
  delete: 'common.delete',
  create: 'roles.create',
  view: 'common.view',
  adjust: 'roles.action.adjust',
  refund: 'roles.action.refund',
  discount: 'roles.action.discount',
  operational: 'roles.action.operational',
  financial: 'roles.action.financial',
  operate: 'roles.action.operate',
  open: 'roles.action.open',
  manage: 'roles.action.manage',
};

/** Role labels shared by the admin pages. */
export const ROLE_LABEL_KEYS: Record<Role, TranslationKey> = {
  OWNER: 'roles.level.owner',
  MANAGER: 'roles.level.manager',
  PHARMACIST: 'roles.level.pharmacist',
  CASHIER: 'roles.level.cashier',
  INVENTORY_CLERK: 'roles.level.inventory_clerk',
  ACCOUNTANT: 'roles.level.accountant',
};
