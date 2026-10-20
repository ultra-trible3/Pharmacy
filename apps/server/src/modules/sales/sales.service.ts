import { Prisma } from '@prisma/client';
import {
  buildPaginated,
  compareCurrency,
  hasPermission,
  multiplyCurrency,
  roundCurrency,
  sumCurrency,
  type BestSellerQuery,
  type PaymentMethodCode,
  type Paginated,
  type ProductListItem,
  type RecentSalesQuery,
  type Role,
  type SaleCreateInput,
  type SalePeriod,
  type SaleQuery,
  type SaleSuspendInput,
} from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { daysUntil, toDateOnly, toIso, todayInBusinessTimezone } from '../../lib/dates.js';
import { ConflictError, InsufficientStockError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { findOpenShift, findOpenShiftForWarehouse } from '../cashdrawer/cashdrawer.service.js';
import { toCustomerDto, type CustomerDto } from '../customers/customers.routes.js';
import { toProductListItem } from '../products/products.service.js';

/**
 * VAT rate applied to the discounted invoice base. Mirrors `TAX_RATE` in the
 * desktop `InvoiceTotals` component so client and server totals always agree.
 */
const VAT_RATE = '0.15';

/** One loyalty point is awarded for every this many currency units spent. */
const LOYALTY_POINTS_RATE = 100;

/** Loyalty points redemption rate: 100 points = 1 currency unit discount. */
const POINTS_REDEMPTION_RATE = 100;

const PAYMENT_METHOD_DB: Record<PaymentMethodCode, 'CASH' | 'CARD' | 'WALLET' | 'CREDIT'> = {
  cash: 'CASH',
  card: 'CARD',
  wallet: 'WALLET',
  credit: 'CREDIT',
};

function money(value: Prisma.Decimal | null | undefined, fallback = '0.00'): string {
  return value === null || value === undefined ? fallback : value.toFixed(2);
}

export interface SaleBatchInfo {
  id: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice: string;
  salePrice: string;
  warehouseId: string;
  warehouseNameAr: string;
  manufactureDate: string | null;
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
  stockValue: string;
}

export interface SaleItemDto {
  id: string;
  saleId: string;
  productId: string;
  batchId: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  product?: ProductListItem & { unitsSold?: number; invoicesCount?: number; revenue?: string; rank?: number; lastSoldAt?: string; lastQuantity?: number; lastInvoiceId?: string };
  batch?: SaleBatchInfo;
}

export interface PaymentDto {
  id: string;
  saleId: string;
  method: PaymentMethodCode;
  amount: string;
  reference: string | null;
  createdAt: string;
}

export interface SaleDto {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  userId: string;
  warehouseId: string;
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
  /** Loyalty points redeemed for this sale. */
  pointsUsed: number;
  status: 'completed' | 'suspended' | 'voided';
  note: string | null;
  createdAt: string;
  updatedAt: string;
  items: SaleItemDto[];
  payments: PaymentDto[];
  customer?: CustomerDto;
  user?: { id: string; fullName: string };
}

const SALE_INCLUDE = {
  customer: true,
  user: { select: { id: true, fullName: true } },
  payments: { orderBy: { createdAt: 'asc' } },
  items: { include: { product: { include: { category: { select: { nameAr: true } } } } } },
} as const;

type SaleWithDetails = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

async function loadBatchInfo(batchIds: Array<string | null>): Promise<Map<string, SaleBatchInfo>> {
  const unique = [...new Set(batchIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, SaleBatchInfo>();
  if (unique.length === 0) return result;

  const today = todayInBusinessTimezone();
  const nearExpiryLimit = new Date(
    new Date(`${today}T00:00:00Z`).getTime() + 90 * 86_400_000,
  );

  const rows = await prisma.batch.findMany({
    where: { id: { in: unique } },
    include: {
      warehouse: { select: { nameAr: true } },
      product: { select: { salePrice: true } },
    },
  });

  for (const row of rows) {
    const expiry = toDateOnly(row.expiryDate);
    const remaining = daysUntil(expiry, today);
    const salePrice = row.salePrice ?? row.product.salePrice;
    result.set(row.id, {
      id: row.id,
      lotNumber: row.lotNumber,
      expiryDate: expiry,
      quantity: row.quantity,
      costPrice: money(row.costPrice),
      salePrice: money(salePrice),
      warehouseId: row.warehouseId,
      warehouseNameAr: row.warehouse.nameAr,
      manufactureDate: row.manufactureDate ? toDateOnly(row.manufactureDate) : null,
      daysToExpiry: remaining,
      isExpired: remaining < 0,
      isNearExpiry: remaining >= 0 && row.expiryDate <= nearExpiryLimit,
      stockValue: money(new Prisma.Decimal(row.costPrice).mul(row.quantity)),
    });
  }
  return result;
}

/** Loads current stock for the given products so resumed items can render stock badges. */
async function loadProductStock(
  productIds: string[],
): Promise<Map<string, { totalStock: number; nearestExpiry: string | null }>> {
  const unique = [...new Set(productIds)];
  const result = new Map<string, { totalStock: number; nearestExpiry: string | null }>();
  if (unique.length === 0) return result;

  const [totals, expiries] = await Promise.all([
    prisma.batch.groupBy({
      by: ['productId'],
      where: { productId: { in: unique }, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    prisma.batch.groupBy({
      by: ['productId'],
      where: { productId: { in: unique }, quantity: { gt: 0 } },
      _min: { expiryDate: true },
    }),
  ]);

  for (const row of totals) {
    result.set(row.productId, {
      totalStock: row._sum.quantity ?? 0,
      nearestExpiry: null,
    });
  }
  for (const row of expiries) {
    const existing = result.get(row.productId) ?? { totalStock: 0, nearestExpiry: null };
    existing.nearestExpiry = row._min.expiryDate ? toDateOnly(row._min.expiryDate) : null;
    result.set(row.productId, existing);
  }

  return result;
}

async function toSaleDto(row: SaleWithDetails, role: Role): Promise<SaleDto> {
  const canViewCost = hasPermission(role, 'cost:view');
  const [batchInfo, stock] = await Promise.all([
    loadBatchInfo(row.items.map((item) => item.batchId)),
    loadProductStock(row.items.map((item) => item.productId)),
  ]);

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    userId: row.userId,
    warehouseId: row.warehouseId,
    subtotal: money(row.subtotal),
    itemDiscount: money(row.itemDiscount),
    invoiceDiscount: money(row.invoiceDiscount),
    taxAmount: money(row.taxAmount),
    total: money(row.total),
    pointsUsed: row.pointsUsed,
    status: row.status.toLowerCase() as SaleDto['status'],
    note: row.note,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    items: row.items.map((item) => {
      const decorated = stock.get(item.productId) ?? { totalStock: 0, nearestExpiry: null };
      return {
        id: item.id,
        saleId: item.saleId,
        productId: item.productId,
        batchId: item.batchId,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        discount: money(item.discount),
        lineTotal: money(item.lineTotal),
        product: toProductListItem({ ...item.product, ...decorated }, canViewCost),
        batch: item.batchId ? batchInfo.get(item.batchId) : undefined,
      };
    }),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      saleId: payment.saleId,
      method: payment.method.toLowerCase() as PaymentMethodCode,
      amount: money(payment.amount),
      reference: payment.reference,
      createdAt: toIso(payment.createdAt),
    })),
    ...(row.customer ? { customer: toCustomerDto(row.customer) } : {}),
    ...(row.user ? { user: row.user } : {}),
  };
}

export async function getSaleDto(id: string, role: Role): Promise<SaleDto> {
  const row = await prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
  if (!row) throw new NotFoundError('الفاتورة غير موجودة');
  return toSaleDto(row, role);
}

// ---------------------------------------------------------------------------
// Totals & invoice numbering
// ---------------------------------------------------------------------------

interface ComputedTotals {
  subtotal: string;
  itemDiscount: string;
  invoiceDiscount: string;
  taxAmount: string;
  total: string;
}

/**
 * Recomputes invoice totals from the submitted lines using the exact same
 * arithmetic as the POS client, so a tampered payload cannot alter the total.
 */
function computeTotals(
  lines: Array<{ unitPrice: string; quantity: number; discount: string }>,
  submittedInvoiceDiscount: string,
): ComputedTotals {
  const subtotal = sumCurrency(lines.map((line) => multiplyCurrency(line.unitPrice, line.quantity)));
  const itemDiscount = sumCurrency(lines.map((line) => line.discount));
  const maxInvoiceDiscount = roundCurrency(
    Math.max(0, Number(subtotal) - Number(itemDiscount)),
  );
  const invoiceDiscount =
    compareCurrency(submittedInvoiceDiscount, maxInvoiceDiscount) > 0
      ? maxInvoiceDiscount
      : roundCurrency(Math.max(0, Number(submittedInvoiceDiscount)));
  const taxable = roundCurrency(Number(subtotal) - Number(itemDiscount) - Number(invoiceDiscount));
  const taxAmount = roundCurrency(Number(taxable) * Number(VAT_RATE));
  const total = roundCurrency(Number(taxable) + Number(taxAmount));
  return { subtotal, itemDiscount, invoiceDiscount, taxAmount, total };
}

/**
 * Aligns the submitted payments with the invoice total:
 *  - non-cash methods are taken at face value,
 *  - cash absorbs the remainder (a zero amount means "exact change"),
 *  - an underpayment short of the total is rejected.
 *
 * Completed sales must be paid in full; suspended holds keep only the
 * positive amounts the cashier already entered.
 */
function normalisePayments(
  payments: Array<{ method: PaymentMethodCode; amount: string; reference?: string | null }>,
  total: string,
  requireFullPayment: boolean,
): Array<{ method: PaymentMethodCode; amount: string; reference?: string | null }> {
  if (!requireFullPayment) {
    return payments
      .filter((payment) => Number(payment.amount) > 0)
      .map((payment) => ({ ...payment, amount: roundCurrency(payment.amount) }));
  }

  let remaining = total;
  const normalised: Array<{ method: PaymentMethodCode; amount: string; reference?: string | null }> = [];

  for (const payment of payments) {
    if (compareCurrency(remaining, '0.00') <= 0) break;
    const raw = roundCurrency(Math.max(0, Number(payment.amount)));
    const tentative = Number(raw) > 0 ? raw : remaining;
    const applied = compareCurrency(tentative, remaining) > 0 ? remaining : tentative;
    normalised.push({ ...payment, amount: applied });
    remaining = roundCurrency(Number(remaining) - Number(applied));
  }

  if (compareCurrency(remaining, '0.01') > 0) {
    throw new ValidationError('مبلغ الدفع أقل من إجمالي الفاتورة', { remaining });
  }
  if (normalised.length === 0) {
    normalised.push({ method: 'cash', amount: total, reference: null });
  }
  return normalised;
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const seq = (await tx.sale.count({ where: { invoiceNumber: { startsWith: `INV-${stamp}-` } } })) + 1;
    const candidate = `INV-${stamp}-${String(seq).padStart(5, '0')}`;
    const clash = await tx.sale.findFirst({ where: { invoiceNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `INV-${stamp}-${now.getTime().toString(36).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

interface CreateSaleOptions {
  status: 'COMPLETED' | 'SUSPENDED';
}

export async function createSale(
  input: SaleCreateInput | SaleSuspendInput,
  user: { id: string; role: Role },
  options: CreateSaleOptions,
): Promise<SaleDto> {
  const { status } = options;
  const totals = computeTotals(input.items, input.invoiceDiscount ?? '0.00');

  // Loyalty points redemption: 100 points = 1 currency unit discount.
  const pointsUsed = 'pointsUsed' in input ? Number(input.pointsUsed ?? 0) : 0;
  const pointsDiscount = roundCurrency(pointsUsed / POINTS_REDEMPTION_RATE);
  const payableTotal = roundCurrency(Number(totals.total) - Number(pointsDiscount));

  const payments = normalisePayments(
    input.payments ?? [],
    payableTotal,
    status === 'COMPLETED',
  );

  // The portion of the invoice deferred to the customer's account (آجل).
  const creditTotal =
    status === 'COMPLETED'
      ? sumCurrency(
          payments
            .filter((payment) => payment.method === 'credit')
            .map((payment) => payment.amount),
        )
      : '0.00';

  const createdId = await prisma.$transaction(async (tx) => {
    const warehouseId = await resolveWarehouseId(tx, input.warehouseId);

    let customer: {
      id: string;
      loyaltyPoints: number;
      creditLimit: Prisma.Decimal;
      currentBalance: Prisma.Decimal;
    } | null = null;
    if (input.customerId) {
      customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new NotFoundError('العميل غير موجود');
      // Validate that the customer has enough points to redeem.
      if (pointsUsed > customer.loyaltyPoints) {
        throw new ValidationError('نقاط غير كافية', { available: customer.loyaltyPoints, requested: pointsUsed });
      }
      if (pointsUsed > 0) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { loyaltyPoints: { decrement: pointsUsed } },
        });
      }
      // Credit sales may not exceed the customer's remaining credit line.
      if (compareCurrency(creditTotal, '0.00') > 0) {
        const limit = Number(customer.creditLimit);
        const balance = Number(customer.currentBalance);
        if (limit <= 0) {
          throw new ValidationError('الدفع الآجل غير متاح لهذا العميل');
        }
        if (Number(roundCurrency(balance + Number(creditTotal))) > limit) {
          const availableCredit = Number(roundCurrency(Math.max(0, limit - balance))).toFixed(2);
          throw new ValidationError(`المبلغ يتجاوز حد الائتمان المتاح (${availableCredit})`, {
            availableCredit,
          });
        }
      }
    }

    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true },
    });
    const activeProductIds = new Set(products.map((product) => product.id));
    const missing = productIds.filter((id) => !activeProductIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(`منتجات غير موجودة أو غير نشطة: ${missing.join(', ')}`);
    }

    const invoiceNumber = await nextInvoiceNumber(tx);
    const today = todayInBusinessTimezone();
    // Link the sale to the cashier's open shift for this warehouse. Sales made
    // without an open shift stay unlinked rather than being assigned to a
    // historical or another cashier's shift.
    const shift =
      status === 'COMPLETED'
        ? await findOpenShiftForWarehouse(tx, user.id, warehouseId)
        : null;
    const resolvedBatches: Array<{
      productId: string;
      batchId: string;
      quantity: number;
      costPrice: Prisma.Decimal;
    }> = [];

    for (const item of input.items) {
      const discount = roundCurrency(item.discount ?? '0.00');
      const gross = multiplyCurrency(item.unitPrice, item.quantity);
      if (compareCurrency(discount, gross) > 0) {
        throw new ValidationError('خصم الصنف أكبر من سعره', { productId: item.productId });
      }

      const batch = await resolveBatchForItem(tx, item, warehouseId, status, today);
      resolvedBatches.push({
        productId: item.productId,
        batchId: batch.id,
        quantity: item.quantity,
        costPrice: batch.costPrice,
      });
    }

    if (status === 'COMPLETED') {
      // Deduct stock FEFO-first inside the same transaction as the sale.
      for (const allocation of resolvedBatches) {
        const updated = await tx.batch.updateMany({
          where: { id: allocation.batchId, quantity: { gte: allocation.quantity } },
          data: { quantity: { decrement: allocation.quantity } },
        });
        if (updated.count === 0) {
          throw new InsufficientStockError('الكمية المتاحة لا تكفي لإتمام البيع', {
            batchId: allocation.batchId,
            requested: allocation.quantity,
          });
        }
        await tx.stockMovement.create({
          data: {
            productId: allocation.productId,
            batchId: allocation.batchId,
            warehouseId,
            type: 'ISSUE',
            quantity: allocation.quantity,
            unitCost: allocation.costPrice,
            reason: 'بيع',
            reference: invoiceNumber,
            userId: user.id,
          },
        });
      }
    }

    const sale = await tx.sale.create({
      data: {
        invoiceNumber,
        customerId: input.customerId ?? null,
        userId: user.id,
        warehouseId,
        shiftId: shift?.id ?? null,
        subtotal: totals.subtotal,
        itemDiscount: totals.itemDiscount,
        invoiceDiscount: totals.invoiceDiscount,
        taxAmount: totals.taxAmount,
        total: payableTotal,
        pointsUsed,
        status,
        note: input.note ?? null,
      },
    });

    await tx.saleItem.createMany({
      data: input.items.map((item, index) => ({
        saleId: sale.id,
        productId: item.productId,
        batchId: resolvedBatches[index]!.batchId,
        quantity: item.quantity,
        unitPrice: roundCurrency(item.unitPrice),
        discount: roundCurrency(item.discount ?? '0.00'),
        lineTotal: roundCurrency(
          Number(multiplyCurrency(item.unitPrice, item.quantity)) - Number(item.discount ?? '0.00'),
        ),
      })),
    });

    if (payments.length > 0) {
      await tx.payment.createMany({
        data: payments.map((payment) => ({
          saleId: sale.id,
          method: PAYMENT_METHOD_DB[payment.method],
          amount: payment.amount,
          reference: payment.reference ?? null,
        })),
      });
    }

    // Award loyalty points to the customer on completed sales: 1 point per
    // LOYALTY_POINTS_RATE currency units spent (rounded down).
    if (status === 'COMPLETED' && input.customerId) {
      const earned = Math.floor(Number(totals.total) / LOYALTY_POINTS_RATE);
      if (earned > 0) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { loyaltyPoints: { increment: earned } },
        });
      }
    }

    // Credit (آجل) sales grow the outstanding balance the debts module collects.
    if (status === 'COMPLETED' && input.customerId && compareCurrency(creditTotal, '0.00') > 0) {
      await tx.customer.update({
        where: { id: input.customerId },
        data: { currentBalance: { increment: creditTotal } },
      });
    }

    await recordAudit(
      {
        action: status === 'COMPLETED' ? 'sale.created' : 'sale.suspended',
        entityType: 'Sale',
        entityId: sale.id,
        after: { invoiceNumber, total: totals.total, status },
        userId: user.id,
      },
      tx,
    );

    return sale.id;
  });

  return getSaleDto(createdId, user.role);
}

async function resolveWarehouseId(tx: Prisma.TransactionClient, warehouseId?: string): Promise<string> {
  if (warehouseId) {
    const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, isActive: true } });
    if (!warehouse) throw new NotFoundError('المخزن غير موجود');
    return warehouse.id;
  }
  const fallback = await tx.warehouse.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!fallback) throw new ValidationError('لا يوجد مخزن نشط');
  return fallback.id;
}

/**
 * Picks the batch a line is served from: the requested batch when given,
 * otherwise the earliest-expiring batch with stock (FEFO).
 */
async function resolveBatchForItem(
  tx: Prisma.TransactionClient,
  item: { productId: string; batchId?: string | null; quantity: number },
  warehouseId: string,
  status: 'COMPLETED' | 'SUSPENDED',
  today: string,
) {
  if (item.batchId) {
    const batch = await tx.batch.findFirst({
      where: { id: item.batchId, productId: item.productId, warehouseId },
    });
    if (!batch) throw new NotFoundError('التشغيلة غير موجودة أو تخص مخزن آخر');
    if (status === 'COMPLETED') {
      if (batch.expiryDate.getTime() <= new Date(`${today}T00:00:00Z`).getTime()) {
        throw new ValidationError('التشغيلة منتهية الصلاحية', { batchId: batch.id });
      }
      if (batch.quantity < item.quantity) {
        throw new InsufficientStockError('الكمية المتاحة في هذه التشغيلة لا تكفي', {
          batchId: batch.id,
          available: batch.quantity,
        });
      }
    }
    return batch;
  }

  const candidates = await tx.batch.findMany({
    where: {
      productId: item.productId,
      warehouseId,
      quantity: { gte: item.quantity },
      ...(status === 'COMPLETED' ? { expiryDate: { gt: new Date(`${today}T00:00:00Z`) } } : {}),
    },
    orderBy: [{ expiryDate: 'asc' }, { quantity: 'desc' }],
    take: 1,
  });

  const batch = candidates[0];
  if (!batch) {
    throw status === 'COMPLETED'
      ? new InsufficientStockError('لا توجد كمية متاحة من هذا المنتج', { productId: item.productId })
      : new ValidationError('لا توجد كمية متاحة من هذا المنتج', { productId: item.productId });
  }
  return batch;
}

// ---------------------------------------------------------------------------
// Lifecycle: list / suspend / resume / void
// ---------------------------------------------------------------------------

const STATUS_DB: Record<'completed' | 'suspended' | 'voided', 'COMPLETED' | 'SUSPENDED' | 'VOIDED'> = {
  completed: 'COMPLETED',
  suspended: 'SUSPENDED',
  voided: 'VOIDED',
};

export async function listSales(
  query: SaleQuery,
  role: Role,
): Promise<Paginated<SaleDto>> {
  const where: Prisma.SaleWhereInput = {
    ...(query.status ? { status: STATUS_DB[query.status] } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.q
      ? {
          OR: [
            { invoiceNumber: { contains: query.q, mode: 'insensitive' } },
            { customer: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: SALE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.sale.count({ where }),
  ]);

  return buildPaginated(await Promise.all(rows.map((row) => toSaleDto(row, role))), total, query.page, query.pageSize);
}

export async function listSuspendedSales(role: Role): Promise<SaleDto[]> {
  const rows = await prisma.sale.findMany({
    where: { status: 'SUSPENDED' },
    include: SALE_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return Promise.all(rows.map((row) => toSaleDto(row, role)));
}

/** Re-opens a suspended sale for editing; stock is only deducted on completion. */
export async function resumeSale(id: string, role: Role): Promise<SaleDto> {
  const existing = await prisma.sale.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('الفاتورة المعلقة غير موجودة');
  if (existing.status !== 'SUSPENDED') {
    throw new ValidationError('هذه الفاتورة ليست معلقة');
  }
  return getSaleDto(id, role);
}

/**
 * Voids a completed sale and puts the units back on their original batches
 * (reverse `ISSUE` movement), which is what a cashier refund needs.
 */
export async function voidSale(id: string, reason: string, user: { id: string; role: Role }): Promise<SaleDto> {
  const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true, payments: true } });
  if (!sale) throw new NotFoundError('الفاتورة غير موجودة');
  if (sale.status === 'VOIDED') throw new ValidationError('الفاتورة ملغاة بالفعل');
  if (sale.status === 'SUSPENDED') throw new ValidationError('لا يمكن إلغاء فاتورة معلقة');

  // Credit (آجل) sales had increased the customer balance; voiding reverses it.
  const creditTotal = sumCurrency(
    sale.payments
      .filter((payment) => payment.method === 'CREDIT')
      .map((payment) => money(payment.amount)),
  );

  await prisma.$transaction(async (tx) => {
    // Conditional update: concurrent void requests cannot both create refunds.
    const voided = await tx.sale.updateMany({
      where: { id: sale.id, status: 'COMPLETED' },
      data: { status: 'VOIDED' },
    });
    if (voided.count === 0) {
      throw new ConflictError('الفاتورة ملغاة بالفعل أو لم تعد صالحة للإلغاء');
    }

    for (const item of sale.items) {
      if (!item.batchId) continue;
      await tx.batch.update({
        where: { id: item.batchId },
        data: { quantity: { increment: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          batchId: item.batchId,
          warehouseId: sale.warehouseId,
          type: 'RETURN_IN',
          quantity: item.quantity,
          reason: `إلغاء فاتورة ${sale.invoiceNumber}: ${reason}`,
          reference: sale.invoiceNumber,
          userId: user.id,
        },
      });
    }
    if (sale.customerId && compareCurrency(creditTotal, '0.00') > 0) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { currentBalance: { decrement: creditTotal } },
      });
    }

    // Attribute the refund to the drawer that actually pays the customer back.
    // The original sale keeps counting towards its own shift's gross payments,
    // and this refund row offsets the cash in the paying shift. When the sale
    // and the refund belong to the same shift the two effects cancel exactly.
    const refundShift = await findOpenShift(tx, user.id, sale.warehouseId);
    if (sale.payments.length > 0) {
      await tx.refund.createMany({
        data: sale.payments.map((payment) => ({
          saleId: sale.id,
          shiftId: refundShift?.id ?? null,
          method: payment.method,
          amount: payment.amount,
          reason,
          userId: user.id,
        })),
      });
    }

    await recordAudit(
      {
        action: 'sale.voided',
        entityType: 'Sale',
        entityId: sale.id,
        before: { status: sale.status },
        after: {
          status: 'VOIDED',
          reason,
          reversedCredit: creditTotal,
          refundShiftId: refundShift?.id ?? null,
          refundedAmount: money(
            sale.payments.reduce(
              (total, payment) => total.plus(payment.amount),
              new Prisma.Decimal(0),
            ),
          ),
        },
        userId: user.id,
      },
      tx,
    );
  });

  return getSaleDto(id, user.role);
}

// ---------------------------------------------------------------------------
// POS dashboards: best sellers & recently sold
// ---------------------------------------------------------------------------

function periodStart(period: SalePeriod): Date {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return startOfToday;
  if (period === 'week') return new Date(startOfToday.getTime() - 6 * 86_400_000);
  return new Date(startOfToday.getTime() - 29 * 86_400_000);
}

function recentStart(period: 'today' | 'week' | 'month' | '7d' | '30d'): Date {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return startOfToday;
    case 'week':
      return new Date(startOfToday.getTime() - 6 * 86_400_000);
    case 'month':
      return new Date(startOfToday.getTime() - 29 * 86_400_000);
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
  }
}

interface BestSellerRow {
  productId: string;
  units: number;
  invoices: number;
  revenue: string;
}

export async function getBestSellers(
  query: BestSellerQuery,
  role: Role,
): Promise<{ items: ProductListItem[]; total: number; page: number; pageSize: number }> {
  const gte = periodStart(query.period);
  const offset = (query.page - 1) * query.limit;
  const categoryFilter = query.categoryId
    ? Prisma.sql`AND p."categoryId" = ${query.categoryId}`
    : Prisma.empty;

  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<BestSellerRow[]>`
      SELECT si."productId" AS "productId",
             COALESCE(SUM(si.quantity), 0)::int AS units,
             COUNT(DISTINCT si."saleId")::int AS invoices,
             COALESCE(SUM(si."lineTotal"), 0)::text AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      WHERE s."status" = 'COMPLETED'
        AND s."createdAt" >= ${gte}
        AND p."isActive" = true
        ${categoryFilter}
      GROUP BY si."productId"
      ORDER BY units DESC, revenue DESC, si."productId" ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(DISTINCT si."productId")::int AS total
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      WHERE s."status" = 'COMPLETED'
        AND s."createdAt" >= ${gte}
        AND p."isActive" = true
        ${categoryFilter}
    `,
  ]);

  if (rows.length === 0) return { items: [], total: 0, page: query.page, pageSize: query.limit };

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.productId) } },
    include: { category: { select: { nameAr: true } } },
  });
  const stock = await loadProductStock(rows.map((row) => row.productId));
  const canViewCost = hasPermission(role, 'cost:view');
  const byId = new Map(products.map((product) => [product.id, product]));

  const items = rows.flatMap((row, index) => {
    const product = byId.get(row.productId);
    if (!product) return [];
    const decorated = stock.get(row.productId) ?? { totalStock: 0, nearestExpiry: null };
    return [
      {
        ...toProductListItem({ ...product, ...decorated }, canViewCost),
        unitsSold: row.units,
        invoicesCount: row.invoices,
        revenue: roundCurrency(row.revenue),
        rank: offset + index + 1,
      },
    ];
  });

  return { items, total: counted[0]?.total ?? items.length, page: query.page, pageSize: query.limit };
}

export async function getRecentSales(
  query: RecentSalesQuery,
  role: Role,
): Promise<{ items: ProductListItem[] }> {
  const gte = recentStart(query.period);
  const sales = await prisma.sale.findMany({
    where: { status: 'COMPLETED', createdAt: { gte } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, createdAt: true, items: { select: { productId: true, quantity: true } } },
  });

  const latest = new Map<string, { saleId: string; soldAt: string; quantity: number }>();
  for (const sale of sales) {
    for (const item of sale.items) {
      if (!latest.has(item.productId)) {
        latest.set(item.productId, {
          saleId: sale.id,
          soldAt: toIso(sale.createdAt),
          quantity: item.quantity,
        });
      }
    }
    if (latest.size >= query.limit) break;
  }

  const productIds = [...latest.keys()].slice(0, query.limit);
  if (productIds.length === 0) return { items: [] };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    include: { category: { select: { nameAr: true } } },
  });
  const stock = await loadProductStock(productIds);
  const canViewCost = hasPermission(role, 'cost:view');

  const items = products.map((product) => {
    const info = latest.get(product.id)!;
    const decorated = stock.get(product.id) ?? { totalStock: 0, nearestExpiry: null };
    return {
      ...toProductListItem({ ...product, ...decorated }, canViewCost),
      lastSoldAt: info.soldAt,
      lastQuantity: info.quantity,
      lastInvoiceId: info.saleId,
    };
  });

  return { items };
}
