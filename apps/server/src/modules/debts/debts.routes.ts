import { Router } from 'express';
import { z } from 'zod';
import {
  buildPaginated,
  debtPaymentSchema,
  debtQuerySchema,
  idSchema,
  type DebtPaymentInput,
  type DebtPaymentMethod,
  type DebtQuery,
} from '@pharmacy/shared';
import type { Customer, Prisma } from '@prisma/client';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordAudit } from '../../lib/audit.js';
import { toIso } from '../../lib/dates.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';
import { toCustomerDto, type CustomerDto } from '../customers/customers.routes.js';
import { findOpenShift } from '../cashdrawer/cashdrawer.service.js';

export const debtsRouter = Router();
debtsRouter.use(authenticate);

const idParams = z.object({ id: idSchema });

const PAYMENT_METHOD_DB: Record<DebtPaymentMethod, 'CASH' | 'CARD' | 'WALLET'> = {
  cash: 'CASH',
  card: 'CARD',
  wallet: 'WALLET',
};

function money(value: Prisma.Decimal | null | undefined, fallback = '0.00'): string {
  return value === null || value === undefined ? fallback : value.toFixed(2);
}

export interface DebtorDto extends CustomerDto {
  /** True when the balance exceeds a configured (positive) credit limit. */
  isOverLimit: boolean;
  /** Remaining credit line, clamped at zero. */
  availableCredit: string;
}

export interface DebtEntryDto {
  id: string;
  type: 'sale' | 'payment';
  amount: string;
  createdAt: string;
  /** Payments only. */
  method?: string;
  reference?: string | null;
  note?: string | null;
  userName?: string | null;
  /** Credit invoices only. */
  saleId?: string;
  invoiceNumber?: string;
}

export interface DebtLedgerDto {
  customer: DebtorDto;
  entries: DebtEntryDto[];
}

export function toDebtorDto(row: Customer): DebtorDto {
  const balance = Number(row.currentBalance);
  const limit = Number(row.creditLimit);
  return {
    ...toCustomerDto(row),
    isOverLimit: limit > 0 && balance > limit,
    availableCredit: Math.max(0, limit - balance).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// GET /debts — receivables list (customers with an outstanding balance)
// ---------------------------------------------------------------------------

debtsRouter.get(
  '/',
  authorize('sales:read'),
  validate({ query: debtQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as DebtQuery;
    const where: Prisma.CustomerWhereInput = {
      currentBalance: { gt: 0 },
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { phone: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total, totals, overLimitCount] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: [{ currentBalance: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
      prisma.customer.aggregate({ where, _sum: { currentBalance: true } }),
      prisma.customer.count({
        where: {
          ...where,
          creditLimit: { gt: 0 },
          currentBalance: { gt: prisma.customer.fields.creditLimit },
        },
      }),
    ]);

    res.status(200).json({
      ...buildPaginated(rows.map(toDebtorDto), total, query.page, query.pageSize),
      summary: {
        totalOutstanding: money(totals._sum.currentBalance),
        debtorsTotal: total,
        overLimitCount,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /debts/:id — customer statement (credit invoices + collected payments)
// ---------------------------------------------------------------------------

debtsRouter.get(
  '/:id',
  authorize('sales:read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new NotFoundError('العميل غير موجود');

    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({
        where: {
          customerId: customer.id,
          status: 'COMPLETED',
          payments: { some: { method: 'CREDIT' } },
        },
        include: { payments: { where: { method: 'CREDIT' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.customerPayment.findMany({
        where: { customerId: customer.id },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const entries: DebtEntryDto[] = [
      ...sales.map((sale) => ({
        id: sale.id,
        type: 'sale' as const,
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        amount: sale.payments
          .reduce((sum, payment) => sum + Number(payment.amount), 0)
          .toFixed(2),
        note: sale.note,
        createdAt: toIso(sale.createdAt),
      })),
      ...payments.map((payment) => ({
        id: payment.id,
        type: 'payment' as const,
        amount: money(payment.amount),
        method: payment.method.toLowerCase(),
        reference: payment.reference,
        note: payment.note,
        userName: payment.user?.fullName ?? null,
        createdAt: toIso(payment.createdAt),
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const ledger: DebtLedgerDto = { customer: toDebtorDto(customer), entries };
    res.status(200).json(ledger);
  }),
);

// ---------------------------------------------------------------------------
// POST /debts/:id/payments — collect a payment against the outstanding balance
// ---------------------------------------------------------------------------

debtsRouter.post(
  '/:id/payments',
  authorize('sales:create'),
  rateLimit({ name: 'debts:pay', windowMs: 60_000, max: 120 }),
  validate({ params: idParams, body: debtPaymentSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as DebtPaymentInput;
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new NotFoundError('العميل غير موجود');

    const balance = Number(customer.currentBalance);
    if (balance <= 0) {
      throw new ValidationError('لا يوجد رصيد مستحق على هذا العميل');
    }
    if (Number(input.amount) > balance + 0.001) {
      throw new ValidationError(`المبلغ أكبر من الرصيد المستحق (${balance.toFixed(2)})`, {
        outstanding: balance.toFixed(2),
      });
    }

    const { updated, payment } = await prisma.$transaction(async (tx) => {
      const shift = await findOpenShift(tx, req.user!.id);
      const updatedRow = await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: { decrement: input.amount } },
      });
      const createdPayment = await tx.customerPayment.create({
        data: {
          customerId: customer.id,
          amount: input.amount,
          method: PAYMENT_METHOD_DB[input.method],
          reference: input.reference ?? null,
          note: input.note ?? null,
          userId: req.user!.id,
          shiftId: shift?.id ?? null,
        },
      });
      await recordAudit(
        {
          action: 'customer.payment',
          entityType: 'Customer',
          entityId: customer.id,
          before: { currentBalance: balance.toFixed(2) },
          after: {
            currentBalance: money(updatedRow.currentBalance),
            amount: input.amount,
            method: input.method,
          },
          userId: req.user!.id,
        },
        tx,
      );
      return { updated: updatedRow, payment: createdPayment };
    });

    res.status(201).json({
      customer: toDebtorDto(updated),
      payment: {
        id: payment.id,
        amount: money(payment.amount),
        method: payment.method.toLowerCase(),
        reference: payment.reference,
        note: payment.note,
        createdAt: toIso(payment.createdAt),
      },
    });
  }),
);
