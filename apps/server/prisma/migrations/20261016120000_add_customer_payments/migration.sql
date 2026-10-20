CREATE TABLE "customer_payments" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_payments_customerId_idx" ON "customer_payments"("customerId");
CREATE INDEX "customer_payments_createdAt_idx" ON "customer_payments"("createdAt");

ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
