/**
 * @pharmacy/shared
 *
 * Single source of truth for domain constants, the permission matrix, monetary
 * helpers and the Zod validation schemas used by both the API server and the
 * Electron desktop client.
 */

export * from './permissions.js';
export * from './constants.js';
export * from './money.js';
export * from './barcode.js';

export * from './schemas/common.js';
export * from './schemas/auth.js';
export * from './schemas/product.js';
export * from './schemas/category.js';
export * from './schemas/supplier.js';
export * from './schemas/warehouse.js';
export * from './schemas/inventory.js';
export * from './schemas/purchase.js';
export * from './schemas/customer.js';
export * from './schemas/debt.js';
export * from './schemas/sale.js';
export * from './schemas/report.js';
export * from './schemas/expense.js';
export * from './schemas/shift.js';
export * from './schemas/user.js';
