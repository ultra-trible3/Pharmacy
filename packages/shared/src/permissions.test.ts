import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, hasPermission, permissionsForRole } from './permissions.js';

describe('permission matrix', () => {
  it('grants the owner every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('never leaks administration rights to the cashier', () => {
    expect(hasPermission('CASHIER', 'products:read')).toBe(true);
    expect(hasPermission('CASHIER', 'sales:create')).toBe(true);
    expect(hasPermission('CASHIER', 'users:manage')).toBe(false);
    expect(hasPermission('CASHIER', 'reports:financial')).toBe(false);
    expect(hasPermission('CASHIER', 'cost:view')).toBe(false);
    expect(hasPermission('CASHIER', 'inventory:adjust')).toBe(false);
  });

  it('keeps cost data away from roles that do not need it', () => {
    expect(hasPermission('CASHIER', 'cost:view')).toBe(false);
    expect(hasPermission('PHARMACIST', 'cost:view')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'cost:view')).toBe(true);
  });

  it('restricts financial reports to owner/manager/accountant', () => {
    const allowed = ROLES.filter((role) => hasPermission(role, 'reports:financial'));
    expect(allowed.sort()).toEqual(['ACCOUNTANT', 'MANAGER', 'OWNER']);
  });

  it('returns a materialised permission list for every role', () => {
    for (const role of ROLES) {
      const list = permissionsForRole(role);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    }
  });
});
