import { z } from 'zod';
import { dateOnlySchema, idSchema, optionalTrimmedString, paginationSchema } from './common.js';
import { moneySchema } from './product.js';
import type { PaymentMethodCode } from './sale.js';

export const SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ShiftStatusCode = (typeof SHIFT_STATUSES)[number];

export const SHIFT_STATUS_LABELS_AR: Record<ShiftStatusCode, string> = {
  OPEN: 'مفتوحة',
  CLOSED: 'مغلقة',
};

export const SHIFT_STATUS_LABELS_EN: Record<ShiftStatusCode, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
};

/** Explicit cash drawer movements recorded during a shift. */
export const CASH_MOVEMENT_TYPES = ['paid_in', 'paid_out'] as const;
export type CashMovementTypeCode = (typeof CASH_MOVEMENT_TYPES)[number];

/** Query for listing shifts / cash drawers. */
export const cashDrawerQuerySchema = paginationSchema.extend({
  q: optionalTrimmedString(120),
  status: z.enum(SHIFT_STATUSES).optional(),
  warehouseId: idSchema.optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
});
export type CashDrawerQuery = z.infer<typeof cashDrawerQuerySchema>;

/** Open a new shift (cash drawer). */
export const openShiftSchema = z
  .object({
    warehouseId: idSchema,
    openingBalance: moneySchema.default('0.00'),
    notes: optionalTrimmedString(500),
  })
  .strict();
export type OpenShiftInput = z.infer<typeof openShiftSchema>;

/** Close a shift (cash drawer). `closingBalance` is the physically counted cash. */
export const closeShiftSchema = z
  .object({
    closingBalance: moneySchema,
    notes: optionalTrimmedString(500),
  })
  .strict();
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

/** Record an explicit paid-in / paid-out cash movement against an open shift. */
export const cashMovementSchema = z
  .object({
    type: z.enum(CASH_MOVEMENT_TYPES),
    amount: moneySchema.refine((value) => Number(value) > 0, {
      message: 'المبلغ يجب أن يكون أكبر من صفر',
    }),
    reason: z
      .string()
      .trim()
      .min(3, 'سبب الحركة مطلوب')
      .max(300, 'سبب الحركة طويل جدًا'),
  })
  .strict();
export type CashMovementInput = z.infer<typeof cashMovementSchema>;

export interface CashDrawerDto {
  id: string;
  userId: string;
  userName: string | null;
  warehouseId: string;
  warehouseNameAr: string | null;
  terminalId: string | null;
  openedAt: string;
  closedAt: string | null;
  openingBalance: string;
  expectedBalance: string;
  closingBalance: string | null;
  variance: string | null;
  status: ShiftStatusCode;
  notes: string | null;
  createdAt: string;
}

export interface CashDrawerSummaryDto {
  totalShifts: number;
  openShifts: number;
  closedShifts: number;
  totalOpeningBalance: string;
  totalClosingBalance: string;
  netCash: string;
  /** Expected cash still held by open shifts (additive field). */
  totalExpectedBalance?: string;
  /** Sum of closing minus expected for closed shifts (additive field). */
  totalVariance?: string;
}

/**
 * Reconciliation snapshot. For an OPEN shift the values are computed live from
 * persisted payments, refunds and cash movements; for a CLOSED shift they are
 * the immutable snapshot stored at closing time.
 */
export interface ShiftReconciliationDto {
  openingBalance: string;
  cashSales: string;
  cardSales: string;
  walletSales: string;
  creditSales: string;
  totalSales: string;
  /** Cash collected against customer credit balances during the shift. */
  customerCashTotal: string;
  cashRefunds: string;
  expensesTotal: string;
  paidInTotal: string;
  paidOutTotal: string;
  expectedCash: string;
  countedCash: string | null;
  variance: string | null;
  salesCount: number;
  voidedSalesCount: number;
  refundsCount: number;
  expensesCount: number;
  customerPaymentsCount: number;
  paidInCount: number;
  paidOutCount: number;
  transactionCount: number;
  status: ShiftStatusCode;
}

export interface ShiftCashMovementDto {
  id: string;
  shiftId: string;
  type: CashMovementTypeCode;
  amount: string;
  reason: string;
  userId: string;
  userName: string | null;
  createdAt: string;
}

export interface ShiftSaleSummaryDto {
  id: string;
  invoiceNumber: string;
  total: string;
  status: 'completed' | 'suspended' | 'voided';
  paymentMethods: PaymentMethodCode[];
  cashAmount: string;
  cardAmount: string;
  walletAmount: string;
  creditAmount: string;
  createdAt: string;
}

export interface ShiftDetailDto extends CashDrawerDto {
  closedByName: string | null;
  warehouseNameEn: string | null;
  reconciliation: ShiftReconciliationDto;
  movements: ShiftCashMovementDto[];
  recentSales: ShiftSaleSummaryDto[];
}
