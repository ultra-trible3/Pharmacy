import { Prisma, type PrismaClient } from '@prisma/client';
import {
  fromMinorUnits,
  toMinorUnits,
  type CashMovementTypeCode,
  type CashDrawerDto,
  type PaymentMethodCode,
  type ShiftCashMovementDto,
  type ShiftDetailDto,
  type ShiftReconciliationDto,
  type ShiftSaleSummaryDto,
  type ShiftStatusCode,
} from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { toIso } from '../../lib/dates.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { CloseShiftInput, OpenShiftInput, CashMovementInput } from '@pharmacy/shared';

type Db = PrismaClient | Prisma.TransactionClient;

const OPEN = 'OPEN';
const CLOSED = 'CLOSED';

/** Decimal -> fixed 2-decimal string (Prisma may return "0" or "12.5"). */
function decimalString(value: Prisma.Decimal | null | undefined): string {
  return value ? fromMinorUnits(toMinorUnits(value.toString())) : '0.00';
}

function countOf(group: { _count?: unknown; _all?: number } | undefined): number {
  const raw = group?._count;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object' && '_all' in raw) {
    return Number((raw as { _all: number })._all);
  }
  return 0;
}

interface ShiftRow {
  id: string;
  userId: string;
  warehouseId: string;
  terminalId: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openingBalance: Prisma.Decimal;
  expectedBalance: Prisma.Decimal;
  closingBalance: Prisma.Decimal | null;
  variance: Prisma.Decimal | null;
  cashSales: Prisma.Decimal;
  cardSales: Prisma.Decimal;
  walletSales: Prisma.Decimal;
  creditSales: Prisma.Decimal;
  customerCashTotal: Prisma.Decimal;
  cashRefunds: Prisma.Decimal;
  expensesTotal: Prisma.Decimal;
  paidInTotal: Prisma.Decimal;
  paidOutTotal: Prisma.Decimal;
  salesCount: number;
  voidedSalesCount: number;
  refundsCount: number;
  expensesCount: number;
  customerPaymentsCount: number;
  paidInCount: number;
  paidOutCount: number;
  status: string;
  notes: string | null;
  closedById: string | null;
  createdAt: Date;
}

interface ShiftRowWithUsers extends ShiftRow {
  user: { fullName: string };
  closedBy: { fullName: string } | null;
}

const SHIFT_INCLUDE = {
  user: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
} as const;

export interface ShiftListRow extends ShiftRowWithUsers {
  warehouseNameAr: string | null;
  warehouseNameEn: string | null;
}

/** Shared converter so every endpoint returns the same shift shape. */
export function toCashDrawerDto(row: ShiftRowWithUsers, warehouse?: { nameAr: string; nameEn: string | null } | null): CashDrawerDto {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.fullName,
    warehouseId: row.warehouseId,
    warehouseNameAr: warehouse?.nameAr ?? null,
    terminalId: row.terminalId,
    openedAt: toIso(row.openedAt),
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
    openingBalance: decimalString(row.openingBalance),
    expectedBalance: decimalString(row.expectedBalance),
    closingBalance: row.closingBalance ? decimalString(row.closingBalance) : null,
    variance: row.variance ? decimalString(row.variance) : null,
    status: row.status as ShiftStatusCode,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
  };
}

/**
 * Computes the live reconciliation for an open shift from persisted records.
 *
 * Sales payments are counted gross (including payments of sales later voided)
 * and every void writes an immutable Refund row attributed to the shift that
 * actually paid the money back. This keeps each drawer correct when a sale and
 * its refund happen in different shifts.
 */
