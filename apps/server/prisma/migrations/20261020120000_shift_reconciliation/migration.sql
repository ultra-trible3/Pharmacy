-- Shift reconciliation: link sales/payments/refunds to shifts and persist the
-- closing snapshot. All new columns are additive so existing rows stay valid.

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('PAID_IN', 'PAID_OUT');

-- AlterTable: cash_drawers
ALTER TABLE "cash_drawers"
  ADD COLUMN "terminalId" TEXT,
  ADD COLUMN "variance" DECIMAL(14,2),
  ADD COLUMN "cashSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cardSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "walletSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "creditSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "customerCashTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cashRefunds" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "expensesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paidInTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paidOutTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "salesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "voidedSalesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expensesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "customerPaymentsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidInCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidOutCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "closedById" TEXT;

-- AlterTable: sales / customer_payments / expenses
ALTER TABLE "sales" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "customer_payments" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "expenses" ADD COLUMN "shiftId" TEXT;

-- CreateTable: refunds
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "shiftId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cash_movements
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_drawers_warehouseId_idx" ON "cash_drawers"("warehouseId");
CREATE INDEX "cash_drawers_terminalId_idx" ON "cash_drawers"("terminalId");
CREATE INDEX "cash_drawers_openedAt_idx" ON "cash_drawers"("openedAt");
CREATE INDEX "cash_drawers_closedById_idx" ON "cash_drawers"("closedById");
CREATE INDEX "sales_shiftId_idx" ON "sales"("shiftId");
CREATE INDEX "customer_payments_shiftId_idx" ON "customer_payments"("shiftId");
CREATE INDEX "expenses_shiftId_idx" ON "expenses"("shiftId");
CREATE INDEX "refunds_saleId_idx" ON "refunds"("saleId");
CREATE INDEX "refunds_shiftId_idx" ON "refunds"("shiftId");
CREATE INDEX "refunds_createdAt_idx" ON "refunds"("createdAt");
CREATE INDEX "cash_movements_shiftId_idx" ON "cash_movements"("shiftId");
CREATE INDEX "cash_movements_createdAt_idx" ON "cash_movements"("createdAt");

-- Concurrency safety: at most one open shift per cashier+warehouse and per
-- terminal. Prisma cannot express partial unique indexes, so they live here.
CREATE UNIQUE INDEX "cash_drawers_open_user_warehouse_key"
  ON "cash_drawers"("userId", "warehouseId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "cash_drawers_open_terminal_key"
  ON "cash_drawers"("terminalId") WHERE "status" = 'OPEN' AND "terminalId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_drawers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_drawers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_drawers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_drawers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cash_drawers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
