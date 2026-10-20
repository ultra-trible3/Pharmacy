-- Sales / POS migration: customers, sales, sale_items, payments, cash_drawers

CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'SUSPENDED', 'VOIDED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET', 'CREDIT');

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");
CREATE INDEX "customers_name_idx" ON "customers"("name");

CREATE TABLE "sales" (
  "id" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "customerId" TEXT,
  "userId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "itemDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "invoiceDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_invoiceNumber_key" ON "sales"("invoiceNumber");
CREATE INDEX "sales_customerId_idx" ON "sales"("customerId");
CREATE INDEX "sales_userId_idx" ON "sales"("userId");
CREATE INDEX "sales_status_idx" ON "sales"("status");
CREATE INDEX "sales_createdAt_idx" ON "sales"("createdAt");

CREATE TABLE "sale_items" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "batchId" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");
CREATE INDEX "payments_method_idx" ON "payments"("method");

CREATE TABLE "cash_drawers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expectedBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "closingBalance" DECIMAL(14,2),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_drawers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_drawers_userId_idx" ON "cash_drawers"("userId");
CREATE INDEX "cash_drawers_status_idx" ON "cash_drawers"("status");

ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cash_drawers" ADD CONSTRAINT "cash_drawers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