export async function computeReconciliation(
  tx: Db,
  shift: Pick<ShiftRow, 'id' | 'openingBalance' | 'status'>,
): Promise<ShiftReconciliationDto> {
  const [payments, refunds, expenseAgg, customerPayments, movements, salesCount, voidedSalesCount] =
    await Promise.all([
      tx.payment.groupBy({
        by: ['method'],
        where: { sale: { shiftId: shift.id } },
        _sum: { amount: true },
      }),
      tx.refund.groupBy({
        by: ['method'],
        where: { shiftId: shift.id },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      tx.expense.aggregate({
        where: { shiftId: shift.id, isActive: true },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      tx.customerPayment.groupBy({
        by: ['method'],
        where: { shiftId: shift.id },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      tx.cashMovement.groupBy({
        by: ['type'],
        where: { shiftId: shift.id },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      tx.sale.count({ where: { shiftId: shift.id, status: 'COMPLETED' } }),
      tx.sale.count({ where: { shiftId: shift.id, status: 'VOIDED' } }),
    ]);

  const sumMethod = (
    rows: Array<{ method: string; _sum: { amount: Prisma.Decimal | null } }>,
    method: string,
  ): string => {
    const row = rows.find((candidate) => candidate.method === method);
    return decimalString(row?._sum.amount);
  };

  const cashSales = sumMethod(payments, 'CASH');
  const cardSales = sumMethod(payments, 'CARD');
  const walletSales = sumMethod(payments, 'WALLET');
  const creditSales = sumMethod(payments, 'CREDIT');
  const totalSales = fromMinorUnits(
    toMinorUnits(cashSales) +
      toMinorUnits(cardSales) +
      toMinorUnits(walletSales) +
      toMinorUnits(creditSales),
  );

  const cashRefunds = sumMethod(refunds, 'CASH');
  const customerCashTotal = sumMethod(customerPayments, 'CASH');

  const movementSum = (type: 'PAID_IN' | 'PAID_OUT'): string => {
    const row = movements.find((candidate) => candidate.type === type);
    return decimalString(row?._sum.amount);
  };
  const movementCount = (type: 'PAID_IN' | 'PAID_OUT'): number => {
    const row = movements.find((candidate) => candidate.type === type);
    return countOf(row);
  };

  const paidInTotal = movementSum('PAID_IN');
  const paidOutTotal = movementSum('PAID_OUT');
  const expensesTotal = decimalString(expenseAgg._sum.amount);
  const refundsCount = refunds.reduce((total, row) => total + countOf(row), 0);
  const customerPaymentsCount = customerPayments.reduce(
    (total, row) => total + countOf(row),
    0,
  );

  // Exact integer-minor-unit arithmetic; no floating point drift.
  const expectedMinor =
    toMinorUnits(shift.openingBalance.toString()) +
    toMinorUnits(cashSales) +
    toMinorUnits(customerCashTotal) +
    toMinorUnits(paidInTotal) -
    toMinorUnits(cashRefunds) -
    toMinorUnits(expensesTotal) -
    toMinorUnits(paidOutTotal);
  const expectedCash = fromMinorUnits(expectedMinor);

  return {
    openingBalance: decimalString(shift.openingBalance),
    cashSales,
    cardSales,
    walletSales,
    creditSales,
    totalSales,
    customerCashTotal,
    cashRefunds,
    expensesTotal,
    paidInTotal,
    paidOutTotal,
    expectedCash,
    countedCash: null,
    variance: null,
    salesCount,
    voidedSalesCount,
    refundsCount,
    expensesCount: countOf(expenseAgg),
    customerPaymentsCount,
    paidInCount: movementCount('PAID_IN'),
    paidOutCount: movementCount('PAID_OUT'),
    transactionCount: salesCount + refundsCount + customerPaymentsCount,
    status: shift.status as ShiftStatusCode,
  };
}

/** Snapshot stored atomically at closing time. Never recomputed afterwards. */
export function snapshotReconciliation(shift: ShiftRow): ShiftReconciliationDto {
  return {
    openingBalance: decimalString(shift.openingBalance),
    cashSales: decimalString(shift.cashSales),
    cardSales: decimalString(shift.cardSales),
    walletSales: decimalString(shift.walletSales),
    creditSales: decimalString(shift.creditSales),
    totalSales: fromMinorUnits(
      toMinorUnits(decimalString(shift.cashSales)) +
        toMinorUnits(decimalString(shift.cardSales)) +
        toMinorUnits(decimalString(shift.walletSales)) +
        toMinorUnits(decimalString(shift.creditSales)),
    ),
    customerCashTotal: decimalString(shift.customerCashTotal),
    cashRefunds: decimalString(shift.cashRefunds),
    expensesTotal: decimalString(shift.expensesTotal),
    paidInTotal: decimalString(shift.paidInTotal),
    paidOutTotal: decimalString(shift.paidOutTotal),
    expectedCash: decimalString(shift.expectedBalance),
    countedCash: shift.closingBalance ? decimalString(shift.closingBalance) : null,
    variance: shift.variance ? decimalString(shift.variance) : null,
    salesCount: shift.salesCount,
    voidedSalesCount: shift.voidedSalesCount,
    refundsCount: shift.refundsCount,
    expensesCount: shift.expensesCount,
    customerPaymentsCount: shift.customerPaymentsCount,
    paidInCount: shift.paidInCount,
    paidOutCount: shift.paidOutCount,
    transactionCount:
      shift.salesCount + shift.refundsCount + shift.customerPaymentsCount,
    status: shift.status as ShiftStatusCode,
  };
}

function toMovementDto(row: {
  id: string;
  shiftId: string;
  type: 'PAID_IN' | 'PAID_OUT';
  amount: Prisma.Decimal;
  reason: string;
  userId: string;
  createdAt: Date;
  user?: { fullName: string } | null;
}): ShiftCashMovementDto {
  return {
    id: row.id,
    shiftId: row.shiftId,
    type: (row.type === 'PAID_IN' ? 'paid_in' : 'paid_out') as CashMovementTypeCode,
    amount: decimalString(row.amount),
    reason: row.reason,
    userId: row.userId,
    userName: row.user?.fullName ?? null,
    createdAt: toIso(row.createdAt),
  };
}

function toSaleSummary(row: {
  id: string;
  invoiceNumber: string;
  total: Prisma.Decimal;
  status: 'COMPLETED' | 'SUSPENDED' | 'VOIDED';
  createdAt: Date;
  payments: Array<{ method: 'CASH' | 'CARD' | 'WALLET' | 'CREDIT'; amount: Prisma.Decimal }>;
}): ShiftSaleSummaryDto {
  const totalFor = (method: string): string =>
    row.payments
      .filter((payment) => payment.method === method)
      .reduce(
        (sum, payment) => fromMinorUnits(toMinorUnits(sum) + toMinorUnits(payment.amount.toString())),
        '0.00',
      );
  const methods = [...new Set(row.payments.map((payment) => payment.method))].map(
    (method) => method.toLowerCase() as PaymentMethodCode,
  );
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    total: decimalString(row.total),
    status: row.status.toLowerCase() as ShiftSaleSummaryDto['status'],
    paymentMethods: methods,
    cashAmount: totalFor('CASH'),
    cardAmount: totalFor('CARD'),
    walletAmount: totalFor('WALLET'),
    creditAmount: totalFor('CREDIT'),
    createdAt: toIso(row.createdAt),
  };
}

/** GET /cashdrawer/:id — live reconciliation for open shifts, snapshot once closed. */
export async function getShiftDetail(id: string): Promise<ShiftDetailDto> {
  const row = await prisma.cashDrawer.findUnique({
    where: { id },
    include: {
      ...SHIFT_INCLUDE,
      cashMovements: {
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
      sales: {
        include: { payments: { select: { method: true, amount: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!row) throw new NotFoundError('الوردة غير موجودة');

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: row.warehouseId },
    select: { nameAr: true, nameEn: true },
  });
  const reconciliation =
    row.status === CLOSED
      ? snapshotReconciliation(row)
      : await computeReconciliation(prisma, row);

  return {
    ...toCashDrawerDto(row, warehouse),
    closedByName: row.closedBy?.fullName ?? null,
    warehouseNameEn: warehouse?.nameEn ?? null,
    reconciliation,
    movements: row.cashMovements.map(toMovementDto),
    recentSales: row.sales.map(toSaleSummary),
  };
}

/** GET /cashdrawer — paginated shift history with aggregate summary. */
export async function listShifts(query: {
  page: number;
  pageSize: number;
  status?: string;
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}): Promise<{ items: CashDrawerDto[]; total: number; summary: Record<string, string | number> }> {
  const startOfLocalDay = (dateOnly: string): Date => {
    const parts = dateOnly.split('-').map(Number);
    return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  };

  const where: Prisma.CashDrawerWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          openedAt: {
            ...(query.dateFrom ? { gte: startOfLocalDay(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: startOfLocalDay(query.dateTo) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? { user: { fullName: { contains: query.q, mode: 'insensitive' as const } } }
      : {}),
  };

  const [rows, total, openAggregate, closedAggregate, openSums, closedSums] = await Promise.all([
    prisma.cashDrawer.findMany({
      where,
      include: SHIFT_INCLUDE,
      orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.cashDrawer.count({ where }),
    prisma.cashDrawer.count({ where: { ...where, status: OPEN } }),
    prisma.cashDrawer.count({ where: { ...where, status: CLOSED } }),
    prisma.cashDrawer.aggregate({
      where: { ...where, status: OPEN },
      _sum: { openingBalance: true, expectedBalance: true },
    }),
    prisma.cashDrawer.aggregate({
      where: { ...where, status: CLOSED },
      _sum: { closingBalance: true, variance: true },
    }),
  ]);

  const warehouseIds = [...new Set(rows.map((row) => row.warehouseId))];
  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: warehouseIds } },
    select: { id: true, nameAr: true, nameEn: true },
  });
  const byId = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

  const items = rows.map((row) => {
    const warehouse = byId.get(row.warehouseId);
    return toCashDrawerDto(
      row,
      warehouse ? { nameAr: warehouse.nameAr, nameEn: warehouse.nameEn } : null,
    );
  });

  const totalOpening = openSums._sum.openingBalance ?? new Prisma.Decimal(0);
  const totalClosing = closedSums._sum.closingBalance ?? new Prisma.Decimal(0);

  return {
    items,
    total,
    summary: {
      totalShifts: total,
      openShifts: openAggregate,
      closedShifts: closedAggregate,
      totalOpeningBalance: decimalString(totalOpening),
      totalClosingBalance: decimalString(totalClosing),
      netCash: fromMinorUnits(
        toMinorUnits(totalClosing.toString()) - toMinorUnits(totalOpening.toString()),
      ),
      totalExpectedBalance: decimalString(openSums._sum.expectedBalance),
      totalVariance: decimalString(closedSums._sum.variance),
    },
  };
}

/** POST /cashdrawer/open */
export async function openShift(
  input: OpenShiftInput,
  user: { id: string },
  terminalId?: string | null,
): Promise<CashDrawerDto> {
  const terminal = terminalId?.trim().slice(0, 64) || null;

  const alreadyOpen = await prisma.cashDrawer.findFirst({
    where: { userId: user.id, warehouseId: input.warehouseId, status: OPEN },
    select: { id: true },
  });
  if (alreadyOpen) {
    throw new ConflictError('هناك وردية مفتوحة بالفعل لهذا المستخدم والمخزن');
  }
  if (terminal) {
    const terminalTaken = await prisma.cashDrawer.findFirst({
      where: { terminalId: terminal, status: OPEN },
      select: { id: true },
    });
    if (terminalTaken) {
      throw new ConflictError('هناك وردية مفتوحة بالفعل على هذا الجهاز');
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.cashDrawer.create({
        data: {
          userId: user.id,
          warehouseId: input.warehouseId,
          terminalId: terminal,
          openedAt: new Date(),
          openingBalance: input.openingBalance,
          expectedBalance: input.openingBalance,
          notes: input.notes ?? null,
          status: OPEN,
        },
        include: SHIFT_INCLUDE,
      });
      await recordAudit(
        {
          action: 'cashdrawer.opened',
          entityType: 'CashDrawer',
          entityId: row.id,
          after: {
            warehouseId: input.warehouseId,
            terminalId: terminal,
            openingBalance: input.openingBalance,
            status: OPEN,
          },
          userId: user.id,
        },
        tx,
      );
      return row;
    });
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: created.warehouseId },
      select: { nameAr: true, nameEn: true },
    });
    return toCashDrawerDto(created, warehouse);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictError('هناك وردية مفتوحة بالفعل');
    }
    throw error;
  }
}

/**
 * PATCH /cashdrawer/:id/close
 *
 * The shift row is locked FOR UPDATE, reconciliation is computed from the
 * persisted records and the snapshot is written in the same transaction. The
 * conditional update makes a duplicate/concurrent close fail with 409 instead
 * of overwriting the first result.
 */
export async function closeShift(
  id: string,
  input: CloseShiftInput,
  user: { id: string },
): Promise<ShiftDetailDto> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "cash_drawers" WHERE "id" = ${id} FOR UPDATE
    `;
    if (locked.length === 0) throw new NotFoundError('الوردة غير موجودة');

    const shift = await tx.cashDrawer.findUniqueOrThrow({ where: { id } });
    if (shift.status !== OPEN) {
      throw new ConflictError('هذه الوردة مغلقة مسبقاً');
    }

    const reconciliation = await computeReconciliation(tx, shift);
    const countedCash = input.closingBalance;
    const variance = fromMinorUnits(
      toMinorUnits(countedCash) - toMinorUnits(reconciliation.expectedCash),
    );

    const updated = await tx.cashDrawer.updateMany({
      where: { id, status: OPEN },
      data: {
        status: CLOSED,
        closedAt: new Date(),
        closingBalance: countedCash,
        expectedBalance: reconciliation.expectedCash,
        variance,
        cashSales: reconciliation.cashSales,
        cardSales: reconciliation.cardSales,
        walletSales: reconciliation.walletSales,
        creditSales: reconciliation.creditSales,
        customerCashTotal: reconciliation.customerCashTotal,
        cashRefunds: reconciliation.cashRefunds,
        expensesTotal: reconciliation.expensesTotal,
        paidInTotal: reconciliation.paidInTotal,
        paidOutTotal: reconciliation.paidOutTotal,
        salesCount: reconciliation.salesCount,
        voidedSalesCount: reconciliation.voidedSalesCount,
        refundsCount: reconciliation.refundsCount,
        expensesCount: reconciliation.expensesCount,
        customerPaymentsCount: reconciliation.customerPaymentsCount,
        paidInCount: reconciliation.paidInCount,
        paidOutCount: reconciliation.paidOutCount,
        closedById: user.id,
        notes: input.notes ?? shift.notes,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError('هذه الوردة مغلقة مسبقاً');
    }

    await recordAudit(
      {
        action: 'cashdrawer.closed',
        entityType: 'CashDrawer',
        entityId: id,
        before: {
          status: OPEN,
          openingBalance: decimalString(shift.openingBalance),
          closingBalance: null,
        },
        after: {
          status: CLOSED,
          countedCash,
          expectedCash: reconciliation.expectedCash,
          variance,
          cashSales: reconciliation.cashSales,
          cardSales: reconciliation.cardSales,
          walletSales: reconciliation.walletSales,
          creditSales: reconciliation.creditSales,
          customerCashTotal: reconciliation.customerCashTotal,
          cashRefunds: reconciliation.cashRefunds,
          expensesTotal: reconciliation.expensesTotal,
          paidInTotal: reconciliation.paidInTotal,
          paidOutTotal: reconciliation.paidOutTotal,
        },
        userId: user.id,
      },
      tx,
    );
  });

  return getShiftDetail(id);
}

/** POST /cashdrawer/:id/movements — explicit cash in/out on an open shift. */
export async function addCashMovement(
  id: string,
  input: CashMovementInput,
  user: { id: string },
): Promise<ShiftCashMovementDto> {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.cashDrawer.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!shift) throw new NotFoundError('الوردة غير موجودة');
    if (shift.status !== OPEN) {
      throw new ConflictError('لا يمكن تسجيل حركة نقدية على وردية مغلقة');
    }

    const created = await tx.cashMovement.create({
      data: {
        shiftId: id,
        type: input.type === 'paid_in' ? 'PAID_IN' : 'PAID_OUT',
        amount: input.amount,
        reason: input.reason,
        userId: user.id,
      },
      include: { user: { select: { fullName: true } } },
    });
    await recordAudit(
      {
        action: input.type === 'paid_in' ? 'cashdrawer.paid_in' : 'cashdrawer.paid_out',
        entityType: 'CashDrawer',
        entityId: id,
        after: { type: input.type, amount: input.amount, reason: input.reason },
        userId: user.id,
      },
      tx,
    );
    return toMovementDto(created);
  });
}

/** Finds the shift a sale/payment/refund belongs to. */
export async function findOpenShift(
  tx: Db,
  userId: string,
  warehouseId?: string,
): Promise<{ id: string } | null> {
  if (warehouseId) {
    const match = await findOpenShiftForWarehouse(tx, userId, warehouseId);
    if (match) return match;
  }
  return tx.cashDrawer.findFirst({
    where: { userId, status: OPEN },
    orderBy: { openedAt: 'desc' },
    select: { id: true },
  });
}

/** Strict variant for sales: never links a sale to another warehouse's shift. */
export async function findOpenShiftForWarehouse(
  tx: Db,
  userId: string,
  warehouseId: string,
): Promise<{ id: string } | null> {
  return tx.cashDrawer.findFirst({
    where: { userId, warehouseId, status: OPEN },
    orderBy: { openedAt: 'desc' },
    select: { id: true },
  });
}
